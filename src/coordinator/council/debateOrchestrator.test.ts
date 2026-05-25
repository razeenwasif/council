import { describe, expect, test } from 'bun:test'
import {
  DebateMemberFailureError,
  DebateQuorumLostError,
  DebateTimeoutError,
  R1_QUORUM,
  R2_QUORUM,
  RESEARCH_ROLES,
  formatDebateMemberFailure,
  formatPositionArrival,
  formatPriorPositions,
  makePositionId,
  parseConfidence,
  parseLineage,
  runDebate,
  type DebateAdapters,
  type Position,
  type ResearchRole,
} from './debateOrchestrator.js'

// ──────────────────────────────────────────────────────────────────────
// Test factories
// ──────────────────────────────────────────────────────────────────────

function makePosition(
  role: ResearchRole,
  roundNumber: 1 | 2,
  overrides: Partial<Position> = {},
): Position {
  return {
    id: makePositionId(roundNumber, role),
    role,
    modelId: `model-for-${role}`,
    roundNumber,
    text: `## Headline\n${role} r${roundNumber} headline\n\n## Position\n${role} r${roundNumber} body.`,
    buildsOn: [],
    contradicts: [],
    confidence: 3,
    durationMs: 100,
    costUsd: 0.01,
    ...overrides,
  }
}

function happyAdapters(overrides: Partial<DebateAdapters> = {}): DebateAdapters {
  return {
    spawnResearcher: async ({ role, roundNumber }) =>
      makePosition(role, roundNumber as 1 | 2),
    spawnSynthesist: async () => ({
      text: '# Brief: test\n\n## Strongest convergent claim\nbody',
      modelId: 'synth-model',
      durationMs: 80,
      costUsd: 0.02,
    }),
    ...overrides,
  }
}

function noopEmit(): (msg: string) => void {
  return () => {}
}

// ──────────────────────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────────────────────

describe('makePositionId', () => {
  test('uses the documented r<n>-<role> shape', () => {
    expect(makePositionId(1, 'hypothesizer')).toBe('r1-hypothesizer')
    expect(makePositionId(2, 'devils_advocate')).toBe('r2-devils_advocate')
  })
})

describe('parseConfidence', () => {
  test('extracts the block form `## Confidence (1-5)\\n4`', () => {
    expect(parseConfidence('## Confidence (1-5)\n4 — solid evidence')).toBe(4)
  })

  test('extracts the inline form `Confidence: 3`', () => {
    expect(parseConfidence('## Confidence: 3 — moderate')).toBe(3)
  })

  test('returns null when missing', () => {
    expect(parseConfidence('no confidence section here')).toBeNull()
  })

  test('returns null on unparseable value (e.g. "high")', () => {
    expect(parseConfidence('## Confidence: high')).toBeNull()
  })

  test('clamps to 1-5 (rejects 6, 7, etc.)', () => {
    // 7 doesn't match the /[1-5]/ class, so returns null.
    expect(parseConfidence('## Confidence: 7')).toBeNull()
  })
})

describe('parseLineage', () => {
  test('parses inline `builds_on: [a, b]`', () => {
    expect(
      parseLineage('## Engaging with\n- builds_on: [r1-empiricist, r1-methodologist]', 'builds_on'),
    ).toEqual(['r1-empiricist', 'r1-methodologist'])
  })

  test('parses inline `contradicts: [a]`', () => {
    expect(
      parseLineage('contradicts: [r1-devils_advocate]', 'contradicts'),
    ).toEqual(['r1-devils_advocate'])
  })

  test('returns empty when the list is `[]`', () => {
    expect(parseLineage('- builds_on: []', 'builds_on')).toEqual([])
  })

  test('returns empty when field is missing', () => {
    expect(parseLineage('some random text', 'builds_on')).toEqual([])
  })

  test('filters out values that do not match position-id shape', () => {
    expect(
      parseLineage('builds_on: [r1-empiricist, not-an-id, r2-methodologist]', 'builds_on'),
    ).toEqual(['r1-empiricist', 'r2-methodologist'])
  })
})

