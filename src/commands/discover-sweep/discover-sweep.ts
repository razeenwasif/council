/**
 * /discover-sweep — automate Council-bootstrap data collection.
 *
 * Reads the paste-format prompts file produced by
 * `seed_council_synthetic.py` (one `/discover <prompt>` per line, with
 * `#` comments), runs /discover on each prompt sequentially, and writes
 * each brief to ~/Research/debates/ + council-runs.jsonl exactly as if
 * the user had typed each command interactively.
 *
 * Matches the architecture of /voice-sweep — single slash command,
 * reuses the same orchestrator path the manual command uses, no shell-
 * level automation needed.
 *
 * Usage:
 *   /discover-sweep ~/Research/council-specialists/data/raw/seeds/physics_discover_prompts.txt
 *   /discover-sweep <file> --limit=10           # first 10 prompts only
 *   /discover-sweep <file> --skip-completed     # skip prompts whose brief already
 *                                                 exists in council-runs.jsonl
 *   /discover-sweep <file> --pause=5            # 5 s between prompts
 *   /discover-sweep <file> --continue-on-error  # don't stop on individual failures
 */

import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

import type { LocalCommandCall } from '../../types/command.js'
import { runDebateFromToolContext } from '../../coordinator/council/debateSpawn.js'
import { defaultBriefPath, writeBrief } from '../../utils/debateBriefWriter.js'

const HELP = `Usage: /discover-sweep <prompts-file> [flags]

Iterates /discover over a paste-format prompts file (the output of
data/seed_council_synthetic.py in council-specialists). Each prompt
produces a brief in ~/Research/debates/ and a record in
~/.openclaude/council-runs.jsonl — same path as typing /discover
manually.

Args:
  <prompts-file>           Absolute or ~/-prefixed path to a paste-format
                           prompts file. Lines starting with /discover are
                           processed; comment lines (starting with #) and
                           blank lines are skipped.

Flags:
  --limit=N                Stop after processing N prompts (default: all).
  --skip-completed         Skip prompts whose normalized text already
                           appears in ~/.openclaude/council-runs.jsonl
                           (resume support for interrupted sweeps).
  --pause=Sec              Wait Sec seconds between prompts. Default 3.
                           Useful for letting Ollama swap models cleanly.
  --continue-on-error      Don't stop the sweep on per-prompt failures.
                           The error is logged in the summary.

Output:
  - Each completed brief: ~/Research/debates/<timestamp>-<slug>.md
  - Per-prompt telemetry: ~/.openclaude/council-runs.jsonl
  - Final summary returned by this command.

Resume after interruption:
  Use --skip-completed to re-run with the same file — already-processed
  prompts are skipped, the rest run.

Example:
  /discover-sweep ~/Research/council-specialists/data/raw/seeds/physics_discover_prompts.txt --skip-completed --pause=5
`

interface ParsedFlags {
  promptsPath?: string
  limit?: number
  pauseMs: number
  skipCompleted: boolean
  continueOnError: boolean
}

interface PromptEntry {
  lineNumber: number
  question: string
}

interface SweepRecord {
  index: number
  question: string
  status: 'completed' | 'skipped' | 'failed'
  briefPath?: string
  durationMs?: number
  error?: string
}

const COUNCIL_RUNS_PATH = join(homedir(), '.openclaude', 'council-runs.jsonl')

function expandPath(p: string): string {
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  if (p === '~') return homedir()
  return p
}

