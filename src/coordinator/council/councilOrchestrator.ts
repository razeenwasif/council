/**
 * Council orchestrator — deterministic pipeline.
 *
 * STATUS: orchestrator logic is implemented and unit-tested. The remaining
 * integration gap is the `SpawnAgent` adapter — a function that invokes
 * openclaude's runAgent (or equivalent) with the right context. v1 still
 * uses the LLM-coordinator-with-strict-prompt path; this file provides the
 * deterministic alternative that v2 will hook in.
 *
 * Why DI instead of direct runAgent: runAgent expects a fully-populated
 * ToolUseContext (MCP clients, abort controller, permission function,
 * precomputed tool pool, etc.) that lives in the parent session. Wiring it
 * in here would intermix orchestration with openclaude internals; the DI
 * boundary keeps the orchestrator testable and the integration narrow.
 */

// ──────────────────────────────────────────────────────────────────────
// Public types — stable across integration paths
// ──────────────────────────────────────────────────────────────────────

export type CouncilRole =
  | 'architect'
  | 'implementer'
  | 'skeptic'
  | 'critic'
  | 'tester'
  | 'security'
  | 'performance'

export const COUNCIL_ROLES: readonly CouncilRole[] = [
  'architect',
  'implementer',
  'skeptic',
  'critic',
  'tester',
  'security',
  'performance',
] as const

export type ReviewVerdict = 'pass' | 'nit' | 'concern' | 'block'

