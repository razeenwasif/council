/**
 * Wraps a function so that it is executed at most once.
 * Subsequent calls return the cached result of the first invocation.
 *
 * Features:
 * - Freeing memory: Clears the reference to the underlying function once executed
 *   to allow closure-bound variables to be garbage collected.
 * - Error propagation: Caches and re-throws any exception thrown synchronously on
 *   the first invocation to preserve Type-system correctness.
 * - Reentrancy protection: Detects recursive execution and throws an error.
 * - Context preservation: Honors standard `this` bindings.
 *
 * @throws {TypeError} If `fn` is not a function.
 */
export function once<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn {
  if (typeof fn !== "function") {
    throw new TypeError("once: fn must be a function");
  }

  let status: "pending" | "executing" | "resolved" | "rejected" = "pending";
  let result: TReturn;
  let error: unknown;
  let targetFn: ((...args: TArgs) => TReturn) | null = fn;

  return function (this: unknown, ...args: TArgs): TReturn {
    if (status === "executing") {
      throw new Error("once: recursive invocation of once-wrapped function is not supported");
    }

    if (status === "resolved") {
      return result;
    }

    if (status === "rejected") {
      throw error;
    }

    status = "executing";
    try {
      result = targetFn!.apply(this, args);
      status = "resolved";
      targetFn = null; // Free reference for GC
      return result;
    } catch (e) {
      error = e;
      status = "rejected";
      targetFn = null; // Free reference for GC
      throw e;
    }
  };
}
