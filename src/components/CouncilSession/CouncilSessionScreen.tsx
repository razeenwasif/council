import React from 'react'
import { Box, Text } from '../../ink.js'
import { SessionCommand } from './SessionCommand.js'
import { SessionStatus } from './SessionStatus.js'
import { StagePane } from './StagePane.js'
import {
  COUNCIL_VOICE_ROLES,
  DISCOVER_VOICE_ROLES,
  type SessionState,
  type Voice,
} from './types.js'
import { VoiceList } from './VoiceList.js'

/**
 * Top-level screen for council/discover sessions.
 *
 * Owns the entire layout end-to-end. Width handling is the load-bearing
 * design choice (see COUNCIL_MODE_REDESIGN.md §5):
 *
 *   Every child receives an explicit `availableColumns` prop. No child
 *   ever calls useTerminalSize(). This is the rule that lets the
 *   multi-pane layout work without the wrap bug that killed Phase 3b.
 *
 * Width-responsive layout:
 *
 *   ≥120 cols  three columns (left stack · center · status)
 *   80-119     single column with voice bar collapsed to a header line
 *   <80        returns null; caller should render the regular REPL
 *
 * Phase C: layout reframed per user feedback (2026-06-07). Left column
 * is now two stacked voice panes (council on top, discover below) —
 * BOTH always visible regardless of which mode is active. When a
 * council session is running, council voices light up live; discover
 * stays in pending state. Same the other way for /discover.
 *
 * Idle state (`session === null`): both lists render with canonical
 * role names in pending status. The center pane shows the chat content
 * (slot) when present. The voice-output sub-pane only renders during
 * active sessions — this is C.2b work; C.2a (current commit) just sets
 * up the stacked-left structure.
 */
export type CouncilSessionScreenProps = {
  /** Active session or null at idle. */
  session: SessionState | null
  /** Total terminal width. We compute pane widths from this. */
  terminalColumns: number
  /** Current command buffer (used by SessionCommand). C.2a default: ''. */
  commandValue?: string
}

/** Build an idle Voice array for a given mode — all roles in pending status. */
function idleVoicesFor(mode: 'council' | 'discover'): Voice[] {
  const roles = mode === 'council' ? COUNCIL_VOICE_ROLES : DISCOVER_VOICE_ROLES
  return roles.map(role => ({
    role,
    model: '', // model unknown until the spawn fires
    status: 'pending',
    headline: '',
    output: '',
  }))
}

const WIDE_THRESHOLD = 120
const NARROW_THRESHOLD = 80
/** Outer (pane-level) width including the pane's own borderStyle="round". */
const VOICE_LIST_WIDTH = 18
const STATUS_WIDTH = 24
/** Outer-screen chrome: borderL + borderR + paddingL + paddingR = 4. */
const OUTER_CHROME = 4

const ACCENT = 'rgb(255,106,0)'
/** Onyx `obsidian_dark` bg — #1e1e24 ≈ rgb(30,30,36). Matches what the
 *  user's Onyx config (theme = "dark") uses. Slight cool tint (B=36 vs
 *  R=G=30), but with the orange borders + accents on top, the overall
 *  composition reads as the orange-themed Onyx variant. */
const BG = 'rgb(30,30,36)'

/** Width *inside* a pane after its round border consumes 1 char each side. */
function paneInner(outerWidth: number): number {
  return Math.max(0, outerWidth - 2)
}

/** borderText config shared by all panes — title text in the top border. */
function paneTitle(content: string) {
  return { content: ` ${content} `, position: 'top' as const, align: 'start' as const, offset: 2 }
}

