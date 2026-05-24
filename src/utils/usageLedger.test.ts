import { describe, expect, test } from 'bun:test'
import {
  aggregateByDay,
  aggregateByModel,
  dedupeBySessionId,
  type UsageLedgerEntry,
} from './usageLedger.js'

function makeEntry(overrides: Partial<UsageLedgerEntry> = {}): UsageLedgerEntry {
  return {
    ts: '2026-05-24T18:00:00Z',
    sessionId: 'session-x',
    cwd: '/home/user/Council',
    modelUsage: {},
    totalCostUSD: 0,
    ...overrides,
  }
}

describe('dedupeBySessionId', () => {
  test('keeps only the latest entry per sessionId by ts', () => {
    const out = dedupeBySessionId([
      makeEntry({ sessionId: 'A', ts: '2026-05-22T10:00:00Z', totalCostUSD: 0.10 }),
      makeEntry({ sessionId: 'B', ts: '2026-05-23T10:00:00Z', totalCostUSD: 0.05 }),
      makeEntry({ sessionId: 'A', ts: '2026-05-24T10:00:00Z', totalCostUSD: 0.15 }),
    ])
    expect(out).toHaveLength(2)
    const sessionA = out.find(e => e.sessionId === 'A')
    const sessionB = out.find(e => e.sessionId === 'B')
    expect(sessionA?.totalCostUSD).toBe(0.15)
    expect(sessionA?.ts).toBe('2026-05-24T10:00:00Z')
    expect(sessionB?.totalCostUSD).toBe(0.05)
  })

  test('preserves order-independence — earlier appearances do not win', () => {
    const out = dedupeBySessionId([
      makeEntry({ sessionId: 'A', ts: '2026-05-24T10:00:00Z', totalCostUSD: 0.15 }),
      makeEntry({ sessionId: 'A', ts: '2026-05-22T10:00:00Z', totalCostUSD: 0.10 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.totalCostUSD).toBe(0.15)
  })

  test('empty input returns empty array', () => {
    expect(dedupeBySessionId([])).toEqual([])
  })
})

describe('aggregateByDay (with dedupe)', () => {
  test('does NOT double-count when a session writes multiple ledger entries', () => {
    // Simulates a resumed session: same sessionId writes growing totals.
    // Naive sum would give 0.10 + 0.15 = 0.25; correct answer is 0.15.
    const out = aggregateByDay([
      makeEntry({ sessionId: 'A', ts: '2026-05-24T09:00:00Z', totalCostUSD: 0.10 }),
      makeEntry({ sessionId: 'A', ts: '2026-05-24T15:00:00Z', totalCostUSD: 0.15 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.totalCostUSD).toBe(0.15)
    expect(out[0]!.sessionCount).toBe(1)
  })
})

describe('aggregateByModel (with dedupe)', () => {
  test('does NOT double-count model usage when a session writes multiple entries', () => {
    const out = aggregateByModel([
      makeEntry({
        sessionId: 'A',
        ts: '2026-05-24T09:00:00Z',
        modelUsage: {
          'claude-opus-4-7': { inputTokens: 1000, outputTokens: 100, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.10 },
        },
      }),
      makeEntry({
        sessionId: 'A',
        ts: '2026-05-24T15:00:00Z',
        modelUsage: {
          'claude-opus-4-7': { inputTokens: 1500, outputTokens: 150, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.15 },
        },
      }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.costUSD).toBeCloseTo(0.15, 5)
    expect(out[0]!.inputTokens).toBe(1500)
    expect(out[0]!.outputTokens).toBe(150)
  })
})

describe('aggregateByDay', () => {
  test('groups entries by UTC date, newest first', () => {
    const out = aggregateByDay([
      makeEntry({ sessionId: 's1', ts: '2026-05-22T10:00:00Z', totalCostUSD: 0.1 }),
      makeEntry({ sessionId: 's2', ts: '2026-05-24T18:00:00Z', totalCostUSD: 0.4 }),
      makeEntry({ sessionId: 's3', ts: '2026-05-23T12:00:00Z', totalCostUSD: 0.2 }),
    ])
    expect(out).toHaveLength(3)
    expect(out[0]!.date).toBe('2026-05-24')
    expect(out[1]!.date).toBe('2026-05-23')
    expect(out[2]!.date).toBe('2026-05-22')
  })

  test('sums totalCostUSD across DISTINCT sessions per day', () => {
    // Distinct sessionIds → dedupe keeps all → summed.
    const out = aggregateByDay([
      makeEntry({ sessionId: 's1', ts: '2026-05-24T09:00:00Z', totalCostUSD: 0.1 }),
      makeEntry({ sessionId: 's2', ts: '2026-05-24T15:00:00Z', totalCostUSD: 0.2 }),
      makeEntry({ sessionId: 's3', ts: '2026-05-24T22:00:00Z', totalCostUSD: 0.3 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.totalCostUSD).toBeCloseTo(0.6, 5)
    expect(out[0]!.sessionCount).toBe(3)
  })

  test('merges per-model entries from DISTINCT sessions on the same day', () => {
    const out = aggregateByDay([
      makeEntry({
        sessionId: 's1',
        ts: '2026-05-24T09:00:00Z',
        modelUsage: {
          'claude-opus-4-7': {
            inputTokens: 1000,
            outputTokens: 100,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            costUSD: 0.05,
          },
        },
      }),
      makeEntry({
        sessionId: 's2',
        ts: '2026-05-24T15:00:00Z',
        modelUsage: {
          'claude-opus-4-7': {
            inputTokens: 2000,
            outputTokens: 200,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            costUSD: 0.10,
          },
          'gemini-3.5-flash': {
            inputTokens: 500,
            outputTokens: 50,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            costUSD: 0.001,
          },
        },
      }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.modelUsage['claude-opus-4-7']?.inputTokens).toBe(3000)
    expect(out[0]!.modelUsage['claude-opus-4-7']?.outputTokens).toBe(300)
    expect(out[0]!.modelUsage['claude-opus-4-7']?.costUSD).toBeCloseTo(0.15, 5)
    expect(out[0]!.modelUsage['gemini-3.5-flash']?.inputTokens).toBe(500)
  })

  test('empty input returns empty array', () => {
    expect(aggregateByDay([])).toEqual([])
  })
})

describe('aggregateByModel', () => {
  test('sorts by cost descending', () => {
    const out = aggregateByModel([
      makeEntry({
        modelUsage: {
          'cheap': { inputTokens: 100, outputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.001 },
          'expensive': { inputTokens: 100, outputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.50 },
          'medium': { inputTokens: 100, outputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.05 },
        },
      }),
    ])
    expect(out.map(m => m.model)).toEqual(['expensive', 'medium', 'cheap'])
  })

  test('sums across DISTINCT sessions for the same model', () => {
    const out = aggregateByModel([
      makeEntry({
        sessionId: 's1',
        modelUsage: {
          'claude-opus-4-7': { inputTokens: 1000, outputTokens: 100, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.05 },
        },
      }),
      makeEntry({
        sessionId: 's2',
        modelUsage: {
          'claude-opus-4-7': { inputTokens: 2000, outputTokens: 200, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.10 },
        },
      }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.inputTokens).toBe(3000)
    expect(out[0]!.outputTokens).toBe(300)
    expect(out[0]!.costUSD).toBeCloseTo(0.15, 5)
    expect(out[0]!.sessionCount).toBe(2)
  })

  test('preserves cache token counts separately', () => {
    const out = aggregateByModel([
      makeEntry({
        modelUsage: {
          'claude-opus-4-7': {
            inputTokens: 100,
            outputTokens: 10,
            cacheReadInputTokens: 5000,
            cacheCreationInputTokens: 200,
            costUSD: 0.01,
          },
        },
      }),
    ])
    expect(out[0]!.cacheReadInputTokens).toBe(5000)
    expect(out[0]!.cacheCreationInputTokens).toBe(200)
  })

  test('empty input returns empty array', () => {
    expect(aggregateByModel([])).toEqual([])
  })
})
