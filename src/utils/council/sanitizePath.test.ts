import { describe, expect, it } from "bun:test";
import { sanitizePath } from "./sanitizePath";
import path from "node:path";

describe("sanitizePath", () => {
  const baseDir = "/home/amaterasu/Council/trusted_base";

  it("should resolve clean relative paths correctly", () => {
    const result = sanitizePath("subdir/file.txt", baseDir);
    expect(result).toBe(path.resolve(baseDir, "subdir/file.txt"));
  });

  it("should accept a path resolving to the base directory itself", () => {
    expect(sanitizePath(".", baseDir)).toBe(path.resolve(baseDir));
    expect(sanitizePath("./", baseDir)).toBe(path.resolve(baseDir));
  });

  it("should throw for paths attempting traversal to escape the base", () => {
    expect(() => sanitizePath("../escaped.txt", baseDir)).toThrow();
    expect(() => sanitizePath("subdir/../../escaped.txt", baseDir)).toThrow();
  });

  it("should accept traversal that stays within the base", () => {
    const result = sanitizePath("subdir/../file.txt", baseDir);
    expect(result).toBe(path.resolve(baseDir, "file.txt"));
  });

  it("should throw for absolute path inputs", () => {
    expect(() => sanitizePath("/absolute/path", baseDir)).toThrow();
    expect(() => sanitizePath("C:/absolute/path", baseDir)).toThrow();
  });

  it("should throw for null-byte inputs", () => {
    expect(() => sanitizePath("file.txt\0", baseDir)).toThrow();
    expect(() => sanitizePath("subdir\0/file.txt", baseDir)).toThrow();
  });

  it("should throw for empty or whitespace-only inputs", () => {
    expect(() => sanitizePath("", baseDir)).toThrow();
    expect(() => sanitizePath("   ", baseDir)).toThrow();
  });
});
