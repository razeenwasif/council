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
import { AGENT_TOOL_NAME } from '../../tools/AgentTool/constants.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { createProgressMessage, SYNTHETIC_MODEL } from '../../utils/messages.js'
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

/** What the caller hands us for transcript injection. We use it to push
 *  synthetic `tool_use` assistant messages (one per spawn, grouped by a
 *  shared `message.id`) so the grouped-tool-use renderer paints the panel
 *  the same way it does for the LLM-coordinator path. */
export type SetMessagesFn = (updater: (prev: Message[]) => Message[]) => void

// ──────────────────────────────────────────────────────────────────────
// Public wrapper — what callers should reach for
// ──────────────────────────────────────────────────────────────────────

export interface RunCouncilFromContextOptions {
  userPrompt: string
  toolUseContext: ToolUseContext
  canUseTool?: CanUseToolFn
  emitStatus?: (msg: string) => void
  /** When provided, the adapter injects grouped `tool_use` placeholder
   *  messages so the multi-agent panel renders (the `7 agents finished`
   *  tree). Without it, the deterministic path still works — it just
   *  doesn't render the panel. */
  setMessages?: SetMessagesFn
  costCeilingUsd?: number
  memberTimeoutMs?: number
  longTimeoutMs?: number
}

/**
 * Run a single council agent (typically the executor) one-shot — no
 * propose/synthesize/review pipeline, no orchestrator. Useful for slash
 * commands like `/handoff` that want one agent to do one thing with
 * full filesystem access. Pipes progress + result through the same
 * panel injection as the council path when `setMessages` is provided.
 *
 * Returns the raw text the agent emitted as its final output. Throws
 * with a labelled error on agent failure or abort.
 */
export interface RunSingleAgentOptions {
  subagent_type: string
  description: string
  prompt: string
  toolUseContext: ToolUseContext
  canUseTool?: CanUseToolFn
  setMessages?: SetMessagesFn
  signal?: AbortSignal
}

export async function runSingleAgentFromToolContext(
  opts: RunSingleAgentOptions,
): Promise<InvokeAgentToolResult> {
  // Optional panel injection — same shape as the council's `prepareSingle`
  // hook. We allocate a tool_use_id and inject a placeholder so the
  // grouped-tool-use renderer paints a row for the live spawn.
  let parentToolUseId: string | undefined
  if (opts.setMessages) {
    parentToolUseId = randomUUID()
    const messageId = randomUUID()
    const setMessages = opts.setMessages
    setMessages(prev => [
      ...prev,
      buildAgentToolUsePlaceholder({
        messageId,
        toolUseId: parentToolUseId!,
        subagent_type: opts.subagent_type,
        description: opts.description,
        prompt: opts.prompt,
      }),
    ])
  }

  // Use the caller's signal if given; otherwise a no-op AbortController.
  // (invokeAgentTool requires a signal to wire its abort race; passing one
  // that never fires is the right "no cancellation" semantics.)
  const ac = new AbortController()
  if (opts.signal) {
    if (opts.signal.aborted) ac.abort()
    else opts.signal.addEventListener('abort', () => ac.abort(), { once: true })
  }

  try {
    const result = await invokeAgentTool({
      subagent_type: opts.subagent_type,
      description: opts.description,
      prompt: opts.prompt,
      toolUseContext: applyToolUseIdOverride(opts.toolUseContext, parentToolUseId),
      canUseTool: opts.canUseTool,
      signal: ac.signal,
      parentToolUseId,
      setMessages: opts.setMessages,
    })

    if (opts.setMessages && parentToolUseId) {
      const setMessages = opts.setMessages
      setMessages(prev => [
        ...prev,
        buildAgentToolResultMessage({
          toolUseId: parentToolUseId!,
          status: 'success',
          summary: result.text,
        }),
      ])
    }
    return result
  } catch (err) {
    if (opts.setMessages && parentToolUseId) {
      const setMessages = opts.setMessages
      setMessages(prev => [
        ...prev,
        buildAgentToolResultMessage({
          toolUseId: parentToolUseId!,
          status: 'error',
          summary: err instanceof Error ? err.message : String(err),
        }),
      ])
    }
    throw err
  }
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
    setMessages: opts.setMessages,
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
  /** When provided, the panel hooks (`prepareBatch`, `prepareSingle`,
   *  `completeMember`) are wired and inject grouped `tool_use` /
   *  `tool_result` messages into the transcript. Without it, those hooks
   *  are omitted entirely and `runCouncil` runs headless. */
  setMessages?: SetMessagesFn
}

/**
 * Construct the spawn + panel callbacks runCouncil expects, each backed
 * by an `AgentTool.call()` invocation with the right subagent_type.
 */
