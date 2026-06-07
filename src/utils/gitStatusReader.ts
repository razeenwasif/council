/**
 * Git status poller — a singleton that runs `git status --porcelain=v1
 * --branch` every few seconds and pushes parsed snapshots to subscribers.
 *
 * Drives both the GitStatusPane (counts + branch + ahead/behind) and the
 * FilesTouchedPane (per-file status list). One poll powers both.
 *
 * Polling auto-starts when the first subscriber attaches and stops when
 * the last one detaches — so when the session view isn't mounted, no
 * subprocess work runs.
 *
 * "Files touched" here means "files currently dirty per git" — that
 * includes pre-existing uncommitted changes from before this session,
 * not just files edited in this turn. Distinguishing the two would
 * require instrumenting every Edit/Write/Bash; not worth it for a
 * status widget. The git list is the honest answer to "what would I
 * commit right now".
 */
import { execFileNoThrow } from './execFileNoThrow.js'

export type GitFileEntry = {
  /** Two-char porcelain v1 status code, e.g. ` M`, `M `, `??`. */
  status: string
  /** Path relative to the repo root. */
  path: string
}

export type GitStatusSnapshot = {
  inRepo: boolean
  branch: string | null
  ahead: number
  behind: number
  staged: number
  modified: number
  deleted: number
  untracked: number
  files: readonly GitFileEntry[]
}

const EMPTY: GitStatusSnapshot = {
  inRepo: false,
  branch: null,
  ahead: 0,
  behind: 0,
  staged: 0,
  modified: 0,
  deleted: 0,
  untracked: 0,
  files: [],
}

const POLL_INTERVAL_MS = 5000

let current: GitStatusSnapshot = EMPTY
const listeners = new Set<(s: GitStatusSnapshot) => void>()
let pollHandle: ReturnType<typeof setInterval> | null = null
let pollInFlight = false

function notify(): void {
  for (const fn of Array.from(listeners)) {
    try {
      fn(current)
    } catch {
      // listener errors must not break the poll loop
    }
  }
}

function parse(stdout: string): GitStatusSnapshot {
  const out: GitStatusSnapshot = {
    ...EMPTY,
    inRepo: true,
    files: [],
  }
  const files: GitFileEntry[] = []

  for (const line of stdout.split('\n')) {
    if (!line) continue

    if (line.startsWith('## ')) {
      // ## main...origin/main [ahead 2, behind 1]
      // ## main
      // ## HEAD (no branch)
      const head = line.slice(3)
      const tracking = head.indexOf('...')
      const bracket = head.indexOf(' [')
      const branchEnd =
        tracking !== -1
          ? tracking
          : bracket !== -1
            ? bracket
            : head.length
      const branchName = head.slice(0, branchEnd).trim()
      out.branch = branchName || null

      if (bracket !== -1) {
        const meta = head.slice(bracket + 2, head.lastIndexOf(']'))
        const ah = meta.match(/ahead (\d+)/)
        const be = meta.match(/behind (\d+)/)
        if (ah) out.ahead = parseInt(ah[1]!, 10)
        if (be) out.behind = parseInt(be[1]!, 10)
      }
      continue
    }

    if (line.length < 3) continue
    const status = line.slice(0, 2)
    const path = line.slice(3)
    files.push({ status, path })

    if (status === '??') {
      out.untracked++
      continue
    }
    const x = status[0]!
    const y = status[1]!
    if (x !== ' ' && x !== '?') out.staged++
    if (y === 'M') out.modified++
    if (y === 'D' || x === 'D') out.deleted++
  }

  out.files = files
  return out
}

async function poll(): Promise<void> {
  if (pollInFlight) return
  pollInFlight = true
  try {
    const { stdout, code } = await execFileNoThrow(
      'git',
      ['--no-optional-locks', 'status', '--porcelain=v1', '--branch'],
      { preserveOutputOnError: false },
    )
    if (code !== 0) {
      if (current.inRepo) {
        current = EMPTY
        notify()
      }
      return
    }
    const next = parse(stdout)
    if (snapshotChanged(current, next)) {
      current = next
      notify()
    }
  } catch {
    if (current.inRepo) {
      current = EMPTY
      notify()
    }
  } finally {
    pollInFlight = false
  }
}

function snapshotChanged(a: GitStatusSnapshot, b: GitStatusSnapshot): boolean {
  if (
    a.inRepo !== b.inRepo ||
    a.branch !== b.branch ||
    a.ahead !== b.ahead ||
    a.behind !== b.behind ||
    a.staged !== b.staged ||
    a.modified !== b.modified ||
    a.deleted !== b.deleted ||
    a.untracked !== b.untracked ||
    a.files.length !== b.files.length
  ) {
    return true
  }
  for (let i = 0; i < a.files.length; i++) {
    const fa = a.files[i]!
    const fb = b.files[i]!
    if (fa.status !== fb.status || fa.path !== fb.path) return true
  }
  return false
}

function startPolling(): void {
  if (pollHandle) return
  void poll()
  pollHandle = setInterval(() => void poll(), POLL_INTERVAL_MS)
}

function stopPolling(): void {
  if (pollHandle) {
    clearInterval(pollHandle)
    pollHandle = null
  }
}

export function getGitStatusSnapshot(): GitStatusSnapshot {
  return current
}

export function subscribeGitStatus(
  fn: (s: GitStatusSnapshot) => void,
): () => void {
  if (listeners.size === 0) startPolling()
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0) stopPolling()
  }
}
