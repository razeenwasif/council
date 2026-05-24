/**
 * memoize - cache results of a pure function keyed by its arguments.
 *
 * Semantics:
 *   - Default cache key is `args[0]` (matching Lodash). For multi-argument
 *     functions, supply a custom `keyFn` to derive a stable key. The default
 *     intentionally avoids `JSON.stringify(args)` to dodge `[object Object]`
 *     collisions and ordering pitfalls.
 *   - `this` binding is preserved via `fn.apply(this, args)`, so the helper
 *     can wrap methods as well as standalone functions.
 *   - Cache hits are detected with `cache.has(key)`, so falsy/undefined
 *     return values (0, "", false, null, undefined) are cached correctly.
 *   - When `maxSize` is set, the cache acts as an O(1) LRU. Access on a hit
 *     refreshes insertion order; on a miss past capacity the oldest entry
 *     is evicted. LRU semantics are implemented with `Map` insertion order
 *     (no external dependency).
 *   - For thenables (promises), a `.catch` is attached that deletes the
 *     cached entry on rejection — but only if the cached reference is still
 *     the same one we stored. This prevents persistent cache poisoning on
 *     transient errors while remaining race-free against later replacements.
 *
 * Caveats:
 *   - Multi-argument callers without a `keyFn` will only key on the first
 *     argument and may observe stale results — pass `keyFn` to opt in.
 */

export interface MemoizeOptions<TArgs extends unknown[], TReturn> {
  keyFn?: (...args: TArgs) => unknown;
  maxSize?: number;
}

export interface MemoizedFunction<TArgs extends unknown[], TReturn> {
  (...args: TArgs): TReturn;
  cache: Map<unknown, TReturn>;
}

export function memoize<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
  options: MemoizeOptions<TArgs, TReturn> = {}
): MemoizedFunction<TArgs, TReturn> {
  if (typeof fn !== "function") {
    throw new TypeError("memoize: fn must be a function");
  }
  const { keyFn, maxSize } = options;
  if (keyFn !== undefined && typeof keyFn !== "function") {
    throw new TypeError("memoize: keyFn must be a function");
  }
  if (maxSize !== undefined && (!Number.isInteger(maxSize) || maxSize <= 0)) {
    throw new TypeError("memoize: maxSize must be a positive integer");
  }

  const cache = new Map<unknown, TReturn>();

  const memoized = function (this: unknown, ...args: TArgs): TReturn {
    const key = keyFn ? keyFn.apply(this, args) : args[0];

    if (cache.has(key)) {
      const value = cache.get(key) as TReturn;
      if (maxSize !== undefined) {
        // Refresh insertion order for LRU tracking.
        cache.delete(key);
        cache.set(key, value);
      }
      return value;
    }

    const result = fn.apply(this, args);

    if (maxSize !== undefined && cache.size >= maxSize) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) {
        cache.delete(oldestKey);
      }
    }

    cache.set(key, result);

    // Evict rejected promises so transient failures are retryable.
    if (result && typeof (result as { then?: unknown }).then === "function") {
      (result as unknown as Promise<unknown>).catch(() => {
        if (cache.get(key) === result) {
          cache.delete(key);
        }
      });
    }

    return result;
  } as MemoizedFunction<TArgs, TReturn>;

  memoized.cache = cache;

  return memoized;
}
