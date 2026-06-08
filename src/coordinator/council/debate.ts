/**
 * Debate types — shared across the orchestrator, spawn adapter, and the
 * /discover slash command.
 *
 * Distinct from the Council orchestrator (`councilOrchestrator.ts`)
 * because the data flow is fundamentally different: Council fans out
 * isolated proposals + reviews and converges on a diff; the debate
 * orchestrator runs voices in MULTIPLE ROUNDS, with each round seeing
 * the prior round's positions. The artifact is a research brief, not
 * a code diff — there's no "executor" stage.
 *
 * Naming chosen to keep these types orthogonal to Council's (Proposal,
 * Review, ExecutorResult) so they can be imported side-by-side without
 * shadowing.
 */

// ──────────────────────────────────────────────────────────────────────
// Roles
// ──────────────────────────────────────────────────────────────────────

export type ResearchRole =
  | 'hypothesizer'
  | 'empiricist'
  | 'devils_advocate'
  | 'methodologist'

/** Ordered list — used by the orchestrator to iterate in a stable order
 *  and to allocate panel tool_use_ids deterministically per round. */
export const RESEARCH_ROLES: readonly ResearchRole[] = [
  'hypothesizer',
  'empiricist',
  'devils_advocate',
  'methodologist',
] as const

// ──────────────────────────────────────────────────────────────────────
// Positions — the unit of work in a debate
// ──────────────────────────────────────────────────────────────────────

/** Stable ID shape: `r<round>-<role>` e.g. `r1-empiricist`. Used in
 *  Round 2 prompts so voices can reference each other by ID when stating
 *  what they're building on or contradicting. */
export type PositionId = string

export function makePositionId(
  roundNumber: number,
  role: ResearchRole,
): PositionId {
  return `r${roundNumber}-${role}`
}

/** A single voice's contribution in a single round. */
export interface Position {
  id: PositionId
  role: ResearchRole
  /** The resolved model id (e.g. `claude-opus-4-7`, `deepseek-chat`).
   *  Populated by the spawn adapter via the same `resolveRoleModel`
   *  helper Council uses, so the live previews can show `▎ Hypothesizer
   *  (claude-opus-4-7): <headline>`. */
  modelId: string
  roundNumber: number
  /** The voice's structured output text — contains `## Headline`,
   *  `## Position`, `## Reasoning`, etc. The orchestrator parses
   *  specific sections out; the full text is preserved for the
   *  Synthesist and the on-disk brief. */
  text: string
  /** Position IDs (from prior rounds) this position explicitly builds on.
   *  Parsed from the `builds_on:` line in the Round 2 output format.
   *  Empty in Round 1. */
  buildsOn: PositionId[]
  /** Position IDs (from prior rounds) this position explicitly contradicts. */
  contradicts: PositionId[]
  /** Self-reported 1-5 confidence parsed from `## Confidence (1-5)` block.
   *  Null when the model omitted it or emitted something unparseable. */
  confidence: number | null
  durationMs: number
  costUsd: number
}

// ──────────────────────────────────────────────────────────────────────
// Result + failure types
// ──────────────────────────────────────────────────────────────────────

/** A voice that didn't deliver in a given round. Mirrors Council's
 *  `CouncilFailure` shape. */
export interface DebateFailure {
  role: ResearchRole
  roundNumber: 1 | 2 | 3
  /** Human-readable failure reason; pre-formatted for display. */
  reason: string
  isTimeout: boolean
}