export interface Proposal {
  role: CouncilRole
  modelId: string
  text: string
  durationMs: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface SynthesizedPlan {
  text: string
  modelId: string
  durationMs: number
  costUsd: number
}

export interface ExecutorResult {
  diff: string
  summary: string
  modelId: string
  durationMs: number
  costUsd: number
}

export interface Review {
  role: CouncilRole
  verdict: ReviewVerdict
  findings: string[]
  modelId: string
  durationMs: number
  costUsd: number
}

/**
 * A council member that didn't deliver — either timed out, threw at the
 * adapter, or returned an auth-failure result text. Surfaced in the
 * `CouncilResult.failures` list so callers (REPL formatter, /council run,
 * /handoff) can tell the user which voices dropped out instead of
 * silently going forward with a smaller council.
 */
export interface CouncilFailure {
  role: CouncilRole
  stage: 'proposal' | 'review'
  /** Human-readable error message — already includes timeout duration when
   *  applicable, or the upstream error text snippet otherwise. */
  reason: string
  /** Whether this was a CouncilTimeoutError specifically (most common
   *  failure mode in practice; worth distinguishing in UI). */
  isTimeout: boolean
}

export interface CouncilResult {
  proposals: Proposal[]
  plan: SynthesizedPlan
  execution: ExecutorResult
  reviews: Review[]
  revised?: ExecutorResult
  /** Members that failed during proposal or review. Empty when all 14
   *  spawns succeeded. Populated by the fault-tolerant batch path. */
  failures: CouncilFailure[]
  totalCostUsd: number
  totalDurationMs: number
}

// ──────────────────────────────────────────────────────────────────────
// Dependency-injection contract — what the integration adapter must supply
// ──────────────────────────────────────────────────────────────────────

export type SpawnRoleProposal = (input: {
  role: CouncilRole
  userPrompt: string
  /** Pre-assigned tool_use_id from `prepareBatch`. Adapters that wire to a
   *  UI panel use this so progress messages route to the right cell. */
  toolUseId?: string
  signal: AbortSignal
}) => Promise<Proposal>

export type SpawnSynthesizer = (input: {
  userPrompt: string
  proposals: Proposal[]
  toolUseId?: string
  signal: AbortSignal
}) => Promise<SynthesizedPlan>

export type SpawnExecutor = (input: {
  userPrompt: string
  plan: SynthesizedPlan
  /** When set, this is a revision pass — diff + blocking reviews provided. */
  revisionContext?: {
    previousDiff: string
    blockingReviews: Review[]
  }
  toolUseId?: string
  signal: AbortSignal
}) => Promise<ExecutorResult>

export type SpawnReview = (input: {
  role: CouncilRole
  userPrompt: string
  proposal: Proposal
  execution: ExecutorResult
  toolUseId?: string
  signal: AbortSignal
}) => Promise<Review>

/**
 * Optional UI/panel hooks. Adapters that want to render the multi-agent
 * "panel" (the `7 agents finished` tree) implement `prepareBatch` to allocate
 * tool_use_ids and inject placeholder messages, and `completeMember` to push
 * matching tool_result messages once each spawn lands. Pure-data adapters
 * (tests, headless) ignore them — defaults are no-ops.
 */
export type PrepareBatchHook = (input: {
  kind: 'proposal' | 'review'
  roles: readonly CouncilRole[]
}) => Promise<Map<CouncilRole, string>>

export type PrepareSingleHook = (input: {
  kind: 'synthesizer' | 'executor' | 'revise'
  description: string
}) => Promise<string>

export type CompleteMemberHook = (input: {
  kind: 'proposal' | 'review' | 'synthesizer' | 'executor' | 'revise'
  role?: CouncilRole
  toolUseId: string
  status: 'success' | 'error'
  summary?: string
}) => Promise<void>

export interface CouncilAdapters {
  spawnProposal: SpawnRoleProposal
  spawnSynthesizer: SpawnSynthesizer
  spawnExecutor: SpawnExecutor
  spawnReview: SpawnReview
  /** Optional — adapter renders the panel by injecting placeholder messages. */
  prepareBatch?: PrepareBatchHook
  /** Optional — single-agent stages (synth/executor) get their own placeholder. */
  prepareSingle?: PrepareSingleHook
  /** Optional — fires once per spawn completion so the adapter can inject
   *  a matching tool_result message. */
  completeMember?: CompleteMemberHook
}

export interface CouncilInputs {
  userPrompt: string
  /** Where the orchestrator emits status updates. Caller wires this into
   *  the session's message stream (or stdout, or a noop in tests). */
  emitStatus: (msg: string) => void
  /** Hard per-query cost ceiling. Pipeline aborts if accumulated cost
   *  exceeds this before the next stage. Defaults to $3. */
  costCeilingUsd?: number
  /** Callback to retrieve the current global cost (used in deterministic
   *  paths where spawns return 0 cost). */
  getCurrentCost?: () => number
  /** Per-member spawn timeout (proposal, review). Defaults to 300s. Bumped
   *  from 60s → 120s → 180s → 300s across live runs as DeepSeek-class
   *  providers kept hitting the ceiling under load. Combined with the
   *  fault-tolerant batch path (1-2 timeouts are absorbed, run continues
   *  with the remaining voices), this is the safety net for "voice is
   *  truly hung, give up and move on" rather than "voice is slow." */
  memberTimeoutMs?: number
  /** Synthesizer + executor get a longer timeout — they have more to do.
   *  Defaults to 5 minutes. */
  longTimeoutMs?: number
  adapters: CouncilAdapters
}

// ──────────────────────────────────────────────────────────────────────
// Errors — distinguished so callers can react appropriately
// ──────────────────────────────────────────────────────────────────────

export class CouncilTimeoutError extends Error {
  constructor(
    public readonly stage: string,
    public readonly timeoutMs: number,
    public readonly role?: CouncilRole,
  ) {
    super(
      `Council ${stage}${role ? ` (${role})` : ''} exceeded ${timeoutMs}ms timeout`,
    )
    this.name = 'CouncilTimeoutError'
  }
}

export class CouncilCostCeilingError extends Error {
  constructor(
    public readonly ceilingUsd: number,
    public readonly accumulatedUsd: number,
    public readonly stage: string,
  ) {
    super(
      `Council exceeded cost ceiling: $${accumulatedUsd.toFixed(4)} > $${ceilingUsd.toFixed(2)} at stage "${stage}"`,
    )
    this.name = 'CouncilCostCeilingError'
  }
}

export class CouncilMemberFailureError extends Error {
  constructor(
    public readonly role: CouncilRole,
    public readonly stage: 'proposal' | 'review',
    public readonly underlying: unknown,
  ) {
    super(
      `Council ${stage} failed for ${role}: ${underlying instanceof Error ? underlying.message : String(underlying)}`,
    )
    this.name = 'CouncilMemberFailureError'
  }
}

/**
 * Thrown when a fault-tolerant batch lost too many members to reach
 * quorum (default: <5 of 7 voices succeeded). Distinct from
 * `CouncilMemberFailureError` (single member) — this is "the council
 * itself can't proceed." Callers should surface it as "not enough voices
 * responded; retry or check provider health."
 */
export class CouncilQuorumLostError extends Error {
  constructor(
    public readonly stage: 'proposal' | 'review',
    public readonly succeededCount: number,
    public readonly required: number,
    public readonly failures: CouncilFailure[],
  ) {
    super(
      `Council ${stage} quorum lost: only ${succeededCount} of ${required} required voices succeeded ` +
        `(failed: ${failures.map(f => `${f.role}=${f.isTimeout ? 'timeout' : 'error'}`).join(', ')})`,
    )
    this.name = 'CouncilQuorumLostError'
  }
}

// ──────────────────────────────────────────────────────────────────────
// Pure helpers — exported for use by adapter + tests
// ──────────────────────────────────────────────────────────────────────

/** ≥3 of 7 block verdicts triggers one revision pass. Tune in one place. */
export const REVISION_BLOCK_THRESHOLD = 3

/** Minimum voices that must succeed in a batch for the council to proceed.
 *  Below this, throw `CouncilQuorumLostError`. 5 of 7 = strong-majority
 *  consensus is still reachable; 4 of 7 means the synthesizer would be
 *  weighing a fragmented voice set, so we bail out. */
export const MIN_VOICES_FOR_QUORUM = 5

export function countBlockingReviews(reviews: Review[]): number {
  return reviews.filter(r => r.verdict === 'block').length
}

export function shouldRevise(reviews: Review[]): boolean {
  return countBlockingReviews(reviews) >= REVISION_BLOCK_THRESHOLD
}

export function formatProposalsForSynthesizer(proposals: Proposal[]): string {
  return proposals
    .map(
      p => `# ${p.role.toUpperCase()} (model: ${p.modelId})\n\n${p.text}\n`,
    )
    .join('\n---\n\n')
}

/** Filter reviews down to the ones whose verdict justifies blocking. */
export function selectBlockingReviews(reviews: Review[]): Review[] {
  return reviews.filter(r => r.verdict === 'block')
}

/**
 * Pull a one-line summary out of a proposal body.
 *
 * Three-tier extraction (most-preferred first):
 *   1. `## Headline\n<one sentence>` — the format the prompt mandates.
 *   2. `## Headline: foo` inline form — single-line variant some models prefer.
 *   3. **Best-effort fallback**: first informative sentence of the proposal
 *      (skipping markdown headings, blockquotes, and code fences). Used when
 *      the model dropped the required section — better to show *something*
 *      from the proposal than a generic "no headline section emitted"
 *      placeholder that hides the model's actual voice.
 *
 * Returns null only when the proposal body is genuinely empty.
 */
export function extractHeadline(text: string): string | null {
  // Tier 1: full `## Headline\n<line>` shape.
  const m = text.match(/^#{1,6}\s*Headline\s*:?\s*\n+([^\n#][^\n]*)/im)
  if (m && m[1]) {
    const line = stripBlockquoteAndQuotes(m[1].trim())
    if (line) return line
  }
  // Tier 2: inline `## Headline: foo` on a single line.
  const inline = text.match(/^#{1,6}\s*Headline\s*:\s*([^\n]+)/im)
  if (inline && inline[1]) {
    const line = stripBlockquoteAndQuotes(inline[1].trim())
    if (line) return line
  }
  // Tier 3: fallback — first informative sentence. Walk the lines, skip
  // headings/blockquotes/code-fences, take the first prose line, then
  // clip at the first sentence boundary (or 140 chars).
  return extractFirstSentence(text)
}

function extractFirstSentence(text: string): string | null {
  let inCodeFence = false
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('```')) {
      inCodeFence = !inCodeFence
      continue
    }
    if (inCodeFence) continue
    if (/^#{1,6}\s/.test(line)) continue // markdown heading
    if (line.startsWith('>')) continue // blockquote
    if (line.startsWith('---')) continue // hr / yaml-frontmatter delimiter
    if (line.startsWith('-') || line.startsWith('*') || /^\d+\./.test(line)) {
      // list item — strip the bullet, take the rest
      const stripped = line.replace(/^[-*]\s+|^\d+\.\s+/, '').trim()
      if (stripped) return clipToSentence(stripped)
      continue
    }
    return clipToSentence(line)
  }
  return null
}

function clipToSentence(s: string): string {
  // Clip at the first sentence-ending punctuation followed by space or
  // end-of-string. Falls back to first 140 chars + ellipsis if no
  // sentence break is found in the first 200 chars.
  const sentenceEnd = s.match(/^[^.!?]+[.!?](?=\s|$)/)
  if (sentenceEnd) {
    const out = sentenceEnd[0].trim()
    return out.length > 200 ? out.slice(0, 197) + '…' : out
  }
  return s.length > 140 ? s.slice(0, 137) + '…' : s
}

function stripBlockquoteAndQuotes(s: string): string {
  return s.replace(/^>\s*/, '').replace(/^["'<](.*)[">']$/, '$1').trim()
}

/**
 * Build the per-proposal arrival message that the orchestrator emits the
 * moment a single member's proposal lands. Renders as a markdown blockquote
 * so the terminal's markdown renderer paints it with the `▎` bar — same
 * shape the LLM-coordinator path produces, but emitted live per arrival.
 *
 * The `(model-id)` parenthetical is omitted when the adapter couldn't
 * resolve a model (modelId equal to the role slug means "unresolved").
 */
export function formatProposalArrival(p: Proposal): string {
  const headline = extractHeadline(p.text)
  const model = modelHint(p.role, p.modelId)
  const label = `**${capitalizeRole(p.role)}**${model}`
  if (headline) return `> ${label}: ${headline}`
  return `> ${label}: (proposal landed; no headline section emitted)`
}

/** Build the per-review arrival message — verdict + first finding when present. */
export function formatReviewArrival(r: Review): string {
  const model = modelHint(r.role, r.modelId)
  const label = `**${capitalizeRole(r.role)}**${model} review`
  const verdict = `**${r.verdict}**`
  const reason = r.findings[0]?.trim()
  if (reason) return `> ${label}: ${verdict} — ${reason}`
  return `> ${label}: ${verdict}`
}

/** ` (model-id)` when the modelId resolved to something other than the role
 *  slug; empty string when it didn't (so we don't print `(architect)`). */
function modelHint(role: CouncilRole, modelId: string): string {
  if (!modelId || modelId === role) return ''
  return ` (${modelId})`
}

/**
 * Convert a rejected Promise.allSettled result into a structured
 * CouncilFailure entry. Distinguishes timeouts (the common case) so the
 * formatter can render them differently.
 */
export function settlementToFailure(
  role: CouncilRole,
  stage: 'proposal' | 'review',
  reason: unknown,
): CouncilFailure {
  if (reason instanceof CouncilTimeoutError) {
    return {
      role,
      stage,
      reason: `timed out after ${reason.timeoutMs}ms`,
      isTimeout: true,
    }
  }
  if (reason instanceof CouncilMemberFailureError) {
    const inner =
      reason.underlying instanceof Error
        ? reason.underlying.message
        : String(reason.underlying)
    return { role, stage, reason: inner, isTimeout: false }
  }
  const msg = reason instanceof Error ? reason.message : String(reason)
  return { role, stage, reason: msg, isTimeout: false }
}

/**
 * Build the "stage finished" line that lands after long single-agent
 * stages (synth / executor / revise). The point is to make the gap
 * between "executor was last thing emitted" and "first review arrives"
 * unmistakable — without this, the user sees the executor's tool_result
 * land in the panel and then nothing happens for up to memberTimeoutMs
 * while reviews are in flight, which feels like a stuck spinner.
 *
 * Includes a short snippet of the stage's output when one is available
 * (typically the first non-empty line, capped at ~140 chars).
 */
export function formatStageDone(
  stage: 'synthesizer' | 'executor' | 'revise' | 'verifier',
  durationMs: number,
  summary?: string,
): string {
  const label =
    stage === 'synthesizer'
      ? 'Synthesizer'
      : stage === 'executor'
        ? 'Executor'
        : stage === 'verifier'
          ? 'Verifier'
          : 'Revision'
  const duration = formatDuration(durationMs)
  const snippet = summary ? firstLineSnippet(summary) : null
  if (snippet) return `> ✓ **${label}** done (${duration}) — ${snippet}`
  return `> ✓ **${label}** done (${duration}).`
}

/** Pull the first non-empty line out of a multi-line summary, capped at
 *  140 chars so a single emit stays under one terminal row. */
function firstLineSnippet(text: string): string | null {
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    // Skip empty lines and lone markdown headings ('## Foo') — we want
    // the first informative line, not a section header.
    if (!line) continue
    if (/^#{1,6}\s/.test(line)) continue
    if (line.length <= 140) return line
    return line.slice(0, 137) + '…'
  }
  return null
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rem = Math.round(s - m * 60)
  return `${m}m ${rem}s`
}

/**
 * Build the per-member failure line that the orchestrator emits whenever
 * a spawn rejects (timeout, member failure, auth failure, anything else).
 * Symmetric with `formatProposalArrival` / `formatReviewArrival` so the
 * failure shows up in the same blockquote stream as the successes.
 */
export function formatMemberFailure(
  stage: 'proposal' | 'review',
  role: CouncilRole,
  err: unknown,
): string {
  const label = `**${capitalizeRole(role)}** ${stage}`
  if (err instanceof CouncilTimeoutError) {
    return `> ✗ ${label}: **timed out** after ${err.timeoutMs}ms`
  }
  const msg =
    err instanceof Error ? err.message : String(err)
  // Bound long error messages so a multi-line stack doesn't fill the screen.
  const trimmed = msg.length > 200 ? msg.slice(0, 200) + '…' : msg
  return `> ✗ ${label}: **failed** — ${trimmed}`
}

function capitalizeRole(role: CouncilRole): string {
  return role[0]!.toUpperCase() + role.slice(1)
}

// ──────────────────────────────────────────────────────────────────────
// Internal helpers — timeout + budget tracking
// ──────────────────────────────────────────────────────────────────────

/**
 * Race a promise against a timeout. On timeout, abort the signal (so the
 * underlying call can clean up) and throw `CouncilTimeoutError`.
 *
 * Uses an AbortController scoped to this call so timeouts don't bleed across
 * concurrent members.
 */
async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  stage: string,
  role?: CouncilRole,
  parentSignal?: AbortSignal,
): Promise<T> {
  const ac = new AbortController()
  const onParentAbort = () => ac.abort()
  if (parentSignal) {
    if (parentSignal.aborted) ac.abort()
    else parentSignal.addEventListener('abort', onParentAbort, { once: true })
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ac.abort()
        reject(new CouncilTimeoutError(stage, timeoutMs, role))
      }, timeoutMs)
    })