describe('formatPriorPositions', () => {
  test('emits each position with id + model + text, separated by ---', () => {
    const out = formatPriorPositions([
      makePosition('hypothesizer', 1, { text: 'h-text' }),
      makePosition('empiricist', 1, { text: 'e-text' }),
    ])
    expect(out).toContain('r1-hypothesizer (model-for-hypothesizer):')
    expect(out).toContain('h-text')
    expect(out).toContain('r1-empiricist (model-for-empiricist):')
    expect(out).toContain('e-text')
    expect(out).toContain('---')
  })

  test('empty input → empty string', () => {
    expect(formatPriorPositions([])).toBe('')
  })
})

describe('formatPositionArrival', () => {
  test('includes round + role + model + headline', () => {
    const p = makePosition('hypothesizer', 1, {
      text: '## Headline\nThe quantization noise floor is the SNR ceiling.',
    })
    expect(formatPositionArrival(p)).toBe(
      '> **Hypothesizer** (model-for-hypothesizer) r1: The quantization noise floor is the SNR ceiling.',
    )
  })

  test('omits model parens when modelId equals role', () => {
    const p = makePosition('empiricist', 2, {
      modelId: 'empiricist',
      text: '## Headline\nGrounded claim.',
    })
    expect(formatPositionArrival(p)).toBe(
      '> **Empiricist** r2: Grounded claim.',
    )
  })

  test('falls back when headline missing entirely', () => {
    const p = makePosition('devils_advocate', 1, { text: '' })
    expect(formatPositionArrival(p)).toContain(
      '(position landed; no headline extracted)',
    )
  })

  test('formats two-word role names ("Devils Advocate")', () => {
    const p = makePosition('devils_advocate', 1, {
      text: '## Headline\nSimpler null explains data.',
    })
    expect(formatPositionArrival(p)).toContain('**Devils Advocate**')
  })
})

describe('formatDebateMemberFailure', () => {
  test('renders timeout with duration', () => {
    const out = formatDebateMemberFailure(
      1,
      'methodologist',
      new DebateTimeoutError('r1', 300_000, 'methodologist'),
    )
    expect(out).toContain('Methodologist')
    expect(out).toContain('r1')
    expect(out).toContain('300000')
    expect(out).toContain('timed out')
  })

  test('renders generic failure with truncated message', () => {
    const out = formatDebateMemberFailure(2, 'hypothesizer', new Error('x'.repeat(500)))
    expect(out).toContain('Hypothesizer')
    expect(out).toContain('r2')
    expect(out).toContain('…')
  })
})

// ──────────────────────────────────────────────────────────────────────
// Full pipeline — happy path
// ──────────────────────────────────────────────────────────────────────

