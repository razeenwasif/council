import type { LocalCommandCall } from '../../types/command.js'
import {
  aggregateByDay,
  aggregateByModel,
  getUsageLedgerPath,
  readUsageLedger,
  type DailyTotals,
  type ModelTotals,
  type UsageLedgerEntry,
} from '../../utils/usageLedger.js'

const HELP = `Usage: /spend [--today | --7d | --30d | --all | --models | --where]

Shows per-day and per-model token usage + spend across all council
sessions. Reads from the append-only ledger at
\`~/.openclaude/usage.jsonl\` — each session-end appends one record.

Flags (mutually exclusive — most-specific wins):
  --today    Just today's spend, broken down by model.
  --7d       Last 7 days (default).
  --30d      Last 30 days.
  --all      Everything ever recorded.
  --models   All-time per-model totals (ranked by cost desc).
  --where    Print the absolute path to the ledger file and exit.

Without any flag, defaults to --7d. The ledger is append-only — to
prune it, delete or rotate the file manually.`

export const call: LocalCommandCall = async (args, _context) => {
  const flag = args.trim().split(/\s+/)[0] ?? ''

  if (flag === '-h' || flag === '--help' || flag === 'help') {
    return { type: 'text', value: HELP }
  }

  if (flag === '--where') {
    return {
      type: 'text',
      value: `Usage ledger: ${getUsageLedgerPath()}`,
    }
  }

  const entries = readUsageLedger()
  if (entries.length === 0) {
    return {
      type: 'text',
      value:
        `No usage recorded yet. The ledger writes on session end (REPL reset, process exit, etc.) — ` +
        `run a few prompts first, then come back. Ledger path: ${getUsageLedgerPath()}`,
    }
  }

  if (flag === '--models') {
    return { type: 'text', value: renderModelsView(entries) }
  }

  if (flag === '--all') {
    return { type: 'text', value: renderDaysView(entries, null) }
  }

  if (flag === '--today') {
    return { type: 'text', value: renderDaysView(entries, 1) }
  }

  if (flag === '--30d') {
    return { type: 'text', value: renderDaysView(entries, 30) }
  }

  // Default: 7 days.
  return { type: 'text', value: renderDaysView(entries, 7) }
}

function renderDaysView(
  entries: UsageLedgerEntry[],
  windowDays: number | null,
): string {
  const days = aggregateByDay(entries)
  const sliced = windowDays === null ? days : days.slice(0, windowDays)
  if (sliced.length === 0) {
    return `No usage recorded in the selected window.`
  }

  const lines: string[] = []
  const windowLabel =
    windowDays === null
      ? 'all-time'
      : windowDays === 1
        ? 'today'
        : `last ${windowDays} days`

  const totalCost = sliced.reduce((acc, d) => acc + d.totalCostUSD, 0)
  const totalSessions = sliced.reduce((acc, d) => acc + d.sessionCount, 0)
  lines.push(
    `Spend (${windowLabel}): ${formatCost(totalCost)} across ${totalSessions} session${totalSessions === 1 ? '' : 's'}`,
  )
  lines.push('')

  // Per-day table
  lines.push(`  Date         Cost      Sessions  Top model`)
  lines.push(`  ───────────────────────────────────────────────────────────────`)
  for (const day of sliced) {
    const topModel = topModelForDay(day)
    const topModelStr = topModel
      ? `${truncate(topModel.model, 25)} (${formatCost(topModel.costUSD)})`
      : '—'
    lines.push(
      `  ${day.date}   ${formatCost(day.totalCostUSD).padStart(8)}  ${String(day.sessionCount).padStart(8)}  ${topModelStr}`,
    )
  }

  // Sparkline at the bottom — shows the trend across the window.
  if (sliced.length >= 2) {
    lines.push('')
    lines.push(`  Trend (oldest → newest): ${sparkline(sliced.map(d => d.totalCostUSD).reverse())}`)
  }

  lines.push('')
  lines.push(
    `Run \`/spend --models\` for an all-time per-model breakdown, or \`/spend --where\` for the ledger path.`,
  )
  return lines.join('\n')
}

function renderModelsView(entries: UsageLedgerEntry[]): string {
  const models = aggregateByModel(entries)
  if (models.length === 0) {
    return `No per-model data in the ledger yet.`
  }

  const lines: string[] = []
  const totalCost = models.reduce((acc, m) => acc + m.costUSD, 0)
  lines.push(
    `All-time per-model spend: ${formatCost(totalCost)} across ${models.length} model${models.length === 1 ? '' : 's'}`,
  )
  lines.push('')
  lines.push(
    `  Model                              Cost      Input        Output       Cache read`,
  )
  lines.push(
    `  ───────────────────────────────────────────────────────────────────────────────────`,
  )
  for (const m of models) {
    lines.push(
      `  ${truncate(m.model, 33).padEnd(33)}  ${formatCost(m.costUSD).padStart(8)}  ${formatNumber(m.inputTokens).padStart(11)}  ${formatNumber(m.outputTokens).padStart(11)}  ${formatNumber(m.cacheReadInputTokens).padStart(11)}`,
    )
  }
  return lines.join('\n')
}

function topModelForDay(day: DailyTotals): ModelTotals | null {
  const models = Object.entries(day.modelUsage)
  if (models.length === 0) return null
  let top: { model: string; entry: ModelTotals } | null = null
  for (const [model, usage] of models) {
    const synthetic: ModelTotals = {
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens,
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
      costUSD: usage.costUSD,
      sessionCount: 0,
    }
    if (!top || synthetic.costUSD > top.entry.costUSD) {
      top = { model, entry: synthetic }
    }
  }
  return top?.entry ?? null
}

/** Tiny inline cost formatter — picks 2 or 4 decimals based on magnitude.
 *  Mirrors what cost-tracker.ts does for consistency. */
function formatCost(cost: number): string {
  if (cost >= 0.5) return `$${cost.toFixed(2)}`
  return `$${cost.toFixed(4)}`
}

/** Compact number formatter: 1234567 → "1.23M", 12345 → "12.3k". */
function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

/** ASCII sparkline using Unicode block characters. Maps values into
 *  8 visible bands (▁ … █). The minimum value renders as ▁ — not a
 *  blank space — so a real day with low spend doesn't look like a
 *  missing data point. */
function sparkline(values: number[]): string {
  if (values.length === 0) return ''
  const BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (max === min) {
    // Flat — render the midpoint bar across the width.
    return BARS[3]!.repeat(values.length)
  }
  const range = max - min
  return values
    .map(v => {
      const band = Math.min(7, Math.max(0, Math.round(((v - min) / range) * 7)))
      return BARS[band]
    })
    .join('')
}
