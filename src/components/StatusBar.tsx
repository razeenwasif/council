import React from 'react'
import { Box, Text, useTheme } from '../ink.js'
import { getTotalCost } from '../cost-tracker.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'

/**
 * StatusBar — collapsed single-line status indicator shown above the prompt
 * area when the active theme is `onyx-orange`.
 *
 * Per `TUI_REDESIGN.md` §9 Q5: at narrow widths the right-column status pane
 * collapses to one line showing `cost · elapsed · agent-progress`. This is
 * Phase 3a — the collapsed mode only. Phase 3b adds the full side pane (wide
 * mode) once the FullscreenLayout integration is validated.
 *
 * Render order in the bar:
 *   ▎ $0.18 · 7m 22s · 3/7 running
 *
 * Hidden entirely when terminal width < 60 cols (extreme narrow).
 */
export type StatusBarProps = {
  /** When true, the elapsed timer is active. Otherwise hidden. */
  isLoading: boolean
  /** Epoch ms when the current loading op started. 0 means not started. */
  loadingStartMs: number
  /** Accumulated paused milliseconds (subtracted from elapsed). */
  pausedMs: number
  /** Epoch ms when the current pause started. null means not paused. */
  pauseStartMs: number | null
  /** Count of agents currently in-flight (tool_use_ids with no result yet). */
  runningAgentCount: number
  /** Total agents spawned in the current run. Undefined when no run is active. */
  totalAgentCount?: number
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

/**
 * Lightweight tick hook — re-renders every second while `active` is true.
 * Used so the elapsed timer updates without subscribing the whole component
 * tree to a global animation frame.
 */
function useSecondTick(active: boolean): void {
  const [, setTick] = React.useState(0)
  React.useEffect(() => {
    if (!active) return
    const id = setInterval(() => setTick(t => (t + 1) % 60), 1000)
    return () => clearInterval(id)
  }, [active])
}

export function StatusBar({
  isLoading,
  loadingStartMs,
  pausedMs,
  pauseStartMs,
  runningAgentCount,
  totalAgentCount,
}: StatusBarProps): React.ReactNode {
  const [themeName] = useTheme()
  const { columns } = useTerminalSize()
  // Hooks first, unconditional — early returns below would otherwise
  // skip the tick subscription and trip React's rules-of-hooks check
  // when the theme switches at runtime.
  useSecondTick(isLoading && loadingStartMs > 0)

  // Theme-gated: only render on onyx-orange. Other themes get the upstream
  // layout untouched.
  if (themeName !== 'onyx-orange') return null

  // Extreme narrow — bail rather than truncate to noise.
  if (columns < 60) return null

  const cost = getTotalCost()
  const now = Date.now()
  const activePause = pauseStartMs !== null ? now - pauseStartMs : 0
  const elapsedMs =
    isLoading && loadingStartMs > 0
      ? Math.max(0, now - loadingStartMs - pausedMs - activePause)
      : 0

  const segments: string[] = []
  segments.push(formatCost(cost))
  if (isLoading && elapsedMs > 0) segments.push(formatElapsed(elapsedMs))
  if (runningAgentCount > 0 && totalAgentCount && totalAgentCount > 0) {
    segments.push(`${runningAgentCount}/${totalAgentCount} running`)
  } else if (runningAgentCount > 0) {
    segments.push(`${runningAgentCount} running`)
  }

  return (
    <Box width="100%" paddingLeft={1}>
      <Text color="rgb(255,106,0)">▎ </Text>
      <Text color="inactive" dimColor>
        {segments.join(' · ')}
      </Text>
    </Box>
  )
}