describe('runDebate — happy path', () => {
  test('R1 + R2 + synthesist all succeed', async () => {
    const result = await runDebate({
      question: 'test question',
      contextFiles: [],
      emitStatus: noopEmit(),
      adapters: happyAdapters(),
    })

    expect(result.rounds).toHaveLength(2)
    expect(result.rounds[0]!.roundNumber).toBe(1)
    expect(result.rounds[0]!.positions).toHaveLength(4)
    expect(result.rounds[1]!.roundNumber).toBe(2)
    expect(result.rounds[1]!.positions).toHaveLength(4)
    expect(result.brief).toContain('# Brief')
    expect(result.failures).toEqual([])
    expect(result.totalCostUsd).toBeGreaterThan(0)
  })

  test('emits stage transitions in order', async () => {
    const emits: string[] = []
    await runDebate({
      question: 'x',
      contextFiles: [],
      emitStatus: m => emits.push(m),
      adapters: happyAdapters(),
    })
    const joined = emits.join('\n')
    expect(joined).toContain('Debate opened')
    expect(joined).toContain('Round 1')
    expect(joined).toContain('Round 2')
    expect(joined).toContain('Synthesizing')
    expect(joined).toContain('Debate finished')
  })

  test('R2 spawn receives R1 positions in priorPositions', async () => {
    const seenPriorCounts: number[] = []
    await runDebate({
      question: 'x',
      contextFiles: [],
      emitStatus: noopEmit(),
      adapters: happyAdapters({
        spawnResearcher: async ({ roundNumber, priorPositions, role }) => {
          if (roundNumber === 2) seenPriorCounts.push(priorPositions.length)
          return makePosition(role, roundNumber as 1 | 2)
        },
      }),
    })
    // 4 R2 spawns, each should see 4 R1 positions.
    expect(seenPriorCounts).toEqual([4, 4, 4, 4])
  })

  test('synthesist sees all R1 + R2 positions', async () => {
    let synthSawCount = 0
    await runDebate({
      question: 'x',
      contextFiles: [],
      emitStatus: noopEmit(),
      adapters: happyAdapters({
        spawnSynthesist: async ({ allPositions }) => {
          synthSawCount = allPositions.length
          return { text: 'brief', modelId: 'm', durationMs: 1, costUsd: 0.01 }
        },
      }),
    })
    // 4 R1 + 4 R2 = 8 positions.
    expect(synthSawCount).toBe(8)
  })
})

// ──────────────────────────────────────────────────────────────────────
// Fault tolerance
// ──────────────────────────────────────────────────────────────────────

describe('runDebate — fault tolerance', () => {
  test('1 voice failing in R1 does NOT abort (3 of 4 succeed = meets R1_QUORUM)', async () => {
    const result = await runDebate({
      question: 'x',
      contextFiles: [],
      emitStatus: noopEmit(),
      adapters: happyAdapters({
        spawnResearcher: async ({ role, roundNumber }) => {
          if (role === 'devils_advocate' && roundNumber === 1) {
            throw new Error('provider 429')
          }
          return makePosition(role, roundNumber as 1 | 2)
        },
      }),
    })

    expect(result.rounds[0]!.positions).toHaveLength(3)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]!.role).toBe('devils_advocate')
    expect(result.failures[0]!.roundNumber).toBe(1)
    expect(result.failures[0]!.isTimeout).toBe(false)

    // R2 should only spawn for the 3 voices that succeeded R1.
    expect(result.rounds[1]!.positions).toHaveLength(3)
  })

  test('2 voices failing in R1 throws CouncilQuorumLostError', async () => {
    const failedRoles: ResearchRole[] = ['devils_advocate', 'methodologist']
    try {
      await runDebate({
        question: 'x',
        contextFiles: [],
        emitStatus: noopEmit(),
        adapters: happyAdapters({
          spawnResearcher: async ({ role, roundNumber }) => {
            if (failedRoles.includes(role) && roundNumber === 1) {
              throw new Error(`flake-${role}`)
            }
            return makePosition(role, roundNumber as 1 | 2)
          },
        }),
      })
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(DebateQuorumLostError)
      const qe = err as DebateQuorumLostError
      expect(qe.stage).toBe('r1')
      expect(qe.succeededCount).toBe(2)
      expect(qe.required).toBe(R1_QUORUM)
      expect(qe.failures).toHaveLength(2)
    }
  })

  test('R2 quorum loss (3 of 4 R2 voices fail) throws', async () => {
    const failedR2Roles: ResearchRole[] = ['empiricist', 'devils_advocate', 'methodologist']
    try {
      await runDebate({
        question: 'x',
        contextFiles: [],
        emitStatus: noopEmit(),
        adapters: happyAdapters({
          spawnResearcher: async ({ role, roundNumber }) => {
            if (roundNumber === 2 && failedR2Roles.includes(role)) {
              throw new Error(`flake-${role}-r2`)
            }
            return makePosition(role, roundNumber as 1 | 2)
          },
        }),
      })
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(DebateQuorumLostError)
      const qe = err as DebateQuorumLostError
      expect(qe.stage).toBe('r2')
      expect(qe.succeededCount).toBe(1)
      expect(qe.required).toBe(R2_QUORUM)
    }
  })

  test('a single R1 timeout becomes a soft failure', async () => {
    const result = await runDebate({
      question: 'x',
      contextFiles: [],
      emitStatus: noopEmit(),
      memberTimeoutMs: 50,
      adapters: happyAdapters({
        spawnResearcher: async ({ role, signal, roundNumber }) => {
          if (role === 'hypothesizer' && roundNumber === 1) {
            return new Promise<Position>((_, reject) => {
              signal.addEventListener(
                'abort',
                () => reject(new Error('aborted')),
                { once: true },
              )
            })
          }
          return makePosition(role, roundNumber as 1 | 2)
        },
      }),
    })

    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]!.isTimeout).toBe(true)
    expect(result.failures[0]!.role).toBe('hypothesizer')
  })
})