function parseFlags(raw: string): ParsedFlags | { error: string } {
  const flags: ParsedFlags = { pauseMs: 3000, skipCompleted: false, continueOnError: false }
  const tokens = raw.trim().split(/\s+/).filter(Boolean)

  for (const tok of tokens) {
    if (tok === '-h' || tok === '--help' || tok === 'help') {
      return { error: 'help' }
    } else if (tok === '--skip-completed') {
      flags.skipCompleted = true
    } else if (tok === '--continue-on-error') {
      flags.continueOnError = true
    } else if (tok.startsWith('--limit=')) {
      const n = parseInt(tok.slice('--limit='.length), 10)
      if (!Number.isFinite(n) || n <= 0) {
        return { error: `--limit must be a positive integer, got '${tok}'` }
      }
      flags.limit = n
    } else if (tok.startsWith('--pause=')) {
      const n = parseFloat(tok.slice('--pause='.length))
      if (!Number.isFinite(n) || n < 0) {
        return { error: `--pause must be a non-negative number, got '${tok}'` }
      }
      flags.pauseMs = Math.round(n * 1000)
    } else if (tok.startsWith('--')) {
      return { error: `unknown flag '${tok}'` }
    } else if (!flags.promptsPath) {
      flags.promptsPath = expandPath(tok)
    } else {
      return { error: `unexpected extra positional arg '${tok}'` }
    }
  }

  if (!flags.promptsPath) {
    return { error: 'prompts file is required (positional arg)' }
  }
  return flags
}

function loadPrompts(path: string): PromptEntry[] | { error: string } {
  if (!existsSync(path)) {
    return { error: `prompts file not found: ${path}` }
  }
  const lines = readFileSync(path, 'utf8').split('\n')
  const out: PromptEntry[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (!line || line.startsWith('#')) continue
    if (!line.startsWith('/discover ')) continue
    const question = line.slice('/discover '.length).trim()
    if (question) out.push({ lineNumber: i + 1, question })
  }
  return out
}

/**
 * Normalize a prompt for comparing against council-runs.jsonl entries —
 * matches the convention in data/council_synthetic.py.
 */
function normalize(s: string): string {
  return s.split(/\s+/).filter(Boolean).join(' ').toLowerCase()
}

function loadCompletedPrompts(): Set<string> {
  if (!existsSync(COUNCIL_RUNS_PATH)) return new Set()
  const seen = new Set<string>()
  try {
    const text = readFileSync(COUNCIL_RUNS_PATH, 'utf8')
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const rec = JSON.parse(trimmed)
        if (rec.kind !== 'discover' && rec.kind !== 'debate') continue
        const prompt = rec.prompt
        if (typeof prompt === 'string' && prompt) {
          seen.add(normalize(prompt))
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // best-effort — return what we have
  }
  return seen
}

function fmtDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const min = Math.floor(ms / 60_000)
  const sec = Math.floor((ms % 60_000) / 1000)
  return `${min}m${sec.toString().padStart(2, '0')}s`
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return
  await new Promise<void>(resolve => setTimeout(resolve, ms))
}