export interface DebateResult {
  question: string
  /** Per-round positions in chronological order. Round 3 (Synthesist)
   *  isn't here — its output is `brief` below. */
  rounds: Array<{
    roundNumber: 1 | 2
    positions: Position[]
  }>
  /** The Synthesist's final markdown brief. */
  brief: string
  /** Absolute path of the on-disk brief, when the caller asked for one
   *  (via `outputPath` on inputs). Undefined when only the in-transcript
   *  brief was wanted. */
  briefPath?: string
  /** Voices that didn't deliver across all rounds. Empty when all 9
   *  spawns succeeded (4 r1 + 4 r2 + 1 Synthesist). */
  failures: DebateFailure[]
  totalCostUsd: number
  totalDurationMs: number
  /** Verifier-agent output (post-synthesis fact-check). When status is
   *  'ok', `notes` contains the verifier's `## Verification Notes`
   *  Markdown section, ready to append to the brief. When 'failed',
   *  `reason` explains why (cap-hit, timeout, etc.) and `notes` is
   *  empty — brief still ships without the verification section.
   *  Undefined when the orchestrator was run without a verifier
   *  adapter (e.g., tests that don't want the extra spawn). */
  verification?: {
    status: 'ok' | 'failed'
    notes: string
    /** Best-effort count of items in the "Suspect claims" list.
     *  Parsed from the notes; 0 when notes is "(none)" or unparseable. */
    flagCount: number
    /** Set when status === 'failed'. */
    reason?: string
    modelId?: string
    durationMs?: number
  }
}

// ──────────────────────────────────────────────────────────────────────
// Inputs + adapter contract
// ──────────────────────────────────────────────────────────────────────

export interface DebateInputs {
  /** The research question. Surfaced verbatim to every voice. */
  question: string
  /** Absolute paths the voices should consider as authoritative context
   *  (e.g. `['~/Research/lit-review.md']`). The orchestrator passes the
   *  paths through; voices choose whether to Read them. The Empiricist's
   *  prompt mandates engaging with at least one. */
  contextFiles: string[]
  /** When set, the Synthesist's brief is written to this absolute path
   *  after the debate finishes. The path appears on `DebateResult.briefPath`. */
  outputPath?: string
  /** Where the orchestrator emits stage transitions + per-arrival
   *  previews. Wire to setMessages in REPL flows, or `() => {}` headless. */
  emitStatus: (msg: string) => void
  /** Hard per-debate cost ceiling. Defaults to $1.00 — debates are
   *  meaningfully more expensive than Council runs because of round 2's
   *  context expansion. */
  costCeilingUsd?: number
  /** Returns the current global session cost (in USD). When provided,
   *  the cost ledger snapshots this between stages and uses the delta
   *  to enforce the ceiling — necessary because the deterministic
   *  AgentTool spawn path returns `costUsd: 0` for each spawn (no flat
   *  cost on the AgentTool result), so a per-spawn-only ledger never
   *  ticks up. Default is `() => 0`, which preserves headless test
   *  behaviour. Callers in the live REPL flow wire `getTotalCost`
   *  from cost-tracker. */
  getCurrentCost?: () => number
  /** Per-voice spawn timeout. Defaults to 300s, same as Council. */
  memberTimeoutMs?: number
  /** Synthesist timeout. Defaults to 5 minutes. */
  synthesistTimeoutMs?: number
  adapters: DebateAdapters
}

// ──────────────────────────────────────────────────────────────────────
// Adapter contract — what the integration must supply
// ──────────────────────────────────────────────────────────────────────

export type SpawnResearcher = (input: {
  role: ResearchRole
  roundNumber: 1 | 2
  question: string
  contextFiles: string[]
  /** In Round 1, this is `[]`. In Round 2, this is every Round 1
   *  position. The adapter renders these into the prompt — usually
   *  formatted with headline + role + position-id, so the voice can
   *  reference them by ID in its response. */
  priorPositions: Position[]
  /** Panel-allocated tool_use_id for the agent panel (optional). */
  toolUseId?: string
  signal: AbortSignal
}) => Promise<Position>

export type SpawnSynthesist = (input: {
  question: string
  contextFiles: string[]
  /** All positions from rounds 1 and 2, in order. */
  allPositions: Position[]
  toolUseId?: string
  signal: AbortSignal
}) => Promise<{
  /** The markdown brief — Synthesist's full output. */
  text: string
  modelId: string
  durationMs: number
  costUsd: number
}>

/** Verifier spawn — post-synthesis fact-check. Optional adapter; when
 *  omitted, `runDebate` skips the verifier stage entirely. */
export type SpawnVerifier = (input: {
  question: string
  brief: string
  allPositions: Position[]
  toolUseId?: string
  signal: AbortSignal
}) => Promise<{
  /** The Verifier's `## Verification Notes` Markdown block. */
  text: string
  modelId: string
  durationMs: number
  costUsd: number
}>

