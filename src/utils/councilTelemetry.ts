/**
 * Council telemetry — append-only JSONL log of every council/discover
 * orchestrator run. One line per record, schema below.
 *
 * Storage: ~/.openclaude/council-runs.jsonl (resolved via
 * getClaudeConfigHomeDir()). Mirrors the existing usage.jsonl pattern.
 *
 * Lifecycle:
 *   - Records are emitted by `councilTelemetryCollector` (a session-bus
 *     subscriber) when the orchestrator fires `session-end`.
 *   - Records are updated in-place via `updateRun()` when the user runs
 *     `/verdict outcome` or `/verdict verify` to attach outcome labels
 *     or verification verdicts. updateRun rewrites the entire file —
 *     fine at single-user scale, would need locking for multi-process.
 *
 * Why this exists:
 *   - Phase 1 of the "self-improving council" plan (BACKLOG P4).
 *   - For the user's research thesis, this is the data substrate that
 *     pairs each council run with a verification verdict (their own,
 *     or one I provided externally). The aggregated dataset answers
 *     "for prompt class X and routing Y, what's the verification rate?"
 *     — exactly the kind of evaluation metric the paper needs.
 *
 * Best-effort persistence: a write failure must not crash the
 * orchestrator. All async functions swallow errors.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'

import { getClaudeConfigHomeDir } from './envUtils.js'

const FILE_NAME = 'council-runs.jsonl'
const SCHEMA_VERSION = 1

const VOICE_OUTPUT_PREVIEW_CHARS = 500
const STAGE_CONTENT_CHAR_CAP = 50_000
const RESULT_CHAR_CAP = 50_000

export type VoiceStatusLite =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'paused'

export type VoiceRecord = {
  role: string
  model: string
  status: VoiceStatusLite
  headline: string
  /** Full character count of accumulated output (not capped). */
  outputLen: number
  /** First N chars of output for human browsing of the JSONL. Beyond
   *  N characters the field is truncated with `…`. The full output
   *  is NOT stored — would bloat the log; the orchestrator's chat
   *  scrollback / agent-thoughts pane is the canonical surface. */
  outputPreview: string
}

export type OutcomeLabel =
  | 'accepted'
  | 'rejected'
  | 'partial'
  | 'needed-manual-fix'

export type OutcomeRecord = {
  label: OutcomeLabel
  setAt: string
  notes?: string
}

export type VerificationVerdict = 'correct' | 'partial' | 'incorrect'

export type VerificationRecord = {
  /** 'human' for the user typing `/verdict verify ...`; a model id
   *  (e.g. 'claude-opus-4-7') for programmatic verification later. */
  verifier: string
  timestamp: string
  verdict: VerificationVerdict
  notes: string
  /** Optional tags: ['factual', 'depth', 'format', 'security'] — what
   *  the verifier specifically checked. */
  aspectsChecked?: string[]
}

export type CouncilRunRecord = {
  schemaVersion: number
  runId: string
  timestamp: string
  kind: 'council' | 'discover'
  prompt: string
  /** sha-256 truncated to 16 hex chars. Useful later for clustering
   *  by prompt similarity without storing the full text twice. */
  promptHash: string
  voices: VoiceRecord[]
  /** Synthesis + execution stage text (capped). Discover sessions
   *  use these for the synthesist brief; council sessions for
   *  the synthesizer plan and executor diff. */
  stageContent: {
    synthesis?: string
    execution?: string
  }
  /** Final emit from session-end (the brief or diff string), capped. */
  result?: { brief?: string; diff?: string }
  totalDurationMs: number
  /** Set later via `/verdict outcome ...`. */
  outcome?: OutcomeRecord
  /** Appended to via `/verdict verify ...`. */
  verifications: VerificationRecord[]
}

export function getTelemetryPath(): string {
  return join(getClaudeConfigHomeDir(), FILE_NAME)
}

export function hashPrompt(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 16)
}

export function newRunId(): string {
  return randomUUID()
}

export function buildRecord(args: {
  kind: 'council' | 'discover'
  prompt: string
  voices: Array<{ role: string; model: string }>
}): CouncilRunRecord {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: newRunId(),
    timestamp: new Date().toISOString(),
    kind: args.kind,
    prompt: args.prompt,
    promptHash: hashPrompt(args.prompt),
    voices: args.voices.map(v => ({
      role: v.role,
      model: v.model,
      status: 'pending',
      headline: '',
      outputLen: 0,
      outputPreview: '',
    })),
    stageContent: {},
    totalDurationMs: 0,
    verifications: [],
  }
}

/** Truncate a string for storage with a trailing ellipsis marker. */
export function cap(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max - 1) + '…'
}

export function setVoicePreview(record: VoiceRecord, fullText: string): void {
  record.outputLen = fullText.length
  record.outputPreview = cap(fullText, VOICE_OUTPUT_PREVIEW_CHARS)
}

export function capStageContent(record: CouncilRunRecord): void {
  if (record.stageContent.synthesis) {
    record.stageContent.synthesis = cap(record.stageContent.synthesis, STAGE_CONTENT_CHAR_CAP)
  }
  if (record.stageContent.execution) {
    record.stageContent.execution = cap(record.stageContent.execution, STAGE_CONTENT_CHAR_CAP)
  }
  if (record.result?.brief) {
    record.result.brief = cap(record.result.brief, RESULT_CHAR_CAP)
  }
  if (record.result?.diff) {
    record.result.diff = cap(record.result.diff, RESULT_CHAR_CAP)
  }
}

export async function appendRun(record: CouncilRunRecord): Promise<void> {
  try {
    mkdirSync(getClaudeConfigHomeDir(), { recursive: true })
    await appendFile(getTelemetryPath(), JSON.stringify(record) + '\n', 'utf8')
  } catch {
    // best-effort
  }
}

export async function readAllRuns(): Promise<CouncilRunRecord[]> {
  try {
    const path = getTelemetryPath()
    if (!existsSync(path)) return []
    const content = await readFile(path, 'utf8')
    const out: CouncilRunRecord[] = []
    for (const line of content.split('\n')) {
      if (!line.trim()) continue
      try {
        out.push(JSON.parse(line) as CouncilRunRecord)
      } catch {
        // skip malformed lines silently
      }
    }
    return out
  } catch {
    return []
  }
}

export async function getMostRecentRun(): Promise<CouncilRunRecord | null> {
  const runs = await readAllRuns()
  return runs.length > 0 ? runs[runs.length - 1]! : null
}

/**
 * Mutate a run in place by runId. Rewrites the entire file (acceptable
 * at single-user scale; would need atomic-rename + locking for any
 * concurrent writers).
 */
export async function updateRun(
  runId: string,
  mutator: (r: CouncilRunRecord) => CouncilRunRecord,
): Promise<boolean> {
  const runs = await readAllRuns()
  const idx = runs.findIndex(r => r.runId === runId)
  if (idx === -1) return false
  runs[idx] = mutator(runs[idx]!)
  try {
    const out = runs.map(r => JSON.stringify(r)).join('\n') + '\n'
    await writeFile(getTelemetryPath(), out, 'utf8')
    return true
  } catch {
    return false
  }
}
