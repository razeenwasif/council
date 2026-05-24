import { describe, expect, test } from 'bun:test'
import {
  COUNCIL_ROLES,
  countBlockingReviews,
  CouncilCostCeilingError,
  CouncilMemberFailureError,
  CouncilTimeoutError,
  formatProposalsForSynthesizer,
  runCouncil,
  selectBlockingReviews,
  shouldRevise,
  type CouncilAdapters,
  type CouncilRole,
  type ExecutorResult,
  type Proposal,
  type Review,
  type ReviewVerdict,
  type SynthesizedPlan,
} from './councilOrchestrator.js'

// ──────────────────────────────────────────────────────────────────────
// Test factories — keep the assertions readable
// ──────────────────────────────────────────────────────────────────────

function makeProposal(role: CouncilRole, overrides: Partial<Proposal> = {}): Proposal {
  return {
    role,
    modelId: `model-for-${role}`,
    text: `${role} proposal body`,
    durationMs: 100,
    inputTokens: 100,
    outputTokens: 200,
    costUsd: 0.01,
    ...overrides,
  }
}

function makePlan(overrides: Partial<SynthesizedPlan> = {}): SynthesizedPlan {
  return {
    text: 'unified plan',
    modelId: 'synth-model',
    durationMs: 80,
    costUsd: 0.02,
    ...overrides,
  }
}

function makeExecutorResult(overrides: Partial<ExecutorResult> = {}): ExecutorResult {
  return {
    diff: '+ console.log("hi")\n',
    summary: 'added a log line',
    modelId: 'executor-model',
    durationMs: 500,
    costUsd: 0.5,
    ...overrides,
  }
}

function makeReview(
  role: CouncilRole,
  verdict: ReviewVerdict,
  overrides: Partial<Review> = {},
): Review {
  return {
    role,
    verdict,
    findings: [`${role} finding`],
    modelId: `model-for-${role}`,
    durationMs: 50,
    costUsd: 0.005,
    ...overrides,
  }
}

/** Adapter that returns canned results — happy path. */
function happyAdapters(overrides: Partial<CouncilAdapters> = {}): CouncilAdapters {
  return {
    spawnProposal: async ({ role }) => makeProposal(role),
    spawnSynthesizer: async () => makePlan(),
    spawnExecutor: async () => makeExecutorResult(),
    spawnReview: async ({ role }) => makeReview(role, 'pass'),
    ...overrides,
  }
}

function noopEmit(): (msg: string) => void {
  return () => {}
}

// ──────────────────────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────────────────────

describe('countBlockingReviews', () => {
  test('counts only block verdicts', () => {
    const reviews: Review[] = [
      makeReview('architect', 'pass'),
      makeReview('implementer', 'block'),
      makeReview('skeptic', 'block'),
      makeReview('critic', 'concern'),
      makeReview('tester', 'nit'),
      makeReview('security', 'block'),
      makeReview('performance', 'pass'),
    ]
    expect(countBlockingReviews(reviews)).toBe(3)
  })

  test('returns 0 when nothing blocks', () => {
    const reviews: Review[] = COUNCIL_ROLES.map(r => makeReview(r, 'pass'))
    expect(countBlockingReviews(reviews)).toBe(0)
  })
})

describe('shouldRevise', () => {
  test('triggers at the threshold (≥3 of 7)', () => {
    const exactlyThree: Review[] = [
      makeReview('architect', 'block'),
      makeReview('implementer', 'block'),
      makeReview('skeptic', 'block'),
      makeReview('critic', 'concern'),
      makeReview('tester', 'pass'),
      makeReview('security', 'pass'),
      makeReview('performance', 'pass'),
    ]
    expect(shouldRevise(exactlyThree)).toBe(true)
  })

  test('does not trigger at 2 blocks', () => {
    const twoBlocks: Review[] = [
      makeReview('architect', 'block'),
      makeReview('implementer', 'block'),
      makeReview('skeptic', 'concern'),
      makeReview('critic', 'concern'),
      makeReview('tester', 'pass'),
      makeReview('security', 'pass'),
      makeReview('performance', 'pass'),
    ]
    expect(shouldRevise(twoBlocks)).toBe(false)
  })
})

describe('selectBlockingReviews', () => {
  test('returns only block-verdict reviews', () => {
    const reviews: Review[] = [
      makeReview('architect', 'pass'),
      makeReview('implementer', 'block'),
      makeReview('skeptic', 'block'),
      makeReview('critic', 'nit'),
    ]
    const out = selectBlockingReviews(reviews)
    expect(out).toHaveLength(2)
    expect(out.map(r => r.role).sort()).toEqual(['implementer', 'skeptic'])
  })
})

