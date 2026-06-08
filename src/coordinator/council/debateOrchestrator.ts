/**
 * Debate orchestrator — multi-round position-evolution pipeline.
 *
 * Distinct from Council (`councilOrchestrator.ts`):
 *   - Council: 7 isolated proposals → synth → executor → 7 isolated reviews
 *   - Debate: 4 isolated positions (R1) → 4 responses w/ visibility (R2) → 1 Synthesist brief
 *
 * Same fault-tolerance shape: each round uses `Promise.allSettled` so a
 * timed-out voice doesn't kill the whole debate; below quorum
 * (R1_QUORUM=3, R2_QUORUM=2) we throw `DebateQuorumLostError`.
 *
 * Shares the helpers `extractHeadline`, `formatStageDone`, etc. from
 * `councilOrchestrator.ts` since the formatters are role-name-agnostic.
 */

import {
  // We re-use these from Council — same shape, no need to duplicate.
  // capitalizeRole is internal to councilOrchestrator so we re-derive
  // a local version below for ResearchRole.
  extractHeadline,
  formatStageDone,
} from './councilOrchestrator.js'
import { emit as emitSessionEvent } from './sessionBus.js'
import {
  DebateCostCeilingError,
  DebateMemberFailureError,
  DebateQuorumLostError,
  DebateTimeoutError,
  R1_QUORUM,
  R2_QUORUM,
  RESEARCH_ROLES,
  makePositionId,
  type DebateAdapters,
  type DebateFailure,
  type DebateInputs,
  type DebateResult,
  type Position,
  type ResearchRole,
} from './debate.js'

// ──────────────────────────────────────────────────────────────────────
// Pure helpers — exported for tests + the spawn adapter to build prompts
// ──────────────────────────────────────────────────────────────────────

/** Build the Round 2 prompt section that shows the voice all of Round 1's
 *  positions. Each position is rendered with its `PositionId` so the
 *  voice can cite it in `builds_on:` / `contradicts:` blocks.
 *
 *  Output format (passed verbatim as text to the Round 2 prompt):
 *
 *      r1-hypothesizer (claude-opus-4-7):
 *      <full position text — headline + sections>
 *
 *      ---
 *
 *      r1-empiricist (deepseek-chat):
 *      <full position text>
 *
 *      ...
 *
 *  The full text of each position is included (not a summary) because
 *  Round 2 voices need to engage with specifics, not paraphrases.
 *  Synthesist gets the same shape over R1 + R2.
 */
export function formatPriorPositions(positions: Position[]): string {
  return positions
    .map(p => `${p.id} (${p.modelId}):\n${p.text.trim()}`)
    .join('\n\n---\n\n')
}

/** Build the failure line emitted to the transcript when a voice rejects.
 *  Symmetric with Council's `formatMemberFailure` so the visual cadence
 *  is identical: `> ✗ **Hypothesizer** r1: timed out after 300000ms`. */
export function formatDebateMemberFailure(
  roundNumber: 1 | 2 | 3,
  role: ResearchRole,
  err: unknown,
): string {
  const label = `**${capitalizeResearchRole(role)}** r${roundNumber}`
  if (err instanceof DebateTimeoutError) {
    return `> ✗ ${label}: **timed out** after ${err.timeoutMs}ms`
  }
  const msg = err instanceof Error ? err.message : String(err)
  const trimmed = msg.length > 200 ? msg.slice(0, 200) + '…' : msg
  return `> ✗ ${label}: **failed** — ${trimmed}`
}

/** Build the per-arrival preview line. Mirrors Council's
 *  `formatProposalArrival` but with `r<round>` context so the user can
 *  tell rounds apart in the transcript:
 *  `▎ Hypothesizer (claude-opus-4-7) r1: <headline>` */
export function formatPositionArrival(p: Position): string {
  const headline = extractHeadline(p.text)
  const model = modelHint(p.role, p.modelId)
  const label = `**${capitalizeResearchRole(p.role)}**${model} r${p.roundNumber}`
  if (headline) return `> ${label}: ${headline}`
  return `> ${label}: (position landed; no headline extracted)`
}

/** Parse the `Confidence (1-5)` block from a position's text. Returns
 *  null when the model omitted it or emitted something unparseable. */
