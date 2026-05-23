/**
 * Council orchestrator — deterministic pipeline (v2 target).
 *
 * v1 STATUS: this file is a contract sketch, not the active codepath.
 *
 * In v1, council mode works by installing a strict system prompt (see
 * COUNCIL_COORDINATOR_PROMPT in built-in/council/prompts.ts) that directs
 * the coordinator LLM to follow the propose → synthesize → execute →
 * review pipeline. The LLM is the orchestrator.
 *
 * v2 will replace LLM-driven orchestration with the deterministic pipeline
 * defined below — a plain TypeScript function that programmatically spawns
 * each council member via runAgent, awaits proposals in parallel,
 * pipes them into the synthesizer, then the executor, then the reviewers.
 * Predictable, cheaper (no coordinator-token spend), unit-testable.
 *
 * The migration path: implement runCouncil() against the AgentTool internal
 * API (runAgent in src/tools/AgentTool/runAgent.ts), then have the /council
 * slash command route to runCouncil() directly instead of toggling the env
 * var and falling through to the coordinator-LLM loop.
 *
 * Why ship v1 LLM-driven first: the LLM coordinator already exists, already
 * handles parallel spawns, already streams task notifications back into the
 * session. The deterministic path needs ~200 lines of internal-API wiring
 * we'd rather write once we've seen the workflow run end-to-end.
 */

// ──────────────────────────────────────────────────────────────────────
// Types — stable across v1/v2. The orchestrator's external contract.
// ──────────────────────────────────────────────────────────────────────

export type CouncilRole =
  | 'architect'
  | 'implementer'
  | 'skeptic'
  | 'critic'

export type ReviewVerdict = 'pass' | 'nit' | 'concern' | 'block'

export interface Proposal {
  role: CouncilRole
  modelId: string
  text: string // The agent's structured proposal (Reasoning / Proposal / Risks)
  durationMs: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface SynthesizedPlan {
  text: string // Consensus / Divergence / Plan / Risks
  modelId: string
  durationMs: number
  costUsd: number
}

export interface ExecutorResult {
  diff: string // Unified diff produced by the executor
  summary: string // Executor's narrative summary
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
  revised?: ExecutorResult // Present iff a revision pass ran
  totalCostUsd: number
  totalDurationMs: number
}

export interface CouncilInputs {
  userPrompt: string
  // Where the orchestrator should announce status / errors. In v1 this is
  // the slash command's stdout. In v2 it'll be the active session's
  // message stream so updates render inline with the conversation.
  emitStatus: (msg: string) => void
  // Per-query hard cost ceiling in USD. The orchestrator aborts with a
  // structured error if exceeded mid-pipeline.
  costCeilingUsd?: number
  // Per-member execution timeout. Defaults to 60s.
  memberTimeoutMs?: number
}

// ──────────────────────────────────────────────────────────────────────
// v1 — placeholder. The active codepath is LLM-driven via
// COUNCIL_COORDINATOR_PROMPT. This function will throw if called in v1.
// Wire it up in v2 by calling runAgent for each member, awaiting Promise.all
// of the four proposals, then the synthesizer, then the executor, then the
// reviewers (and optionally one revise pass if ≥2 block verdicts).
// ──────────────────────────────────────────────────────────────────────

export async function runCouncil(
  _inputs: CouncilInputs,
): Promise<CouncilResult> {
  throw new Error(
    'runCouncil() is not wired in v1. Council mode is currently LLM-driven via ' +
      'the coordinator system prompt — enable it with `/council on` and the ' +
      'coordinator LLM will execute the workflow. To migrate to deterministic ' +
      'orchestration, implement this function against runAgent (see header).',
  )
}

// ──────────────────────────────────────────────────────────────────────
// Helpers used by both v1 (for cost telemetry) and v2 (for orchestration).
// Pure functions — no external dependencies. Move them as the wiring grows.
// ──────────────────────────────────────────────────────────────────────

/**
 * Count blocking verdicts. Used to decide whether the executor needs a
 * revision pass. Centralized here so v1 review parsing and v2 orchestration
 * use the same definition.
 */
export function countBlockingReviews(reviews: Review[]): number {
  return reviews.filter(r => r.verdict === 'block').length
}

/**
 * Whether the council should trigger a revision pass after reviews.
 * v1 policy: 2+ blocks → revise once. Easy to tune later.
 */
export function shouldRevise(reviews: Review[]): boolean {
  return countBlockingReviews(reviews) >= 2
}

/**
 * Format proposals for the synthesizer's input. Stable shape so the
 * synthesizer prompt can rely on it.
 */
export function formatProposalsForSynthesizer(proposals: Proposal[]): string {
  return proposals
    .map(
      p => `# ${p.role.toUpperCase()} (model: ${p.modelId})\n\n${p.text}\n`,
    )
    .join('\n---\n\n')
}
