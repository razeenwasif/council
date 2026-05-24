import { describe, test, expect } from 'bun:test'
import { withRetry } from './withRetry.js'

describe('withRetry', () => {
  test('succeeds first try', async () => {
    let calls = 0
    const delays: number[] = []
    const sleep = async (ms: number) => {
      delays.push(ms)
    }
    const result = await withRetry(
      async () => {
        calls++
        return 'ok'
      },
      { sleep, random: () => 0.5 },
    )
    expect(result).toBe('ok')
    expect(calls).toBe(1)
    expect(delays.length).toBe(0)
  })

  test('succeeds after one retry', async () => {
    let calls = 0
    const attempts: number[] = []
    const delays: number[] = []
    const sleep = async (ms: number) => {
      delays.push(ms)
    }
    const result = await withRetry(
      async (attempt: number) => {
        attempts.push(attempt)
        calls++
        if (calls === 1) throw new Error('transient')
        return 'value'
      },
      { sleep, random: () => 0.5 },
    )
    expect(result).toBe('value')
    expect(calls).toBe(2)
    expect(delays.length).toBe(1)
    expect(attempts).toEqual([1, 2])
  })

  test('exhausts retries with final error preserved', async () => {
    const sentinel = new Error('boom')
    let calls = 0
    const delays: number[] = []
    const sleep = async (ms: number) => {
      delays.push(ms)
    }
    let caught: unknown
    try {
      await withRetry(
        async () => {
          calls++
          throw sentinel
        },
        { maxAttempts: 4, sleep, random: () => 0.5 },
      )
    } catch (err) {
      caught = err
    }
    expect(caught).toBe(sentinel)
    expect(calls).toBe(4)
    expect(delays.length).toBe(3)
  })

  test('shouldRetry returning false stops early', async () => {
    const sentinel = new Error('stop')
    let calls = 0
    const delays: number[] = []
    const sleep = async (ms: number) => {
      delays.push(ms)
    }
    let caught: unknown
    try {
      await withRetry(
        async () => {
          calls++
          throw sentinel
        },
        {
          sleep,
          random: () => 0.5,
          shouldRetry: () => false,
        },
      )
    } catch (err) {
      caught = err
    }
    expect(caught).toBe(sentinel)
    expect(calls).toBe(1)
    expect(delays.length).toBe(0)
  })

  test('shouldRetry receives error and attempt number', async () => {
    const sentinel = new Error('inspect')
    const calls: Array<{ error: unknown; attempt: number }> = []
    const delays: number[] = []
    const sleep = async (ms: number) => {
      delays.push(ms)
    }
    try {
      await withRetry(
        async () => {
          throw sentinel
        },
        {
          sleep,
          random: () => 0.5,
          shouldRetry: (error, attempt) => {
            calls.push({ error, attempt })
            return false
          },
        },
      )
    } catch {
      // expected
    }
    expect(calls.length).toBe(1)
    expect(calls[0].error).toBe(sentinel)
    expect(calls[0].attempt).toBe(1)
  })

  test('respects maxDelayMs cap', async () => {
    const delays: number[] = []
    const sleep = async (ms: number) => {
      delays.push(ms)
    }
    try {
      await withRetry(
        async () => {
          throw new Error('always')
        },
        {
          maxAttempts: 5,
          baseDelayMs: 1000,
          maxDelayMs: 1500,
          sleep,
          random: () => 1,
        },
      )
    } catch {
      // expected
    }
    expect(delays.length).toBeGreaterThan(0)
    for (const d of delays) {
      expect(d).toBeLessThanOrEqual(1500)
    }
  })
})