export function parseConfidence(text: string): number | null {
  // Tolerant: match `## Confidence (1-5)\n<n>` or `Confidence: <n>` or
  // `Confidence (1-5): <n>` — anything starting with the word.
  const m = text.match(/^#{0,6}\s*confidence[^\n]*\n+\s*([1-5])\b/im)
  if (m && m[1]) return parseInt(m[1], 10)
  const inline = text.match(/^#{0,6}\s*confidence[^\n]*:\s*([1-5])\b/im)
  if (inline && inline[1]) return parseInt(inline[1], 10)
  return null
}

/** Parse `builds_on: [r1-empiricist, r1-methodologist]` from the
 *  voice's output. Tolerant of bullet-list and inline forms. Empty
 *  array when not found or empty. */
export function parseLineage(
  text: string,
  field: 'builds_on' | 'contradicts',
): string[] {
  // Match either "- builds_on: [...]" or "builds_on: [...]" anywhere.
  // The bracketed list can be empty (`[]`) or contain comma-separated IDs.
  const inline = text.match(
    new RegExp(`(?:^|\\n)\\s*[-*]?\\s*${field}\\s*:\\s*\\[([^\\]]*)\\]`, 'i'),
  )
  if (inline && inline[1] !== undefined) {
    return inline[1]
      .split(',')
      .map(s => s.trim())
      .filter(s => /^r\d+-[a-z_]+$/i.test(s))
  }
  return []
}

function capitalizeResearchRole(role: ResearchRole): string {
  return role
    .split('_')
    .map(w => w[0]!.toUpperCase() + w.slice(1))
    .join(' ')
}

function modelHint(role: ResearchRole, modelId: string): string {
  if (!modelId || modelId === role) return ''
  return ` (${modelId})`
}

// ──────────────────────────────────────────────────────────────────────
// Internal — cost ledger + timeout race
// ──────────────────────────────────────────────────────────────────────

/**
 * Tracks cumulative cost during a debate and throws when it crosses the
 * ceiling. Two data sources:
 *
 *   1. **Per-spawn `costUsd`** — what `recordOrThrow` accepts. In tests
 *      where adapters return real per-call costs, this is the only
 *      signal needed.
 *
 *   2. **Global cost-tracker delta** — exposed via the `getCurrentCost`
 *      callback. Necessary in the AgentTool-backed deterministic path,
 *      where `invokeAgentTool` returns `costUsd: 0` because the
 *      AgentTool API doesn't expose flat cost. The orchestrator's local
 *      ledger would never tick up and the ceiling would never fire —
 *      live debates have hit $1.50+ on a $1.00 ceiling because of this.
 *      The callback lets the ledger snapshot the global cost-tracker
 *      between stages and use the larger of (sum of recorded, global
 *      delta) as the accumulated total. That way the ceiling fires
 *      whichever source has the higher number.
 *
 * Default `getCurrentCost` is `() => 0`, which preserves legacy test
 * behaviour: tests that don't wire in a cost tracker continue to drive
 * the ledger purely through `recordOrThrow`.
 */
class CostLedger {
  private recorded = 0
  private readonly startGlobalCost: number
  constructor(
    private readonly ceilingUsd: number,
    private readonly getCurrentCost: () => number = () => 0,
  ) {
    this.startGlobalCost = getCurrentCost()
  }
  recordOrThrow(stage: string, costUsd: number): void {
    this.recorded += costUsd
    this.throwIfOverCeiling(stage)
  }
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
      throw new DebateCostCeilingError(
        this.ceilingUsd,
        accumulated,
        stage,
      )
    }
  }
}

/** Race a promise against a timeout. On timeout, abort the signal so the
 *  underlying spawn can clean up, then throw DebateTimeoutError. Mirrors
 *  Council's `withTimeout`. */
async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  stage: 'r1' | 'r2' | 'synthesist',
  role?: ResearchRole,
): Promise<T> {
  const ac = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ac.abort()
        reject(new DebateTimeoutError(stage, timeoutMs, role))
      }, timeoutMs)
    })
    return await Promise.race([fn(ac.signal), timeoutPromise])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Turn a rejected Promise.allSettled result into a structured
 *  DebateFailure entry. */
function settlementToFailure(
  role: ResearchRole,
  roundNumber: 1 | 2 | 3,
  reason: unknown,
): DebateFailure {
  if (reason instanceof DebateTimeoutError) {
    return {
      role,
      roundNumber,
      reason: `timed out after ${reason.timeoutMs}ms`,
      isTimeout: true,
    }
  }
  if (reason instanceof DebateMemberFailureError) {
    const inner =
      reason.underlying instanceof Error
        ? reason.underlying.message
        : String(reason.underlying)
    return { role, roundNumber, reason: inner, isTimeout: false }
  }
  const msg = reason instanceof Error ? reason.message : String(reason)
  return { role, roundNumber, reason: msg, isTimeout: false }
}

