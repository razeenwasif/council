import * as React from 'react'
import { getCouncilVendorBadge } from '../coordinator/council/vendorBadge.js'
import { Box, Text } from '../ink.js'
import { formatNumber } from '../utils/format.js'
import type { Theme } from '../utils/theme.js'

/**
 * One row per running / completed sub-agent in the agent-tool group view.
 *
 * Layout (two lines):
 *
 *   ├─ critic (gpt-5.5) · 8 tool uses · 1.2k tokens
 *   │  └ › Worried about locale-dependent grouping — Intl.NumberFormat differs by env…
 *
 * The second line — the "status" — is driven by `lastActivity`:
 *   - kind: 'thinking' → the agent is producing text; show the last
 *     sentence-ish chunk of its reasoning. Rendered italic + dim with a
 *     leading "›" so it is visually distinct from tool calls.
 *   - kind: 'tool'     → the agent is using (or just used) a tool; show
 *     the tool name / arg summary (existing behaviour).
 *   - null             → no progress yet; show "Initializing…".
 *
 * When the agent is resolved, the second line shows "Done" (or the task
 * description for async / backgrounded agents).
 *
 * Note: this component was previously emitted by the React Compiler with
 * memoization cache slots. The compiled form is annoying to extend safely
 * (slot count needs to track every new conditional), so it was rewritten
 * as plain React. The component renders once per agent per progress update
 * — not a hot path; memoization isn't load-bearing here.
 */
type AgentActivity =
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; text: string }

type Props = {
  agentType: string
  description?: string
  name?: string
  descriptionColor?: keyof Theme
  taskDescription?: string
  toolUseCount: number
  tokens: number | null
  color?: keyof Theme
  isLast: boolean
  isResolved: boolean
  isError: boolean
  isAsync?: boolean
  shouldAnimate: boolean
  lastActivity?: AgentActivity | null
  hideType?: boolean
}

export function AgentProgressLine(props: Props) {
  const {
    agentType,
    description,
    name,
    descriptionColor,
    taskDescription,
    toolUseCount,
    tokens,
    color,
    isLast,
    isResolved,
    isAsync = false,
    lastActivity,
    hideType = false,
  } = props

  const treeChar = isLast ? '└─' : '├─'
  const isBackgrounded = isAsync && isResolved
  const statusIndent = isLast ? '   └  ' : '│  └  '
  // Vendor badge for known council roles; null for everything else.
  const badge = getCouncilVendorBadge(agentType)

  // Header: agent type/name + optional description + counts
  const header = hideType ? (
    <>
      <Text bold>{name ?? description ?? agentType}</Text>
      {name && description && <Text dimColor>: {description}</Text>}
    </>
  ) : (
    <>
      <Text
        bold
        backgroundColor={color}
        color={color ? 'inverseText' : undefined}
      >
        {agentType}
      </Text>
      {description && (
        <>
          {' ('}
          <Text
            backgroundColor={descriptionColor}
            color={descriptionColor ? 'inverseText' : undefined}
          >
            {description}
          </Text>
          {')'}
        </>
      )}
    </>
  )

  const counts = !isBackgrounded && (
    <>
      {' · '}
      {toolUseCount} tool {toolUseCount === 1 ? 'use' : 'uses'}
      {tokens !== null && <> · {formatNumber(tokens)} tokens</>}
    </>
  )

  // Second-line status: thinking | tool | initializing | done | running-in-bg
  let statusContent: React.ReactNode
  if (!isResolved) {
    if (lastActivity?.kind === 'thinking') {
      // Tint the leading "›" in the vendor color so the thinking line is
      // visually bound to the row's badge above. Text remains dim+italic.
      statusContent = (
        <>
          {badge ? (
            <Text color={badge.color}>›{' '}</Text>
          ) : (
            <Text dimColor>›{' '}</Text>
          )}
          <Text dimColor italic>
            {lastActivity.text}
          </Text>
        </>
      )
    } else if (lastActivity?.kind === 'tool') {
      statusContent = <Text dimColor>{lastActivity.text}</Text>
    } else {
      statusContent = <Text dimColor>Initializing…</Text>
    }
  } else if (isBackgrounded) {
    statusContent = (
      <Text dimColor>{taskDescription ?? 'Running in the background'}</Text>
    )
  } else {
    statusContent = <Text dimColor>Done</Text>
  }

  return (
    <Box flexDirection="column">
      <Box paddingLeft={3}>
        <Text dimColor>{treeChar} </Text>
        {badge && (
          <Text color={badge.color}>{badge.glyph}{' '}</Text>
        )}
        <Text dimColor={!isResolved}>
          {header}
          {counts}
        </Text>
      </Box>
      {!isBackgrounded && (
        <Box paddingLeft={3} flexDirection="row">
          <Text dimColor>{statusIndent}</Text>
          {statusContent}
        </Box>
      )}
    </Box>
  )
}
