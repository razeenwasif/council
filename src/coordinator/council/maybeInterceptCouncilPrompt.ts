/**
 * REPL-side hook for the deterministic council path.
 *
 * When `COUNCIL_DETERMINISTIC=1` is set AND council mode is on AND the
 * router would route this prompt to the council, this function takes
 * over: it calls `runCouncilFromToolContext` directly and injects the
 * resulting messages into the conversation, bypassing the LLM-coordinator
 * path entirely.
 *
 * Returns `true` when it handled the prompt — caller should early-return.
 * Returns `false` for every other case — caller should proceed with the
 * normal flow (e.g. `handlePromptSubmit`).
 *
 * This is opt-in (env flag) so the default behaviour stays the
 * battle-tested LLM-coordinator path. Once `/council run` has been
 * exercised enough in live sessions to verify the assistantMessage stub
 * and the rest of the spawn adapter, flip the default by removing the
 * env-flag check here.
 */

import type { Message } from '../../types/message.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { ToolUseContext } from '../../Tool.js'
import {
  createAssistantMessage,
  createUserMessage,
} from '../../utils/messages.js'
import { isCouncilMode } from './councilMode.js'
import { routePrompt } from './router/strategy.js'
import {
  CouncilCostCeilingError,
  CouncilMemberFailureError,
  CouncilTimeoutError,
} from './councilOrchestrator.js'
import { runCouncilFromToolContext } from './councilSpawn.js'

export interface MaybeInterceptInputs {
  input: string
  getToolUseContext: () => Promise<ToolUseContext> | ToolUseContext
  setMessages: (updater: (prev: Message[]) => Message[]) => void
  canUseTool?: CanUseToolFn
}

export async function maybeInterceptCouncilPrompt(
  opts: MaybeInterceptInputs,
): Promise<boolean> {
  // Opt-in only — keeps the default path unchanged.
  if (process.env.COUNCIL_DETERMINISTIC !== '1') return false

  // Council mode must be active. If the user has /council off (or never
  // turned it on), don't intercept.
  if (!isCouncilMode()) return false

  // Slash commands never get intercepted — they have their own dispatch.
  if (opts.input.trim().startsWith('/')) return false

  // Run the router. Solo prompts skip the council entirely; we only
  // intercept the council branch.
  const decision = await routePrompt(opts.input)
  if (decision.route !== 'council') return false

  // ── We're handling this prompt. ────────────────────────────────────
  const toolUseContext = await opts.getToolUseContext()

  // Inject the user message into the transcript so it appears like a
  // normal turn.
  opts.setMessages(prev => [
    ...prev,
    createUserMessage({ content: opts.input }),
  ])

  try {
    const result = await runCouncilFromToolContext({
      userPrompt: opts.input,
      toolUseContext,
      canUseTool: opts.canUseTool,
      // emitStatus could push interim messages into the transcript; for
      // now we keep them out so the final assistant message is the only
      // visible artifact. The AgentTool agent panel will show live
      // progress per voice independently.
      emitStatus: () => {},
    })

    opts.setMessages(prev => [
      ...prev,
      createAssistantMessage({ content: formatCouncilResult(result) }),
    ])
  } catch (err) {
    opts.setMessages(prev => [
      ...prev,
      createAssistantMessage({ content: formatCouncilError(err) }),
    ])
  }

  return true
}

// ──────────────────────────────────────────────────────────────────────
// Result / error formatting — exported for tests
// ──────────────────────────────────────────────────────────────────────

export function formatCouncilResult(result: {
  proposals: Array<{ role: string; modelId: string; text: string }>
  plan: { text: string }
  execution: { summary: string }
  reviews: Array<{ role: string; verdict: string; findings: string[] }>
  revised?: { summary: string }
  totalCostUsd: number
  totalDurationMs: number
}): string {
  const verdictTally = result.reviews.reduce<Record<string, number>>(
    (acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] ?? 0) + 1 }),
    {},
  )
  const tallyStr = ['pass', 'nit', 'concern', 'block']
    .filter(v => (verdictTally[v] ?? 0) > 0)
    .map(v => `${verdictTally[v]} ${v}`)
    .join(' · ')

  const lines: string[] = []
  lines.push(
    `**Council finished** — ${result.proposals.length} proposals, ${tallyStr}.`,
  )
  lines.push(
    `Duration: ${(result.totalDurationMs / 1000).toFixed(1)}s · Reported cost: $${result.totalCostUsd.toFixed(4)} (real cost in \`/stats\`).`,
  )
  if (result.revised) {
    lines.push('')
    lines.push(`Revision pass applied:`)
    lines.push(result.revised.summary)
  }
  lines.push('')
  lines.push('**Executor output**')
  lines.push(result.execution.summary)
  return lines.join('\n')
}

export function formatCouncilError(err: unknown): string {
  if (err instanceof CouncilTimeoutError) {
    return `Council timed out at stage **${err.stage}**${err.role ? ` (${err.role})` : ''} after ${err.timeoutMs}ms.`
  }
  if (err instanceof CouncilCostCeilingError) {
    return `Council hit cost ceiling ($${err.ceilingUsd}) at stage **${err.stage}**. Accumulated: $${err.accumulatedUsd.toFixed(4)}.`
  }
  if (err instanceof CouncilMemberFailureError) {
    const inner =
      err.underlying instanceof Error
        ? err.underlying.message
        : String(err.underlying)
    return `Council member **${err.role}** failed during **${err.stage}**: ${inner}`
  }
  return `Council run failed: ${err instanceof Error ? err.message : String(err)}`
}
