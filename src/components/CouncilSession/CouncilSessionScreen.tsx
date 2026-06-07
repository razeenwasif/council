import React from 'react'
import { Box, Text } from '../../ink.js'
import { SessionCommand } from './SessionCommand.js'
import { SessionStatus } from './SessionStatus.js'
import { StagePane } from './StagePane.js'
import type { SessionState } from './types.js'
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
 *   ≥120 cols  three columns (voices · current · status)
 *   80-119     single column with voice bar collapsed to a header line
 *   <80        returns null; caller should render the regular REPL
 *
 * Phase A renders from a static SessionState (the preview script
 * supplies a hard-coded mock). Phase B replaces the static state with
 * a useSessionState() hook subscribing to orchestrator events.
 */
export type CouncilSessionScreenProps = {
  session: SessionState
  /** Total terminal width. We compute pane widths from this. */
  terminalColumns: number
  /** Current command buffer (used by SessionCommand). Phase A: ''. */
  commandValue?: string
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

  const focusedVoice = session.voices[session.focusedVoiceIndex] ?? session.voices[0] ?? null
  const runningVoices = session.voices.filter(v => v.status === 'running').map(v => v.role)
  const centerTitle = focusedVoice
    ? `current — ${focusedVoice.role} (${focusedVoice.model})`
    : 'current'

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
        kind={session.kind}
        prompt={session.prompt}
        stage={session.stage}
        availableColumns={interiorWidth}
      />
      {isWide ? (
        <Box flexDirection="row" flexGrow={1} backgroundColor={BG}>
          <Box
            width={VOICE_LIST_WIDTH}
            borderStyle="round"
            borderColor={ACCENT}
            backgroundColor={BG}
            flexDirection="column"
            borderText={paneTitle('voices')}
          >
            <VoiceList
              voices={session.voices}
              focusedIndex={session.focusedVoiceIndex}
              availableColumns={paneInner(VOICE_LIST_WIDTH)}
            />
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
              stage={session.stage}
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
              status={session.status}
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
              voices={session.voices}
              focusedIndex={session.focusedVoiceIndex}
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
              stage={session.stage}
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
              status={session.status}
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
  const title = kind === 'council' ? 'council session' : 'discover session'
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
