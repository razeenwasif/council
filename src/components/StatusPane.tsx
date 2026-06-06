import React from 'react'
import { Box, Text, useTheme } from '../ink.js'
import { getTotalCost } from '../cost-tracker.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'

/**
 * StatusPane — fixed right-column status indicator for wide terminals.
 *
 * Phase 3b of the TUI redesign. Shown alongside the chat area when the
 * terminal width is ≥ STATUS_PANE_MIN_WIDTH and the active theme is
 * `onyx-orange`. Below that threshold, `StatusBar` (Phase 3a) renders
 * instead as a single-line indicator above the prompt.
 *
 * Multi-line content, all live:
 *   $0.18        cost
 *   12.4k tok    cumulative input+output tokens
 *   7m 22s       elapsed (current op only)
 *   3 running    in-flight agent count
 *
 * Layout: a fixed-width column with left border to visually separate
 * from the chat area. Width is STATUS_PANE_WIDTH (see constant below).
 *
 * Sources are the same refs StatusBar reads — no new state.
 */

/** Visible columns including border + padding. */
export const STATUS_PANE_WIDTH = 22
/** Minimum terminal width to show the pane (otherwise StatusBar wins). */
export const STATUS_PANE_MIN_WIDTH = 120

export type StatusPaneProps = {
  isLoading: boolean
  loadingStartMs: number
  pausedMs: number
  pauseStartMs: number | null
  runningAgentCount: number
  /** Cumulative input tokens for the session. 0 when unknown. */
  inputTokens?: number
  /** Cumulative output tokens for the session. 0 when unknown. */
  outputTokens?: number
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

function formatCost(usd: number): string {
  if (usd < 0.01) return '$0.00'
  if (usd < 10) return `$${usd.toFixed(2)}`
  return `$${usd.toFixed(1)}`
}

function useSecondTick(active: boolean): void {
  const [, setTick] = React.useState(0)
  React.useEffect(() => {
    if (!active) return
    const id = setInterval(() => setTick(t => (t + 1) % 60), 1000)
    return () => clearInterval(id)
  }, [active])
}

export function StatusPane({
  isLoading,
  loadingStartMs,
  pausedMs,
  pauseStartMs,
  runningAgentCount,
  inputTokens = 0,
  outputTokens = 0,
}: StatusPaneProps): React.ReactNode {
  const [themeName] = useTheme()
  const { columns } = useTerminalSize()
  // All hooks unconditional — early returns below.
  useSecondTick(isLoading && loadingStartMs > 0)

  if (themeName !== 'onyx-orange') return null
  if (columns < STATUS_PANE_MIN_WIDTH) return null

  const cost = getTotalCost()
  const now = Date.now()
  const activePause = pauseStartMs !== null ? now - pauseStartMs : 0
  const elapsedMs =
    isLoading && loadingStartMs > 0
      ? Math.max(0, now - loadingStartMs - pausedMs - activePause)
      : 0
  const totalTokens = inputTokens + outputTokens

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      width={STATUS_PANE_WIDTH}
      borderStyle="round"
      borderColor="rgb(255,106,0)"
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      paddingX={1}
    >
      <StatRow label="cost" value={formatCost(cost)} highlight />
      {totalTokens > 0 && <StatRow label="tokens" value={formatTokens(totalTokens)} />}
      {isLoading && elapsedMs > 0 && <StatRow label="elapsed" value={formatElapsed(elapsedMs)} />}
      {runningAgentCount > 0 && <StatRow label="running" value={`${runningAgentCount}`} />}
    </Box>
  )
}

function StatRow({
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
      <Text color="subtle" dimColor>
        {label}
      </Text>
      <Text color={highlight ? 'rgb(255,106,0)' : 'text'} bold={highlight}>
        {value}
      </Text>
    </Box>
  )
}
