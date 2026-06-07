import React from 'react'
import { Box, Text } from '../../ink.js'
import type { RefObject } from 'react'
import type { ScrollBoxHandle } from '../../ink/components/ScrollBox.js'
import { ModalContext } from '../../context/modalContext.js'
import { ChatPane } from './ChatPane.js'
import { EffectiveTerminalSizeProvider } from '../../hooks/useEffectiveTerminalSize.js'
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
  /** Total terminal rows. Used to size modal overlays. Defaults to a
   *  generous fallback when not provided (preview-only path). */
  terminalRows?: number
  /** Current command buffer (used by SessionCommand when no `promptContent`
   *  slot is provided — the preview-only path). */
  commandValue?: string
  /** Chat content slot — typically the REPL's `Messages` + spinner +
   *  tool JSX. When provided, renders inside the chat sub-pane wrapped
   *  with `EffectiveTerminalSizeProvider`. When absent, the chat pane
   *  shows a placeholder. */
  chatContent?: React.ReactNode
  /** Prompt content slot — typically the REPL's `PromptInput`. When
   *  provided, renders inside the command pane in place of the static
   *  `SessionCommand` stub. */
  promptContent?: React.ReactNode
  /** Overlay (modal) slot — typically the centered slash-command dialog
   *  (`/theme`, `/spend`, `/help`, etc.). When provided, renders
   *  absolute-positioned at the bottom of the screen, overlaying the
   *  full session view (not just the chat sub-pane). Wrapped with
   *  ModalContext so descendant Pane / Select / Tabs components size
   *  themselves correctly. */
  overlayContent?: React.ReactNode
  /** Scroll-box handle for the modal's internal ScrollBox. Threaded
   *  through ModalContext so Tabs (which owns its own ScrollBox) can
   *  attach it. */
  modalScrollRef?: RefObject<ScrollBoxHandle | null>
  /** Which workspace pane currently owns the live PromptInput. Phase 2
   *  of dual-pane work (2026-06-07). The unfocused pane shows ghost text
   *  for its draft. Defaults to 'council' at idle. */
  focusedPane?: 'council' | 'research'
  /** Draft text of the pane that does NOT currently have focus —
   *  displayed as static ghost text in that pane's input area. The
   *  focused pane's draft is the REPL's live `inputValue` and renders
   *  via `promptContent`. */
  unfocusedDraft?: string
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
/** Outer (pane-level) widths including each pane's own borderStyle="round"
 *  (2 chars for the border + 2 for paddingX = 4 chars chrome per pane).
 *  Bumped from 18/24 → 22/28 in C.3 follow-up so role names like
 *  "performance", "implementer", "methodologist" render without `…`
 *  truncation, and the status pane labels stop squeezing. */
const VOICE_LIST_WIDTH = 22
const STATUS_WIDTH = 28
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

/** Rows reserved at the top of a modal so the user can still see the
 *  last few transcript lines behind it. Mirrors FullscreenLayout's
 *  identically-named constant. */
const MODAL_TRANSCRIPT_PEEK = 2

