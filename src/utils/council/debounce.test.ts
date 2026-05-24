import { describe, expect, test } from "bun:test"
import { debounce, type DebounceTimers } from "./debounce.js"

/**
 * Minimal fake-timer harness. Each scheduled callback gets a unique handle.
 * `advance(ms)` fires every callback whose deadline is <= the new clock value,
 * in deadline order, mirroring real setTimeout semantics closely enough for
 * trailing-edge debounce tests.
 */
function makeFakeTimers(): {
  timers: DebounceTimers
  advance: (ms: number) => void
  now: () => number
  scheduledCount: () => number
} {
  let clock = 0
  let nextId = 1
  const scheduled = new Map<
    number,
    { fireAt: number; handler: () => void }
  >()

  const timers: DebounceTimers = {
    setTimeout: (handler, ms) => {
      const id = nextId++
      scheduled.set(id, { fireAt: clock + ms, handler })
      return id
    },
    clearTimeout: (handle) => {
      scheduled.delete(handle as number)
    },
  }

  const advance = (ms: number): void => {
    clock += ms
    let progress = true
    while (progress) {
      progress = false
      const due = [...scheduled.entries()]
        .filter(([, v]) => v.fireAt <= clock)
        .sort((a, b) => a[1].fireAt - b[1].fireAt)
      for (const [id, entry] of due) {
        if (!scheduled.has(id)) continue
        scheduled.delete(id)
        entry.handler()
        progress = true
      }
    }
  }

  return {
    timers,
    advance,
    now: () => clock,
    scheduledCount: () => scheduled.size,
  }
}

describe("debounce", () => {
  test("fires once after the wait period when called repeatedly", () => {
    const { timers, advance } = makeFakeTimers()
    const calls: number[] = []
    const d = debounce((x: number) => calls.push(x), 100, { timers })

    d(1)
    d(2)
    d(3)
    expect(calls).toEqual([])

    advance(99)
    expect(calls).toEqual([])

    advance(1)
    expect(calls).toEqual([3])
  })

  test("uses the most recent arguments", () => {
    const { timers, advance } = makeFakeTimers()
    const calls: string[] = []
    const d = debounce((s: string) => calls.push(s), 50, { timers })

    d("a")
    d("b")
    advance(25)
    d("c")
    advance(50)

    expect(calls).toEqual(["c"])
  })

  test("subsequent burst after fire schedules a new invocation", () => {
    const { timers, advance } = makeFakeTimers()
    const calls: number[] = []
    const d = debounce((x: number) => calls.push(x), 100, { timers })

    d(1)
    advance(100)
    expect(calls).toEqual([1])

    d(2)
    d(3)
    advance(100)
    expect(calls).toEqual([1, 3])
  })

  test("cancel() discards a pending invocation", () => {
    const { timers, advance } = makeFakeTimers()
    const calls: number[] = []
    const d = debounce((x: number) => calls.push(x), 100, { timers })

    d(42)
    expect(d.pending()).toBe(true)
    d.cancel()
    expect(d.pending()).toBe(false)
    advance(1000)
    expect(calls).toEqual([])
  })

  test("flush() fires immediately when a call is pending", () => {
    const { timers, advance } = makeFakeTimers()
    const calls: number[] = []
    const d = debounce((x: number) => calls.push(x), 100, { timers })

    d(7)
    expect(calls).toEqual([])
    d.flush()
    expect(calls).toEqual([7])
    expect(d.pending()).toBe(false)

    // Advancing further must not fire again.
    advance(1000)
    expect(calls).toEqual([7])
  })

  test("flush() is a no-op when nothing is pending", () => {
    const { timers } = makeFakeTimers()
    const calls: number[] = []
    const d = debounce(() => calls.push(1), 100, { timers })
    d.flush()
    expect(calls).toEqual([])
  })

  test("pending() reflects scheduled state", () => {
    const { timers, advance } = makeFakeTimers()
    const d = debounce(() => {}, 100, { timers })
    expect(d.pending()).toBe(false)
    d()
    expect(d.pending()).toBe(true)
    advance(100)
    expect(d.pending()).toBe(false)
  })

  test("preserves `this` binding from the most recent call", () => {
    const { timers, advance } = makeFakeTimers()
    const received: unknown[] = []
    const d = debounce(function (this: unknown) {
      received.push(this)
    }, 50, { timers })

    const ctxA = { name: "a" }
    const ctxB = { name: "b" }
    d.call(ctxA)
    d.call(ctxB)
    advance(50)

    expect(received).toEqual([ctxB])
  })

  test("waitMs === 0 still defers (does not call synchronously)", () => {
    const { timers, advance } = makeFakeTimers()
    const calls: number[] = []
    const d = debounce((x: number) => calls.push(x), 0, { timers })

    d(1)
    expect(calls).toEqual([])
    advance(0)
    expect(calls).toEqual([1])
  })

  test("throws if fn is not a function", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => debounce(undefined as any, 100)).toThrow(TypeError)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => debounce(123 as any, 100)).toThrow(TypeError)
  })

  test("throws if waitMs is invalid", () => {
    expect(() => debounce(() => {}, -1)).toThrow(TypeError)
    expect(() => debounce(() => {}, NaN)).toThrow(TypeError)
    expect(() => debounce(() => {}, Number.POSITIVE_INFINITY)).toThrow(
      TypeError,
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => debounce(() => {}, "100" as any)).toThrow(TypeError)
  })

  test("cancel() after fire is a no-op", () => {
    const { timers, advance } = makeFakeTimers()
    const calls: number[] = []
    const d = debounce((x: number) => calls.push(x), 50, { timers })
    d(1)
    advance(50)
    expect(calls).toEqual([1])
    d.cancel()
    advance(1000)
    expect(calls).toEqual([1])
  })

  test("integrates with real timers (smoke)", async () => {
    const calls: number[] = []
    const d = debounce((x: number) => calls.push(x), 5)
    d(1)
    d(2)
    await new Promise((r) => setTimeout(r, 25))
    expect(calls).toEqual([2])
  })
})
