import React from 'react'
import { Box, Text } from '../../ink.js'
import type { RefObject } from 'react'
import ScrollBox, { type ScrollBoxHandle } from '../../ink/components/ScrollBox.js'
import { ModalContext } from '../../context/modalContext.js'
import { ChatPane } from './ChatPane.js'
import { EffectiveTerminalSizeProvider } from '../../hooks/useEffectiveTerminalSize.js'
import { SessionCommand } from './SessionCommand.js'
import { SessionStatus } from './SessionStatus.js'
import { GitStatusPane, SessionTasksPane } from './SidePanes.js'
import { StagePane } from './StagePane.js'
import { SystemMonitor } from './SystemMonitor.js'
import { useScratchpad } from '../../hooks/useScratchpad.js'
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
  /** Scroll-box handle for the dedicated "agent thoughts" pane (below
   *  the workspace row). REPL listens to Shift+↑/↓ and Shift+PgUp/PgDn
   *  and calls scrollBy on this handle. */
  agentScrollRef?: RefObject<ScrollBoxHandle | null>
  /** Which pane currently owns scroll keys (PageUp/Down, arrow scrolls).
   *  'chat' (default) routes to the workspace's chat scrollback;
   *  'agent' routes to the agent thoughts pane. Toggled via Alt+1/Alt+2
   *  in the REPL. Also drives the border-accent visual cue so the user
   *  can see at a glance which pane will receive scroll input. */
  scrollFocus?: 'chat' | 'agent'
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
  agentScrollRef,
  scrollFocus = 'chat',
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
  // Phase 3b dual-pane (2026-06-07): both idle and active sessions
  // use the same dual WorkspacePane center layout. The pane matching
  // session.kind hosts the voice-output content; the other pane shows
  // its idle workspace state. Bottom command pane is gone entirely —
  // the PromptInput always lives inside the focused pane.
  const isSessionActive = session !== null
  const voiceOutputTitle = focusedVoice
    ? `current — ${focusedVoice.role} (${focusedVoice.model})`
    : 'current'
  // Map session kind → pane: council session → council pane;
  // discover session → research pane (research is the UI label for
  // the discover orchestrator per Phase 4 decision).
  const sessionPane: 'council' | 'research' | null =
    session?.kind === 'council'
      ? 'council'
      : session?.kind === 'discover'
        ? 'research'
        : null
  // Center split (2026-06-08 reframe): left half stacks the two workspace
  // panes vertically (council on top, research below), right half holds
  // the agent thoughts pane at full height. Voice-list + status panes
  // still sit on the outer columns.
  const leftHalfOuter = Math.floor(centerOuter / 2)
  const rightHalfOuter = centerOuter - leftHalfOuter

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
            {/* System monitor — polls every 2s in its own useEffect;
                the first sample renders ~immediately with zero rates. */}
            <Box
              flexShrink={0}
              borderStyle="round"
              borderColor={ACCENT}
              backgroundColor={BG}
              flexDirection="column"
              borderText={paneTitle('system')}
              overflow="hidden"
            >
              <SystemMonitor availableColumns={paneInner(VOICE_LIST_WIDTH)} />
            </Box>
            {/* Git status — branch, ahead/behind, M/A/D/? counts. Polls
                every 5s via gitStatusReader. Fills the slack below the
                system monitor. */}
            <Box
              flexGrow={1}
              flexShrink={1}
              borderStyle="round"
              borderColor={ACCENT}
              backgroundColor={BG}
              flexDirection="column"
              borderText={paneTitle('git')}
              overflow="hidden"
            >
              <GitStatusPane availableColumns={paneInner(VOICE_LIST_WIDTH)} />
            </Box>
          </Box>
          {/* Center: single workspace pane (left half) + agent thoughts
              pane (right half). Reframed 2026-06-08 from the prior dual
              council/research stack — pane overlap bugs were leaking
              messages between panes, and the routing was ambiguous.
              Now a single pane hosts both modes; the user types
              `/council …` or `/discover …` explicitly to pick which
              orchestrator runs. Plain chat goes through the normal
              REPL path. */}
          <Box flexDirection="row" flexGrow={1}>
            {/* Left half: workspace pane (chat + prompt input). Border
                lights up when scrollFocus='chat' (alt+1). */}
            <Box flexDirection="column" width={leftHalfOuter} flexShrink={0}>
              <WorkspacePane
                name="workspace"
                outerWidth={leftHalfOuter}
                focused={scrollFocus === 'chat'}
                chatContent={chatContent}
                promptContent={promptContent}
                commandValue={commandValue}
                switchHint="alt-1 to focus · type /council or /discover"
              />
            </Box>
            {/* Right half: agent thoughts pane at full column height.
                Border lights up when scrollFocus='agent' (alt+2). */}
            <Box
              width={rightHalfOuter}
              flexShrink={0}
              borderStyle="round"
              borderColor={scrollFocus === 'agent' ? ACCENT : 'gray'}
              backgroundColor={BG}
              flexDirection="column"
              borderText={paneTitle(
                sessionPane && voiceOutputTitle
                  ? `agent thoughts · ${voiceOutputTitle}`
                  : 'agent thoughts',
              )}
              overflow="hidden"
            >
              {sessionPane ? (
                <ScrollBox
                  ref={agentScrollRef}
                  stickyScroll={true}
                  flexGrow={1}
                  flexDirection="column"
                >
                  <StagePane
                    stage={stage}
                    focusedVoice={focusedVoice}
                    voices={session?.voices ?? []}
                    availableColumns={paneInner(rightHalfOuter)}
                    synthesisText={session?.stageContent?.synthesis}
                    executionText={session?.stageContent?.execution}
                  />
                </ScrollBox>
              ) : (
                <Box paddingX={1} paddingY={1} flexDirection="column">
                  <Text dimColor italic>
                    [no active session — agent thoughts will stream here when
                    you run /council or /discover]
                  </Text>
                </Box>
              )}
            </Box>
          </Box>
          <Box
            width={STATUS_WIDTH}
            flexShrink={0}
            flexDirection="column"
          >
            <Box
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
            <Box
              flexGrow={2}
              flexShrink={1}
              flexBasis={0}
              borderStyle="round"
              borderColor={ACCENT}
              backgroundColor={BG}
              flexDirection="column"
              borderText={paneTitle('scratchpad')}
              overflow="hidden"
            >
              <ScratchpadPane availableColumns={paneInner(STATUS_WIDTH)} />
            </Box>
            {/* TaskCreate tail. In-progress first, then pending, then
                completed. Empty when TaskCreate hasn't been used.
                (Files-touched widget consolidated into the left git
                pane on 2026-06-08.) */}
            <Box
              flexGrow={1}
              flexShrink={1}
              flexBasis={0}
              borderStyle="round"
              borderColor={ACCENT}
              backgroundColor={BG}
              flexDirection="column"
              borderText={paneTitle('tasks')}
              overflow="hidden"
            >
              <SessionTasksPane availableColumns={paneInner(STATUS_WIDTH)} />
            </Box>
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
              voices={session?.voices ?? []}
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
      {/* Phase 3b dual-pane (2026-06-07): bottom command pane removed
          entirely. The PromptInput now always lives inside the focused
          workspace pane (council or research). Both idle and active
          session states use the same dual-pane center layout. */}
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
        ctrl-c cancel · alt-1/alt-2 focus chat/agent · pgup/pgdn scroll · /copy chat · /council · /discover
      </Text>
    </Box>
  )
}