export function buildCouncilAdapters(
  inputs: BuildCouncilAdaptersInputs,
): CouncilAdapters {
  return {
    spawnProposal: async ({ role, userPrompt, toolUseId, signal }) =>
      proposalFromAgentTool({
        role,
        userPrompt,
        toolUseId,
        signal,
        toolUseContext: inputs.toolUseContext,
        canUseTool: inputs.canUseTool,
        setMessages: inputs.setMessages,
      }),

    spawnSynthesizer: async ({ userPrompt, proposals, toolUseId, signal }) =>
      synthesizerFromAgentTool({
        userPrompt,
        proposals,
        toolUseId,
        signal,
        toolUseContext: inputs.toolUseContext,
        canUseTool: inputs.canUseTool,
        setMessages: inputs.setMessages,
      }),

    spawnExecutor: async ({ userPrompt, plan, revisionContext, toolUseId, signal }) =>
      executorFromAgentTool({
        userPrompt,
        plan,
        revisionContext,
        toolUseId,
        signal,
        toolUseContext: inputs.toolUseContext,
        canUseTool: inputs.canUseTool,
        setMessages: inputs.setMessages,
      }),

    spawnReview: async ({ role, userPrompt, proposal, execution, toolUseId, signal }) =>
      reviewFromAgentTool({
        role,
        userPrompt,
        proposal,
        execution,
        toolUseId,
        signal,
        toolUseContext: inputs.toolUseContext,
        canUseTool: inputs.canUseTool,
        setMessages: inputs.setMessages,
      }),

    // Panel hooks — only wired when caller supplied setMessages.
    ...(inputs.setMessages
      ? buildPanelHooks(inputs.setMessages)
      : {}),
  }
}

// ──────────────────────────────────────────────────────────────────────
// Panel hooks — synthesize the messages the grouped renderer expects
// ──────────────────────────────────────────────────────────────────────

/**
 * Build the optional `prepareBatch` / `prepareSingle` / `completeMember`
 * hooks that inject the grouped tool_use placeholder messages. Pulling
 * the logic out keeps the adapter factory readable.
 */
function buildPanelHooks(
  setMessages: SetMessagesFn,
): Pick<CouncilAdapters, 'prepareBatch' | 'prepareSingle' | 'completeMember'> {
  return {
    prepareBatch: async ({ kind, roles }) => {
      const messageId = randomUUID()
      const map = new Map<CouncilRole, string>()
      const placeholders: Message[] = []
      for (const role of roles) {
        const toolUseId = randomUUID()
        map.set(role, toolUseId)
        placeholders.push(
          buildAgentToolUsePlaceholder({
            messageId,
            toolUseId,
            subagent_type: role,
            description:
              kind === 'proposal'
                ? `${capitalize(role)} proposal`
                : `${capitalize(role)} review`,
            prompt: `Council ${kind} for ${role}`,
          }),
        )
      }
      setMessages(prev => [...prev, ...placeholders])
      return map
    },

    prepareSingle: async ({ kind, description }) => {
      const messageId = randomUUID()
      const toolUseId = randomUUID()
      const subagent_type =
        kind === 'synthesizer' ? 'synthesizer' : 'executor'
      setMessages(prev => [
        ...prev,
        buildAgentToolUsePlaceholder({
          messageId,
          toolUseId,
          subagent_type,
          description,
          prompt: `Council ${kind}`,
        }),
      ])
      return toolUseId
    },

    completeMember: async ({ toolUseId, status, summary }) => {
      setMessages(prev => [
        ...prev,
        buildAgentToolResultMessage({
          toolUseId,
          status,
          summary: summary ?? '',
        }),
      ])
    },
  }
}

/**
 * Synthesize an assistant message containing a single `tool_use` block
 * for the AgentTool. Shared `messageId` across siblings is what triggers
 * the grouped-rendering path (see `applyGrouping` in `utils/groupToolUses.ts`
 * — it keys groups by `messageId:toolName` and only groups when ≥2 are
 * present in the same message).
 */
function buildAgentToolUsePlaceholder(opts: {
  messageId: string
  toolUseId: string
  subagent_type: string
  description: string
  prompt: string
}): Message {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      id: opts.messageId,
      container: null,
      model: SYNTHETIC_MODEL,
      role: 'assistant',
      stop_reason: 'tool_use',
      stop_sequence: '',
      type: 'message',
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
        service_tier: null,
        cache_creation: {
          ephemeral_1h_input_tokens: 0,
          ephemeral_5m_input_tokens: 0,
        },
        inference_geo: null,
        iterations: null,
        speed: null,
      },
      content: [
        {
          type: 'tool_use',
          id: opts.toolUseId,
          name: AGENT_TOOL_NAME,
          input: {
            subagent_type: opts.subagent_type,
            description: opts.description,
            prompt: opts.prompt,
          },
        },
      ],
      context_management: null,
    },
    requestId: undefined,
    isVirtual: true,
  } as unknown as Message
}

