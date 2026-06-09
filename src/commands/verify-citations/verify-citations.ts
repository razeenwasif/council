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
  /** Actual paper title fetched from arxiv.org. Null if extraction failed. */
  actualTitle?: string | null
  /** Title window from the brief near the cited ID. Null if no nearby text found. */
  claimedContext?: string | null
  /** Jaccard similarity between claimedContext and actualTitle (0..1). */
  titleSimilarity?: number | null
  /** True when the cited context appears to match the actual paper.
   *  Set on titleSimilarity >= TITLE_MATCH_THRESHOLD; false on lower;
   *  null when one or both inputs are unavailable. */
  titleMatch?: boolean | null
  checkedAt: string
  errorMessage?: string
}

// Jaccard token-overlap threshold for considering a brief's claimed
// title and the actual paper title a match. Picked from real data:
//   - Mismatch case (failure mode #13, falcon-3 2026-06-09): Jaccard
//     ≈ 0.07 between "Characterizing Verbatim Short-Term Memory in
//     Neural Language Models" (actual) and the 240-char window
//     around the ID in the brief — clearly below threshold.
//   - Paraphrase case (hypothetical, "the LLaMA paper" → actual
//     "LLaMA: Open and Efficient Foundation Language Models"):
//     Jaccard ≈ 0.14 — comfortably above 0.1.
// 0.1 is the tightest threshold that still tolerates colloquial
// paraphrasing of paper titles. Lower → more false positives on
// legitimate paraphrased cites; higher → more false negatives on
// real mismatches.
const TITLE_MATCH_THRESHOLD = 0.1
const CONTEXT_WINDOW_CHARS = 240

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has',
  'have', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'over',
  'than', 'that', 'the', 'these', 'this', 'those', 'to', 'with', 'we',
  'using', 'used', 'use', 'via', 'about', 'how', 'what', 'when', 'where',
  'why', 'how',
])

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 3 && !STOP_WORDS.has(t)),
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  for (const t of a) if (b.has(t)) intersection++
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
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

/**
 * Extract the arxiv-served paper title from the abs-page HTML. The
 * format is `<title>[<id>] <Title text></title>` — we lift the
 * portion after the `]` and trim.
 */
function extractArxivTitleFromHtml(html: string): string | null {
  const match = html.match(/<title>\s*\[[\d.v]+\]\s*([\s\S]+?)\s*<\/title>/i)
  if (!match) return null
  // Collapse any internal whitespace runs to a single space.
  return match[1]!.replace(/\s+/g, ' ').trim()
}

/**
 * Pull a window of text from the brief around the first occurrence of
 * the cited ID. Used as the "claimed" side of the title-match check —
 * model-emitted titles + author lines typically appear within ~240
 * characters of the cited ID.
 */
function extractClaimedContext(content: string, id: string): string | null {
  const idx = content.indexOf(id)
  if (idx === -1) return null
  const start = Math.max(0, idx - CONTEXT_WINDOW_CHARS)
  const end = Math.min(content.length, idx + id.length + CONTEXT_WINDOW_CHARS)
  return content.slice(start, end)
}

async function checkArxivId(id: string, timeoutMs: number): Promise<CitationCheck> {
  const url = `https://arxiv.org/abs/${id}`
  const checkedAt = new Date().toISOString()
  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)
  try {
    // Use GET (not HEAD) so we can inspect the title in the response
    // body. Bandwidth cost is ~50KB per check; for typical briefs with
    // ≤10 IDs this is negligible vs the latency of an extra round-trip.
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
    })
    const html = res.ok ? await res.text() : ''
    const actualTitle = res.ok ? extractArxivTitleFromHtml(html) : null
    return {
      id,
      url,
      status: res.status,
      resolves: res.ok,
      actualTitle,
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

/**
 * Expand a leading `~` or `~/` in a path. Slash commands bypass the
 * shell, so paths like `~/Research/...` arrive verbatim and need to
 * be expanded explicitly before being passed to existsSync / readFileSync.
 */
function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  return p
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
      briefPath = expandHome(tok)
    }
  }
  return { briefPath, timeoutMs }
}

function fmtCheck(c: CitationCheck): string {
  const status =
    typeof c.status === 'number' ? `HTTP ${c.status}` : c.status.toUpperCase()
  // Failure modes (in increasing severity):
  //   FAIL      — ID does not resolve at all (404 / timeout / network error)
  //   MISMATCH  — ID resolves but the brief's claimed title/context does NOT
  //               match the actual paper (failure mode #13 — real-ID/false-
  //               context binding)
  //   OK        — ID resolves AND title check passed (or no claimed title
  //               text was found near the ID to compare against)
  let tag: string
  if (!c.resolves) tag = 'FAIL'
  else if (c.titleMatch === false) tag = 'MISMATCH'
  else tag = 'OK'

  const lines = [`  [${tag}] ${c.id}  (${status})  ${c.url}`]
  if (tag === 'MISMATCH') {
    if (c.actualTitle) lines.push(`         actual:  ${c.actualTitle}`)
    if (c.titleSimilarity !== null && c.titleSimilarity !== undefined) {
      lines.push(`         match:   ${(c.titleSimilarity * 100).toFixed(0)}% token overlap (threshold ${(TITLE_MATCH_THRESHOLD * 100).toFixed(0)}%)`)
    }
  }
  return lines.join('\n')
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

  // Check in parallel — arxiv.org rate-limits aggressively but small
  // batches of GETs (~10 IDs) are tolerated.
  const checks = await Promise.all(ids.map(id => checkArxivId(id, parsed.timeoutMs)))

  // For each resolved ID, compare the actual paper title against the
  // text in the brief near the cited ID — catches failure mode #13
  // (real-ID / false-context binding) where the ID resolves but
  // corresponds to a different paper than the brief claims.
  for (const c of checks) {
    if (!c.resolves || !c.actualTitle) {
      c.titleMatch = null
      c.titleSimilarity = null
      c.claimedContext = null
      continue
    }
    const claimed = extractClaimedContext(content, c.id)
    c.claimedContext = claimed
    if (!claimed) {
      c.titleMatch = null
      c.titleSimilarity = null
      continue
    }
    const sim = jaccard(tokenize(claimed), tokenize(c.actualTitle))
    c.titleSimilarity = sim
    c.titleMatch = sim >= TITLE_MATCH_THRESHOLD
  }

  for (const c of checks) lines.push(fmtCheck(c))

  const failures = checks.filter(c => !c.resolves)
  const mismatches = checks.filter(c => c.resolves && c.titleMatch === false)
  const clean = checks.filter(c => c.resolves && c.titleMatch !== false)
  lines.push('')
  if (failures.length === 0 && mismatches.length === 0) {
    lines.push(`  All ${checks.length} arXiv IDs resolved cleanly with title-match.`)
  } else {
    if (failures.length > 0) {
      lines.push(
        `  ${failures.length}/${checks.length} arXiv ID${failures.length === 1 ? '' : 's'} failed to resolve.`,
      )
      lines.push(`    Likely confabulated IDs: ${failures.map(f => f.id).join(', ')}`)
    }
    if (mismatches.length > 0) {
      lines.push(
        `  ${mismatches.length}/${checks.length} arXiv ID${mismatches.length === 1 ? '' : 's'} resolved BUT title does NOT match the brief's context.`,
      )
      lines.push(`    Likely failure-mode #13 (real-ID/false-context binding): ${mismatches.map(m => m.id).join(', ')}`)
    }
    if (clean.length > 0) {
      lines.push(`  ${clean.length} citation${clean.length === 1 ? '' : 's'} passed all checks.`)
    }
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
