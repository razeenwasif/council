/**
 * /verify-citations — scan a /discover brief for arXiv IDs and check
 * that each one resolves over HTTPS. Implements the BACKLOG entry
 * "Citation verification harness" — a deterministic check that catches
 * confident-sounding arXiv-ID confabulations the Verifier role may
 * miss.
 *
 * Scope (this iteration): arXiv IDs only. Author-name confabulations
 * (e.g. "Yang & Hodgkiasz, 2023") require a different lookup
 * strategy and stay deferred.
 *
 * Behavior:
 *   - With no args: scan the most-recently-modified .md in
 *     ~/Research/debates/.
 *   - With a path arg: scan that file.
 *   - HEAD-request https://arxiv.org/abs/<id> for each ID with a
 *     configurable timeout (default 5 s); flag any that 404, 503, or
 *     timeout.
 *   - Append a `citationsVerified` entry to the matching record in
 *     ~/.openclaude/council-runs.jsonl when the brief path matches a
 *     telemetry record's brief path (best-effort — silently no-op if
 *     no match).
 *   - Print a one-screen summary to the REPL with each flagged ID
 *     and the failure mode (404 / 503 / timeout).
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { LocalCommandCall } from '../../types/command.js'

const DEFAULT_TIMEOUT_MS = 5_000
const ARXIV_ID_REGEX = /\b(\d{4}\.\d{4,5})\b/g
const DEBATES_DIR = join(homedir(), 'Research', 'debates')
const COUNCIL_RUNS_PATH = join(homedir(), '.openclaude', 'council-runs.jsonl')

const HELP = `Usage: /verify-citations [<brief path>] [--timeout=<ms>]

Scans a /discover brief for arXiv IDs (regex \\b\\d{4}\\.\\d{4,5}\\b)
and HEAD-checks each one against https://arxiv.org/abs/<id>. Flags
IDs that return 404, 503, or time out.

Args:
  <brief path>   path to a .md file in ~/Research/debates/.
                 If omitted, scans the most-recently-modified brief
                 in that directory.
  --timeout=<ms> per-request timeout in milliseconds (default 5000).

When the brief path matches a telemetry record's brief path in
~/.openclaude/council-runs.jsonl, this command appends a
citationsVerified[] field to that record. The /verdict commands and
future analyses can consume this field.

Examples:
  /verify-citations
  /verify-citations ~/Research/debates/2026-06-09-09-11-how-does-4-bit-quantization-affect-a-dom.md
  /verify-citations --timeout=10000
`

interface CitationCheck {
  id: string
  url: string
  status: number | 'timeout' | 'error'
  resolves: boolean
  checkedAt: string
  errorMessage?: string
}

function latestBriefPath(): string | null {
  if (!existsSync(DEBATES_DIR)) return null
  const entries = readdirSync(DEBATES_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const p = join(DEBATES_DIR, f)
      try {
        return { path: p, mtimeMs: statSync(p).mtimeMs }
      } catch {
        return null
      }
    })
    .filter((e): e is { path: string; mtimeMs: number } => e !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  return entries[0]?.path ?? null
}

function extractArxivIds(content: string): string[] {
  const ids = new Set<string>()
  for (const match of content.matchAll(ARXIV_ID_REGEX)) {
    if (match[1]) ids.add(match[1])
  }
  return [...ids].sort()
}

async function checkArxivId(id: string, timeoutMs: number): Promise<CitationCheck> {
  const url = `https://arxiv.org/abs/${id}`
  const checkedAt = new Date().toISOString()
  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
    })
    return {
      id,
      url,
      status: res.status,
      resolves: res.ok,
      checkedAt,
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { id, url, status: 'timeout', resolves: false, checkedAt }
    }
    return {
      id,
      url,
      status: 'error',
      resolves: false,
      checkedAt,
      errorMessage: err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearTimeout(timeoutHandle)
  }
}

interface CouncilRunRecord {
  runId?: string
  kind?: string
  briefPath?: string
  citationsVerified?: CitationCheck[]
  [k: string]: unknown
}

/**
 * Append citationsVerified to the matching record in council-runs.jsonl.
 * Match is by briefPath. Returns the runId of the updated record, or
 * null if no match. Best-effort — silently no-op on read/write errors
 * since this is auxiliary data.
 */