export function CouncilSessionScreen({
  session,
  terminalColumns,
  terminalRows = 40,
  commandValue = '',
  chatContent,
  promptContent,
  overlayContent,
  modalScrollRef,
  focusedPane = 'council',
  unfocusedDraft = '',
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
  // Phase C.2b: center is split into chat + voice-output sub-panes when
  // a session is active. At idle (Phase D-post-smoke 2026-06-07): center
  // splits into two workspace panes — council (left) hosts the live
  // chat scrollback + PromptInput; research (right) is currently a
  // placeholder, will get its own input + scrollback in Phase 2 of the
  // dual-pane work.
  const isSessionActive = session !== null
  const voiceOutputTitle = focusedVoice
    ? `current — ${focusedVoice.role} (${focusedVoice.model})`
    : 'current'
  // Split math: outer widths of the two sub-panes (each includes its own
  // round border). chat gets floor; voice-output gets the remainder.
  const chatOuterActive = Math.floor(centerOuter / 2)
  const voiceOutputOuter = centerOuter - chatOuterActive
  // Idle dual-pane split: council pane (left) gets floor; research pane
  // (right) gets the remainder.
  const councilPaneOuter = Math.floor(centerOuter / 2)
  const researchPaneOuter = centerOuter - councilPaneOuter

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
          <Box width={VOICE_LIST_WIDTH} flexShrink={0} flexDirection="column">
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
          {/* Center: split into chat sub-pane + voice-output sub-pane
              when a session is active; single chat pane spanning the
              full center at idle. Chat sub-pane wraps its content with
              EffectiveTerminalSizeProvider so word-wrap respects the
              allocated columns. */}
          {isSessionActive ? (
            <Box flexDirection="row" flexGrow={1}>
              <Box
                width={chatOuterActive}
                flexShrink={0}
                borderStyle="round"
                borderColor={ACCENT}
                backgroundColor={BG}
                flexDirection="column"
                borderText={paneTitle('chat')}
              >
                <ChatPane
                  availableColumns={chatOuterActive}
                  chatContent={chatContent}
                />
              </Box>
              <Box
                width={voiceOutputOuter}
                flexShrink={0}
                borderStyle="round"
                borderColor={ACCENT}
                backgroundColor={BG}
                flexDirection="column"
                borderText={paneTitle(voiceOutputTitle)}
              >
                <StagePane
                  stage={stage}
                  focusedVoice={focusedVoice}
                  availableColumns={paneInner(voiceOutputOuter)}
                  synthesisText={session?.stageContent?.synthesis}
                  executionText={session?.stageContent?.execution}
                />
              </Box>
            </Box>
          ) : (
            <Box flexDirection="row" flexGrow={1}>
              <WorkspacePane
                name="council"
                outerWidth={councilPaneOuter}
                focused={focusedPane === 'council'}
                chatContent={chatContent}
                promptContent={promptContent}
                commandValue={commandValue}
                ghostDraft={focusedPane === 'council' ? undefined : unfocusedDraft}
                switchHint="alt-1 to focus"
              />
              <WorkspacePane
                name="research"
                outerWidth={researchPaneOuter}
                focused={focusedPane === 'research'}
                chatContent={chatContent}
                promptContent={promptContent}
                commandValue={commandValue}
                ghostDraft={focusedPane === 'research' ? undefined : unfocusedDraft}
                switchHint="alt-2 to focus"
              />
            </Box>
          )}
          <Box
            width={STATUS_WIDTH}
            flexShrink={0}
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
              synthesisText={session?.stageContent?.synthesis}
              executionText={session?.stageContent?.execution}
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
      {/* Command pane visually aligns with the chat/voice-output area:
          left margin = voice list column width, right margin = status
          pane width. So it sits "under" the center column rather than
          spanning the full screen. Only at wide widths; the collapsed
          narrow layout has no voice list to align to.

          Phase 1 of dual-pane work (2026-06-07): at idle the PromptInput
          lives inside the council workspace pane, so no bottom command
          pane is rendered. During active sessions the bottom command
          pane is preserved (Phase 3 will fold it into per-pane inputs). */}
      {isSessionActive && (
        <Box
          marginLeft={isWide ? VOICE_LIST_WIDTH : 0}
          marginRight={isWide ? STATUS_WIDTH : 0}
          borderStyle="round"
          borderColor={ACCENT}
          backgroundColor={BG}
          flexDirection="column"
          borderText={paneTitle('command')}
        >
          {promptContent ? (
            // REPL slot — its PromptInput already manages its own input.
            // No EffectiveTerminalSizeProvider here because the prompt is
            // a single line; horizontal width matters for input wrap but
            // PromptInput uses its own column-aware logic that respects
            // the flex-allocated width.
            promptContent
          ) : (
            <SessionCommand value={commandValue} availableColumns={paneInner(centerOuter)} />
          )}
        </Box>
      )}
      <HelpBar availableColumns={interiorWidth} />
      {/* Overlay slot — slash-command modals (/theme, /spend, /help)
          render absolute-positioned at the bottom of the OUTER screen.
          Previously these were inside FullscreenLayout's modal slot,
          which is now inside the chat sub-pane — they'd overlay only
          the chat, looking small and off-center. Hoisting to the outer
          Box's coordinate space restores full-screen modal behavior.
          Mirrors FullscreenLayout's ModalContext + absolute wrapping
          (see src/context/modalContext.tsx for the contract). */}
      {overlayContent && (
        <ModalContext
          value={{
            rows: terminalRows - MODAL_TRANSCRIPT_PEEK - 1,
            columns: terminalColumns - 4,
            scrollRef: modalScrollRef ?? null,
          }}
        >
          <Box
            position="absolute"
            bottom={0}
            left={0}
            right={0}
            maxHeight={terminalRows - MODAL_TRANSCRIPT_PEEK}
            flexDirection="column"
            overflow="hidden"
            opaque={true}
            backgroundColor={BG}
          >
            <Box flexShrink={0}>
              <Text color="permission">{'▔'.repeat(terminalColumns)}</Text>
            </Box>
            <Box flexDirection="column" paddingX={2} flexShrink={0} overflow="hidden">
              {overlayContent}
            </Box>
          </Box>
        </ModalContext>
      )}
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
        ctrl-c cancel · esc background · alt-1/alt-2 switch pane · enter focus
      </Text>
    </Box>
  )
}