/**
 * Scratchpad pane content — renders the in-memory session notes
 * (appended via the `/note` slash command). Subscribes to the
 * scratchpadStore singleton via the useScratchpad hook so writes from
 * the command surface here without prop drilling.
 *
 * Notes show newest-last as numbered lines. Empty state shows a hint
 * pointing the user at the `/note` command.
 */
function ScratchpadPane({
  availableColumns,
}: {
  availableColumns: number
}): React.ReactNode {
  const notes = useScratchpad()
  // String literals (not &lt; entities) so the rendered text is `<text>`
  // rather than `&lt;text&gt;` — Ink doesn't decode HTML entities.
  return (
    <Box paddingX={1} flexDirection="column" width={availableColumns} flexGrow={1}>
      {notes.length === 0 ? (
        <Text dimColor italic>(empty — add with /note below)</Text>
      ) : (
        notes.map((n, i) => (
          <Box key={i} flexDirection="row">
            <Text dimColor>{i + 1}. </Text>
            <Text wrap="wrap">{n}</Text>
          </Box>
        ))
      )}
      {/* Persistent hint at the bottom so the slash-command surface
          stays discoverable even after notes are pinned. */}
      <Box flexGrow={1} />
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor italic>{'/note <text>'} add</Text>
        <Text dimColor italic>/note clear · /note list</Text>
      </Box>
    </Box>
  )
}

