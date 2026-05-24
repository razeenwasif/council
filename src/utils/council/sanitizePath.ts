import path from "node:path";

/**
 * Resolves a user-supplied relative path against a trusted base directory.
 * Throws an error if the path is invalid or escapes the base directory.
 * Does not resolve or protect against symlink traversal.
 */
export function sanitizePath(userPath: string, baseDir: string): string {
  if (!userPath || userPath.trim() === "") {
    throw new Error("Path cannot be empty or whitespace only");
  }

  if (userPath.includes("\0")) {
    throw new Error("Path cannot contain null bytes");
  }

  // Defensively normalize Windows separators and check for Windows drive letters/UNC roots
  const normalizedUserPath = userPath.replace(/\\/g, "/");
  if (path.isAbsolute(normalizedUserPath) || /^[a-zA-Z]:/.test(normalizedUserPath)) {
    throw new Error("Absolute paths are not allowed");
  }

  const resolvedBase = path.resolve(baseDir);
  const resolvedCandidate = path.resolve(resolvedBase, normalizedUserPath);

  // Check if candidate is equal to base or is inside base directory
  const isInside =
    resolvedCandidate === resolvedBase ||
    resolvedCandidate.startsWith(resolvedBase + path.sep);

  if (!isInside) {
    throw new Error("Path escapes the base directory");
  }

  return resolvedCandidate;
}