/**
 * One of the two side-by-side workspace panes at idle (council / research).
 *
 * Focused pane: bright accent border, hosts the chat scrollback (top)
 * and the REPL's live PromptInput (bottom — passed via `promptContent`).
 * Unfocused pane: dimmed border, hosts an empty middle area and a ghost
 * preview of its draft text at the bottom, plus a switch hint.
 *
 * The PromptInput uses `useEffectiveTerminalSize` for its wrap math, so
 * the input slot is wrapped in an `EffectiveTerminalSizeProvider` bounded
 * to this pane's inner width.
 */
function WorkspacePane({
  name,
  outerWidth,
  focused,
  chatContent,
  promptContent,
  commandValue,
  ghostDraft,
  switchHint,
}: {
  name: 'council' | 'research'
  outerWidth: number
  focused: boolean
  chatContent?: React.ReactNode
  promptContent?: React.ReactNode
  commandValue: string
  /** Ghost draft text for the unfocused state. `undefined` when focused. */
  ghostDraft?: string
  switchHint: string
}): React.ReactNode {
  const borderColor = focused ? ACCENT : 'gray'
  const innerWidth = paneInner(outerWidth)
  return (
    <Box
      width={outerWidth}
      flexShrink={0}
      borderStyle="round"
      borderColor={borderColor}
      backgroundColor={BG}
      flexDirection="column"
      borderText={paneTitle(name)}
    >
      <Box flexGrow={1} flexDirection="column">
        {focused ? (
          <ChatPane availableColumns={outerWidth} chatContent={chatContent} />
        ) : (
          <Box paddingX={1} paddingY={1} flexDirection="column" width={innerWidth}>
            <Text dimColor italic>
              [{name} workspace — {switchHint}]
            </Text>
          </Box>
        )}
      </Box>
      {focused && promptContent ? (
        <Box flexShrink={0} flexDirection="column">
          <EffectiveTerminalSizeProvider columns={innerWidth}>
            {promptContent}
          </EffectiveTerminalSizeProvider>
        </Box>
      ) : focused ? (
        <Box flexShrink={0} flexDirection="column" paddingX={1}>
          <SessionCommand value={commandValue} availableColumns={innerWidth} />
        </Box>
      ) : (
        // Unfocused: render a ghost preview of the draft so the user
        // sees what they had been typing in this pane before switching.
        // Empty draft shows a "your text here" placeholder.
        <Box
          flexShrink={0}
          flexDirection="row"
          paddingX={1}
          width={innerWidth}
        >
          <Text dimColor>{'❯ '}</Text>
          {ghostDraft && ghostDraft.length > 0 ? (
            <Text dimColor>{ghostDraft}</Text>
          ) : (
            <Text dimColor italic>(empty draft — {switchHint} and type)</Text>
          )}
        </Box>
      )}
    </Box>
  )
}
