import { describe, expect, test } from "bun:test";
import { isNonEmptyString } from "./isNonEmptyString.js";

describe("isNonEmptyString", () => {
  test("returns true for non-empty primitive strings", () => {
    expect(isNonEmptyString("hello")).toBe(true);
    expect(isNonEmptyString("a")).toBe(true);
    expect(isNonEmptyString("🙂")).toBe(true); // Unicode / multi-byte character
    expect(isNonEmptyString("a\0b")).toBe(true); // Embedded null byte
  });

  test("returns true for strings containing only whitespace", () => {
    expect(isNonEmptyString(" ")).toBe(true);
    expect(isNonEmptyString("   ")).toBe(true);
    expect(isNonEmptyString("\t\n")).toBe(true);
  });

  test("returns false for an empty string", () => {
    expect(isNonEmptyString("")).toBe(false);
  });

  test("returns false for null and undefined", () => {
    expect(isNonEmptyString(null)).toBe(false);
    expect(isNonEmptyString(undefined)).toBe(false);
  });

  test("returns false for other primitive types", () => {
    expect(isNonEmptyString(123)).toBe(false);
    expect(isNonEmptyString(0)).toBe(false);
    expect(isNonEmptyString(NaN)).toBe(false);
    expect(isNonEmptyString(Infinity)).toBe(false);
    expect(isNonEmptyString(true)).toBe(false);
    expect(isNonEmptyString(false)).toBe(false);
    expect(isNonEmptyString(0n)).toBe(false);
    expect(isNonEmptyString(Symbol("test"))).toBe(false);
  });

  test("returns false for objects and arrays", () => {
    expect(isNonEmptyString({})).toBe(false);
    expect(isNonEmptyString([])).toBe(false);
    expect(isNonEmptyString(["a"])).toBe(false);
    expect(isNonEmptyString(() => {})).toBe(false);
  });

  test("returns false for custom object stringifiers", () => {
    expect(isNonEmptyString({ toString() { return "hi"; } })).toBe(false);
    expect(isNonEmptyString({ valueOf() { return "x"; } })).toBe(false);
  });

  test("returns false for String wrapper objects", () => {
    expect(isNonEmptyString(new String("hello"))).toBe(false);
  });

  test("proves type narrowing at compile time", () => {
    const val: unknown = "test";
    if (isNonEmptyString(val)) {
      // This assertion will only compile if TS successfully narrows `val` to `string`
      const upper: string = val.toUpperCase();
      expect(upper).toBe("TEST");
    }
  });
});