    return await Promise.race([fn(ac.signal), timeoutPromise])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    parentSignal?.removeEventListener('abort', onParentAbort)
  }
}

class CostLedger {
  private recorded = 0
  private readonly startGlobalCost: number
  constructor(
    private readonly ceilingUsd: number,
    private readonly getCurrentCost: () => number = () => 0,
  ) {
    this.startGlobalCost = getCurrentCost()
  }

  /** Record a stage's cost. Throws if it would push past the ceiling. */
  recordOrThrow(stage: string, costUsd: number): void {
    this.recorded += costUsd
    this.throwIfOverCeiling(stage)
  }

  /** Pre-flight check — call before launching a stage you can't easily abort. */
  ensureHeadroomOrThrow(stage: string): void {
    this.throwIfOverCeiling(stage)
  }

  total(): number {
    return this.bestEstimateAccumulated()
  }

  private bestEstimateAccumulated(): number {
    const globalDelta = Math.max(0, this.getCurrentCost() - this.startGlobalCost)
    return Math.max(this.recorded, globalDelta)
  }

  private throwIfOverCeiling(stage: string): void {
    const accumulated = this.bestEstimateAccumulated()
    if (accumulated >= this.ceilingUsd) {
      throw new CouncilCostCeilingError(
        this.ceilingUsd,
        accumulated,
        stage,
      )
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// Main entry point
// ──────────────────────────────────────────────────────────────────────

export async function runCouncil(
  inputs: CouncilInputs,
): Promise<CouncilResult> {
  const {
    userPrompt,
    emitStatus,
    costCeilingUsd = 3,
    memberTimeoutMs = 300_000,
    longTimeoutMs = 5 * 60_000,
    getCurrentCost,
    adapters,
  } = inputs

  const start = Date.now()
  const ledger = new CostLedger(costCeilingUsd, getCurrentCost)

  // ── Step 1: convene — spawn all 7 proposals in parallel ───────────
  emitStatus('Council convened — seven members proposing in parallel.')
  ledger.ensureHeadroomOrThrow('convene')

  // Allocate tool_use_ids for the proposal batch. Adapters with a UI panel
  // implement this and inject placeholder messages so the panel renders;
  // headless adapters return an empty map.
  const proposalIds: Map<CouncilRole, string> =
    (await adapters.prepareBatch?.({ kind: 'proposal', roles: COUNCIL_ROLES })) ??
    new Map()

  // Fault-tolerant batch: each member's promise is fully self-contained —
  // success path emits arrival + records cost + flips panel cell to
  // resolved; failure path emits ✗ line + flips panel cell to error.
  // We never re-throw from the per-member promise, so Promise.allSettled
  // gives us a uniform shape: `{ status: 'fulfilled', value: Proposal }`
  // or `{ status: 'rejected', reason: CouncilFailure }`. Aggregated below.
  const proposalSettlements = await Promise.allSettled(
    COUNCIL_ROLES.map(role => {
      const toolUseId = proposalIds.get(role)
      return withTimeout(
        signal => adapters.spawnProposal({ role, userPrompt, toolUseId, signal }),
        memberTimeoutMs,
        'proposal',
        role,
      )
        .then(async p => {
          emitStatus(formatProposalArrival(p))
          if (toolUseId) {
            await adapters.completeMember?.({
              kind: 'proposal',
              role,
              toolUseId,
              status: 'success',
              summary: p.text,
            })
          }
          return p
        })
        .catch(async err => {
          // Surface the failure inline (so the user sees it land at the same
          // visual cadence as the successes) before flipping the cell.
          emitStatus(formatMemberFailure('proposal', role, err))
          if (toolUseId) {
            await adapters.completeMember?.({
              kind: 'proposal',
              role,
              toolUseId,
              status: 'error',
              summary: err instanceof Error ? err.message : String(err),
            })
          }
          // Re-throw a typed error so we can recognise it in the aggregation
          // pass below. We keep CouncilTimeoutError as-is for the .isTimeout
          // bit; everything else gets wrapped in CouncilMemberFailureError.
          if (err instanceof CouncilTimeoutError) throw err
          throw new CouncilMemberFailureError(role, 'proposal', err)
        })
    }),
  )

  const proposals: Proposal[] = []
  const proposalFailures: CouncilFailure[] = []
  for (let i = 0; i < proposalSettlements.length; i++) {
    const settlement = proposalSettlements[i]!
    const role = COUNCIL_ROLES[i]!
    if (settlement.status === 'fulfilled') {
      proposals.push(settlement.value)
    } else {
      proposalFailures.push(settlementToFailure(role, 'proposal', settlement.reason))
    }
  }

  if (proposals.length < MIN_VOICES_FOR_QUORUM) {
    throw new CouncilQuorumLostError(
      'proposal',
      proposals.length,
      MIN_VOICES_FOR_QUORUM,
      proposalFailures,
    )
  }

  for (const p of proposals) ledger.recordOrThrow('proposal:' + p.role, p.costUsd)

  // ── Step 2: synthesize ────────────────────────────────────────────
  emitStatus('Synthesizing.')
  ledger.ensureHeadroomOrThrow('synthesize')

  const synthToolUseId = await adapters.prepareSingle?.({
    kind: 'synthesizer',
    description: 'Synthesize council proposals',
  })

  let plan: SynthesizedPlan
  const synthStart = Date.now()
  try {
    plan = await withTimeout(
      signal => adapters.spawnSynthesizer({ userPrompt, proposals, toolUseId: synthToolUseId, signal }),
      longTimeoutMs,
      'synthesize',
    )
    if (synthToolUseId) {
      await adapters.completeMember?.({
        kind: 'synthesizer',
        toolUseId: synthToolUseId,
        status: 'success',
        summary: plan.text,
      })
    }
    emitStatus(formatStageDone('synthesizer', Date.now() - synthStart, plan.text))
  } catch (err) {
    if (synthToolUseId) {
      await adapters.completeMember?.({
        kind: 'synthesizer',
        toolUseId: synthToolUseId,
        status: 'error',
        summary: err instanceof Error ? err.message : String(err),
      })
    }
    throw err
  }
  ledger.recordOrThrow('synthesize', plan.costUsd)

  // ── Step 3: execute ───────────────────────────────────────────────
  emitStatus('Executing plan.')
  ledger.ensureHeadroomOrThrow('execute')

  const executorToolUseId = await adapters.prepareSingle?.({
    kind: 'executor',
    description: 'Execute council plan',
  })

  let execution: ExecutorResult
  const executorStart = Date.now()
  try {
    execution = await withTimeout(
      signal => adapters.spawnExecutor({ userPrompt, plan, toolUseId: executorToolUseId, signal }),
      longTimeoutMs,
      'execute',
    )
    if (executorToolUseId) {
      await adapters.completeMember?.({
        kind: 'executor',
        toolUseId: executorToolUseId,
        status: 'success',
        summary: execution.summary,
      })
    }
    emitStatus(
      formatStageDone('executor', Date.now() - executorStart, execution.summary),
    )
  } catch (err) {
    if (executorToolUseId) {
      await adapters.completeMember?.({
        kind: 'executor',
        toolUseId: executorToolUseId,
        status: 'error',
        summary: err instanceof Error ? err.message : String(err),
      })
    }
    throw err
  }
  ledger.recordOrThrow('execute', execution.costUsd)

  // ── Step 4: review (parallel) ─────────────────────────────────────
  // Reviews only run for roles whose proposal succeeded — a voice can't
  // review without its own proposal as context. So the review batch
  // size matches `proposals.length`, not `COUNCIL_ROLES.length`. This
  // means quorum math for reviews is "of the voices that proposed".
  emitStatus(`Reviewing — ${proposals.length} members on the diff.`)
  ledger.ensureHeadroomOrThrow('review')

  const reviewedRoles = proposals.map(p => p.role)
  const reviewIds: Map<CouncilRole, string> =
    (await adapters.prepareBatch?.({ kind: 'review', roles: reviewedRoles })) ??
    new Map()

  const reviewSettlements = await Promise.allSettled(
    proposals.map(proposal => {
      const role = proposal.role
      const toolUseId = reviewIds.get(role)
      return withTimeout(
        signal =>
          adapters.spawnReview({
            role,
            userPrompt,
            proposal,
            execution,
            toolUseId,
            signal,
          }),
        memberTimeoutMs,
        'review',
        role,
      )
        .then(async r => {
          emitStatus(formatReviewArrival(r))
          if (toolUseId) {
            await adapters.completeMember?.({
              kind: 'review',
              role,
              toolUseId,
              status: 'success',
              summary: `${r.verdict}: ${r.findings.join(' ')}`,
            })
          }
          return r
        })
        .catch(async err => {
          emitStatus(formatMemberFailure('review', role, err))
          if (toolUseId) {
            await adapters.completeMember?.({
              kind: 'review',
              role,
              toolUseId,
              status: 'error',
              summary: err instanceof Error ? err.message : String(err),
            })
          }
          if (err instanceof CouncilTimeoutError) throw err
          throw new CouncilMemberFailureError(role, 'review', err)
        })
    }),
  )

  const reviews: Review[] = []
  const reviewFailures: CouncilFailure[] = []
  for (let i = 0; i < reviewSettlements.length; i++) {
    const settlement = reviewSettlements[i]!
    const role = reviewedRoles[i]!
    if (settlement.status === 'fulfilled') {
      reviews.push(settlement.value)
    } else {
      reviewFailures.push(settlementToFailure(role, 'review', settlement.reason))
    }
  }

  if (reviews.length < MIN_VOICES_FOR_QUORUM) {
    throw new CouncilQuorumLostError(
      'review',
      reviews.length,
      MIN_VOICES_FOR_QUORUM,
      [...proposalFailures, ...reviewFailures],
    )
  }

  for (const r of reviews) ledger.recordOrThrow('review:' + r.role, r.costUsd)

  // ── Step 5: maybe revise (cap at one revision) ────────────────────
  let revised: ExecutorResult | undefined
  if (shouldRevise(reviews)) {
    emitStatus(
      `${countBlockingReviews(reviews)} block verdicts — revising once.`,
    )
    ledger.ensureHeadroomOrThrow('revise')

    const reviseToolUseId = await adapters.prepareSingle?.({
      kind: 'revise',
      description: 'Revise executor diff',
    })

    const reviseStart = Date.now()
    try {
      revised = await withTimeout(
        signal =>
          adapters.spawnExecutor({
            userPrompt,
            plan,
            revisionContext: {
              previousDiff: execution.diff,
              blockingReviews: selectBlockingReviews(reviews),
            },
            toolUseId: reviseToolUseId,
            signal,
          }),
        longTimeoutMs,
        'revise',
      )
      if (reviseToolUseId) {
        await adapters.completeMember?.({
          kind: 'revise',
          toolUseId: reviseToolUseId,
          status: 'success',
          summary: revised.summary,
        })
      }
      emitStatus(
        formatStageDone('revise', Date.now() - reviseStart, revised.summary),
      )
    } catch (err) {
      if (reviseToolUseId) {
        await adapters.completeMember?.({
          kind: 'revise',
          toolUseId: reviseToolUseId,
          status: 'error',
          summary: err instanceof Error ? err.message : String(err),
        })
      }
      throw err
    }
    ledger.recordOrThrow('revise', revised.costUsd)
  }

  emitStatus('Council finished.')

  return {
    proposals,
    plan,
    execution,
    reviews,
    revised,
    failures: [...proposalFailures, ...reviewFailures],
    totalCostUsd: ledger.total(),
    totalDurationMs: Date.now() - start,
  }
}