// ──────────────────────────────────────────────────────────────────────
// Main entry point
// ──────────────────────────────────────────────────────────────────────

export async function runDebate(inputs: DebateInputs): Promise<DebateResult> {
  const {
    question,
    contextFiles,
    emitStatus,
    costCeilingUsd = 1.0,
    getCurrentCost,
    memberTimeoutMs = 300_000,
    synthesistTimeoutMs = 5 * 60_000,
    adapters,
  } = inputs

  const start = Date.now()
  const ledger = new CostLedger(costCeilingUsd, getCurrentCost)
  const failures: DebateFailure[] = []

  // ── Round 1: independent positions ──────────────────────────────────
  emitStatus(
    `Debate opened — round 1, ${RESEARCH_ROLES.length} researchers proposing independently.`,
  )
  ledger.ensureHeadroomOrThrow('r1')

  const r1Ids: Map<ResearchRole, string> =
    (await adapters.prepareBatch?.({ kind: 'r1', roles: RESEARCH_ROLES })) ??
    new Map()

  const r1Settlements = await Promise.allSettled(
    RESEARCH_ROLES.map(role => {
      const toolUseId = r1Ids.get(role)
      return withTimeout(
        signal =>
          adapters.spawnResearcher({
            role,
            roundNumber: 1,
            question,
            contextFiles,
            priorPositions: [],
            toolUseId,
            signal,
          }),
        memberTimeoutMs,
        'r1',
        role,
      )
        .then(async p => {
          emitStatus(formatPositionArrival(p))
          if (toolUseId) {
            await adapters.completeMember?.({
              kind: 'r1',
              role,
              toolUseId,
              status: 'success',
              summary: p.text,
            })
          }
          return p
        })
        .catch(async err => {
          emitStatus(formatDebateMemberFailure(1, role, err))
          if (toolUseId) {
            await adapters.completeMember?.({
              kind: 'r1',
              role,
              toolUseId,
              status: 'error',
              summary: err instanceof Error ? err.message : String(err),
            })
          }
          if (err instanceof DebateTimeoutError) throw err
          throw new DebateMemberFailureError(role, 1, err)
        })
    }),
  )

  const round1Positions: Position[] = []
  for (let i = 0; i < r1Settlements.length; i++) {
    const settlement = r1Settlements[i]!
    const role = RESEARCH_ROLES[i]!
    if (settlement.status === 'fulfilled') {
      round1Positions.push(settlement.value)
    } else {
      failures.push(settlementToFailure(role, 1, settlement.reason))
    }
  }

  if (round1Positions.length < R1_QUORUM) {
    throw new DebateQuorumLostError(
      'r1',
      round1Positions.length,
      R1_QUORUM,
      failures,
    )
  }

  for (const p of round1Positions) ledger.recordOrThrow('r1:' + p.role, p.costUsd)
  emitStatus(
    formatStageDone(
      'synthesizer',
      Date.now() - start,
      `Round 1 closed — ${round1Positions.length}/${RESEARCH_ROLES.length} positions in.`,
    ).replace('Synthesizer', 'Round 1'),
  )

  // ── Round 2: responses (each voice sees R1's positions) ─────────────
  // Only the roles that succeeded in R1 get to respond — a voice can't
  // refine its own position if it didn't have one.
  const r2Roles = round1Positions.map(p => p.role)
  emitStatus(`Round 2 — ${r2Roles.length} researchers responding.`)
  ledger.ensureHeadroomOrThrow('r2')

  const r2Ids: Map<ResearchRole, string> =
    (await adapters.prepareBatch?.({ kind: 'r2', roles: r2Roles })) ?? new Map()

  const r2Start = Date.now()
  const r2Settlements = await Promise.allSettled(
    r2Roles.map(role => {
      const toolUseId = r2Ids.get(role)
      return withTimeout(
        signal =>
          adapters.spawnResearcher({
            role,
            roundNumber: 2,
            question,
            contextFiles,
            priorPositions: round1Positions,
            toolUseId,
            signal,
          }),
        memberTimeoutMs,
        'r2',
        role,
      )
        .then(async p => {
          emitStatus(formatPositionArrival(p))
          if (toolUseId) {
            await adapters.completeMember?.({
              kind: 'r2',
              role,
              toolUseId,
              status: 'success',
              summary: p.text,
            })
          }
          return p
        })
        .catch(async err => {
          emitStatus(formatDebateMemberFailure(2, role, err))
          if (toolUseId) {
            await adapters.completeMember?.({
              kind: 'r2',
              role,
              toolUseId,
              status: 'error',
              summary: err instanceof Error ? err.message : String(err),
            })
          }
          if (err instanceof DebateTimeoutError) throw err
          throw new DebateMemberFailureError(role, 2, err)
        })
    }),
  )

  const round2Positions: Position[] = []
  for (let i = 0; i < r2Settlements.length; i++) {
    const settlement = r2Settlements[i]!
    const role = r2Roles[i]!
    if (settlement.status === 'fulfilled') {
      round2Positions.push(settlement.value)
    } else {
      failures.push(settlementToFailure(role, 2, settlement.reason))
    }
  }

  if (round2Positions.length < R2_QUORUM) {
    throw new DebateQuorumLostError(
      'r2',
      round2Positions.length,
      R2_QUORUM,
      failures,
    )
  }

  for (const p of round2Positions) ledger.recordOrThrow('r2:' + p.role, p.costUsd)
  emitStatus(
    formatStageDone(
      'synthesizer',
      Date.now() - r2Start,
      `Round 2 closed — ${round2Positions.length}/${r2Roles.length} responses in.`,
    ).replace('Synthesizer', 'Round 2'),
  )

  // ── Round 3: Synthesist builds the brief ────────────────────────────
  emitStatus('Synthesizing — building the brief from all rounds.')
  ledger.ensureHeadroomOrThrow('synthesist')

  const synthToolUseId = await adapters.prepareSingle?.({
    kind: 'synthesist',
    description: 'Synthesize debate brief',
  })

  const synthStart = Date.now()
  const allPositions = [...round1Positions, ...round2Positions]
  let synth: { text: string; modelId: string; durationMs: number; costUsd: number }
  // Surface the synthesist as a voice in the agent thoughts pane,
  // mirroring the verifier wiring below. session-start declared
  // 'synthesist' in the voices list; flip running → done/failed as
  // the spawn progresses.
  emitSessionEvent({ type: 'voice-state', role: 'synthesist', status: 'running' })
  try {
    synth = await withTimeout(
      signal =>
        adapters.spawnSynthesist({
          question,
          contextFiles,
          allPositions,
          toolUseId: synthToolUseId,
          signal,
        }),
      synthesistTimeoutMs,
      'synthesist',
    )
    if (synthToolUseId) {
      await adapters.completeMember?.({
        kind: 'synthesist',
        toolUseId: synthToolUseId,
        status: 'success',
        summary: synth.text,
      })
    }
    // Stream the brief text into the agent thoughts pane via the
    // synthesist voice card.
    emitSessionEvent({ type: 'voice-output', role: 'synthesist', chunk: synth.text })
    emitSessionEvent({
      type: 'voice-state',
      role: 'synthesist',
      status: 'done',
      headline: extractHeadline(synth.text) ?? 'Brief written',
    })
    emitStatus(
      formatStageDone('synthesizer', Date.now() - synthStart, synth.text),
    )
  } catch (err) {
    if (synthToolUseId) {
      await adapters.completeMember?.({
        kind: 'synthesist',
        toolUseId: synthToolUseId,
        status: 'error',
        summary: err instanceof Error ? err.message : String(err),
      })
    }
    emitSessionEvent({
      type: 'voice-state',
      role: 'synthesist',
      status: 'failed',
      headline: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
  ledger.recordOrThrow('synthesist', synth.costUsd)

  // ── Verifier stage (optional, never blocks) ─────────────────────────
  // Post-synthesis fact-check. Runs only when the adapter supplied
  // a `spawnVerifier` callback. Failures degrade gracefully — the
  // brief still ships without verification notes if the verifier
  // cap-hits, times out, or errors.
  // TEMP DEBUG 2026-06-08 — emitStatus turned out to be a no-op in
  // the /discover code path (slash command doesn't pass it through),
  // so write to a file we can grep instead. Remove once verifier
  // works end-to-end.
  try {
    const { appendFileSync } = await import('node:fs')
    appendFileSync(
      '/tmp/verifier-debug.log',
      `[${new Date().toISOString()}] post-synth: typeof spawnVerifier = ${typeof adapters.spawnVerifier}, adapter keys = ${Object.keys(adapters).join(',')}\n`,
    )
  } catch {
    // best-effort
  }
  let verification: DebateResult['verification']
  if (adapters.spawnVerifier) {
    emitStatus('Verifying — checking the brief against the appendix.')
    // Surface the verifier as a voice in the agent thoughts pane.
    // session-start declared 'verifier' in the voices list; flip to
    // 'running' as we kick off the spawn so the UI lights up.
    emitSessionEvent({ type: 'voice-state', role: 'verifier', status: 'running' })
    const verifyStart = Date.now()
    try {
      const v = await withTimeout(
        signal =>
          adapters.spawnVerifier!({
            question,
            brief: synth.text,
            allPositions,
            signal,
          }),
        synthesistTimeoutMs,
        'synthesist', // re-uses synth timeout class for the stage budget
      )
      ledger.recordOrThrow('synthesist', v.costUsd)
      verification = {
        status: 'ok',
        notes: v.text,
        flagCount: countSuspectClaims(v.text),
        modelId: v.modelId,
        durationMs: Date.now() - verifyStart,
      }
      // Push the verifier text onto the agent thoughts pane via the
      // standard voice-output bus event, then flip status to done.
      emitSessionEvent({ type: 'voice-output', role: 'verifier', chunk: v.text })
      emitSessionEvent({
        type: 'voice-state',
        role: 'verifier',
        status: 'done',
        headline:
          extractHeadline(v.text) ??
          `Verifier flagged ${verification.flagCount} claim(s)`,
      })
      emitStatus(formatStageDone('verifier', Date.now() - verifyStart, v.text))
    } catch (err) {
      verification = {
        status: 'failed',
        notes: '',
        flagCount: 0,
        reason: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - verifyStart,
      }
      emitSessionEvent({
        type: 'voice-state',
        role: 'verifier',
        status: 'failed',
        headline: verification.reason ?? 'verifier failed',
      })
      emitStatus(
        `Verifier stage failed (${verification.reason}). Brief shipped without verification notes.`,
      )
    }
  }

  emitStatus('Debate finished.')

  return {
    question,
    rounds: [
      { roundNumber: 1, positions: round1Positions },
      { roundNumber: 2, positions: round2Positions },
    ],
    brief: synth.text,
    failures,
    totalCostUsd: ledger.total(),
    totalDurationMs: Date.now() - start,
    verification,
  }
}

/**
 * Best-effort count of items in the verifier's "Suspect claims" list.
 * Counts "Concern:" lines — the most stable marker across model
 * output variations. VERIFIER_PROMPT's canonical schema is:
 *   - **Claim**: "..."
 *     - **Concern**: ...
 *     - **Suggested check**: ...
 * Local models vary in fidelity. Observed variants:
 *   - R1 on Q-Day (2026-06-09): `- **Q-Day**:` + `- Concern:` (bullets)
 *   - R1 on quantization (2026-06-09): `### Concern` (markdown header)
 * Counting Concern markers — in either bullet OR header form — gives
 * a robust flag count, because every flag has exactly one Concern
 * per the prompt's schema.
 *
 * Returns 0 when the section is empty ("(none)", "<none>", "none").
 */
function countSuspectClaims(notes: string): number {
  if (!notes) return 0
  // Empty-section sentinel — accept (none), <none>, "none", any case
  if (/^\s*[(<]?none[)>]?\s*$/im.test(notes)) return 0
  // Match a Concern marker as either:
  //   (a) bullet — `- Concern:` or `- **Concern**:` or `* Concern:`
  //   (b) header — `### Concern` or `## Concern`
  // The bullet form is canonical per VERIFIER_PROMPT; header form is
  // R1's drift variant. Either marks exactly one flagged claim.
  const bulletMatches = notes.match(/^\s*[-*]\s+\*{0,2}Concern\*{0,2}\s*:/gim) ?? []
  const headerMatches = notes.match(/^#{2,4}\s+\*{0,2}Concern\*{0,2}/gim) ?? []
  return bulletMatches.length + headerMatches.length
}

// Re-exports for convenience.
export {
  RESEARCH_ROLES,
  R1_QUORUM,
  R2_QUORUM,
  makePositionId,
  DebateQuorumLostError,
  DebateMemberFailureError,
  DebateTimeoutError,
  DebateCostCeilingError,
}
export type {
  DebateAdapters,
  DebateFailure,
  DebateInputs,
  DebateResult,
  Position,
  ResearchRole,
}
