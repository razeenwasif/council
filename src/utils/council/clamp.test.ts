import { describe, expect, test } from "bun:test";
import { clamp } from "./clamp.js";

describe("clamp", () => {
  test("value already in range", () => {
    expect(clamp(5, 1, 10)).toBe(5);
    expect(clamp(1, 1, 10)).toBe(1);
    expect(clamp(10, 1, 10)).toBe(10);
  });

  test("value below min", () => {
    expect(clamp(0, 1, 10)).toBe(1);
    expect(clamp(-5, 0, 5)).toBe(0);
  });

  test("value above max", () => {
    expect(clamp(15, 1, 10)).toBe(10);
    expect(clamp(100, -10, 20)).toBe(20);
  });

  test("equal bounds (min === max)", () => {
    expect(clamp(5, 5, 5)).toBe(5);
    expect(clamp(10, 5, 5)).toBe(5);
    expect(clamp(0, 5, 5)).toBe(5);
  });

  test("NaN value input", () => {
    expect(clamp(NaN, 1, 10)).toBeNaN();
  });

  test("throws if min > max", () => {
    expect(() => clamp(5, 10, 1)).toThrow(RangeError);
  });

  test("throws if bounds are NaN", () => {
    expect(() => clamp(5, NaN, 10)).toThrow(RangeError);
    expect(() => clamp(5, 1, NaN)).toThrow(RangeError);
    expect(() => clamp(5, NaN, NaN)).toThrow(RangeError);
  });

  test("negative range limits", () => {
    expect(clamp(-5, -10, -2)).toBe(-5);
    expect(clamp(-15, -10, -2)).toBe(-10);
    expect(clamp(0, -10, -2)).toBe(-2);
  });
});