// ──────────────────────────────────────────────────────────────────────
// Adapter integration — panel hooks fire correctly
// ──────────────────────────────────────────────────────────────────────

describe('runDebate — adapter hooks', () => {
  test('prepareBatch fires for r1 and r2 with the right roles', async () => {
    const calls: Array<{ kind: string; roles: readonly ResearchRole[] }> = []
    await runDebate({
      question: 'x',
      contextFiles: [],
      emitStatus: noopEmit(),
      adapters: happyAdapters({
        prepareBatch: async ({ kind, roles }) => {
          calls.push({ kind, roles })
          return new Map(roles.map((r, i) => [r, `id-${kind}-${i}`]))
        },
      }),
    })

    expect(calls).toHaveLength(2)
    expect(calls[0]!.kind).toBe('r1')
    expect(calls[0]!.roles).toEqual(RESEARCH_ROLES)
    expect(calls[1]!.kind).toBe('r2')
    expect(calls[1]!.roles).toEqual(RESEARCH_ROLES) // all 4 succeeded in r1
  })

  test('completeMember fires once per spawn with right status', async () => {
    const calls: Array<{ kind: string; role?: ResearchRole; status: string }> = []
    await runDebate({
      question: 'x',
      contextFiles: [],
      emitStatus: noopEmit(),
      adapters: happyAdapters({
        prepareBatch: async ({ roles, kind }) =>
          new Map(roles.map(r => [r, `id-${kind}-${r}`])),
        prepareSingle: async ({ kind }) => `id-${kind}`,
        completeMember: async ({ kind, role, status }) => {
          calls.push({ kind, role, status })
        },
      }),
    })

    // 4 r1 + 4 r2 + 1 synthesist = 9
    expect(calls).toHaveLength(9)
    expect(calls.every(c => c.status === 'success')).toBe(true)
    expect(calls.filter(c => c.kind === 'r1')).toHaveLength(4)
    expect(calls.filter(c => c.kind === 'r2')).toHaveLength(4)
    expect(calls.filter(c => c.kind === 'synthesist')).toHaveLength(1)
  })

  test('toolUseId from prepareBatch threads to spawnResearcher', async () => {
    const seen: Array<{ role: ResearchRole; toolUseId: string | undefined }> = []
    await runDebate({
      question: 'x',
      contextFiles: [],
      emitStatus: noopEmit(),
      adapters: happyAdapters({
        spawnResearcher: async ({ role, toolUseId, roundNumber }) => {
          if (roundNumber === 1) seen.push({ role, toolUseId })
          return makePosition(role, roundNumber as 1 | 2)
        },
        prepareBatch: async ({ roles, kind }) =>
          new Map(roles.map(r => [r, `tuid-${kind}-${r}`])),
      }),
    })
    for (const role of RESEARCH_ROLES) {
      const entry = seen.find(s => s.role === role)
      expect(entry?.toolUseId).toBe(`tuid-r1-${role}`)
    }
  })
})

// ──────────────────────────────────────────────────────────────────────
// Cost ceiling
// ──────────────────────────────────────────────────────────────────────

