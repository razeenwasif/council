/**
 * Append-only per-session usage ledger at `~/.openclaude/usage.jsonl`.
 *
 * Written from `saveCurrentSessionCosts` so every session-end (process
 * exit, REPL reset, /reset, mid-session checkpoint) lands a record.
 * Read by the `/usage` command to render per-day + per-model spend
 * tables across sessions.
 *
 * Schema is intentionally append-only JSONL — one record per line — so
 * a crash mid-write only loses the in-flight line, never corrupts the
 * file. Older records stay forever; rotation is the user's call.
 *
 * NOT in scope here: per-spawn (per-council-role) attribution. The
 * orchestrator runs spawns concurrently so before/after snapshots of
 * the global cost-tracker can't disambiguate which role spent what
 * when multiple roles share a model. Per-model aggregation is what we
 * have reliable data for, and it's what the user actually wants — "how
 * much does each provider cost me" beats "how much did the Skeptic
 * specifically spend." Per-role attribution can be added later if a
 * use case shows up.
 */

import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { getClaudeConfigHomeDir } from './envUtils.js'

export interface UsageLedgerModelEntry {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  costUSD: number
}

export interface UsageLedgerEntry {
  /** ISO 8601 timestamp of when the record was written. */
  ts: string
  /** Session ID for cross-referencing with transcripts. */
  sessionId: string
  /** Working directory the session was launched from. */
  cwd: string
  /** Per-model breakdown — keys are model IDs as the cost-tracker knows them. */
  modelUsage: Record<string, UsageLedgerModelEntry>
  /** Sum of all per-model costUSD entries — denormalized for fast totals. */
  totalCostUSD: number
}

/** Absolute path to the ledger file. Exported so /usage can show it
 *  if the user asks where their data lives. */
export function getUsageLedgerPath(): string {
  return join(getClaudeConfigHomeDir(), 'usage.jsonl')
}

/**
 * Append a single record. Best-effort: a write failure is logged to
 * stderr but never throws — the cost-tracker shouldn't fail a session
 * exit because of a ledger write hiccup.
 */
export function appendUsageLedger(entry: UsageLedgerEntry): void {
  try {
    const dir = getClaudeConfigHomeDir()
    mkdirSync(dir, { recursive: true })
    const line = JSON.stringify(entry) + '\n'
    appendFileSync(getUsageLedgerPath(), line, 'utf8')
  } catch (err) {
    // Stderr only — never throw. Ledger is best-effort observability;
    // a write failure (permissions, disk-full, etc.) shouldn't poison
    // the session.
    process.stderr.write(
      `[usage-ledger] write failed: ${err instanceof Error ? err.message : String(err)}\n`,
    )
  }
}

/**
 * Read all records from the ledger. Returns [] when the file doesn't
 * exist yet (first run) or is empty. Skips malformed lines silently —
 * the ledger is append-only, so a partial line from a crash mid-write
 * shouldn't disqualify the rest.
 */
export function readUsageLedger(): UsageLedgerEntry[] {
  const path = getUsageLedgerPath()
  if (!existsSync(path)) return []
  try {
    const raw = readFileSync(path, 'utf8')
    const entries: UsageLedgerEntry[] = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed) as UsageLedgerEntry
        // Defensive shape check — older records before a schema bump
        // might be missing fields. Skip rather than crash.
        if (
          typeof parsed.ts === 'string' &&
          typeof parsed.sessionId === 'string' &&
          typeof parsed.modelUsage === 'object' &&
          parsed.modelUsage !== null &&
          typeof parsed.totalCostUSD === 'number'
        ) {
          entries.push(parsed)
        }
      } catch {
        // Skip malformed line.
      }
    }
    return entries
  } catch (err) {
    process.stderr.write(
      `[usage-ledger] read failed: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return []
  }
}

/**
 * Aggregate a flat list of records into per-day per-model totals. The
 * day key is the ISO date in the local timezone (YYYY-MM-DD); records
 * are bucketed by `ts.slice(0, 10)` in UTC for stability across
 * machines.
 */
export interface DailyTotals {
  /** YYYY-MM-DD in UTC. */
  date: string
  modelUsage: Record<string, UsageLedgerModelEntry>
  totalCostUSD: number
  sessionCount: number
}

export function aggregateByDay(entries: UsageLedgerEntry[]): DailyTotals[] {
  const byDate = new Map<string, DailyTotals>()
  for (const entry of entries) {
    const date = entry.ts.slice(0, 10) // YYYY-MM-DD in UTC
    let bucket = byDate.get(date)
    if (!bucket) {
      bucket = { date, modelUsage: {}, totalCostUSD: 0, sessionCount: 0 }
      byDate.set(date, bucket)
    }
    bucket.sessionCount++
    bucket.totalCostUSD += entry.totalCostUSD
    for (const [model, usage] of Object.entries(entry.modelUsage)) {
      const existing = bucket.modelUsage[model]
      if (existing) {
        existing.inputTokens += usage.inputTokens
        existing.outputTokens += usage.outputTokens
        existing.cacheReadInputTokens += usage.cacheReadInputTokens
        existing.cacheCreationInputTokens += usage.cacheCreationInputTokens
        existing.costUSD += usage.costUSD
      } else {
        bucket.modelUsage[model] = { ...usage }
      }
    }
  }
  // Return newest first.
  return Array.from(byDate.values()).sort((a, b) =>
    b.date.localeCompare(a.date),
  )
}

/** Aggregate across the full ledger by model only — used for the all-time
 *  per-model table. */
export interface ModelTotals {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  costUSD: number
  sessionCount: number
}

export function aggregateByModel(entries: UsageLedgerEntry[]): ModelTotals[] {
  const byModel = new Map<string, ModelTotals>()
  for (const entry of entries) {
    for (const [model, usage] of Object.entries(entry.modelUsage)) {
      let bucket = byModel.get(model)
      if (!bucket) {
        bucket = {
          model,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          costUSD: 0,
          sessionCount: 0,
        }
        byModel.set(model, bucket)
      }
      bucket.inputTokens += usage.inputTokens
      bucket.outputTokens += usage.outputTokens
      bucket.cacheReadInputTokens += usage.cacheReadInputTokens
      bucket.cacheCreationInputTokens += usage.cacheCreationInputTokens
      bucket.costUSD += usage.costUSD
      bucket.sessionCount++
    }
  }
  // Sort by cost descending — most expensive at the top.
  return Array.from(byModel.values()).sort((a, b) => b.costUSD - a.costUSD)
}