describe('formatProposalsForSynthesizer', () => {
  test('emits role headers in upper-case with model + body', () => {
    const proposals: Proposal[] = [
      makeProposal('architect', { text: 'pull a shared util' }),
      makeProposal('skeptic', { text: 'beware of NaN' }),
    ]
    const out = formatProposalsForSynthesizer(proposals)
    expect(out).toContain('# ARCHITECT (model: model-for-architect)')
    expect(out).toContain('pull a shared util')
    expect(out).toContain('# SKEPTIC (model: model-for-skeptic)')
    expect(out).toContain('beware of NaN')
    expect(out).toContain('---') // separator between proposals
  })
})

// ──────────────────────────────────────────────────────────────────────
// Full pipeline — happy path
// ──────────────────────────────────────────────────────────────────────

describe('runCouncil — happy path', () => {
  test('all 7 propose, synthesize, execute, review pass — no revision', async () => {
    const emits: string[] = []
    const result = await runCouncil({
      userPrompt: 'add a /health endpoint',
      emitStatus: m => emits.push(m),
      adapters: happyAdapters(),
    })

    expect(result.proposals).toHaveLength(7)
    expect(result.proposals.map(p => p.role).sort()).toEqual(
      [...COUNCIL_ROLES].sort(),
    )
    expect(result.plan.text).toBe('unified plan')
    expect(result.execution.diff).toContain('console.log')
    expect(result.reviews).toHaveLength(7)
    expect(result.revised).toBeUndefined()
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0)

    // Status emits should announce each stage exactly once.
    const statusJoined = emits.join('\n')
    expect(statusJoined).toContain('Council convened')
    expect(statusJoined).toContain('Synthesizing')
    expect(statusJoined).toContain('Executing plan')
    expect(statusJoined).toContain('Reviewing')
    expect(statusJoined).toContain('Council finished')
  })

  test('accumulated cost is the sum of all stages', async () => {
    const result = await runCouncil({
      userPrompt: 'x',
      emitStatus: noopEmit(),
      adapters: happyAdapters(),
    })
    // 7 proposals × 0.01 + 1 plan × 0.02 + 1 execute × 0.5 + 7 reviews × 0.005
    const expected = 7 * 0.01 + 0.02 + 0.5 + 7 * 0.005
    expect(result.totalCostUsd).toBeCloseTo(expected, 5)
  })
})

// ──────────────────────────────────────────────────────────────────────
// Revision loop
// ──────────────────────────────────────────────────────────────────────

describe('runCouncil — revision loop', () => {
  test('≥3 blocks triggers exactly one revision pass', async () => {
    let executorCallCount = 0
    const result = await runCouncil({
      userPrompt: 'x',
      emitStatus: noopEmit(),
      adapters: happyAdapters({
        spawnExecutor: async ({ revisionContext }) => {
          executorCallCount++
          return makeExecutorResult({
            summary: revisionContext ? 'revised' : 'initial',
          })
        },
        spawnReview: async ({ role }) => {
          // Make 3 of 7 block — exactly the threshold.
          const blockSet: CouncilRole[] = ['critic', 'implementer', 'security']
          return makeReview(role, blockSet.includes(role) ? 'block' : 'pass')
        },
      }),
    })

    expect(executorCallCount).toBe(2)
    expect(result.revised).toBeDefined()
    expect(result.revised?.summary).toBe('revised')
    expect(result.reviews.filter(r => r.verdict === 'block')).toHaveLength(3)
  })

  test('2 blocks does NOT trigger revision', async () => {
    let executorCallCount = 0
    const result = await runCouncil({
      userPrompt: 'x',
      emitStatus: noopEmit(),
      adapters: happyAdapters({
        spawnExecutor: async () => {
          executorCallCount++
          return makeExecutorResult()
        },
        spawnReview: async ({ role }) => {
          const blockSet: CouncilRole[] = ['critic', 'implementer']
          return makeReview(role, blockSet.includes(role) ? 'block' : 'pass')
        },
      }),
    })

    expect(executorCallCount).toBe(1)
    expect(result.revised).toBeUndefined()
  })

  test('revision adapter receives previous diff + blocking reviews', async () => {
    const seenRevisionContexts: Array<{ diff: string; blockCount: number } | null> = []
    await runCouncil({
      userPrompt: 'x',
      emitStatus: noopEmit(),
      adapters: happyAdapters({
        spawnExecutor: async ({ revisionContext }) => {
          seenRevisionContexts.push(
            revisionContext
              ? {
                  diff: revisionContext.previousDiff,
                  blockCount: revisionContext.blockingReviews.length,
                }
              : null,
          )
          return makeExecutorResult({ diff: 'initial diff content' })
        },
        spawnReview: async ({ role }) => {
          const blockSet: CouncilRole[] = ['critic', 'implementer', 'security']
          return makeReview(role, blockSet.includes(role) ? 'block' : 'pass')
        },
      }),
    })

    expect(seenRevisionContexts).toHaveLength(2)
    expect(seenRevisionContexts[0]).toBeNull() // initial pass
    expect(seenRevisionContexts[1]?.diff).toBe('initial diff content')
    expect(seenRevisionContexts[1]?.blockCount).toBe(3)
  })
})

