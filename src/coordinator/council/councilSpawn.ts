/**
 * Adapter that wires runCouncil() into openclaude's AgentTool dispatch.
 *
 * `runCouncil` is provider-agnostic — it expects four `CouncilAdapters`
 * callbacks (spawnProposal, spawnSynthesizer, spawnExecutor, spawnReview)
 * and orchestrates them deterministically. This module builds those
 * callbacks by invoking the existing `AgentTool.call()` machinery, which
 * is already production-tested by the LLM-coordinator path.
 *
 * ## Status
 *
 * The adapter is implemented end-to-end. The remaining integration step
 * is wiring `runCouncilFromToolContext` into a real call site — either:
 *
 *   (a) A REPL turn-handler hook that intercepts council-worthy prompts
 *       before they reach the LLM coordinator (the eventual goal — full
 *       deterministic path).
 *
 *   (b) A slash command (see `/council run`) that takes a prompt as an
 *       argument and orchestrates explicitly — useful for testing and
 *       for users who want to invoke the council on demand without the
 *       LLM-coordinator overhead.
 *
 * Option (b) ships now; (a) requires REPL surgery and lands later.
 *
 * ## Verification needed
 *
 * `assistantMessage` is normally provided by the LLM's tool-use turn;
 * when we drive AgentTool from a slash command there isn't one, so we
 * pass a synthetic stub with random UUIDs. Analytics events get bogus
 * IDs as a result — functionally harmless but worth knowing about. If
 * an internal openclaude pathway pulls fields off `assistantMessage`
 * beyond `.message.id` / `.requestId`, the stub may need extending —
 * watch the first live invocation for surprises.
 */

import { randomUUID } from 'crypto'
import { AgentTool } from '../../tools/AgentTool/AgentTool.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { ToolUseContext } from '../../Tool.js'
import { getSettings_DEPRECATED } from '../../utils/settings/settings.js'
import {
  COUNCIL_ROLES,
  formatProposalsForSynthesizer,
  runCouncil,
  type CouncilAdapters,
  type CouncilResult,
  type CouncilRole,
  type ExecutorResult,
  type Proposal,
  type Review,
  type ReviewVerdict,
  type SynthesizedPlan,
} from './councilOrchestrator.js'

// ──────────────────────────────────────────────────────────────────────
// Public wrapper — what callers should reach for
// ──────────────────────────────────────────────────────────────────────

export interface RunCouncilFromContextOptions {
  userPrompt: string
  toolUseContext: ToolUseContext
  canUseTool?: CanUseToolFn
  emitStatus?: (msg: string) => void
  costCeilingUsd?: number
  memberTimeoutMs?: number
  longTimeoutMs?: number
}

/**
 * Convenience entry point. Builds the spawn adapters from the given
 * tool-use context and runs the full council pipeline. Returns the
 * structured result that callers can format for display.
 */
export async function runCouncilFromToolContext(
  opts: RunCouncilFromContextOptions,
): Promise<CouncilResult> {
  const adapters = buildCouncilAdapters({
    toolUseContext: opts.toolUseContext,
    canUseTool: opts.canUseTool,
  })

  return runCouncil({
    userPrompt: opts.userPrompt,
    emitStatus: opts.emitStatus ?? (() => {}),
    costCeilingUsd: opts.costCeilingUsd,
    memberTimeoutMs: opts.memberTimeoutMs,
    longTimeoutMs: opts.longTimeoutMs,
    adapters,
  })
}

// ──────────────────────────────────────────────────────────────────────
// Adapter factory
// ──────────────────────────────────────────────────────────────────────

export interface BuildCouncilAdaptersInputs {
  toolUseContext: ToolUseContext
  canUseTool?: CanUseToolFn
}

/**
 * Construct the four spawn callbacks runCouncil expects, each backed by
 * an `AgentTool.call()` invocation with the right subagent_type.
 */
