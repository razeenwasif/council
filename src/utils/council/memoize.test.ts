import { describe, expect, test } from "bun:test";
import { memoize } from "./memoize.js";

describe("memoize", () => {
  test("caches results for repeated identical arguments", () => {
    let calls = 0;
    const fn = memoize((x: number) => {
      calls++;
      return x * 2;
    });

    expect(fn(2)).toBe(4);
    expect(fn(2)).toBe(4);
    expect(fn(2)).toBe(4);
    expect(calls).toBe(1);

    expect(fn(3)).toBe(6);
    expect(calls).toBe(2);
  });

  test("caches falsy and edge-case keys correctly", () => {
    const seen: unknown[] = [];
    const fn = memoize((x: unknown) => {
      seen.push(x);
      return x;
    });

    expect(fn(0)).toBe(0);
    expect(fn(0)).toBe(0);

    expect(fn(false)).toBe(false);
    expect(fn(false)).toBe(false);

    expect(fn("")).toBe("");
    expect(fn("")).toBe("");

    expect(fn(null)).toBe(null);
    expect(fn(null)).toBe(null);

    expect(fn(undefined)).toBe(undefined);
    expect(fn(undefined)).toBe(undefined);

    // Each distinct falsy key should have invoked the underlying fn exactly once.
    expect(seen).toEqual([0, false, "", null, undefined]);
  });

  test("preserves `this` binding when wrapping a method", () => {
    const obj = {
      factor: 7,
      compute: memoize(function (this: { factor: number }, x: number) {
        return x * this.factor;
      }),
    };

    expect(obj.compute(3)).toBe(21);
    expect(obj.compute(3)).toBe(21);
  });

  test("uses a custom keyFn for multi-argument resolution", () => {
    let calls = 0;
    const fn = memoize(
      (a: number, b: number) => {
        calls++;
        return a + b;
      },
      { keyFn: (a: number, b: number) => `${a}:${b}` }
    );

    expect(fn(1, 2)).toBe(3);
    expect(fn(1, 2)).toBe(3);
    expect(calls).toBe(1);

    expect(fn(1, 3)).toBe(4);
    expect(calls).toBe(2);

    // Without a custom keyFn the second argument would be ignored: confirm
    // the keyFn is in effect by exercising another permutation.
    expect(fn(2, 1)).toBe(3);
    expect(calls).toBe(3);
  });

  test("keyFn receives the same `this` as the wrapped call", () => {
    const seenThis: unknown[] = [];
    const obj = {
      tag: "ctx",
      compute: memoize(
        function (this: { tag: string }, x: number) {
          return `${this.tag}:${x}`;
        },
        {
          keyFn: function (this: { tag: string }, x: number) {
            seenThis.push(this);
            return `${this.tag}:${x}`;
          },
        }
      ),
    };

    expect(obj.compute(1)).toBe("ctx:1");
    expect(seenThis[0]).toBe(obj);
  });

  test("LRU evicts the oldest entry when exceeding maxSize", () => {
    let calls = 0;
    const fn = memoize(
      (x: number) => {
        calls++;
        return x * 10;
      },
      { maxSize: 2 }
    );

    fn(1); // cache: [1]
    fn(2); // cache: [1, 2]
    fn(3); // cache: [2, 3] — 1 evicted
    expect(calls).toBe(3);

    fn(2); // hit
    fn(3); // hit
    expect(calls).toBe(3);

    fn(1); // miss — 1 was evicted earlier
    expect(calls).toBe(4);
  });

  test("LRU refreshes access order on cache hits", () => {
    let calls = 0;
    const fn = memoize(
      (x: number) => {
        calls++;
        return x;
      },
      { maxSize: 2 }
    );

    fn(1); // cache: [1]
    fn(2); // cache: [1, 2]
    fn(1); // hit — refresh: cache: [2, 1]
    fn(3); // miss — evict LRU (2): cache: [1, 3]
    expect(calls).toBe(3);

    fn(1); // still cached
    expect(calls).toBe(3);

    fn(2); // evicted earlier, recompute
    expect(calls).toBe(4);
  });

  test("evicts rejected promises so retries can succeed", async () => {
    let calls = 0;
    const fn = memoize(async (x: number) => {
      calls++;
      if (calls === 1) {
        throw new Error("transient");
      }
      return x * 2;
    });

    await expect(fn(5)).rejects.toThrow("transient");
    // Allow the catch-handler microtask to run and evict the entry.
    await Promise.resolve();
    await Promise.resolve();

    expect(fn.cache.has(5)).toBe(false);

    const second = await fn(5);
    expect(second).toBe(10);
    expect(calls).toBe(2);
  });

  test("does not evict resolved promises", async () => {
    let calls = 0;
    const fn = memoize(async (x: number) => {
      calls++;
      return x + 1;
    });

    expect(await fn(1)).toBe(2);
    expect(await fn(1)).toBe(2);
    expect(calls).toBe(1);
    expect(fn.cache.has(1)).toBe(true);
  });

  test("exposes the underlying cache for inspection", () => {
    const fn = memoize((x: number) => x + 1);
    fn(1);
    fn(2);
    expect(fn.cache.size).toBe(2);
    expect(fn.cache.get(1)).toBe(2);
    expect(fn.cache.get(2)).toBe(3);
  });

  test("throws TypeError when fn is not a function", () => {
    expect(() => memoize(null as unknown as () => number)).toThrow(TypeError);
    expect(() => memoize(42 as unknown as () => number)).toThrow(TypeError);
    expect(() => memoize("nope" as unknown as () => number)).toThrow(TypeError);
  });

  test("throws TypeError when keyFn is provided but is not a function", () => {
    expect(() =>
      memoize((x: number) => x, {
        keyFn: "bad" as unknown as (x: number) => unknown,
      })
    ).toThrow(TypeError);
  });

  test("throws TypeError when maxSize is not a positive integer", () => {
    expect(() => memoize((x: number) => x, { maxSize: 0 })).toThrow(TypeError);
    expect(() => memoize((x: number) => x, { maxSize: -1 })).toThrow(TypeError);
    expect(() => memoize((x: number) => x, { maxSize: 1.5 })).toThrow(
      TypeError
    );
    expect(() =>
      memoize((x: number) => x, {
        maxSize: "10" as unknown as number,
      })
    ).toThrow(TypeError);
  });
});