export function CouncilSessionScreen({
  session,
  terminalColumns,
  commandValue = '',
}: CouncilSessionScreenProps): React.ReactNode {
  if (terminalColumns < NARROW_THRESHOLD) return null

  const isWide = terminalColumns >= WIDE_THRESHOLD
  const interiorWidth = terminalColumns - OUTER_CHROME
  // Center pane outer width (including its own round border).
  const centerOuter = isWide
    ? interiorWidth - VOICE_LIST_WIDTH - STATUS_WIDTH
    : interiorWidth

  // Resolve voices for both panes. When session is active and matches the
  // mode, use live voices; otherwise pending placeholders from the
  // canonical role list. This implements §9 Q3 of PHASE_C_PLAN: both
  // lists always visible; only the active mode's pane shows live status.
  const councilVoices: readonly Voice[] =
    session?.kind === 'council' ? session.voices : idleVoicesFor('council')
  const discoverVoices: readonly Voice[] =
    session?.kind === 'discover' ? session.voices : idleVoicesFor('discover')

  // Focus indices: -1 for the inactive mode so its pane shows no `▸`.
  const councilFocusedIndex =
    session?.kind === 'council' ? session.focusedVoiceIndex : -1
  const discoverFocusedIndex =
    session?.kind === 'discover' ? session.focusedVoiceIndex : -1

  const focusedVoice = session
    ? session.voices[session.focusedVoiceIndex] ?? session.voices[0] ?? null
    : null
  const runningVoices = session
    ? session.voices.filter(v => v.status === 'running').map(v => v.role)
    : []
  const centerTitle = focusedVoice
    ? `current — ${focusedVoice.role} (${focusedVoice.model})`
    : 'chat'

  // Idle: no elapsed timer + cumulative cost (handled by SessionStatus
  // when status.startMs === 0). At idle we synthesize a status block.
  const status = session?.status ?? {
    costUsd: 0, // SessionStatus reads getTotalCost() so this is fine
    totalTokens: 0,
    startMs: 0,
    totalAgents: 0,
    runningAgents: 0,
  }
  const stage = session?.stage ?? 'idle'
  const promptSummary = session?.prompt ?? 'ready'
  const kind: 'council' | 'discover' = session?.kind ?? 'council'

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={ACCENT}
      backgroundColor={BG}
      flexGrow={1}
      width={terminalColumns}
      paddingX={1}
    >
      <TopBar
        kind={kind}
        prompt={promptSummary}
        stage={stage}
        availableColumns={interiorWidth}
      />
      {isWide ? (
        <Box flexDirection="row" flexGrow={1} backgroundColor={BG}>
          {/* Left column: stacked council + discover voice panes. Both
              always visible per §9 Q3 of PHASE_C_PLAN. The active mode's
              pane shows live status; the other stays in pending. */}
          <Box width={VOICE_LIST_WIDTH} flexDirection="column">
            <Box
              borderStyle="round"
              borderColor={ACCENT}
              backgroundColor={BG}
              flexDirection="column"
              borderText={paneTitle('council')}
            >
              <VoiceList
                voices={councilVoices}
                focusedIndex={councilFocusedIndex}
                availableColumns={paneInner(VOICE_LIST_WIDTH)}
                mode="council"
              />
            </Box>
            <Box
              borderStyle="round"
              borderColor={ACCENT}
              backgroundColor={BG}
              flexDirection="column"
              borderText={paneTitle('discover')}
            >
              <VoiceList
                voices={discoverVoices}
                focusedIndex={discoverFocusedIndex}
                availableColumns={paneInner(VOICE_LIST_WIDTH)}
                mode="discover"
              />
            </Box>
          </Box>
          <Box
            flexGrow={1}
            borderStyle="round"
            borderColor={ACCENT}
            backgroundColor={BG}
            flexDirection="column"
            borderText={paneTitle(centerTitle)}
          >
            <StagePane
              stage={stage}
              focusedVoice={focusedVoice}
              availableColumns={paneInner(centerOuter)}
            />
          </Box>
          <Box
            width={STATUS_WIDTH}
            borderStyle="round"
            borderColor={ACCENT}
            backgroundColor={BG}
            flexDirection="column"
            borderText={paneTitle('status')}
          >
            <SessionStatus
              status={status}
              availableColumns={paneInner(STATUS_WIDTH)}
              runningVoices={runningVoices}
            />
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column" flexGrow={1} backgroundColor={BG}>
          <Box
            borderStyle="round"
            borderColor={ACCENT}
            backgroundColor={BG}
            flexDirection="column"
            borderText={paneTitle('voices')}
          >
            <CollapsedVoiceBar
              voices={councilVoices}
              focusedIndex={councilFocusedIndex >= 0 ? councilFocusedIndex : 0}
              availableColumns={paneInner(interiorWidth)}
            />
          </Box>
          <Box
            borderStyle="round"
            borderColor={ACCENT}
            backgroundColor={BG}
            flexDirection="column"
            flexGrow={1}
            borderText={paneTitle(centerTitle)}
          >
            <StagePane
              stage={stage}
              focusedVoice={focusedVoice}
              availableColumns={paneInner(interiorWidth)}
            />
          </Box>
          <Box
            borderStyle="round"
            borderColor={ACCENT}
            backgroundColor={BG}
            flexDirection="column"
            borderText={paneTitle('status')}
          >
            <SessionStatus
              status={status}
              availableColumns={paneInner(interiorWidth)}
              runningVoices={runningVoices}
            />
          </Box>
        </Box>
      )}
      <Box
        borderStyle="round"
        borderColor={ACCENT}
        backgroundColor={BG}
        flexDirection="column"
        borderText={paneTitle('command')}
      >
        <SessionCommand value={commandValue} availableColumns={paneInner(interiorWidth)} />
      </Box>
      <HelpBar availableColumns={interiorWidth} />
    </Box>
  )
}

