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

class CostLedger {
  private accumulated = 0
  constructor(private readonly ceilingUsd: number) {}
  recordOrThrow(stage: string, costUsd: number): void {
    this.accumulated += costUsd
    if (this.accumulated > this.ceilingUsd) {
      throw new DebateCostCeilingError(
        this.ceilingUsd,
        this.accumulated,
        stage,
      )
    }
  }
  ensureHeadroomOrThrow(stage: string): void {
    if (this.accumulated >= this.ceilingUsd) {
      throw new DebateCostCeilingError(
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
    memberTimeoutMs = 300_000,
    synthesistTimeoutMs = 5 * 60_000,
    adapters,
  } = inputs

  const start = Date.now()
  const ledger = new CostLedger(costCeilingUsd)
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
    throw err
  }
  ledger.recordOrThrow('synthesist', synth.costUsd)

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
  }
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
