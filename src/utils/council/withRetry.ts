/**
 * Generic retry helper with full-jitter exponential backoff.
 *
 * NAME COLLISION: There is another `withRetry` at `src/services/api/withRetry.ts`.
 * That module is a separate, API-specific helper. Do not confuse the two.
 * This module is a small, dependency-free utility intended for use throughout
 * the Council codebase where a simple retry primitive is needed.
 *
 * Backoff formula (full jitter):
 *   delay = random() * min(maxDelayMs, baseDelayMs * 2^(attempt - 1))
 *
 * Behavior notes:
 *   - The final failed attempt does NOT sleep before rethrowing.
 *   - The `signal` option is reserved for future use and is NOT honored in v1.
 *   - The original thrown value (including non-Error throws) is rethrown by
 *     identity (i.e. `throw lastError` preserves reference equality).
 *   - Caller-side idempotency: retrying side-effecting functions may cause
 *     double execution of those side effects. Callers must ensure the wrapped
 *     function is safe to retry.
 */

export type ShouldRetry = (
  error: unknown,
  attempt: number,
) => boolean | Promise<boolean>

export interface WithRetryOptions {
  /** Total number of attempts including the first. Must be >= 1. Default 3. */
  maxAttempts?: number
  /** Base delay in ms for exponential backoff. Default 100. */
  baseDelayMs?: number
  /** Upper bound on the computed delay (post-jitter cap input). Default 30_000. */
  maxDelayMs?: number
  /** Predicate to decide whether an error is retryable. Default: always true. */
  shouldRetry?: ShouldRetry
  /** Reserved for future use. Not honored in v1. */
  signal?: AbortSignal
  /** Test seam: sleep implementation. Default uses setTimeout. */
  sleep?: (ms: number) => Promise<void>
  /** Test seam: PRNG in [0, 1). Default Math.random. */
  random?: () => number
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

const defaultShouldRetry: ShouldRetry = () => true

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options?: WithRetryOptions,
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 100,
    maxDelayMs = 30_000,
    shouldRetry = defaultShouldRetry,
    sleep = defaultSleep,
    random = Math.random,
  } = options ?? {}

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError(
      `withRetry: maxAttempts must be an integer >= 1 (got ${String(maxAttempts)})`,
    )
  }
  if (typeof baseDelayMs !== 'number' || baseDelayMs < 0) {
    throw new TypeError(
      `withRetry: baseDelayMs must be a number >= 0 (got ${String(baseDelayMs)})`,
    )
  }

  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt)
    } catch (err) {
      lastError = err
      if (attempt === maxAttempts) break
      const retryable = await shouldRetry(err, attempt)
      if (!retryable) break
      const expo = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1))
      const delay = random() * expo
      await sleep(delay)
    }
  }
  throw lastError
}
