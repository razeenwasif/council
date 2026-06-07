/**
 * Scratchpad — a small file-backed note store the user appends to via the
 * `/note` slash command. Renders in a dedicated pane below the status
 * pane in the council session view. Module-level singleton because
 * there's only one session view per process; mirrors the sessionBus
 * pattern.
 *
 * Persistence:
 *   - Backing file: ~/.openclaude/scratchpad.json
 *   - Loaded synchronously on module init (small file, runs once).
 *   - Saved synchronously on every append/clear via atomic
 *     write-to-tmp + rename so a kill mid-write can't corrupt the file.
 *   - A malformed file is preserved as scratchpad.json.bak before the
 *     store falls back to empty, so the user can hand-recover.
 *
 * I/O errors are swallowed — a write failure must never crash the UI.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { getClaudeConfigHomeDir } from './envUtils.js'

const FILE_NAME = 'scratchpad.json'
const SCHEMA_VERSION = 1

type Persisted = {
  version: number
  notes: string[]
}

function filePath(): string {
  return join(getClaudeConfigHomeDir(), FILE_NAME)
}

function load(): string[] {
  const path = filePath()
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Persisted>
    if (Array.isArray(parsed?.notes)) {
      return parsed.notes.filter((n): n is string => typeof n === 'string')
    }
  } catch {
    // fall through to .bak rescue
  }
  // File exists but couldn't be parsed — keep it under .bak so notes
  // aren't silently wiped on a one-off corruption.
  try {
    renameSync(path, `${path}.bak`)
  } catch {
    // best-effort
  }
  return []
}

function save(current: string[]): void {
  try {
    const dir = getClaudeConfigHomeDir()
    mkdirSync(dir, { recursive: true })
    const path = filePath()
    const tmp = `${path}.tmp`
    const body: Persisted = { version: SCHEMA_VERSION, notes: current }
    writeFileSync(tmp, JSON.stringify(body, null, 2), 'utf8')
    renameSync(tmp, path)
  } catch {
    // Persistence is best-effort — the in-memory copy still works.
  }
}

let notes: string[] = load()
const listeners = new Set<(notes: string[]) => void>()

function notify(): void {
  for (const fn of Array.from(listeners)) {
    try {
      fn(notes)
    } catch {
      // Never let a listener error break the slash-command emit.
    }
  }
}

export function appendNote(note: string): void {
  notes = [...notes, note]
  save(notes)
  notify()
}

export function clearNotes(): void {
  if (notes.length === 0) return
  notes = []
  save(notes)
  notify()
}

export function getNotes(): readonly string[] {
  return notes
}

export function subscribe(fn: (notes: string[]) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