/**
 * Synthesize a user message containing a `tool_result` block that matches
 * a previously-injected `tool_use`. This is what flips the grouped
 * renderer's `isResolved` / `isError` flags for each agent cell.
 */
function buildAgentToolResultMessage(opts: {
  toolUseId: string
  status: 'success' | 'error'
  summary: string
}): Message {
  const summaryText = opts.summary.slice(0, 4000) // bound so a huge proposal doesn't blow context
  return {
    type: 'user',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: opts.toolUseId,
          is_error: opts.status === 'error',
          content: summaryText,
        },
      ],
    },
    isMeta: true,
  } as unknown as Message
}

// ──────────────────────────────────────────────────────────────────────
// Role → model resolution
// ──────────────────────────────────────────────────────────────────────

/**
 * Fallback model IDs per role — mirrors the defaults documented in COUNCIL.md
 * and the table in `commands/council/council.ts`. Used only when settings.json
 * has no `agentRouting[role]` binding. Kept here (not imported from the
 * /council command) to avoid pulling the slash-command surface into the
 * orchestrator adapter.
 */
const FALLBACK_ROLE_MODEL: Record<string, string> = {
  architect: 'claude-opus-4-7',
  implementer: 'deepseek-chat',
  skeptic: 'gemini-3.5-flash',
  critic: 'gpt-4.1-mini',
  tester: 'qwen3.6-plus',
  security: 'mistral-large-latest',
  performance: 'mistral-medium-latest',
  synthesizer: 'gemini-3.5-flash',
  executor: 'claude-opus-4-7',
}

/**
 * Resolve the model ID a given role is actually routed to. Read from
 * settings.agentRouting first (the live binding), fall back to the
 * documented defaults, then to the role name itself if neither matches.
 *
 * Exported so the orchestrator's formatters can surface the model in
 * preview lines like `▎ Critic (gpt-4.1-mini): <headline>`.
 */
export function resolveRoleModel(role: string): string {
  try {
    const settings = getSettings_DEPRECATED() as
      | { agentRouting?: Record<string, string> }
      | undefined
    const routed = settings?.agentRouting?.[role]
    if (typeof routed === 'string' && routed.length > 0) return routed
  } catch {
    // settings unavailable — fall through to the static map.
  }
  return FALLBACK_ROLE_MODEL[role] ?? role
}

// ──────────────────────────────────────────────────────────────────────
// Per-stage AgentTool invocations
// ──────────────────────────────────────────────────────────────────────

interface CommonSpawnDeps {
  toolUseContext: ToolUseContext
  canUseTool?: CanUseToolFn
  signal: AbortSignal
  /** When set (via the panel hooks), AgentTool's `toolUseContext.toolUseId`
   *  is overridden so its progress messages route to the matching cell. */
  toolUseId?: string
  /** Optional transcript injector. When both this AND `toolUseId` are set,
   *  AgentTool's internal progress events are wrapped via
   *  `createProgressMessage` (parentToolUseID = our `toolUseId`) and pushed
   *  into the transcript — which is what populates the panel's per-cell
   *  tool counts / token totals / "thinking" preview lines. Without this,
   *  the panel renders but cells stay at "0 tool uses · 0 tokens." */
  setMessages?: SetMessagesFn
}

