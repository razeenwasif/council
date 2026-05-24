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

export interface CouncilResult {
  proposals: Proposal[]
  plan: SynthesizedPlan
  execution: ExecutorResult
  reviews: Review[]
  revised?: ExecutorResult
  totalCostUsd: number
  totalDurationMs: number
}

// ──────────────────────────────────────────────────────────────────────
// Dependency-injection contract — what the integration adapter must supply
// ──────────────────────────────────────────────────────────────────────

export type SpawnRoleProposal = (input: {
  role: CouncilRole
  userPrompt: string
  signal: AbortSignal
}) => Promise<Proposal>

export type SpawnSynthesizer = (input: {
  userPrompt: string
  proposals: Proposal[]
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
  signal: AbortSignal
}) => Promise<ExecutorResult>

export type SpawnReview = (input: {
  role: CouncilRole
  userPrompt: string
  proposal: Proposal
  execution: ExecutorResult
  signal: AbortSignal
}) => Promise<Review>

export interface CouncilAdapters {
  spawnProposal: SpawnRoleProposal
  spawnSynthesizer: SpawnSynthesizer
  spawnExecutor: SpawnExecutor
  spawnReview: SpawnReview
}

export interface CouncilInputs {
  userPrompt: string
  /** Where the orchestrator emits status updates. Caller wires this into
   *  the session's message stream (or stdout, or a noop in tests). */
  emitStatus: (msg: string) => void
  /** Hard per-query cost ceiling. Pipeline aborts if accumulated cost
   *  exceeds this before the next stage. Defaults to $3. */
  costCeilingUsd?: number
  /** Per-member spawn timeout (proposal, review). Defaults to 60s. */
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

// ──────────────────────────────────────────────────────────────────────
// Pure helpers — exported for use by adapter + tests
// ──────────────────────────────────────────────────────────────────────

/** ≥3 of 7 block verdicts triggers one revision pass. Tune in one place. */
export const REVISION_BLOCK_THRESHOLD = 3

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
  private accumulated = 0
  constructor(private readonly ceilingUsd: number) {}

  /** Record a stage's cost. Throws if it would push past the ceiling. */
  recordOrThrow(stage: string, costUsd: number): void {
    this.accumulated += costUsd
    if (this.accumulated > this.ceilingUsd) {
      throw new CouncilCostCeilingError(
        this.ceilingUsd,
        this.accumulated,
        stage,
      )
    }
  }

  /** Pre-flight check — call before launching a stage you can't easily abort. */
  ensureHeadroomOrThrow(stage: string): void {
    if (this.accumulated >= this.ceilingUsd) {
      throw new CouncilCostCeilingError(
        this.ceilingUsd,
        this.accumulated,
        stage,
      )
    }
  }

  total(): number {
    return this.accumulated
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
    memberTimeoutMs = 60_000,
    longTimeoutMs = 5 * 60_000,
    adapters,
  } = inputs

  const start = Date.now()
  const ledger = new CostLedger(costCeilingUsd)

  // ── Step 1: convene — spawn all 7 proposals in parallel ───────────
  emitStatus('Council convened — seven members proposing in parallel.')
  ledger.ensureHeadroomOrThrow('convene')

  const proposalPromises = COUNCIL_ROLES.map(role =>
    withTimeout(
      signal => adapters.spawnProposal({ role, userPrompt, signal }),
      memberTimeoutMs,
      'proposal',
      role,
    ).catch(err => {
      // Wrap underlying failures so the caller can distinguish them from
      // orchestration errors (timeout, cost). Timeouts already throw
      // CouncilTimeoutError; everything else becomes CouncilMemberFailureError.
      if (err instanceof CouncilTimeoutError) throw err
      throw new CouncilMemberFailureError(role, 'proposal', err)
    }),
  )

  const proposals = await Promise.all(proposalPromises)
  for (const p of proposals) ledger.recordOrThrow('proposal:' + p.role, p.costUsd)

  // ── Step 2: synthesize ────────────────────────────────────────────
  emitStatus('Synthesizing.')
  ledger.ensureHeadroomOrThrow('synthesize')

  const plan = await withTimeout(
    signal => adapters.spawnSynthesizer({ userPrompt, proposals, signal }),
    longTimeoutMs,
    'synthesize',
  )
  ledger.recordOrThrow('synthesize', plan.costUsd)

  // ── Step 3: execute ───────────────────────────────────────────────
  emitStatus('Executing plan.')
  ledger.ensureHeadroomOrThrow('execute')

  const execution = await withTimeout(
    signal => adapters.spawnExecutor({ userPrompt, plan, signal }),
    longTimeoutMs,
    'execute',
  )
  ledger.recordOrThrow('execute', execution.costUsd)

  // ── Step 4: review (parallel) ─────────────────────────────────────
  emitStatus('Reviewing — seven members on the diff.')
  ledger.ensureHeadroomOrThrow('review')

  const reviewPromises = COUNCIL_ROLES.map(role => {
    const proposal = proposals.find(p => p.role === role)
    if (!proposal) {
      // Should never happen — proposals array is built from COUNCIL_ROLES.
      throw new Error(
        `Internal: missing proposal for ${role} during review pass`,
      )
    }
    return withTimeout(
      signal =>
        adapters.spawnReview({
          role,
          userPrompt,
          proposal,
          execution,
          signal,
        }),
      memberTimeoutMs,
      'review',
      role,
    ).catch(err => {
      if (err instanceof CouncilTimeoutError) throw err
      throw new CouncilMemberFailureError(role, 'review', err)
    })
  })

  const reviews = await Promise.all(reviewPromises)
  for (const r of reviews) ledger.recordOrThrow('review:' + r.role, r.costUsd)

  // ── Step 5: maybe revise (cap at one revision) ────────────────────
  let revised: ExecutorResult | undefined
  if (shouldRevise(reviews)) {
    emitStatus(
      `${countBlockingReviews(reviews)} block verdicts — revising once.`,
    )
    ledger.ensureHeadroomOrThrow('revise')

    revised = await withTimeout(
      signal =>
        adapters.spawnExecutor({
          userPrompt,
          plan,
          revisionContext: {
            previousDiff: execution.diff,
            blockingReviews: selectBlockingReviews(reviews),
          },
          signal,
        }),
      longTimeoutMs,
      'revise',
    )
    ledger.recordOrThrow('revise', revised.costUsd)
  }

  emitStatus('Council finished.')

  return {
    proposals,
    plan,
    execution,
    reviews,
    revised,
    totalCostUsd: ledger.total(),
    totalDurationMs: Date.now() - start,
  }
}