export function buildCouncilAdapters(
  inputs: BuildCouncilAdaptersInputs,
): CouncilAdapters {
  return {
    spawnProposal: async ({ role, userPrompt, signal }) =>
      proposalFromAgentTool({
        role,
        userPrompt,
        signal,
        ...inputs,
      }),

    spawnSynthesizer: async ({ userPrompt, proposals, signal }) =>
      synthesizerFromAgentTool({
        userPrompt,
        proposals,
        signal,
        ...inputs,
      }),

    spawnExecutor: async ({ userPrompt, plan, revisionContext, signal }) =>
      executorFromAgentTool({
        userPrompt,
        plan,
        revisionContext,
        signal,
        ...inputs,
      }),

    spawnReview: async ({ role, userPrompt, proposal, execution, signal }) =>
      reviewFromAgentTool({
        role,
        userPrompt,
        proposal,
        execution,
        signal,
        ...inputs,
      }),
  }
}

// ──────────────────────────────────────────────────────────────────────
// Per-stage AgentTool invocations
// ──────────────────────────────────────────────────────────────────────

interface CommonSpawnDeps {
  toolUseContext: ToolUseContext
  canUseTool?: CanUseToolFn
  signal: AbortSignal
}

async function proposalFromAgentTool(
  args: { role: CouncilRole; userPrompt: string } & CommonSpawnDeps,
): Promise<Proposal> {
  const start = Date.now()
  const result = await invokeAgentTool({
    subagent_type: args.role,
    description: `${capitalize(args.role)} proposal`,
    prompt: `You are one of seven council members. Produce your structured proposal for this request.\n\n${args.userPrompt}`,
    toolUseContext: args.toolUseContext,
    canUseTool: args.canUseTool,
    signal: args.signal,
  })

  return {
    role: args.role,
    modelId: args.role, // best we can know without surfacing the resolved model
    text: result.text,
    durationMs: Date.now() - start,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
  }
}

async function synthesizerFromAgentTool(
  args: { userPrompt: string; proposals: Proposal[] } & CommonSpawnDeps,
): Promise<SynthesizedPlan> {
  const start = Date.now()
  const synthInput =
    `Original user request:\n${args.userPrompt}\n\n` +
    `Five council proposals to reduce to one plan:\n\n` +
    formatProposalsForSynthesizer(args.proposals)

  const result = await invokeAgentTool({
    subagent_type: 'synthesizer',
    description: 'Synthesize council proposals',
    prompt: synthInput,
    toolUseContext: args.toolUseContext,
    canUseTool: args.canUseTool,
    signal: args.signal,
  })

  return {
    text: result.text,
    modelId: 'synthesizer',
    durationMs: Date.now() - start,
    costUsd: result.costUsd,
  }
}

async function executorFromAgentTool(
  args: {
    userPrompt: string
    plan: SynthesizedPlan
    revisionContext?: {
      previousDiff: string
      blockingReviews: Review[]
    }
  } & CommonSpawnDeps,
): Promise<ExecutorResult> {
  const start = Date.now()

  const prompt = args.revisionContext
    ? buildRevisionPrompt(args.userPrompt, args.plan, args.revisionContext)
    : buildExecutorPrompt(args.userPrompt, args.plan)

  const result = await invokeAgentTool({
    subagent_type: 'executor',
    description: args.revisionContext ? 'Apply revision edits' : 'Execute council plan',
    prompt,
    toolUseContext: args.toolUseContext,
    canUseTool: args.canUseTool,
    signal: args.signal,
  })

  // The executor's "diff" is whatever it summarised at the end. The real
  // diff is on disk — the result.text contains the summary it produced.
  return {
    diff: result.text,
    summary: result.text,
    modelId: 'executor',
    durationMs: Date.now() - start,
    costUsd: result.costUsd,
  }
}

async function reviewFromAgentTool(
  args: {
    role: CouncilRole
    userPrompt: string
    proposal: Proposal
    execution: ExecutorResult
  } & CommonSpawnDeps,
): Promise<Review> {
  const start = Date.now()
  const reviewInput =
    `Original user request:\n${args.userPrompt}\n\n` +
    `Your original proposal (you are the ${args.role}):\n${args.proposal.text}\n\n` +
    `Executor's diff and summary:\n${args.execution.summary}\n\n` +
    `Review this diff. Your verdict must be one of: pass, nit, concern, block. ` +
    `Begin your response with the verdict word, then a short reason.`

  const result = await invokeAgentTool({
    subagent_type: args.role,
    description: `${capitalize(args.role)} review`,
    prompt: reviewInput,
    toolUseContext: args.toolUseContext,
    canUseTool: args.canUseTool,
    signal: args.signal,
  })

  const verdict = parseVerdict(result.text)

  return {
    role: args.role,
    verdict,
    findings: [result.text],
    modelId: args.role,
    durationMs: Date.now() - start,
    costUsd: result.costUsd,
  }
}

