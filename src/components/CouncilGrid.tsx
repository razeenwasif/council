import * as React from 'react'
import { getCouncilVendorBadge } from '../coordinator/council/vendorBadge.js'
import { Box, Text } from '../ink.js'
import { formatNumber } from '../utils/format.js'
import type { Theme } from '../utils/theme.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'

/**
 * Grid layout for the council agent panel.
 *
 * The default openclaude layout stacks `AgentProgressLine` rows vertically
 * — 2 lines per agent × 7 voices = 14 rows. Fine, but you can't see all
 * voices at once and lateral comparison is awkward. The grid puts 2 or 3
 * agents per row instead, with the same vendor badge + status content
 * compressed into a single cell.
 *
 * Layout selection is width-driven (read via `useTerminalSize`):
 *   - ≥180 cols: 3-column grid
 *   - ≥100 cols: 2-column grid
 *   - <100 cols: falls back to the existing stacked rendering
 *
 * Activation: see `shouldUseCouncilGrid(...)` — gated on council mode +
 * agent count to avoid disrupting non-council sub-agent renders.
 */

type AgentActivity =
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; text: string }

export interface CouncilGridAgent {
  id: string
  agentType: string
  description?: string
  name?: string
  descriptionColor?: keyof Theme
  taskDescription?: string
  toolUseCount: number
  tokens: number | null
  color?: keyof Theme
  isResolved: boolean
  isError: boolean
  isAsync?: boolean
  lastActivity?: AgentActivity | null
}

// Width budget per cell (rough): subtract 2 chars for inter-column gap,
// then divide by column count. Inside each cell, the badge+role header
// takes ~22 chars; remaining is for the thinking/tool text.
const COL_GAP_CHARS = 2
const HEADER_RESERVE_CHARS = 22

function pickColumnCount(terminalCols: number): 1 | 2 | 3 {
  if (terminalCols >= 180) return 3
  if (terminalCols >= 100) return 2
  return 1
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 1) + '…'
}

interface GridCellProps {
  agent: CouncilGridAgent
  cellWidth: number
  shouldAnimate: boolean
}

function GridCell({ agent, cellWidth, shouldAnimate }: GridCellProps) {
  const badge = getCouncilVendorBadge(agent.agentType)
  const statusBudget = Math.max(8, cellWidth - HEADER_RESERVE_CHARS)
  const isBackgrounded = agent.isAsync && agent.isResolved

  // Row 1: badge + role + counts (or task description for backgrounded).
  const counts = !isBackgrounded
    ? ` · ${agent.toolUseCount}u${agent.tokens !== null ? ` · ${formatNumber(agent.tokens)}t` : ''}`
    : ''

  // Row 2: status — thinking text, tool info, "Initializing…", "Done",
  // or task description for backgrounded async agents.
  let statusText = ''
  let statusKind: 'thinking' | 'tool' | 'static' = 'static'
  if (!agent.isResolved) {
    if (agent.lastActivity?.kind === 'thinking') {
      statusText = truncate(agent.lastActivity.text, statusBudget)
      statusKind = 'thinking'
    } else if (agent.lastActivity?.kind === 'tool') {
      statusText = truncate(agent.lastActivity.text, statusBudget)
      statusKind = 'tool'
    } else {
      statusText = 'Initializing…'
    }
  } else if (isBackgrounded) {
    statusText = truncate(
      agent.taskDescription ?? 'Running in the background',
      statusBudget,
    )
  } else {
    statusText = 'Done'
  }

  return (
    <Box flexDirection="column" width={cellWidth} paddingRight={COL_GAP_CHARS / 2}>
      <Box>
        {badge && (
          <Text color={badge.color}>
            {badge.glyph}
            {' '}
          </Text>
        )}
        <Text bold dimColor={!agent.isResolved}>
          {agent.agentType}
        </Text>
        {!isBackgrounded && <Text dimColor>{counts}</Text>}
      </Box>
      <Box>
        {statusKind === 'thinking' && badge ? (
          <Text color={badge.color}>›{' '}</Text>
        ) : (
          <Text dimColor>›{' '}</Text>
        )}
        <Text
          dimColor
          italic={statusKind === 'thinking'}
        >
          {statusText}
        </Text>
      </Box>
    </Box>
  )
}

export interface CouncilGridProps {
  agents: CouncilGridAgent[]
  shouldAnimate: boolean
}

export function CouncilGrid({ agents, shouldAnimate }: CouncilGridProps) {
  const { columns: terminalCols } = useTerminalSize()
  const colCount = pickColumnCount(terminalCols)

  // Fallback path: ≤100-col terminals don't get the grid. Caller should
  // route narrow terminals through `CouncilOrStacked` so the stacked
  // fallback renders instead; this component returns null defensively.
  if (colCount === 1) return null

  const cellWidth = Math.max(
    HEADER_RESERVE_CHARS + 10,
    Math.floor((terminalCols - 4) / colCount),
  )

  // Chunk agents into rows.
  const rows: CouncilGridAgent[][] = []
  for (let i = 0; i < agents.length; i += colCount) {
    rows.push(agents.slice(i, i + colCount))
  }

  return (
    <Box flexDirection="column" paddingLeft={2} marginTop={1}>
      {rows.map((row, rowIdx) => (
        <Box
          // Visual separator between rows — small marginBottom on all but
          // the last row.
          marginBottom={rowIdx < rows.length - 1 ? 1 : 0}
          flexDirection="row"
          key={rowIdx}
        >
          {row.map(agent => (
            <GridCell
              agent={agent}
              cellWidth={cellWidth}
              shouldAnimate={shouldAnimate}
              key={agent.id}
            />
          ))}
        </Box>
      ))}
    </Box>
  )
}

/**
 * Wrapper that picks the right layout per render. Use this from
 * non-component render functions — it consolidates the width check + the
 * shouldUseCouncilGrid check so callers don't have to reason about
 * either. When the grid can't be used (non-council, too few agents, or
 * narrow terminal), renders `stackedFallback` as-is.
 */
export interface CouncilOrStackedProps {
  agents: CouncilGridAgent[]
  shouldAnimate: boolean
  /** What to render when the grid is not used (existing stacked rows). */
  stackedFallback: React.ReactNode
}

export function CouncilOrStacked({
  agents,
  shouldAnimate,
  stackedFallback,
}: CouncilOrStackedProps) {
  const { columns: terminalCols } = useTerminalSize()
  const wide = pickColumnCount(terminalCols) > 1
  if (!wide || !shouldUseCouncilGrid(agents.map(a => a.agentType))) {
    return <>{stackedFallback}</>
  }
  return <CouncilGrid agents={agents} shouldAnimate={shouldAnimate} />
}

/**
 * Decide whether to use the grid layout for a given agent group. Returns
 * true only when council mode is on AND the group has enough agents to
 * benefit (5+) AND the terminal is wide enough. Caller falls back to the
 * stacked layout otherwise.
 *
 * Council-mode detection uses the agent-type heuristic rather than env
 * vars — that way the grid kicks in when council agents are present
 * regardless of whether council mode was technically set, which is what
 * users actually want.
 */
export function shouldUseCouncilGrid(agentTypes: string[]): boolean {
  if (agentTypes.length < 5) return false
  // Count agents whose type maps to a council vendor badge — if most of
  // them are council members, use the grid.
  const councilCount = agentTypes.filter(t => getCouncilVendorBadge(t) !== null)
    .length
  return councilCount >= 5
}