function TopBar({
  kind,
  prompt,
  stage,
  availableColumns,
}: {
  kind: 'council' | 'discover'
  prompt: string
  stage: SessionState['stage']
  availableColumns: number
}): React.ReactNode {
  const isIdle = stage === 'idle'
  // At idle the "session" suffix is misleading — the screen is the
  // chrome, not a session-mode replacement. Drop it when no session.
  const title = isIdle
    ? 'council'
    : kind === 'council'
      ? 'council session'
      : 'discover session'
  // Leave 18 chars for `· stage: <up-to-9>` plus padding.
  const promptBudget = Math.max(10, availableColumns - title.length - 24)
  const promptSummary = prompt.length > promptBudget ? `${prompt.slice(0, promptBudget - 1)}…` : prompt
  return (
    <Box paddingX={1} width={availableColumns}>
      <Text dimColor>{title} · </Text>
      <Text bold>{promptSummary}</Text>
      <Box flexGrow={1} />
      <Text dimColor>stage: </Text>
      <Text color={ACCENT} bold>
        {stage}
      </Text>
    </Box>
  )
}


function CollapsedVoiceBar({
  voices,
  focusedIndex,
  availableColumns,
}: {
  voices: SessionState['voices']
  focusedIndex: number
  availableColumns: number
}): React.ReactNode {
  // Compact horizontal list: "▸ critic · architect ✓ · implementer ✓ · ..."
  const labelMaxLen = Math.max(40, availableColumns - 4)
  let line = ''
  for (let i = 0; i < voices.length; i++) {
    const v = voices[i]!
    if (i > 0) line += ' · '
    const arrow = i === focusedIndex ? '▸ ' : ''
    const glyph =
      v.status === 'done' ? ' ✓' :
      v.status === 'running' ? ' ●' :
      v.status === 'failed' ? ' ✗' :
      v.status === 'paused' ? ' ⏸' :
      ''
    line += `${arrow}${v.role}${glyph}`
    if (line.length > labelMaxLen) {
      line = `${line.slice(0, labelMaxLen - 1)}…`
      break
    }
  }
  return (
    <Box paddingX={1} width={availableColumns}>
      <Text>{line}</Text>
    </Box>
  )
}

function HelpBar({ availableColumns }: { availableColumns: number }): React.ReactNode {
  return (
    <Box paddingX={1} width={availableColumns}>
      <Text dimColor>
        ctrl-c cancel · esc background · tab switch voice · enter focus
      </Text>
    </Box>
  )
}