/**
 * One of the two side-by-side workspace panes (council / research).
 *
 * Layout matrix:
 * - Focused + no voiceOutput: chat (grows) + promptContent (bottom).
 * - Focused + voiceOutput:    chat (grows ½) + voiceOutput (grows ½) + promptContent.
 * - Unfocused + no voiceOutput: placeholder hint (grows) + ghost draft.
 * - Unfocused + voiceOutput:   voiceOutput (grows) + ghost draft.
 *
 * The voiceOutput area renders inside an inner Box with its own borderless
 * title heading so it's visually distinct from the chat scrollback above.
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
  chatPreview,
  promptContent,
  commandValue,
  ghostDraft,
  switchHint,
  voiceOutputContent,
  voiceOutputTitle,
}: {
  name: 'council' | 'research' | 'workspace'
  outerWidth: number
  focused: boolean
  chatContent?: React.ReactNode
  /** Read-only static preview of this pane's recent messages when
   *  unfocused. The focused pane uses `chatContent` (full scrollable);
   *  the unfocused pane uses this if provided, else the placeholder. */
  chatPreview?: React.ReactNode
  promptContent?: React.ReactNode
  commandValue: string
  /** Ghost draft text for the unfocused state. `undefined` when focused. */
  ghostDraft?: string
  switchHint: string
  /** When this pane owns the active session, the voice-output StagePane.
   *  Renders below the chat (or alone if unfocused). */
  voiceOutputContent?: React.ReactNode
  voiceOutputTitle?: string
}): React.ReactNode {
  const borderColor = focused ? ACCENT : 'gray'
  const innerWidth = paneInner(outerWidth)
  return (
    <Box
      width={outerWidth}
      flexGrow={1}
      flexBasis={0}
      flexShrink={1}
      borderStyle="round"
      borderColor={borderColor}
      backgroundColor={BG}
      flexDirection="column"
      borderText={paneTitle(name)}
    >
      {/* Top area: chat (focused), chatPreview (unfocused + has prior
          messages), placeholder (unfocused + no session + no preview),
          or null (unfocused + active session — voice-output fills). */}
      {focused ? (
        <Box flexGrow={voiceOutputContent ? 1 : 2} flexDirection="column">
          <ChatPane availableColumns={outerWidth} chatContent={chatContent} />
        </Box>
      ) : voiceOutputContent ? null : chatPreview ? (
        <Box
          flexGrow={1}
          flexDirection="column"
          width={innerWidth}
          overflow="hidden"
        >
          {chatPreview}
        </Box>
      ) : (
        <Box
          flexGrow={1}
          paddingX={1}
          paddingY={1}
          flexDirection="column"
          width={innerWidth}
        >
          <Text dimColor italic>
            [{name} workspace — {switchHint}]
          </Text>
        </Box>
      )}
      {/* Middle area: voice-output (StagePane) when this pane owns the
          active session. StagePane has its own internal title, so no
          wrapper title here — that was causing a duplicate-title bug
          where the wrapper version stuck at the top of the pane while
          the StagePane version scrolled with content. */}
      {voiceOutputContent && (
        <Box
          flexGrow={focused ? 1 : 2}
          flexDirection="column"
          paddingX={1}
          width={innerWidth}
        >
          {voiceOutputContent}
        </Box>
      )}
      {/* Bottom area: live PromptInput (focused) or ghost draft (unfocused). */}
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
        // Unfocused: ghost draft preview so the user sees what they had
        // been typing in this pane before switching.
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
