const formatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * Format a USD amount as a display string.
 * Examples: 0.42 -> "$0.42", 12.5 -> "$12.50", 1500 -> "$1,500.00", -3.2 -> "-$3.20".
 * Non-finite input (NaN, Infinity) returns "$0.00".
 */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd)) return '$0.00'
  return formatter.format(usd)
}
