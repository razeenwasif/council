import { describe, expect, test } from 'bun:test'
import {
  COUNCIL_ROLES,
  countBlockingReviews,
  CouncilCostCeilingError,
  CouncilMemberFailureError,
  CouncilQuorumLostError,
  CouncilTimeoutError,
  extractHeadline,
  formatMemberFailure,
  formatProposalArrival,
  formatProposalsForSynthesizer,
  formatReviewArrival,
  formatStageDone,
  runCouncil,
  selectBlockingReviews,
  settlementToFailure,
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

describe('extractHeadline', () => {
  test('extracts the first non-empty line after `## Headline`', () => {
    const text = `## Headline\nPure lexical sanitizer using path.relative for containment.\n\n## Reasoning\n...`
    expect(extractHeadline(text)).toBe(
      'Pure lexical sanitizer using path.relative for containment.',
    )
  })

  test('handles inline form `## Headline: foo`', () => {
    const text = `## Headline: Name the export checkPathWithinBase\n## Reasoning\n...`
    expect(extractHeadline(text)).toBe(
      'Name the export checkPathWithinBase',
    )
  })

  test('strips a leading blockquote marker if the model added one', () => {
    const text = `## Headline\n> The chosen approach is X.\n`
    expect(extractHeadline(text)).toBe('The chosen approach is X.')
  })

  test('falls back to first prose line when no headline section is present', () => {
    const text = `## Reasoning\nThe right approach is to use a Map. We bound it at 1000 entries.\n## Proposal\nmore stuff`
    // Skips the heading, takes the first prose line, clips at sentence end.
    expect(extractHeadline(text)).toBe('The right approach is to use a Map.')
  })

  test('fallback returns the whole line when there is no sentence-ending punctuation', () => {
    const text = `## Reasoning\nstuff here without a period\n## Proposal\nmore`
    expect(extractHeadline(text)).toBe('stuff here without a period')
  })

  test('fallback skips bullet markers and grabs the first list-item sentence', () => {
    const text = `## Proposal\n- Use a Map keyed by the first arg.\n- Add tests.\n`
    expect(extractHeadline(text)).toBe('Use a Map keyed by the first arg.')
  })

  test('fallback skips code fences', () => {
    const text = `\`\`\`ts\nconst x = 1\n\`\`\`\nThe helper should be pure.`
    expect(extractHeadline(text)).toBe('The helper should be pure.')
  })

  test('falls back when the headline line is empty (skips to next prose)', () => {
    const text = `## Headline\n\n## Reasoning\nWe need a debounce.`
    expect(extractHeadline(text)).toBe('We need a debounce.')
  })

  test('returns null only when the body is genuinely empty', () => {
    expect(extractHeadline('')).toBeNull()
    expect(extractHeadline('\n\n\n')).toBeNull()
    expect(extractHeadline('## Just\n## Headings')).toBeNull()
  })

  test('case-insensitive on the heading word', () => {
    const text = `### HEADLINE\nWorks regardless of case.\n`
    expect(extractHeadline(text)).toBe('Works regardless of case.')
  })

  test('clips long unbroken text to 140 chars with ellipsis', () => {
    const long = 'x'.repeat(500)
    const text = `## Proposal\n${long}`
    const out = extractHeadline(text)
    expect(out).not.toBeNull()
    expect(out!.length).toBeLessThan(150)
    expect(out!.endsWith('…')).toBe(true)
  })
})

describe('formatProposalArrival', () => {
  test('renders blockquote with role + resolved model id + headline', () => {
    const p = makeProposal('architect', {
      modelId: 'claude-opus-4-7',
      text: '## Headline\nGo with the simplest shape.\n\n## Reasoning\n...',
    })
    expect(formatProposalArrival(p)).toBe(
      '> **Architect** (claude-opus-4-7): Go with the simplest shape.',
    )
  })

  test('omits the (model) parenthetical when modelId is unresolved (equals role)', () => {
    const p = makeProposal('architect', {
      modelId: 'architect',
      text: '## Headline\nGo with the simplest shape.\n\n## Reasoning\n...',
    })
    expect(formatProposalArrival(p)).toBe(
      '> **Architect**: Go with the simplest shape.',
    )
  })

  test('falls back to first prose sentence when the proposal omits ## Headline', () => {
    const p = makeProposal('skeptic', {
      modelId: 'gemini-3.5-flash',
      text: '## Reasoning\nThe naive approach has a race condition. We must guard the timer.',
    })
    const out = formatProposalArrival(p)
    expect(out).toBe(
      '> **Skeptic** (gemini-3.5-flash): The naive approach has a race condition.',
    )
  })

  test('falls back to the placeholder string only when the body is genuinely empty', () => {
    const p = makeProposal('skeptic', {
      modelId: 'gemini-3.5-flash',
      text: '',
    })
    const out = formatProposalArrival(p)
    expect(out).toContain('**Skeptic**')
    expect(out).toContain('no headline section emitted')
  })
})

describe('formatStageDone', () => {
  test('renders synthesizer done with sub-minute duration and a snippet', () => {
    const out = formatStageDone(
      'synthesizer',
      12_500,
      '## Plan\nGo with debounce in src/utils/council/debounce.ts.\n\n## Risks\n...',
    )
    // Skips the `## Plan` heading, picks the first informative line.
    expect(out).toBe(
      '> ✓ **Synthesizer** done (12.5s) — Go with debounce in src/utils/council/debounce.ts.',
    )
  })

  test('renders executor done with multi-minute duration', () => {
    const out = formatStageDone(
      'executor',
      183_000,
      'Files created: src/utils/council/debounce.ts (88 lines).',
    )
    expect(out).toBe(
      '> ✓ **Executor** done (3m 3s) — Files created: src/utils/council/debounce.ts (88 lines).',
    )
  })

  test('truncates long snippets with an ellipsis', () => {
    const longSummary = 'A long summary that goes on and on '.repeat(20)
    const out = formatStageDone('executor', 1000, longSummary)
    expect(out).toContain('…')
    // The full emit should fit within ~200 chars (label + duration + 140-char snippet).
    expect(out.length).toBeLessThan(200)
  })

  test('omits the snippet when summary is undefined', () => {
    expect(formatStageDone('synthesizer', 1500)).toBe(
      '> ✓ **Synthesizer** done (1.5s).',
    )
  })

  test('omits the snippet when summary contains only headings', () => {
    const out = formatStageDone('executor', 500, '## Section A\n## Section B')
    expect(out).toBe('> ✓ **Executor** done (500ms).')
  })

  test('formats revision pass with the right label', () => {
    const out = formatStageDone('revise', 60_000, 'Addressed the blocking concerns.')
    expect(out).toContain('Revision')
    expect(out).toContain('1m 0s')
    expect(out).toContain('Addressed the blocking concerns.')
  })
})

describe('runCouncil — stage-done emits', () => {
  test('emits ✓ Synthesizer done and ✓ Executor done between stages', async () => {
    const emits: string[] = []
    await runCouncil({
      userPrompt: 'x',
      emitStatus: m => emits.push(m),
      adapters: happyAdapters(),
    })

    const synthDone = emits.find(m => m.includes('Synthesizer') && m.includes('done'))
    const execDone = emits.find(m => m.includes('Executor') && m.includes('done'))
    expect(synthDone).toBeDefined()
    expect(execDone).toBeDefined()

    // Sequence: Synthesizing → ✓ Synth done → Executing → ✓ Exec done → Reviewing
    const synthDoneIdx = emits.indexOf(synthDone!)
    const execDoneIdx = emits.indexOf(execDone!)
    const reviewingIdx = emits.findIndex(m => m.includes('Reviewing'))
    expect(synthDoneIdx).toBeLessThan(execDoneIdx)
    expect(execDoneIdx).toBeLessThan(reviewingIdx)
  })
})

describe('formatMemberFailure', () => {
  test('formats CouncilTimeoutError with the timeout duration', () => {
    const out = formatMemberFailure(
      'proposal',
      'skeptic',
      new CouncilTimeoutError('proposal', 60_000, 'skeptic'),
    )
    expect(out).toContain('Skeptic')
    expect(out).toContain('timed out')
    expect(out).toContain('60000')
    expect(out).toContain('✗')
  })

  test('truncates a long error message with an ellipsis', () => {
    const longMsg = 'x'.repeat(500)
    const out = formatMemberFailure('review', 'critic', new Error(longMsg))
    expect(out.length).toBeLessThan(500)
    expect(out).toContain('…')
  })

  test('handles non-Error throws gracefully', () => {
    const out = formatMemberFailure('proposal', 'tester', 'bare string error')
    expect(out).toContain('Tester')
    expect(out).toContain('bare string error')
  })
})

describe('settlementToFailure', () => {
  test('CouncilTimeoutError → isTimeout=true with duration in reason', () => {
    const f = settlementToFailure(
      'skeptic',
      'proposal',
      new CouncilTimeoutError('proposal', 60_000, 'skeptic'),
    )
    expect(f).toMatchObject({
      role: 'skeptic',
      stage: 'proposal',
      isTimeout: true,
    })
    expect(f.reason).toContain('60000')
  })

  test('CouncilMemberFailureError → unwraps underlying message', () => {
    const f = settlementToFailure(
      'security',
      'proposal',
      new CouncilMemberFailureError('security', 'proposal', new Error('upstream 429')),
    )
    expect(f.isTimeout).toBe(false)
    expect(f.reason).toBe('upstream 429')
  })

  test('plain Error → uses message verbatim', () => {
    const f = settlementToFailure('critic', 'review', new Error('boom'))
    expect(f.isTimeout).toBe(false)
    expect(f.reason).toBe('boom')
  })

  test('non-Error throws → stringified', () => {
    const f = settlementToFailure('tester', 'proposal', 'just a string')
    expect(f.reason).toBe('just a string')
  })
})

describe('formatReviewArrival', () => {
  test('includes role + model id + verdict + first finding', () => {
    const r: Review = {
      role: 'security',
      verdict: 'block',
      findings: ['Path traversal — relative input is not normalised.'],
      modelId: 'mistral-large-latest',
      durationMs: 80,
      costUsd: 0.01,
    }
    expect(formatReviewArrival(r)).toBe(
      '> **Security** (mistral-large-latest) review: **block** — Path traversal — relative input is not normalised.',
    )
  })

  test('omits the finding tail when none is present', () => {
    const r: Review = {
      role: 'architect',
      verdict: 'pass',
      findings: [],
      modelId: 'claude-opus-4-7',
      durationMs: 50,
      costUsd: 0.01,
    }
    expect(formatReviewArrival(r)).toBe(
      '> **Architect** (claude-opus-4-7) review: **pass**',
    )
  })

  test('omits the (model) parenthetical when modelId is unresolved', () => {
    const r: Review = {
      role: 'critic',
      verdict: 'pass',
      findings: [],
      modelId: 'critic',
      durationMs: 50,
      costUsd: 0.01,
    }
    expect(formatReviewArrival(r)).toBe('> **Critic** review: **pass**')
  })
})

describe('runCouncil — panel hooks', () => {
  test('prepareBatch is called once per batch with the right roles and kind', async () => {
    const calls: Array<{ kind: string; roles: readonly CouncilRole[] }> = []
    await runCouncil({
      userPrompt: 'x',
      emitStatus: noopEmit(),
      adapters: happyAdapters({
        prepareBatch: async ({ kind, roles }) => {
          calls.push({ kind, roles })
          return new Map(roles.map((r, i) => [r, `id-${kind}-${i}`]))
        },
      }),
    })

    expect(calls).toHaveLength(2)
    expect(calls[0]!.kind).toBe('proposal')
    expect(calls[0]!.roles).toEqual(COUNCIL_ROLES)
    expect(calls[1]!.kind).toBe('review')
    expect(calls[1]!.roles).toEqual(COUNCIL_ROLES)
  })

  test('prepareSingle fires for synthesizer + executor stages', async () => {
    const calls: string[] = []
    await runCouncil({
      userPrompt: 'x',
      emitStatus: noopEmit(),
      adapters: happyAdapters({
        prepareSingle: async ({ kind }) => {
          calls.push(kind)
          return `id-${kind}`
        },
      }),
    })

    expect(calls).toEqual(['synthesizer', 'executor'])
  })

  test('completeMember fires once per spawn with status and toolUseId', async () => {
    const calls: Array<{ kind: string; role?: CouncilRole; toolUseId: string; status: string }> = []
    await runCouncil({
      userPrompt: 'x',
      emitStatus: noopEmit(),
      adapters: happyAdapters({
        prepareBatch: async ({ roles, kind }) =>
          new Map(roles.map(r => [r, `${kind}-${r}`])),
        prepareSingle: async ({ kind }) => `single-${kind}`,
        completeMember: async ({ kind, role, toolUseId, status }) => {
          calls.push({ kind, role, toolUseId, status })
        },
      }),
    })

    // 7 proposals + 1 synth + 1 executor + 7 reviews = 16
    expect(calls).toHaveLength(16)
    expect(calls.every(c => c.status === 'success')).toBe(true)
    expect(calls.filter(c => c.kind === 'proposal')).toHaveLength(7)
    expect(calls.filter(c => c.kind === 'review')).toHaveLength(7)
    expect(calls.filter(c => c.kind === 'synthesizer')).toHaveLength(1)
    expect(calls.filter(c => c.kind === 'executor')).toHaveLength(1)
  })

  test('completeMember reports error status when a spawn rejects', async () => {
    const calls: Array<{ role?: CouncilRole; status: string }> = []
    try {
      await runCouncil({
        userPrompt: 'x',
        emitStatus: noopEmit(),
        adapters: happyAdapters({
          spawnProposal: async ({ role }) => {
            if (role === 'security') throw new Error('boom')
            return makeProposal(role)
          },
          prepareBatch: async ({ roles, kind }) =>
            new Map(roles.map(r => [r, `${kind}-${r}`])),
          completeMember: async ({ role, status }) => {
            calls.push({ role, status })
          },
        }),
      })
    } catch {
      // expected — security fails out
    }

    const securityCalls = calls.filter(c => c.role === 'security')
    expect(securityCalls).toHaveLength(1)
    expect(securityCalls[0]!.status).toBe('error')
  })

  test('toolUseId from prepareBatch is forwarded to the spawn callback', async () => {
    const seen: Array<{ role: CouncilRole; toolUseId: string | undefined }> = []
    await runCouncil({
      userPrompt: 'x',
      emitStatus: noopEmit(),
      adapters: happyAdapters({
        spawnProposal: async ({ role, toolUseId }) => {
          seen.push({ role, toolUseId })
          return makeProposal(role)
        },
        prepareBatch: async ({ roles }) =>
          new Map(roles.map(r => [r, `tuid-${r}`])),
      }),
    })

    for (const role of COUNCIL_ROLES) {
      const entry = seen.find(s => s.role === role)
      expect(entry?.toolUseId).toBe(`tuid-${role}`)
    }
  })
})

describe('runCouncil — live arrival pings', () => {
  test('emits one preview per proposal as each lands', async () => {
    const emits: string[] = []
    await runCouncil({
      userPrompt: 'x',
      emitStatus: m => emits.push(m),
      adapters: happyAdapters({
        spawnProposal: async ({ role }) =>
          makeProposal(role, {
            text: `## Headline\n${role} says hi\n\n## Reasoning\n...`,
          }),
      }),
    })

    for (const role of COUNCIL_ROLES) {
      const cap = role[0]!.toUpperCase() + role.slice(1)
      // The factory sets modelId to `model-for-${role}` (not equal to the role
      // slug), so the formatter includes it in parens.
      expect(emits).toContain(`> **${cap}** (model-for-${role}): ${role} says hi`)
    }
  })

  test('emits one preview per review with verdict', async () => {
    const emits: string[] = []
    await runCouncil({
      userPrompt: 'x',
      emitStatus: m => emits.push(m),
      adapters: happyAdapters({
        spawnReview: async ({ role }) =>
          makeReview(role, 'pass', { findings: [`${role} OK`] }),
      }),
    })

    for (const role of COUNCIL_ROLES) {
      const cap = role[0]!.toUpperCase() + role.slice(1)
      expect(emits).toContain(
        `> **${cap}** (model-for-${role}) review: **pass** — ${role} OK`,
      )
    }
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
    expect(result.failures).toEqual([])
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

describe('runCouncil — timeouts (fault-tolerant)', () => {
  test('a single hung proposal does NOT abort — surfaces as a failure in the result', async () => {
    const hungAdapters = happyAdapters({
      spawnProposal: async ({ role, signal }) => {
        if (role === 'skeptic') {
          return new Promise<Proposal>((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            })
          })
        }
        return makeProposal(role)
      },
    })

    const result = await runCouncil({
      userPrompt: 'x',
      emitStatus: noopEmit(),
      memberTimeoutMs: 50,
      adapters: hungAdapters,
    })

    expect(result.proposals).toHaveLength(6)
    expect(result.proposals.map(p => p.role)).not.toContain('skeptic')
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]!.role).toBe('skeptic')
    expect(result.failures[0]!.stage).toBe('proposal')
    expect(result.failures[0]!.isTimeout).toBe(true)
  })

  test('emits a ✗ status line for each timed-out voice', async () => {
    const emits: string[] = []
    await runCouncil({
      userPrompt: 'x',
      emitStatus: m => emits.push(m),
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

    const failureLines = emits.filter(m => m.includes('✗'))
    expect(failureLines).toHaveLength(1)
    expect(failureLines[0]).toContain('Tester')
    expect(failureLines[0]).toContain('timed out')
  })

  test('too many timeouts triggers CouncilQuorumLostError', async () => {
    const slowRoles: CouncilRole[] = ['skeptic', 'tester', 'security']
    const hung = happyAdapters({
      spawnProposal: async ({ role, signal }) => {
        if (slowRoles.includes(role)) {
          return new Promise<Proposal>((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')))
          })
        }
        return makeProposal(role)
      },
    })

    try {
      await runCouncil({
        userPrompt: 'x',
        emitStatus: noopEmit(),
        memberTimeoutMs: 50,
        adapters: hung,
      })
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(CouncilQuorumLostError)
      const qe = err as CouncilQuorumLostError
      expect(qe.succeededCount).toBe(4)
      expect(qe.required).toBe(5)
      expect(qe.stage).toBe('proposal')
      expect(qe.failures).toHaveLength(3)
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

  test('aborts via getCurrentCost when per-spawn costUsd is 0 (deterministic-path bug fix)', async () => {
    let pretendGlobalCost = 0
    const expensive = happyAdapters({
      spawnProposal: async ({ role }) => {
        pretendGlobalCost += 0.4
        return makeProposal(role, { costUsd: 0 })
      },
    })

    await expect(
      runCouncil({
        userPrompt: 'x',
        emitStatus: noopEmit(),
        costCeilingUsd: 1.0,
        getCurrentCost: () => pretendGlobalCost,
        adapters: expensive,
      }),
    ).rejects.toThrow(CouncilCostCeilingError)
  })

  test('does NOT abort when getCurrentCost stays below ceiling', async () => {
    let pretendGlobalCost = 0
    const cheap = happyAdapters({
      spawnProposal: async ({ role }) => {
        pretendGlobalCost += 0.05
        return makeProposal(role, { costUsd: 0 })
      },
    })

    const result = await runCouncil({
      userPrompt: 'x',
      emitStatus: noopEmit(),
      costCeilingUsd: 1.0,
      getCurrentCost: () => pretendGlobalCost,
      adapters: cheap,
    })
    expect(result.proposals).toHaveLength(7)
  })

  test('defaults to () => 0 when getCurrentCost not provided (legacy test behaviour preserved)', async () => {
    const result = await runCouncil({
      userPrompt: 'x',
      emitStatus: noopEmit(),
      costCeilingUsd: 0.001, // microscopic — would fire if anything was attributed
      adapters: happyAdapters({
        spawnProposal: async ({ role }) => makeProposal(role, { costUsd: 0 }),
        spawnSynthesizer: async () => ({
          text: 'plan',
          modelId: 'm',
          durationMs: 1,
          costUsd: 0,
        }),
        spawnExecutor: async () => ({
          diff: 'diff',
          summary: 'summary',
          modelId: 'm',
          durationMs: 1,
          costUsd: 0,
        }),
        spawnReview: async ({ role }) => makeReview(role, 'pass', { costUsd: 0 }),
      }),
    })
    expect(result.proposals).toHaveLength(7)
  })
})

// ──────────────────────────────────────────────────────────────────────
// Member failure
// ──────────────────────────────────────────────────────────────────────

describe('runCouncil — member failure (fault-tolerant)', () => {
  test('a single non-timeout proposal failure does NOT abort — appears in failures list', async () => {
    const failing = happyAdapters({
      spawnProposal: async ({ role }) => {
        if (role === 'security') throw new Error('upstream 429')
        return makeProposal(role)
      },
    })

    const result = await runCouncil({
      userPrompt: 'x',
      emitStatus: noopEmit(),
      adapters: failing,
    })

    expect(result.proposals).toHaveLength(6)
    expect(result.proposals.map(p => p.role)).not.toContain('security')
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]!.role).toBe('security')
    expect(result.failures[0]!.stage).toBe('proposal')
    expect(result.failures[0]!.isTimeout).toBe(false)
    expect(result.failures[0]!.reason).toContain('upstream 429')
  })

  test('a single review failure also lands as a soft failure', async () => {
    const failing = happyAdapters({
      spawnReview: async ({ role }) => {
        if (role === 'tester') throw new Error('vendor down')
        return makeReview(role, 'pass')
      },
    })

    const result = await runCouncil({
      userPrompt: 'x',
      emitStatus: noopEmit(),
      adapters: failing,
    })

    expect(result.reviews).toHaveLength(6)
    expect(result.reviews.map(r => r.role)).not.toContain('tester')
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]!.role).toBe('tester')
    expect(result.failures[0]!.stage).toBe('review')
  })

  test('review batch only invokes spawnReview for roles whose proposal succeeded', async () => {
    const reviewedRoles: CouncilRole[] = []
    await runCouncil({
      userPrompt: 'x',
      emitStatus: noopEmit(),
      adapters: happyAdapters({
        spawnProposal: async ({ role }) => {
          if (role === 'critic') throw new Error('flake')
          return makeProposal(role)
        },
        spawnReview: async ({ role }) => {
          reviewedRoles.push(role)
          return makeReview(role, 'pass')
        },
      }),
    })

    expect(reviewedRoles).toHaveLength(6)
    expect(reviewedRoles).not.toContain('critic')
  })

  test('too many proposal failures trigger CouncilQuorumLostError', async () => {
    const failedRoles: CouncilRole[] = ['critic', 'implementer', 'security']
    const failing = happyAdapters({
      spawnProposal: async ({ role }) => {
        if (failedRoles.includes(role)) throw new Error(`flake-${role}`)
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
      expect(err).toBeInstanceOf(CouncilQuorumLostError)
      const qe = err as CouncilQuorumLostError
      expect(qe.succeededCount).toBe(4)
      expect(qe.required).toBe(5)
      expect(qe.stage).toBe('proposal')
      expect(qe.failures.map(f => f.role).sort()).toEqual(failedRoles.sort())
    }
  })
})