// ──────────────────────────────────────────────────────────────────────
// Timeouts
// ──────────────────────────────────────────────────────────────────────

describe('runCouncil — timeouts', () => {
  test('a hung proposal call rejects with CouncilTimeoutError', async () => {
    const hungAdapters = happyAdapters({
      spawnProposal: async ({ role, signal }) => {
        if (role === 'skeptic') {
          // Hang until aborted. Resolve never — relies on timeout to wake up.
          return new Promise<Proposal>((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            })
          })
        }
        return makeProposal(role)
      },
    })

    await expect(
      runCouncil({
        userPrompt: 'x',
        emitStatus: noopEmit(),
        memberTimeoutMs: 50,
        adapters: hungAdapters,
      }),
    ).rejects.toThrow(CouncilTimeoutError)
  })

  test('timeout error names the stage and role', async () => {
    try {
      await runCouncil({
        userPrompt: 'x',
        emitStatus: noopEmit(),
        memberTimeoutMs: 50,
        adapters: happyAdapters({
          spawnProposal: async ({ role, signal }) => {
            if (role === 'tester') {
              return new Promise<Proposal>((_, reject) => {
                signal.addEventListener('abort', () => reject(new Error('aborted')))
              })
            }
            return makeProposal(role)
          },
        }),
      })
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(CouncilTimeoutError)
      const te = err as CouncilTimeoutError
      expect(te.stage).toBe('proposal')
      expect(te.role).toBe('tester')
      expect(te.timeoutMs).toBe(50)
    }
  })
})

// ──────────────────────────────────────────────────────────────────────
// Cost ceiling
// ──────────────────────────────────────────────────────────────────────

describe('runCouncil — cost ceiling', () => {
  test('aborts when accumulated cost exceeds ceiling', async () => {
    // Each proposal costs $1; 7 proposals = $7 — overshoots a $3 ceiling.
    const expensive = happyAdapters({
      spawnProposal: async ({ role }) => makeProposal(role, { costUsd: 1 }),
    })

    await expect(
      runCouncil({
        userPrompt: 'x',
        emitStatus: noopEmit(),
        costCeilingUsd: 3,
        adapters: expensive,
      }),
    ).rejects.toThrow(CouncilCostCeilingError)
  })

  test('ceiling error names the stage and accumulated cost', async () => {
    try {
      await runCouncil({
        userPrompt: 'x',
        emitStatus: noopEmit(),
        costCeilingUsd: 0.5,
        adapters: happyAdapters({
          spawnProposal: async ({ role }) => makeProposal(role, { costUsd: 0.2 }),
        }),
      })
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(CouncilCostCeilingError)
      const ce = err as CouncilCostCeilingError
      expect(ce.ceilingUsd).toBe(0.5)
      expect(ce.accumulatedUsd).toBeGreaterThan(0.5)
      expect(ce.stage).toMatch(/proposal/)
    }
  })
})

// ──────────────────────────────────────────────────────────────────────
// Member failure
// ──────────────────────────────────────────────────────────────────────

describe('runCouncil — member failure', () => {
  test('a non-timeout error from a member surfaces as CouncilMemberFailureError', async () => {
    const failing = happyAdapters({
      spawnProposal: async ({ role }) => {
        if (role === 'security') throw new Error('upstream 429')
        return makeProposal(role)
      },
    })

    try {
      await runCouncil({
        userPrompt: 'x',
        emitStatus: noopEmit(),
        adapters: failing,
      })
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(CouncilMemberFailureError)
      const me = err as CouncilMemberFailureError
      expect(me.role).toBe('security')
      expect(me.stage).toBe('proposal')
      expect((me.underlying as Error).message).toBe('upstream 429')
    }
  })

  test('a failure during review also surfaces as CouncilMemberFailureError', async () => {
    const failing = happyAdapters({
      spawnReview: async ({ role }) => {
        if (role === 'tester') throw new Error('vendor down')
        return makeReview(role, 'pass')
      },
    })

    await expect(
      runCouncil({
        userPrompt: 'x',
        emitStatus: noopEmit(),
        adapters: failing,
      }),
    ).rejects.toMatchObject({
      name: 'CouncilMemberFailureError',
      role: 'tester',
      stage: 'review',
    })
  })
})