describe('runDebate — cost ceiling', () => {
  test('aborts when accumulated cost exceeds ceiling (per-spawn costUsd path)', async () => {
    const expensive = happyAdapters({
      spawnResearcher: async ({ role, roundNumber }) =>
        makePosition(role, roundNumber as 1 | 2, { costUsd: 0.5 }),
    })

    await expect(
      runDebate({
        question: 'x',
        contextFiles: [],
        emitStatus: noopEmit(),
        costCeilingUsd: 1.0,
        adapters: expensive,
      }),
    ).rejects.toThrow() // either DebateCostCeilingError or quorum issues — both acceptable
  })

  test('aborts via getCurrentCost when per-spawn costUsd is 0 (deterministic-path bug fix)', async () => {
    // Simulates the deterministic AgentTool path: every spawn returns
    // costUsd: 0 (because AgentTool.call doesn't expose flat cost), so
    // the ledger's per-spawn accumulator never ticks. Without the
    // getCurrentCost callback wiring, the ceiling never fires. With
    // it, the ledger snapshots the global cost-tracker delta and
    // catches the runaway.
    let pretendGlobalCost = 0
    const expensive = happyAdapters({
      spawnResearcher: async ({ role, roundNumber }) => {
        // Mimic real per-spawn cost flowing to global tracker only,
        // not exposed on the Position object.
        pretendGlobalCost += 0.4
        return makePosition(role, roundNumber as 1 | 2, { costUsd: 0 })
      },
    })

    await expect(
      runDebate({
        question: 'x',
        contextFiles: [],
        emitStatus: noopEmit(),
        costCeilingUsd: 1.0,
        getCurrentCost: () => pretendGlobalCost,
        adapters: expensive,
      }),
    ).rejects.toThrow() // CostCeilingError after 3 spawns × $0.40 = $1.20 > $1.00
  })

  test('does NOT abort when getCurrentCost stays below ceiling', async () => {
    // Same setup but the simulated global cost barely creeps up.
    let pretendGlobalCost = 0
    const cheap = happyAdapters({
      spawnResearcher: async ({ role, roundNumber }) => {
        pretendGlobalCost += 0.05
        return makePosition(role, roundNumber as 1 | 2, { costUsd: 0 })
      },
    })

    const result = await runDebate({
      question: 'x',
      contextFiles: [],
      emitStatus: noopEmit(),
      costCeilingUsd: 1.0,
      getCurrentCost: () => pretendGlobalCost,
      adapters: cheap,
    })
    expect(result.brief).toBeTruthy()
  })

  test('defaults to () => 0 when getCurrentCost not provided (legacy test behaviour preserved)', async () => {
    // No getCurrentCost passed; per-spawn costUsd of 0 means the
    // ledger stays at 0 and the run completes. This test pins the
    // "tests don't need to mock cost-tracker" behaviour. Synthesist
    // also returns 0 cost so a microscopic ceiling doesn't trip.
    const result = await runDebate({
      question: 'x',
      contextFiles: [],
      emitStatus: noopEmit(),
      costCeilingUsd: 0.001, // microscopic — would fire if anything was attributed
      adapters: happyAdapters({
        spawnResearcher: async ({ role, roundNumber }) =>
          makePosition(role, roundNumber as 1 | 2, { costUsd: 0 }),
        spawnSynthesist: async () => ({
          text: 'brief',
          modelId: 'm',
          durationMs: 1,
          costUsd: 0,
        }),
      }),
    })
    expect(result.brief).toBeTruthy()
  })
})

// ──────────────────────────────────────────────────────────────────────
// Member failure error shape
// ──────────────────────────────────────────────────────────────────────

describe('DebateMemberFailureError', () => {
  test('preserves role + round + underlying error', () => {
    const err = new DebateMemberFailureError(
      'empiricist',
      2,
      new Error('upstream 502'),
    )
    expect(err.role).toBe('empiricist')
    expect(err.roundNumber).toBe(2)
    expect(err.message).toContain('upstream 502')
    expect(err.message).toContain('empiricist')
  })
})