function appendCitationsToTelemetry(
  briefPath: string,
  checks: CitationCheck[],
): string | null {
  try {
    if (!existsSync(COUNCIL_RUNS_PATH)) return null
    const lines = readFileSync(COUNCIL_RUNS_PATH, 'utf8').split('\n').filter(Boolean)
    const records: CouncilRunRecord[] = lines.map(l => {
      try {
        return JSON.parse(l) as CouncilRunRecord
      } catch {
        return {} as CouncilRunRecord
      }
    })
    // Find the most recent record matching briefPath
    let matchIdx = -1
    for (let i = records.length - 1; i >= 0; i--) {
      if (records[i]?.briefPath === briefPath) {
        matchIdx = i
        break
      }
    }
    if (matchIdx < 0) return null
    records[matchIdx]!.citationsVerified = checks
    const out = records.map(r => JSON.stringify(r)).join('\n') + '\n'
    writeFileSync(COUNCIL_RUNS_PATH, out, 'utf8')
    return records[matchIdx]!.runId ?? null
  } catch {
    return null
  }
}

function parseFlags(raw: string): { briefPath?: string; timeoutMs: number } | { error: string } {
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  let timeoutMs = DEFAULT_TIMEOUT_MS
  let briefPath: string | undefined
  for (const tok of tokens) {
    if (tok === '--help' || tok === '-h') return { error: 'help' }
    if (tok.startsWith('--timeout=')) {
      const n = parseInt(tok.slice('--timeout='.length), 10)
      if (!Number.isFinite(n) || n <= 0) {
        return { error: `--timeout must be a positive integer, got '${tok}'` }
      }
      timeoutMs = n
    } else if (tok.startsWith('--')) {
      return { error: `unknown flag '${tok}'` }
    } else {
      briefPath = tok
    }
  }
  return { briefPath, timeoutMs }
}

function fmtCheck(c: CitationCheck): string {
  const tag = c.resolves ? 'OK' : 'FAIL'
  const status =
    typeof c.status === 'number' ? `HTTP ${c.status}` : c.status.toUpperCase()
  return `  [${tag}] ${c.id}  (${status})  ${c.url}`
}

export const call: LocalCommandCall = async (args, _context) => {
  const raw = (args ?? '').trim()
  if (raw === 'help' || raw === '--help' || raw === '-h') {
    return { type: 'text', value: HELP }
  }

  const parsed = parseFlags(raw)
  if ('error' in parsed) {
    if (parsed.error === 'help') return { type: 'text', value: HELP }
    return { type: 'text', value: `verify-citations: ${parsed.error}\n\n${HELP}` }
  }

  const briefPath = parsed.briefPath ?? latestBriefPath()
  if (!briefPath) {
    return {
      type: 'text',
      value: `verify-citations: no brief specified and no .md file found in ${DEBATES_DIR}`,
    }
  }
  if (!existsSync(briefPath)) {
    return {
      type: 'text',
      value: `verify-citations: file not found: ${briefPath}`,
    }
  }

  let content: string
  try {
    content = readFileSync(briefPath, 'utf8')
  } catch (err) {
    return {
      type: 'text',
      value: `verify-citations: failed to read ${briefPath}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const ids = extractArxivIds(content)
  const lines: string[] = []
  lines.push(`verify-citations: ${briefPath}`)
  lines.push(`  ${ids.length} arXiv ID${ids.length === 1 ? '' : 's'} found`)

  if (ids.length === 0) {
    lines.push('  No IDs to check — the brief may cite by author/year only,')
    lines.push('  or the empiricist may not have used arXiv references this run.')
    return { type: 'text', value: lines.join('\n') }
  }

  lines.push(`  Checking with ${parsed.timeoutMs}ms timeout...`)
  lines.push('')

  // Check in parallel — arxiv.org rate-limits aggressively but HEAD
  // requests at small batches are tolerated.
  const checks = await Promise.all(ids.map(id => checkArxivId(id, parsed.timeoutMs)))
  for (const c of checks) lines.push(fmtCheck(c))

  const failures = checks.filter(c => !c.resolves)
  lines.push('')
  if (failures.length === 0) {
    lines.push(`  All ${checks.length} arXiv IDs resolved cleanly.`)
  } else {
    lines.push(
      `  ${failures.length}/${checks.length} arXiv ID${failures.length === 1 ? '' : 's'} failed to resolve.`,
    )
    lines.push(`  Likely confabulated IDs: ${failures.map(f => f.id).join(', ')}`)
  }

  // Best-effort telemetry attachment
  const updatedRunId = appendCitationsToTelemetry(briefPath, checks)
  if (updatedRunId) {
    lines.push('')
    lines.push(
      `  Attached citationsVerified[] to council-runs.jsonl record runId=${updatedRunId.slice(0, 8)}`,
    )
  }

  return { type: 'text', value: lines.join('\n') }
}