export const call: LocalCommandCall = async (args, context) => {
  const raw = (args ?? '').trim()
  if (!raw) {
    return { type: 'text', value: HELP }
  }

  const flagsOrError = parseFlags(raw)
  if ('error' in flagsOrError) {
    if (flagsOrError.error === 'help') return { type: 'text', value: HELP }
    return { type: 'text', value: `discover-sweep: ${flagsOrError.error}\n\n${HELP}` }
  }
  const flags = flagsOrError

  const promptsOrError = loadPrompts(flags.promptsPath!)
  if ('error' in promptsOrError) {
    return { type: 'text', value: `discover-sweep: ${promptsOrError.error}` }
  }
  let prompts = promptsOrError

  // Apply --skip-completed filter BEFORE --limit so the limit counts
  // prompts that will actually run.
  let skippedCount = 0
  if (flags.skipCompleted) {
    const completed = loadCompletedPrompts()
    const before = prompts.length
    prompts = prompts.filter(p => !completed.has(normalize(p.question)))
    skippedCount = before - prompts.length
  }

  if (flags.limit && flags.limit < prompts.length) {
    prompts = prompts.slice(0, flags.limit)
  }

  if (prompts.length === 0) {
    return {
      type: 'text',
      value:
        skippedCount > 0
          ? `discover-sweep: all ${skippedCount} prompts already completed (per council-runs.jsonl). Nothing to do.`
          : `discover-sweep: 0 prompts found in ${flags.promptsPath}.`,
    }
  }

  // ─── Run loop ───────────────────────────────────────────────────────
  const sweepStart = Date.now()
  const records: SweepRecord[] = []
  const abortSignal = context.abortController?.signal

  const headerLines: string[] = [
    `discover-sweep starting: ${prompts.length} prompts from ${flags.promptsPath}`,
  ]
  if (skippedCount > 0) {
    headerLines.push(`  skipping ${skippedCount} already-completed prompts`)
  }
  if (flags.limit) {
    headerLines.push(`  --limit=${flags.limit} active`)
  }
  headerLines.push(
    `  pause between prompts: ${(flags.pauseMs / 1000).toFixed(1)}s`,
    `  estimated time: ${fmtDuration(prompts.length * 95_000 + (prompts.length - 1) * flags.pauseMs)}`,
  )

  for (let i = 0; i < prompts.length; i++) {
    if (abortSignal?.aborted) {
      records.push({
        index: i,
        question: prompts[i]!.question,
        status: 'skipped',
        error: 'aborted by user',
      })
      // Mark all remaining as skipped too.
      for (let j = i + 1; j < prompts.length; j++) {
        records.push({
          index: j,
          question: prompts[j]!.question,
          status: 'skipped',
          error: 'aborted by user',
        })
      }
      break
    }

    const entry = prompts[i]!
    const promptStart = Date.now()
    const outputPath = defaultBriefPath(
      join(homedir(), 'Research', 'debates'),
      entry.question,
    )

    try {
      const result = await runDebateFromToolContext({
        question: entry.question,
        contextFiles: [],
        outputPath,
        toolUseContext: context,
        canUseTool: context.canUseTool,
        setMessages: context.setMessages,
      })

      let briefPath: string | undefined
      try {
        briefPath = writeBrief({ outputPath, result })
      } catch {
        // Brief was generated but writing failed — telemetry still captured.
        briefPath = undefined
      }

      records.push({
        index: i,
        question: entry.question,
        status: 'completed',
        briefPath,
        durationMs: Date.now() - promptStart,
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      records.push({
        index: i,
        question: entry.question,
        status: 'failed',
        durationMs: Date.now() - promptStart,
        error: errMsg,
      })
      if (!flags.continueOnError) {
        // Mark remaining as skipped and bail out.
        for (let j = i + 1; j < prompts.length; j++) {
          records.push({
            index: j,
            question: prompts[j]!.question,
            status: 'skipped',
            error: 'sweep stopped after earlier failure',
          })
        }
        break
      }
    }

    // Pause between prompts (skip after the very last one).
    if (i < prompts.length - 1 && flags.pauseMs > 0) {
      await sleep(flags.pauseMs)
    }
  }

  // ─── Summary ────────────────────────────────────────────────────────
  const completed = records.filter(r => r.status === 'completed')
  const failed = records.filter(r => r.status === 'failed')
  const skipped = records.filter(r => r.status === 'skipped')
  const totalDuration = Date.now() - sweepStart
  const avgDuration =
    completed.length > 0
      ? completed.reduce((a, r) => a + (r.durationMs ?? 0), 0) / completed.length
      : 0

  const summary: string[] = [
    ...headerLines,
    '',
    `Done in ${fmtDuration(totalDuration)} · ` +
      `${completed.length} ok · ${failed.length} failed · ${skipped.length} skipped`,
    `Avg per /discover: ${fmtDuration(avgDuration)}`,
  ]

  if (failed.length > 0) {
    summary.push('', 'Failures:')
    for (const f of failed.slice(0, 5)) {
      const preview = f.question.length > 80 ? f.question.slice(0, 80) + '…' : f.question
      summary.push(`  [${f.index + 1}] ${preview}`)
      summary.push(`      ${f.error}`)
    }
    if (failed.length > 5) {
      summary.push(`  (and ${failed.length - 5} more)`)
    }
  }

  summary.push(
    '',
    `Next: distill briefs into training data with:`,
    `  cd ~/Research/council-specialists && \\`,
    `    python data/council_synthetic.py --domain <domain> \\`,
    `      --output data/raw/council_synthetic_<domain>.jsonl`,
  )

  return { type: 'text', value: summary.join('\n') }
}
