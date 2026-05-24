import { describe, expect, test } from "bun:test";
import { once } from "./once.js";

describe("once", () => {
  test("invokes the underlying function exactly once and caches return value", () => {
    let count = 0;
    const fn = once((x: number) => {
      count++;
      return x * 2;
    });

    expect(fn(5)).toBe(10);
    expect(fn(10)).toBe(10);
    expect(count).toBe(1);
  });

  test("preserves this context", () => {
    const context = {
      factor: 3,
      fn: once(function (this: { factor: number }, x: number) {
        return x * this.factor;
      })
    };

    expect(context.fn(5)).toBe(15);
  });

  test("caches and re-throws synchronous errors on subsequent invocations", () => {
    let count = 0;
    const fn = once(() => {
      count++;
      throw new Error("fail");
    });

    expect(() => fn()).toThrow("fail");
    expect(() => fn()).toThrow("fail");
    expect(count).toBe(1);
  });

  test("works with async functions (promises)", async () => {
    let count = 0;
    const fn = once(async (x: number) => {
      count++;
      return x * 10;
    });

    const p1 = fn(2);
    const p2 = fn(4);

    expect(p1).toBe(p2);
    const val = await p1;
    expect(val).toBe(20);
    expect(count).toBe(1);
  });

  test("throws TypeError if argument is not a function", () => {
    expect(() => once(null as any)).toThrow(TypeError);
    expect(() => once(42 as any)).toThrow(TypeError);
  });

  test("prevents and throws on recursive / reentrant calls", () => {
    const fn = once(() => {
      fn();
    });

    expect(() => fn()).toThrow(
      "once: recursive invocation of once-wrapped function is not supported"
    );
  });

  test("caches falsy values correctly", () => {
    let count = 0;
    const fn = once(() => {
      count++;
      return 0;
    });

    expect(fn()).toBe(0);
    expect(fn()).toBe(0);
    expect(count).toBe(1);
  });
});
