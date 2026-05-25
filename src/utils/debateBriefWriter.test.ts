import { describe, expect, test } from 'bun:test'
import {
  defaultBriefPath,
  formatBrief,
} from './debateBriefWriter.js'
import type {
  DebateResult,
  Position,
  ResearchRole,
} from '../coordinator/council/debate.js'

function makePosition(
  role: ResearchRole,
  roundNumber: 1 | 2,
  overrides: Partial<Position> = {},
): Position {
  return {
    id: `r${roundNumber}-${role}`,
    role,
    modelId: `model-for-${role}`,
    roundNumber,
    text: `## Headline\n${role} r${roundNumber} headline\n\n## Position\n${role} body`,
    buildsOn: [],
    contradicts: [],
    confidence: 3,
    durationMs: 100,
    costUsd: 0.01,
    ...overrides,
  }
}

function makeResult(overrides: Partial<DebateResult> = {}): DebateResult {
  return {
    question: 'test question',
    rounds: [
      {
        roundNumber: 1,
        positions: [
          makePosition('hypothesizer', 1),
          makePosition('empiricist', 1),
          makePosition('devils_advocate', 1),
          makePosition('methodologist', 1),
        ],
      },
      {
        roundNumber: 2,
        positions: [
          makePosition('hypothesizer', 2, {
            buildsOn: ['r1-empiricist'],
            contradicts: ['r1-devils_advocate'],
          }),
          makePosition('methodologist', 2, {
            buildsOn: ['r1-hypothesizer'],
          }),
        ],
      },
    ],
    brief: '# Brief: test\n\n## Strongest convergent claim\nBody.',
    failures: [],
    totalCostUsd: 0.12,
    totalDurationMs: 90_000,
    ...overrides,
  }
}

describe('formatBrief', () => {
  test('includes metadata header with question + cost + duration', () => {
    const out = formatBrief(makeResult())
    expect(out).toContain('question: test question')
    expect(out).toContain('cost_usd: 0.1200')
    expect(out).toContain('duration_sec: 90.0')
    expect(out).toContain('r1_positions: 4')
    expect(out).toContain('r2_positions: 2')
  })

  test('lists each voice + its model in the metadata', () => {
    const out = formatBrief(makeResult())
    expect(out).toContain('role: hypothesizer')
    expect(out).toContain('model: model-for-hypothesizer')
    expect(out).toContain('role: empiricist')
    expect(out).toContain('model: model-for-empiricist')
  })

  test('builds lineage tree from R2 positions builds_on / contradicts', () => {
    const out = formatBrief(makeResult())
    expect(out).toContain('## Position lineage')
    expect(out).toContain('**r2-hypothesizer**')
    expect(out).toContain('builds on: `r1-empiricist`')
    expect(out).toContain('contradicts: `r1-devils_advocate`')
    expect(out).toContain('**r2-methodologist**')
  })

  test('marks positions with no explicit lineage', () => {
    const result = makeResult({
      rounds: [
        { roundNumber: 1, positions: [makePosition('hypothesizer', 1)] },
        {
          roundNumber: 2,
          positions: [makePosition('hypothesizer', 2, { buildsOn: [], contradicts: [] })],
        },
      ],
    })
    const out = formatBrief(result)
    expect(out).toContain('_(no explicit lineage cited)_')
  })

  test('includes the synthesist brief verbatim', () => {
    const out = formatBrief(makeResult({ brief: '# Custom brief text\n\n_marker_' }))
    expect(out).toContain('# Custom brief text')
    expect(out).toContain('_marker_')
  })

  test('appendix includes all positions with id + role + text', () => {
    const out = formatBrief(makeResult())
    expect(out).toContain('## Appendix: full positions')
    expect(out).toContain('### Round 1')
    expect(out).toContain('#### `r1-hypothesizer` — hypothesizer (model-for-hypothesizer)')
    expect(out).toContain('### Round 2')
    expect(out).toContain('hypothesizer r1 headline')
    expect(out).toContain('hypothesizer r2 headline')
  })

  test('lists failures in metadata when present', () => {
    const result = makeResult({
      failures: [
        {
          role: 'devils_advocate',
          roundNumber: 1,
          reason: 'upstream 429',
          isTimeout: false,
        },
      ],
    })
    const out = formatBrief(result)
    expect(out).toContain('failures: 1')
    expect(out).toContain('failure_detail:')
    expect(out).toContain('role: devils_advocate')
    expect(out).toContain('round: 1')
    expect(out).toContain('reason: upstream 429')
  })

  test('escapes YAML-special characters in question / failure reasons', () => {
    const result = makeResult({
      question: 'Does X: Y work? "Yes" or no',
    })
    const out = formatBrief(result)
    // The question line should be quoted because it contains : and quotes.
    expect(out).toMatch(/question: "Does X.*Yes.*"/)
  })

  test('handles a result with no R2 positions gracefully', () => {
    const result = makeResult({
      rounds: [
        { roundNumber: 1, positions: [makePosition('hypothesizer', 1)] },
        { roundNumber: 2, positions: [] },
      ],
    })
    const out = formatBrief(result)
    expect(out).toContain('_No Round 2 positions._')
  })
})

describe('defaultBriefPath', () => {
  test('produces a YYYY-MM-DD-HH-MM-slug.md path', () => {
    const out = defaultBriefPath(
      '/home/u/Research/debates',
      'How significant is quantization-induced SNR degradation',
      new Date('2026-05-24T15:30:00Z'),
    )
    // We don't pin HH-MM because the time-of-day comes from local TZ in
    // toTimeString() — just check the shape.
    expect(out).toMatch(
      /\/home\/u\/Research\/debates\/2026-05-24-\d{2}-\d{2}-how-significant-is-quantization-i/,
    )
    expect(out.endsWith('.md')).toBe(true)
  })

  test('strips special characters from the slug', () => {
    const out = defaultBriefPath(
      '/tmp',
      'Q&A: How "many" things?!',
      new Date('2026-01-01T00:00:00Z'),
    )
    expect(out).toMatch(/qa-how-many-things/)
  })

  test('falls back to "debate" when question slugifies to empty', () => {
    const out = defaultBriefPath('/tmp', '!!!', new Date('2026-01-01'))
    expect(out).toMatch(/-debate\.md$/)
  })
})
