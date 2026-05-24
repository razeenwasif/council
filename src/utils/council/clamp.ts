/**
 * Clamps a number to a specified range [min, max].
 *
 * @param value - The numeric value to clamp.
 * @param min - The lower bound.
 * @param max - The upper bound.
 * @returns The clamped number, or NaN if the input value is NaN.
 * @throws {RangeError} If min or max is NaN, or if min > max.
 */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(min) || Number.isNaN(max)) {
    throw new RangeError("Range bounds must be valid numbers (cannot be NaN).");
  }
  if (min > max) {
    throw new RangeError(`min (${min}) cannot be greater than max (${max}).`);
  }
  if (Number.isNaN(value)) {
    return NaN;
  }
  return Math.max(min, Math.min(max, value));
}
