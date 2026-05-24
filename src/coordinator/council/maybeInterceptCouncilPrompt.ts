/**
 * REPL-side hook for the deterministic council path.
 *
 * **Default path as of v1.x** — when council mode is on AND the router
 * would route this prompt to the council, this function takes over: it
 * calls `runCouncilFromToolContext` directly and injects the resulting
 * messages into the conversation. The LLM-coordinator-with-strict-prompt
 * path is no longer the default; use `COUNCIL_LLM_COORDINATOR=1` to
 * opt back into it (escape hatch for rare edge cases or debugging).
 *
 * Returns `true` when it handled the prompt — caller should early-return.
 * Returns `false` for every other case — caller should proceed with the
 * normal flow (e.g. `handlePromptSubmit`).
 *
 * History: shipped behind `COUNCIL_DETERMINISTIC=1` for live-session
 * verification; default was flipped after the deterministic path
 * completed a full 7-voice run end-to-end (commits 578b2f6 through
 * ed0c355 trace the bug-by-bug integration walkthrough).
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
  // Escape hatch — `COUNCIL_LLM_COORDINATOR=1` opts back into the
  // pre-flip LLM-coordinator path. Useful if the deterministic path
  // hits an unforeseen edge case and the user needs the old behaviour
  // without recompiling. Default behaviour (no env flag) is the
  // deterministic path.
  if (process.env.COUNCIL_LLM_COORDINATOR === '1') return false

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