/** Optional UI/panel hooks, mirroring Council's pattern. Headless
 *  adapters omit them. */
export type DebatePrepareBatchHook = (input: {
  kind: 'r1' | 'r2'
  roles: readonly ResearchRole[]
}) => Promise<Map<ResearchRole, string>>

export type DebatePrepareSingleHook = (input: {
  kind: 'synthesist'
  description: string
}) => Promise<string>

export type DebateCompleteMemberHook = (input: {
  kind: 'r1' | 'r2' | 'synthesist'
  role?: ResearchRole
  toolUseId: string
  status: 'success' | 'error'
  summary?: string
}) => Promise<void>

export interface DebateAdapters {
  spawnResearcher: SpawnResearcher
  spawnSynthesist: SpawnSynthesist
  /** Optional. When set, the orchestrator spawns the verifier after
   *  the synthesist completes and folds the verification notes into
   *  `DebateResult.verification`. When omitted, the verifier stage
   *  is skipped entirely — safe default for tests + future code
   *  paths that don't want the extra latency. */
  spawnVerifier?: SpawnVerifier
  prepareBatch?: DebatePrepareBatchHook
  prepareSingle?: DebatePrepareSingleHook
  completeMember?: DebateCompleteMemberHook
}

// ──────────────────────────────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────────────────────────────

/** Thrown when a debate stage doesn't reach quorum (default: <3 of 4 in
 *  R1, <2 of 4 in R2). The synthesizer would be reasoning over a
 *  fragmented voice set — better to fail loudly than produce a misleading
 *  "brief" based on one voice. */
export class DebateQuorumLostError extends Error {
  constructor(
    public readonly stage: 'r1' | 'r2',
    public readonly succeededCount: number,
    public readonly required: number,
    public readonly failures: DebateFailure[],
  ) {
    super(
      `Debate ${stage} quorum lost: only ${succeededCount} of ${required} required voices succeeded ` +
        `(failed: ${failures.map(f => `${f.role}=${f.isTimeout ? 'timeout' : 'error'}`).join(', ')})`,
    )
    this.name = 'DebateQuorumLostError'
  }
}

/** Per-member failure during a round. Wrapped around the underlying
 *  spawn error so the orchestrator can distinguish "voice failed" from
 *  "infrastructure failed". */
export class DebateMemberFailureError extends Error {
  constructor(
    public readonly role: ResearchRole,
    public readonly roundNumber: 1 | 2 | 3,
    public readonly underlying: unknown,
  ) {
    super(
      `Debate round ${roundNumber} failed for ${role}: ${underlying instanceof Error ? underlying.message : String(underlying)}`,
    )
    this.name = 'DebateMemberFailureError'
  }
}

/** Per-member timeout — distinct from generic failure so callers can
 *  treat slow providers differently from broken ones. */
export class DebateTimeoutError extends Error {
  constructor(
    public readonly stage: 'r1' | 'r2' | 'synthesist',
    public readonly timeoutMs: number,
    public readonly role?: ResearchRole,
  ) {
    super(
      `Debate ${stage}${role ? ` (${role})` : ''} exceeded ${timeoutMs}ms timeout`,
    )
    this.name = 'DebateTimeoutError'
  }
}

/** Per-debate cost ceiling exceeded. */
export class DebateCostCeilingError extends Error {
  constructor(
    public readonly ceilingUsd: number,
    public readonly accumulatedUsd: number,
    public readonly stage: string,
  ) {
    super(
      `Debate exceeded cost ceiling: $${accumulatedUsd.toFixed(4)} > $${ceilingUsd.toFixed(2)} at stage "${stage}"`,
    )
    this.name = 'DebateCostCeilingError'
  }
}

// ──────────────────────────────────────────────────────────────────────
// Tunable constants
// ──────────────────────────────────────────────────────────────────────

/** ≥3 of 4 voices must deliver Round 1 positions for the debate to proceed
 *  to Round 2. Round 2 needs voices to engage with each other — too few
 *  positions and the responses become trivial. */
export const R1_QUORUM = 3

/** ≥2 of 4 voices must deliver Round 2 responses for the Synthesist to
 *  have material. Below this, the brief would just be Round 1 with extra
 *  steps. */
export const R2_QUORUM = 2
