/**
 * Trailing-edge debounce helper.
 *
 * Wraps `fn` so that rapid successive calls collapse into a single invocation
 * that fires `waitMs` after the most recent call. The wrapped function's
 * arguments and `this` binding from the LAST call are used when the timer
 * finally fires.
 *
 * The returned function exposes:
 *   - `cancel()`  — discard any pending invocation without firing.
 *   - `flush()`   — fire the pending invocation immediately (if any).
 *   - `pending()` — true if a call is scheduled but not yet fired.
 *
 * Notes:
 *   - This is a trailing-edge debounce (no leading-edge call). For the
 *     leading-edge variant, use a separate primitive.
 *   - The wrapped function's return value is NOT propagated, because the
 *     debounced call fires asynchronously. The wrapper returns `void`.
 *   - The `timers` option is a test seam allowing injection of a fake timer
 *     pair compatible with `setTimeout` / `clearTimeout`.
 *   - `waitMs` of 0 still defers via the timer queue (it does not invoke
 *     synchronously).
 *
 * @throws {TypeError} If `fn` is not a function or `waitMs` is not a
 *   non-negative finite number.
 */

export interface DebounceTimers {
  setTimeout: (handler: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

export interface DebounceOptions {
  /** Test seam: timer pair. Defaults to global setTimeout/clearTimeout. */
  timers?: DebounceTimers
}

export interface DebouncedFunction<TArgs extends unknown[]> {
  (...args: TArgs): void
  /** Discard any pending invocation without firing. */
  cancel: () => void
  /** Fire the pending invocation immediately (if any). */
  flush: () => void
  /** True if a call is scheduled but not yet fired. */
  pending: () => boolean
}

const defaultTimers: DebounceTimers = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => unknown,
  waitMs: number,
  options?: DebounceOptions,
): DebouncedFunction<TArgs> {
  if (typeof fn !== "function") {
    throw new TypeError("debounce: fn must be a function.")
  }
  if (
    typeof waitMs !== "number" ||
    !Number.isFinite(waitMs) ||
    waitMs < 0
  ) {
    throw new TypeError(
      `debounce: waitMs must be a non-negative finite number (got ${String(waitMs)}).`,
    )
  }

  const timers = options?.timers ?? defaultTimers

  let handle: unknown = null
  let pendingArgs: TArgs | null = null
  let pendingThis: unknown = undefined

  const fire = (): void => {
    handle = null
    const args = pendingArgs
    const ctx = pendingThis
    pendingArgs = null
    pendingThis = undefined
    if (args !== null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(fn as any).apply(ctx, args)
    }
  }

  const debounced = function (this: unknown, ...args: TArgs): void {
    pendingArgs = args
    pendingThis = this
    if (handle !== null) {
      timers.clearTimeout(handle)
    }
    handle = timers.setTimeout(fire, waitMs)
  } as DebouncedFunction<TArgs>

  debounced.cancel = (): void => {
    if (handle !== null) {
      timers.clearTimeout(handle)
      handle = null
    }
    pendingArgs = null
    pendingThis = undefined
  }

  debounced.flush = (): void => {
    if (handle !== null) {
      timers.clearTimeout(handle)
      fire()
    }
  }

  debounced.pending = (): boolean => handle !== null

  return debounced
}
