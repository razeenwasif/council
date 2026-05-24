/**
 * Type guard to check if a value is a non-empty primitive string.
 *
 * NOTE: This function checks for a literal length > 0. It returns `true` for
 * strings containing only whitespace (e.g., "   " or "\n").
 *
 * NOTE: This returns `false` for String wrapper objects (e.g., `new String("abc")`)
 * because their typeof is "object" and they do not match TypeScript's primitive `string` type.
 *
 * @param x - The value to check.
 * @returns True if the value is a primitive string with a length greater than zero.
 */
export function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.length > 0;
}