async function proposalFromAgentTool(
  args: { role: CouncilRole; userPrompt: string } & CommonSpawnDeps,
): Promise<Proposal> {
  const start = Date.now()
  const result = await invokeAgentTool({
    subagent_type: args.role,
    description: `${capitalize(args.role)} proposal`,
    prompt: `You are one of seven council members. Produce your structured proposal for this request.\n\n${args.userPrompt}`,
    toolUseContext: applyToolUseIdOverride(args.toolUseContext, args.toolUseId),
    canUseTool: args.canUseTool,
    signal: args.signal,
    parentToolUseId: args.toolUseId,
    setMessages: args.setMessages,
  })

  return {
    role: args.role,
    modelId: resolveRoleModel(args.role),
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
    `${args.proposals.length} council proposals to reduce to one plan` +
    (args.proposals.length < 7
      ? ` (${7 - args.proposals.length} of 7 voices failed to deliver — proceed with the remaining majority)`
      : '') +
    `:\n\n` +
    formatProposalsForSynthesizer(args.proposals)

  const result = await invokeAgentTool({
    subagent_type: 'synthesizer',
    description: 'Synthesize council proposals',
    prompt: synthInput,
    toolUseContext: applyToolUseIdOverride(args.toolUseContext, args.toolUseId),
    canUseTool: args.canUseTool,
    signal: args.signal,
    parentToolUseId: args.toolUseId,
    setMessages: args.setMessages,
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
    toolUseContext: applyToolUseIdOverride(args.toolUseContext, args.toolUseId),
    canUseTool: args.canUseTool,
    signal: args.signal,
    parentToolUseId: args.toolUseId,
    setMessages: args.setMessages,
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
    toolUseContext: applyToolUseIdOverride(args.toolUseContext, args.toolUseId),
    canUseTool: args.canUseTool,
    signal: args.signal,
    parentToolUseId: args.toolUseId,
    setMessages: args.setMessages,
  })

  const verdict = parseVerdict(result.text)

  return {
    role: args.role,
    verdict,
    findings: [result.text],
    modelId: resolveRoleModel(args.role),
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
  /** Panel-allocated tool_use_id; used as `parentToolUseID` on every progress
   *  message we forward into the transcript. */
  parentToolUseId?: string
  setMessages?: SetMessagesFn
}

export interface InvokeAgentToolResult {
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
  // Build onProgress only when the caller wired both a setMessages hook AND
  // a panel-allocated parentToolUseId. Without both, there's nothing for the
  // progress messages to attach to (no panel cell). Matches the wrapping
  // logic in `runToolUse` (services/tools/toolExecution.ts:540) — we wrap
  // each event with the outer AgentTool call's tool_use_id as
  // `parentToolUseID`, which is what `buildMessageLookups` keys
  // progress-by-toolUseID lookups on.
  const setMessages = args.setMessages
  const parentToolUseId = args.parentToolUseId
  const onProgress =
    setMessages && parentToolUseId
      ? (progress: { toolUseID: string; data: unknown }) => {
          setMessages(prev => [
            ...prev,
            createProgressMessage({
              toolUseID: progress.toolUseID,
              parentToolUseID: parentToolUseId,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              data: progress.data as any,
            }),
          ])
        }
      : undefined

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onProgress as any,
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

  // Auth-failure detection. When an underlying API call 401s (e.g. expired
  // Anthropic OAuth token), the SDK surfaces the error AS the message text
  // rather than throwing. Without this check the orchestrator would treat
  // the error string as the agent's proposal/diff/review and silently
  // continue — the live run that motivated this looked like a successful
  // 7-voice debate over a non-existent diff. Throwing here turns it into a
  // first-class failure that bubbles through the orchestrator's existing
  // error handling (CouncilMemberFailureError for proposals/reviews;
  // aborts the pipeline for executor/synthesizer).
  if (looksLikeAuthFailure(text)) {
    throw new AgentAuthFailureError(args.subagent_type, text)
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
 * Distinguished error class for upstream API auth failures (401, expired
 * OAuth token, etc.) surfaced as a result-text rather than a thrown
 * exception. Callers — orchestrator, /council run formatter, /handoff —
 * can match on this to print a "run /login" hint instead of a generic
 * "council member X failed" message.
 */
export class AgentAuthFailureError extends Error {
  constructor(
    public readonly subagentType: string,
    public readonly originalText: string,
  ) {
    super(
      `Agent "${subagentType}" hit an upstream API auth failure (likely 401). ` +
        `Run /login in a normal council session to refresh the OAuth token. ` +
        `Underlying error text: ${originalText.slice(0, 200)}${originalText.length > 200 ? '…' : ''}`,
    )
    this.name = 'AgentAuthFailureError'
  }
}

/**
 * Detect when an agent's "result text" is actually an upstream auth-failure
 * message. The SDK doesn't always throw on 401 — sometimes the error
 * surfaces as the message content. Patterns matched: explicit "401",
 * "Please run /login", Anthropic's `authentication_error` JSON shape,
 * and OpenAI/Mistral's "Incorrect API key" wording. Conservative — only
 * fires on signals that are very unlikely to appear in a real proposal.
 */
export function looksLikeAuthFailure(text: string): boolean {
  const t = text.toLowerCase()
  return (
    t.includes('please run /login') ||
    t.includes('"type":"authentication_error"') ||
    t.includes('authentication_error') ||
    /\bapi error:\s*401\b/.test(t) ||
    /\b401\b.*(unauthor|auth)/i.test(t) ||
    t.includes('incorrect api key') ||
    t.includes('invalid authentication credentials')
  )
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
/**
 * If a panel-allocated `toolUseId` is provided, return a context whose
 * `toolUseId` is overridden so AgentTool's progress messages route to the
 * matching cell in the grouped agent panel. When undefined, the original
 * context is returned unchanged.
 */
export function applyToolUseIdOverride(
  ctx: ToolUseContext,
  toolUseId: string | undefined,
): ToolUseContext {
  if (!toolUseId) return ctx
  return { ...ctx, toolUseId }
}

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