// ──────────────────────────────────────────────────────────────────────
// AgentTool driver — the only place where we talk to the AgentTool API
// ──────────────────────────────────────────────────────────────────────

interface InvokeAgentToolInputs {
  subagent_type: string
  description: string
  prompt: string
  toolUseContext: ToolUseContext
  canUseTool?: CanUseToolFn
  signal: AbortSignal
}

interface InvokeAgentToolResult {
  text: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

/**
 * Drive `AgentTool.call()` with the given input. Returns the final result
 * text and token/cost metadata. Throws on agent error or abort.
 *
 * Notes:
 *   - `assistantMessage` is synthetic. See file header.
 *   - `canUseTool` defaults to "always allow" — fine for council members
 *     which have a restricted tool set; the executor's broader tools rely
 *     on its own `permissionMode: 'bypassPermissions'` setting.
 */
async function invokeAgentTool(
  args: InvokeAgentToolInputs,
): Promise<InvokeAgentToolResult> {
  // Stub assistantMessage. AgentTool reads .message.id and .requestId for
  // toolUseID composition and analytics attribution. Random UUIDs are
  // sufficient — no real-world hook depends on them being meaningful.
  //
  // KNOWN INTEGRATION ISSUE: when invoked from the deterministic path
  // (COUNCIL_DETERMINISTIC=1), this stub is missing fields that the
  // LLM-coordinator path supplies naturally. First live attempt failed
  // with "Cannot read properties of undefined (reading 'startsWith')" —
  // most likely candidates: missing `model` input field default, missing
  // `assistantMessage.parentRequestId` / similar, or a downstream code
  // path that assumes a field this stub doesn't include. Needs a stack
  // trace from a live failure to pinpoint. Until fixed, COUNCIL_DETER-
  // MINISTIC=1 callers fall back to the LLM-coordinator path by unsetting
  // the env flag.
  const stubAssistantMessage = {
    message: { id: randomUUID() },
    requestId: randomUUID(),
    // Defensive extras — fields we know AgentTool / runAgent reach for
    // in some branches. Doesn't hurt to provide them even if unused.
    parentRequestId: undefined,
    role: 'assistant' as const,
    type: 'assistant' as const,
  } as unknown as Parameters<typeof AgentTool.call>[3]

  const stubCanUseTool: CanUseToolFn =
    args.canUseTool ??
    (async () => ({ behavior: 'allow' as const, updatedInput: undefined }))

  // Patch the toolUseContext for deterministic-path invocations.
  // Each fix below was tracked down from a specific live-failure stack:
  //   1. mainLoopModel — getAgentModel → getBedrockRegionPrefix →
  //      extractModelIdFromArn does `modelId.startsWith('arn:')` on
  //      undefined.
  //   2. abortController — runAgent line 531 reads `toolUseContext.
  //      abortController.signal` unconditionally for sync agents.
  // The LLM-coordinator path supplies both naturally because openclaude's
  // tool-use loop populates them before dispatch; from a slash-command
  // hook context, neither may be set yet.
  const patchedContext = ensureAbortController(
    ensureMainLoopModel(args.toolUseContext),
    args.signal,
  )

  // AgentTool.call returns a Promise<{ data }> — a single terminal result,
  // not a stream. Race it against the abort signal so the orchestrator's
  // per-member timeout can unblock even when AgentTool's internal work
  // doesn't observe our signal directly. (AgentTool may keep running in
  // the background after the race; orchestration unblocks regardless.)
  //
  // We wrap the call in a try/catch so any synchronous-throw or unhandled
  // rejection becomes a labelled error including the subagent_type and
  // the underlying message — much easier to triage than a bare
  // "Cannot read properties of undefined" coming from deep inside the
  // openclaude internals.
  const callPromise: Promise<unknown> = (async () => {
    try {
      return await AgentTool.call(
        {
          prompt: args.prompt,
          subagent_type: args.subagent_type,
          description: args.description,
        } as Parameters<typeof AgentTool.call>[0],
        patchedContext,
        stubCanUseTool,
        stubAssistantMessage,
      )
    } catch (err) {
      const inner = err instanceof Error ? err.message : String(err)
      // Pull the first ~10 stack frames so the next failure surfaces the
      // exact site of the crash without dumping the whole thing.
      const stackTail =
        err instanceof Error && err.stack
          ? '\n\nStack (top frames):\n' +
            err.stack.split('\n').slice(0, 12).join('\n')
          : ''
      const enriched = new Error(
        `AgentTool.call failed for subagent_type="${args.subagent_type}" via deterministic spawn adapter: ${inner}. ` +
          `If you're running with COUNCIL_DETERMINISTIC=1, drop the env flag to fall back to the LLM-coordinator path while we iterate.` +
          stackTail,
      )
      if (err instanceof Error && err.stack) {
        ;(enriched as Error & { cause?: unknown }).cause = err
      }
      throw enriched
    }
  })()

  const abortPromise = new Promise<never>((_, reject) => {
    args.signal.addEventListener(
      'abort',
      () =>
        reject(
          new Error(`AgentTool spawn for ${args.subagent_type} aborted`),
        ),
      { once: true },
    )
  })

  const result = (await Promise.race([callPromise, abortPromise])) as {
    data?: {
      status?: string
      content?: Array<{ type?: string; text?: string }>
      usage?: {
        input_tokens?: number
        output_tokens?: number
      }
    }
  }

  if (!result?.data) {
    throw new Error(
      `AgentTool spawn for ${args.subagent_type} returned no data`,
    )
  }

  // Extract text from the agent's final content. Source candidates in order
  // of preference — the AgentTool result shape isn't single-canonical across
  // every code path (sub-agent vs teammate vs forked-agent flows differ
  // slightly), so we look at a few places. If none work, we synthesize a
  // brief summary from tool_use blocks so the orchestrator can keep going
  // rather than aborting the whole council on a quiet "no text" return.
  const text = extractResultText(result.data) || synthesizeToolUseSummary(result.data)

  if (!text) {
    // Genuinely empty — include a redacted snapshot of the result shape so
    // the next failure points at the real issue instead of a vague string.
    const shape = describeResultShape(result.data)
    throw new Error(
      `AgentTool spawn for ${args.subagent_type} returned no text and no tool use to summarize. ` +
        `Result shape: ${shape}. Most likely the agent emitted only tool_uses and the AgentTool's text-fallback logic didn't surface earlier text content — paste this whole error for triage.`,
    )
  }

  const inputTokens = result.data.usage?.input_tokens ?? 0
  const outputTokens = result.data.usage?.output_tokens ?? 0
  // The AgentTool result shape doesn't expose a flat cost_usd; the cost
  // tracker accumulates it elsewhere. Leave at 0 — runCouncil's cost
  // ceiling won't be triggered by this path until we surface real cost.
  const costUsd = 0

  return { text, inputTokens, outputTokens, costUsd }
}

// ──────────────────────────────────────────────────────────────────────
// AgentTool result parsing — robust to a few shape variations
// ──────────────────────────────────────────────────────────────────────

interface AgentToolResultData {
  content?: Array<{ type?: string; text?: string; name?: string; input?: unknown }>
  text?: string
  summary?: string
  message?: { content?: unknown }
  status?: string
  totalToolUseCount?: number
  usage?: { input_tokens?: number; output_tokens?: number }
}

/**
 * Try to extract a string of the agent's final answer text from the result.
 * The AgentTool's result shape isn't single-canonical (teammate, sub-agent,
 * forked-agent paths differ); look at multiple places.
 */
export function extractResultText(data: AgentToolResultData): string {
  // 1. content array of {type, text} blocks (most common)
  if (Array.isArray(data.content)) {
    const text = data.content
      .filter(c => c?.type === 'text' && typeof c.text === 'string')
      .map(c => c.text!)
      .join('\n')
      .trim()
    if (text) return text
  }

  // 2. flat text field (some sub-agent paths)
  if (typeof data.text === 'string' && data.text.trim()) {
    return data.text.trim()
  }

  // 3. summary field (alternate)
  if (typeof data.summary === 'string' && data.summary.trim()) {
    return data.summary.trim()
  }

  // 4. nested message.content (when AgentTool returns a wrapped message)
  if (data.message?.content) {
    const inner = data.message.content
    if (typeof inner === 'string' && inner.trim()) return inner.trim()
    if (Array.isArray(inner)) {
      const text = (inner as Array<{ type?: string; text?: string }>)
        .filter(c => c?.type === 'text' && typeof c.text === 'string')
        .map(c => c.text!)
        .join('\n')
        .trim()
      if (text) return text
    }
  }

  return ''
}

/**
 * If the agent finished with no final text (only tool_uses), synthesize a
 * brief summary so the orchestrator can keep going with a degraded
 * proposal rather than aborting the whole council. Mentions the tools
 * the agent called and that no final answer was produced — useful
 * signal for the synthesizer which can weigh this member's input lower.
 */
export function synthesizeToolUseSummary(data: AgentToolResultData): string {
  if (!Array.isArray(data.content)) return ''

  const tools = data.content
    .filter(c => c?.type === 'tool_use' && typeof c.name === 'string')
    .map(c => c.name!)

  if (tools.length === 0) return ''

  const uniqueTools = Array.from(new Set(tools))
  return (
    `## Reasoning\nAgent exited after ${tools.length} tool call(s) (${uniqueTools.join(', ')}) without producing a final proposal text. ` +
    `Treat this voice as low-confidence for the synthesis pass.\n\n` +
    `## Proposal\nNo concrete proposal produced — defer to the other council members.\n\n` +
    `## Risks\nNon-finalising agent run — may indicate an infrastructure issue (maxTurns, tool-loop, or model alignment failure).`
  )
}

/**
 * Compact description of a result object for diagnostic error messages —
 * shows which fields are present and their types/sizes without leaking
 * full payloads.
 */
export function describeResultShape(data: AgentToolResultData): string {
  const parts: string[] = []
  if (data.status) parts.push(`status="${data.status}"`)
  if (Array.isArray(data.content)) {
    const blockTypes = data.content.map(c => c?.type ?? 'unknown')
    parts.push(`content=[${blockTypes.join(', ')}]`)
  } else if ('content' in data) {
    parts.push(`content=<${typeof data.content}>`)
  }
  if (typeof data.text === 'string') parts.push(`text.len=${data.text.length}`)
  if (typeof data.summary === 'string') parts.push(`summary.len=${data.summary.length}`)
  if (typeof data.totalToolUseCount === 'number') {
    parts.push(`totalToolUseCount=${data.totalToolUseCount}`)
  }
  if (data.usage) parts.push(`usage.input=${data.usage.input_tokens ?? 0},output=${data.usage.output_tokens ?? 0}`)
  return parts.length ? `{ ${parts.join(', ')} }` : '<empty>'
}

// ──────────────────────────────────────────────────────────────────────
// Context patching — fills mainLoopModel when undefined
// ──────────────────────────────────────────────────────────────────────

const FALLBACK_MAIN_LOOP_MODEL = 'claude-opus-4-7'

/**
 * Return a ToolUseContext with `abortController` guaranteed to be a
 * non-null AbortController. `runAgent` reads `toolUseContext.abortController.
 * signal` unconditionally for sync agents (runAgent.ts:531/538), so an
 * undefined `abortController` field crashes the spawn before any agent
 * work happens.
 *
 * If the context already has one, use it as-is. Otherwise, create a
 * fresh AbortController linked to the orchestrator's per-member abort
 * signal — so when the orchestrator's per-member timeout fires, the
 * spawn's internal work aborts too.
 */
export function ensureAbortController(
  ctx: ToolUseContext,
  parentSignal: AbortSignal,
): ToolUseContext {
  if (ctx.abortController instanceof AbortController) return ctx

  const ac = new AbortController()

  // Propagate the orchestrator's per-member abort signal so timeouts
  // reach the underlying agent. Use { once: true } so we don't leak
  // listeners across many parallel spawns.
  if (parentSignal.aborted) {
    ac.abort()
  } else {
    parentSignal.addEventListener('abort', () => ac.abort(), { once: true })
  }

  return { ...ctx, abortController: ac }
}

/**
 * Return a ToolUseContext with `options.mainLoopModel` guaranteed to be a
 * non-empty string. The LLM-coordinator path populates this naturally;
 * the deterministic spawn path drives AgentTool from a slash command /
 * REPL hook where it may be undefined. AgentTool then passes it to
 * `getBedrockRegionPrefix` which `.startsWith`s it unconditionally.
 *
 * Source order: existing value → settings.model from ~/.openclaude/
 * settings.json → hardcoded Anthropic fallback. The picked value only
 * affects internal Bedrock region inference (which doesn't apply for
 * Anthropic OAuth or other providers) and analytics — model selection
 * for each council agent still comes from the agent definition or
 * agentRouting, not from this.
 */
export function ensureMainLoopModel(
  ctx: ToolUseContext,
): ToolUseContext {
  if (
    typeof ctx.options?.mainLoopModel === 'string' &&
    ctx.options.mainLoopModel.length > 0
  ) {
    return ctx
  }

  let resolved: string | undefined
  try {
    const settings = getSettings_DEPRECATED() as { model?: string } | undefined
    resolved =
      typeof settings?.model === 'string' && settings.model.length > 0
        ? settings.model
        : undefined
  } catch {
    // Settings read can fail in tests / non-standard contexts. Fall through
    // to the hardcoded default.
  }

  return {
    ...ctx,
    options: {
      ...ctx.options,
      mainLoopModel: resolved ?? FALLBACK_MAIN_LOOP_MODEL,
    },
  }
}

// ──────────────────────────────────────────────────────────────────────
// Pure helpers — exported for tests
// ──────────────────────────────────────────────────────────────────────

export function parseVerdict(text: string): ReviewVerdict {
  // Look at the first 200 chars; verdicts should appear at the start.
  const head = text.slice(0, 200).toLowerCase()
  // Order matters — check "block" before "concern" so "no blockers" isn't
  // mis-parsed (it would match "block" with the simple includes; the
  // negation pattern is rare enough that we tolerate it; tighten later
  // if real-world reviews keep using such phrasing).
  if (/\bblock\b/.test(head)) return 'block'
  if (/\bconcern\b/.test(head)) return 'concern'
  if (/\bnit\b/.test(head)) return 'nit'
  if (/\bpass\b/.test(head)) return 'pass'
  // No clear verdict — treat as concern so it appears in the count but
  // doesn't force a revision.
  return 'concern'
}

export function buildExecutorPrompt(
  userPrompt: string,
  plan: SynthesizedPlan,
): string {
  return (
    `Original user request:\n${userPrompt}\n\n` +
    `Synthesized council plan (execute exactly this):\n${plan.text}\n\n` +
    `Make the changes the plan describes. When done, summarize what changed (files touched + tests run).`
  )
}

export function buildRevisionPrompt(
  userPrompt: string,
  plan: SynthesizedPlan,
  ctx: { previousDiff: string; blockingReviews: Review[] },
): string {
  const blocks = ctx.blockingReviews
    .map(r => `- ${capitalize(r.role)}: ${r.findings.join(' ')}`)
    .join('\n')

  return (
    `Original user request:\n${userPrompt}\n\n` +
    `Original synthesized plan:\n${plan.text}\n\n` +
    `Previous executor summary:\n${ctx.previousDiff}\n\n` +
    `Blocking review concerns (${ctx.blockingReviews.length}):\n${blocks}\n\n` +
    `Revise the implementation to address each blocking concern above. Make explicit edits — do not skip or refuse. Summarize the revised state when done.`
  )
}

function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s
}

// Re-export so callers can pull everything from this module.
export { runCouncil, COUNCIL_ROLES }
export type { CouncilResult, Proposal, SynthesizedPlan, ExecutorResult, Review }
