import React from 'react'
import { Box, Text } from '../../ink.js'
import type { SessionStatus as SessionStatusData } from './types.js'

/**
 * Right pane — live cost / tokens / elapsed / active list.
 *
 * Phase A: rendered with mock data via the preview script. Phase B
 * subscribes to live orchestrator events.
 *
 * Width is determined by the parent (CouncilSessionScreen passes a
 * fixed width via flex). All text-wrap calculations should respect
 * `availableColumns` if needed — Phase A's content is all short labels
 * so this isn't a concern yet.
 */
export type SessionStatusProps = {
  status: SessionStatusData
  /** Number of columns the pane was allocated (caller passes via flex). */
  availableColumns: number
  /** Voice roles currently running, for the active list. */
  runningVoices: readonly string[]
}

const ACCENT = 'rgb(255,106,0)'

function formatCost(usd: number): string {
  if (usd < 0.01) return '$0.00'
  if (usd < 10) return `$${usd.toFixed(2)}`
  return `$${usd.toFixed(1)}`
}

function formatTokens(n: number): string {
  if (n < 1000) return `${n}`
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

function formatElapsed(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) return '0s'
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s}s`
}

/**
 * Re-renders every second while a session is active so the elapsed
 * field stays current. Cheap subscription — only this pane re-mounts.
 */
function useSecondTick(active: boolean): void {
  const [, setTick] = React.useState(0)
  React.useEffect(() => {
    if (!active) return
    const id = setInterval(() => setTick(t => (t + 1) % 60), 1000)
    return () => clearInterval(id)
  }, [active])
}

export function SessionStatus({
  status,
  availableColumns,
  runningVoices,
}: SessionStatusProps): React.ReactNode {
  const sessionActive = status.startMs > 0
  useSecondTick(sessionActive)

  const elapsedMs = sessionActive ? Date.now() - status.startMs : 0
  const progress = `${status.runningAgents}/${status.totalAgents} running`

  // Truncate running list to fit the pane width. "  · " is 4 chars per entry.
  const maxNameLen = Math.max(8, availableColumns - 6)
  const trimmedRunning = runningVoices.map(r => (r.length > maxNameLen ? `${r.slice(0, maxNameLen - 1)}…` : r))

  return (
    <Box flexDirection="column" paddingX={1} width={availableColumns}>
      <Row label="cost" value={formatCost(status.costUsd)} highlight />
      {status.totalTokens > 0 && <Row label="tokens" value={formatTokens(status.totalTokens)} />}
      {sessionActive && <Row label="elapsed" value={formatElapsed(elapsedMs)} />}
      <Box marginTop={1} />
      <Row label="progress" value={progress} />
      {trimmedRunning.length > 0 && (
        <>
          <Box marginTop={1}>
            <Text dimColor>active</Text>
          </Box>
          {trimmedRunning.map((r, i) => (
            <Box key={`${r}-${i}`}>
              <Text color={ACCENT}>· </Text>
              <Text>{r}</Text>
            </Box>
          ))}
        </>
      )}
    </Box>
  )
}

function Row({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}): React.ReactNode {
  return (
    <Box flexDirection="row" justifyContent="space-between">
      <Text dimColor>{label}</Text>
      <Text color={highlight ? ACCENT : undefined} bold={highlight}>
        {value}
      </Text>
    </Box>
  )
}
