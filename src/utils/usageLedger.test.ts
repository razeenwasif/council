import { describe, expect, test } from 'bun:test'
import {
  aggregateByDay,
  aggregateByModel,
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

describe('aggregateByDay', () => {
  test('groups entries by UTC date, newest first', () => {
    const out = aggregateByDay([
      makeEntry({ ts: '2026-05-22T10:00:00Z', totalCostUSD: 0.1 }),
      makeEntry({ ts: '2026-05-24T18:00:00Z', totalCostUSD: 0.4 }),
      makeEntry({ ts: '2026-05-23T12:00:00Z', totalCostUSD: 0.2 }),
    ])
    expect(out).toHaveLength(3)
    expect(out[0]!.date).toBe('2026-05-24')
    expect(out[1]!.date).toBe('2026-05-23')
    expect(out[2]!.date).toBe('2026-05-22')
  })

  test('sums totalCostUSD across multiple sessions per day', () => {
    const out = aggregateByDay([
      makeEntry({ ts: '2026-05-24T09:00:00Z', totalCostUSD: 0.1 }),
      makeEntry({ ts: '2026-05-24T15:00:00Z', totalCostUSD: 0.2 }),
      makeEntry({ ts: '2026-05-24T22:00:00Z', totalCostUSD: 0.3 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.totalCostUSD).toBeCloseTo(0.6, 5)
    expect(out[0]!.sessionCount).toBe(3)
  })

  test('merges per-model entries from multiple sessions on the same day', () => {
    const out = aggregateByDay([
      makeEntry({
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

  test('sums across multiple sessions for the same model', () => {
    const out = aggregateByModel([
      makeEntry({
        modelUsage: {
          'claude-opus-4-7': { inputTokens: 1000, outputTokens: 100, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.05 },
        },
      }),
      makeEntry({
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
