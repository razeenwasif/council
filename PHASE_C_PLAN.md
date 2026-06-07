# Phase C Plan — Session View as the Default REPL Layout

> Architectural rework making `CouncilSessionScreen` the outermost layout always. The chat scrollback + prompt input flow into the session view's panes; the multi-agent voices/stages light up when `/council` or `/discover` fires. Supersedes `COUNCIL_MODE_REDESIGN.md` §6 Phase C/D/E plan.

**Status**: plan draft, awaiting sign-off.
**Branch**: not yet created — will be `feat/phase-c-session-default` after sign-off.
**Estimated effort**: 12–20 hours of focused work across ~3–5 days.
**Risk**: high — touches `REPL.tsx` (5,101 LOC), `FullscreenLayout.tsx` (636 LOC), and the scroll/overlay/keyboard machinery they own.

---

## 1. Context — why now, why this scope

Phase B made the session view appear on `/council` / `/discover` and disappear after. The user feedback (2026-06-07): the *banner* and the *chat-as-default* layout aren't what they envisioned. They want `./bin/council` to drop straight into the session view chrome — orange-bordered panes, voices list, status pane — even when nothing is running. The chat scrollback lives in the center pane when idle; voice progress takes over when a session is active.

This is structurally different from Phase B. Phase B made the session view a *replacement* for the regular REPL during sessions. Phase C makes the session view the *frame* for everything — the regular REPL just becomes content in one of its panes.

The 5-line banner suppression in `cli.tsx` already shipped (commit `a766fbf`) handles the "no more ASCII art" half of the user's frustration. Phase C is the architectural half.

---

## 2. Architecture decision — composition with slots

Three options were considered; **composition with slots** is chosen.

### α) Composition (chosen)

`CouncilSessionScreen` is the outermost. It accepts ReactNode slots:

```ts
interface CouncilSessionScreenProps {
  // Phase B (still required):
  session: SessionState | null  // null when idle
  terminalColumns: number
  // Phase C — slots populated by REPL when present:
  chatContent?: ReactNode   // routed into center pane when idle
  promptContent?: ReactNode // routed into bottom command pane
  overlayContent?: ReactNode  // floats over everything (modals, permission prompts)
  pillContent?: ReactNode   // the "N new messages" pill from FullscreenLayout
}
```

REPL passes the existing `Messages + spinner + tool JSX` as `chatContent`, the existing `PromptInput` as `promptContent`, modals as `overlayContent`, and the pill as `pillContent`. CouncilSessionScreen owns layout; the content stays in REPL's hands.

This avoids absorbing FullscreenLayout's complexity into the new component. The scroll machinery, sticky-bottom logic, divider tracking, etc. all stay in REPL via primitives (`ScrollBox`, `NewMessagesPill`) used in slot content.

### β) Absorption — rejected

Move FullscreenLayout's logic *into* CouncilSessionScreen. Cleaner final shape but 1+ weeks of refactor and high regression risk on subtle scroll behaviors. Not worth the complexity.

### γ) Nest FullscreenLayout inside session view — rejected

Render FullscreenLayout's whole tree as the center-pane content. Reintroduces the Phase 3b wrap bug (FullscreenLayout's columns calculation wants full terminal width). Also creates nested borders. Architecturally wrong.

---

## 3. Layout design (revised after Q&A 2026-06-07)

User answers in §9 force a different layout than the initial sketch. New target:

```
╭─ council · ready / running · stage: idle|proposal|... ────────────────────────────────╮
│ ╭─ council ─╮ ╭─ chat ────────────╮ ╭─ voices output ──╮ ╭─ status ──╮               │
│ │ ◯ archit  │ │ user: foo bar      │ │ ## Headline      │ │ cost $X.YZ │              │
│ │ ● implmtr │ │ assistant: ...     │ │ ## Position      │ │ tokens N   │              │
│ │ ✓ skeptic │ │ ...                │ │ ...              │ │ idle / Xm  │              │
│ │ ◯ critic  │ │                    │ │ [streaming]      │ │            │              │
│ │ ◯ tester  │ │                    │ │                  │ │            │              │
│ │ ◯ securit │ │                    │ │                  │ │            │              │
│ │ ◯ perform │ │                    │ │                  │ │            │              │
│ ╰───────────╯ │                    │ │                  │ │            │              │
│ ╭─ discover ╮ │                    │ │                  │ │            │              │
│ │ ◯ hypothr │ │                    │ │                  │ │            │              │
│ │ ◯ empircs │ │                    │ │                  │ │            │              │
│ │ ◯ devsadv │ │                    │ │                  │ │            │              │
│ │ ◯ methodl │ │                    │ │                  │ │            │              │
│ ╰───────────╯ ╰────────────────────╯ ╰──────────────────╯ ╰────────────╯              │
│ ╭─ command ───────────────────────────────────────────────────────────────────────────╮│
│ │ ❯ _                                                                                  ││
│ ╰─────────────────────────────────────────────────────────────────────────────────────╯│
╰── ctrl-c cancel · esc background · tab switch voice · enter focus ────────────────────╯
```

### Pane-by-pane

| Pane | Content | Width | Idle behavior | Active-session behavior |
|------|---------|-------|---------------|-------------------------|
| **Top bar** | title + stage | full | `council · ready` | `council · <prompt>` + `stage: <stage>` |
| **Left column** | council voices (top) + discover voices (bottom) stacked | 18 cols | all pending `◯` | live status glyphs for the active mode's voices; the other mode stays all-pending |
| **Chat (center-left)** | the existing REPL chat scrollback via `chatContent` slot | flex, ~50% of remaining when active, full remaining when idle | full conversation + spinner + tool JSX | same content, narrower; still scrolls; voice output appears alongside |
| **Voices output (center-right)** | focused voice's streaming output | flex, ~50% of remaining when active; **hidden entirely when idle** | (not rendered) | focused voice's `## Headline` / `## Position` / streaming text |
| **Status (right)** | cumulative cost + tokens + elapsed | 22 cols | `cost $X.YZ` / `tokens N` / `idle` | live cost / tokens / `elapsed Xm Ys` |
| **Command (bottom)** | `PromptInput` from REPL via `promptContent` slot | full | active input; submitting fires `/council`, `/discover`, etc. as today | same input; mid-session commands per §9 Q4 of the redesign doc |
| **Help bar** | keybinding hints | full | static text |  same |

### Implications

- **Chat width gets cut in half during active sessions.** This is the user's explicit choice — they want to see chat history alongside live voice output. Acceptable tradeoff.
- **Left column has two stacked panes with their own borders.** Council on top (height 9: 7 voices + 2 border rows), discover below (height 6: 4 voices + 2 border rows). Total 15 rows minimum just for voice stack. Terminal needs ≥30 rows; below that, fall back to single-column collapsed layout per §4 width responsiveness.
- **Voices output pane only renders when a session is active.** Saves horizontal space at idle.
- **No mode toggle.** Both council and discover voice lists are always visible, even though only one is "live" at a time. User confirmed this in Q3.

---

## 4. Width handling — even more critical now

Same hard rule as before: every child of `CouncilSessionScreen` receives an explicit `availableColumns`. No child calls `useTerminalSize()` directly.

The user's Q1 decision (chat + voice side-by-side during active sessions) makes this *more* fragile than the original plan. Chat content gets ~half the terminal width during sessions — `Messages` word-wrap *must* respect that or rows will overflow into the voice output sub-pane (a re-run of the Phase 3b bug).

Three approaches considered for getting `Messages` to wrap correctly:

- (a) **Context provider that overrides `useTerminalSize`'s return** — clean, well-scoped, doesn't touch Messages internals
- (b) Refactor `Messages` to take an explicit `availableColumns` prop — invasive
- (c) Live with overflow — *not* acceptable, this is the Phase 3b bug

**Chosen: (a) — `useEffectiveTerminalSize` context shim.** ~40 LOC including provider, hook, types. Wraps `chatContent` so descendants calling the new hook get the allocated columns instead of real terminal columns.

The component code keeps using `useTerminalSize` where appropriate (top-level layout in `CouncilSessionScreen` that wants real terminal cols). Children inside `chatContent` switch to `useEffectiveTerminalSize`. We do *not* monkey-patch `useTerminalSize` globally — that would affect every other component.

### Width math at ≥120 cols

Active session layout (left stack + chat + voice output + status):

```
borders + padding             : 6   (outer round + paddingX=1 + inter-pane sep)
left stack (council+discover) : 18
chat                          : flex (~40)
voice output                  : flex (~40)
status                        : 22
                             total: 126 (with chat=40, voice-out=40)
```

So the chat/voice-output split has roughly `(terminalCols - 46 - 6) / 2` cols each. At 120 cols → each gets ~34. At 160 cols → each gets ~54. At 200+ → comfortable.

### Width math at <120 cols (collapsed)

| Width | Layout |
|-------|--------|
| ≥120 cols | Full 5-pane grid as above |
| 80–119 cols | Single column. Voice stacks collapse into a horizontal bar above chat. Status moves to a single bottom line. Voice output (when session active) replaces chat for the duration. |
| <80 cols | Returns null. REPL renders without the session-view chrome. |

At <80 cols the screen is too narrow to be useful with the multi-pane layout. The user falls back to regular REPL with the agent panel inline (the Phase 1+2+3a state). Orchestrator still runs, just no session-view chrome.

### Vertical math

The stacked left column needs ≥15 rows just for the voices:
- Council pane: 7 voices + 2 border rows = 9 rows
- Discover pane: 4 voices + 2 border rows = 6 rows

Plus top bar (1), command pane (3), help bar (1), outer borders (2) → minimum useful screen height is ≈22 rows. Below that, treat as <80-width fallback (return null, regular REPL).

Most modern terminals are 30+ rows, so this is rarely a constraint.

---

## 5. Modal / overlay handling

`FullscreenLayout` currently absolute-positions modals (slash command dialogs, permission prompts) over its entire viewport at `position={'absolute'} bottom={0} left={0} right={0}`. The modal divider does `"▔".repeat(columns)`.

In Phase C, the same approach works *if* the absolute positioning is relative to `CouncilSessionScreen`'s outer box. The divider line still needs to use the correct width — the new `TerminalSizeContext` override will fix this naturally.

Permission prompts are simpler — they're inline in the chat scrollback or in the bottom slot. They'll flow through the same slots as today.

---

## 6. File-by-file changes

| File | Change | LOC est |
|------|--------|---------|
| `src/components/CouncilSession/CouncilSessionScreen.tsx` | Major rewrite: stacked-left layout, split center pane (chat + voice output sub-panes during active session), accept `chatContent`/`promptContent`/`overlayContent`/`pillContent` slot props. Replace static `SessionCommand` with `promptContent` when given. Wrap `chatContent` in `useEffectiveTerminalSize` shim. Idle render path (no voice-output sub-pane). | +180 / −60 |
| `src/components/CouncilSession/types.ts` | Add `'idle'` to `Stage` union. SessionState becomes nullable in the screen's contract — pass null for idle. | +5 |
| `src/components/CouncilSession/mockData.ts` | Add `MOCK_IDLE_SESSION` for the preview script. | +25 |
| `src/components/CouncilSession/SessionStatus.tsx` | Handle idle case: no elapsed timer, show cumulative cost/tokens via `getTotalCost()` and (if available) session-cumulative tokens. | +15 |
| `src/components/CouncilSession/VoiceList.tsx` | Add `mode` prop (`'council' \| 'discover'`) so it can be reused for both stacked panes. When session is null/idle, render all voices in pending state. | +20 |
| `src/components/CouncilSession/StagePane.tsx` | Becomes the voice-output sub-pane only (not the whole center). Only renders when session is active. | +10 / −15 |
| `src/components/CouncilSession/ChatPane.tsx` *(new)* | Container for `chatContent` slot — wraps it in `EffectiveTerminalSizeProvider` so descendants get the chat-pane's column allocation, not real terminal columns. | +40 |
| `src/hooks/useEffectiveTerminalSize.ts` *(new)* | Context + provider + hook for overriding `useTerminalSize` in subtrees. ~40 LOC including types. | +40 |
| `src/screens/REPL.tsx` | Remove the early-return for sessionState. Always render `CouncilSessionScreen` as the outermost (after KeybindingSetup + MCPConnectionManager). Move scrollable content + bottom slot into the new prop slots. Pass overlays/pill through. Wire `FullscreenLayout`'s ScrollBox + NewMessagesPill into `chatContent`. | +130 / −80 |
| `src/components/FullscreenLayout.tsx` | Leave untouched and unused. Compiles but isn't reached. Eventual deletion is a Phase D cleanup task. | 0 |
| `scripts/preview-council-mode.tsx` | Add `idle` mode argv option. | +12 |
| `COUNCIL_MODE_REDESIGN.md` | §14 Phase C status section after shipping. Cross-reference the new layout. | +70 |
| `CONTEXT.md` | Update file map with the new components + hook. Add hard rule about `useEffectiveTerminalSize` vs `useTerminalSize` choice. | +15 |
| `BACKLOG.md` | Move "delete FullscreenLayout" to P3 cleanup. | +5 |

Approximate total: ~500 LOC across ~13 files (revised up from the original ~360 LOC estimate after the Q1/Q3 layout decisions). REPL.tsx is the biggest single edit (+130 / −80 net change). The new `ChatPane` component is the second-biggest addition.

---

## 7. Phasing

Even Phase C should ship in sub-steps so we have stable checkpoints. Three sub-phases:

### C.1 — `useEffectiveTerminalSize` context shim (1–2h)

The load-bearing primitive. Build the context provider and a `useEffectiveTerminalSize` hook that prefers the context value, falls back to the real `useTerminalSize`. Wrap a test consumer (e.g. `Messages` smoke) to confirm it works.

**Gate**: word-wrap inside a Messages component wrapped in the shim respects the shim's columns, not the actual terminal columns. If this fails, Phase C is dead — pivot to option β or γ.

### C.2 — CouncilSessionScreen slots + idle state (3–4h)

Add the slot props. Add idle session state handling. Update mockData and preview script to render an idle session view (with chatContent and promptContent passed as placeholder ReactNodes). Verify preview shows the layout at idle correctly.

**Gate**: preview script with `idle` arg renders the session chrome correctly with placeholder chat and prompt. Voices list shows all 7 in pending state.

### C.3 — REPL.tsx integration (6–10h)

The big one. Replace the conditional early-return with an always-render of CouncilSessionScreen. Route the existing scrollable content (Messages + spinner + toolJSX) into chatContent, PromptInput into promptContent, modal/overlay into overlayContent, pill into pillContent. Test extensively: chat works at idle, scrolling works, modal dialogs open/close, permission prompts work, slash commands fire, /council / /discover transition correctly.

**Gate**: live REPL smoke covering: normal chat, /spend, /theme, /help, /council, /discover, slash command dialogs, permission prompts. If any of these regress, Phase C must be revertable.

---

## 8. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| `useEffectiveTerminalSize` context shim doesn't propagate through Messages' word-wrap | medium | blocks entire phase | Validate in C.1 before any other work. If it fails, pivot to option β. |
| FullscreenLayout's scroll machinery breaks when extracted from its wrapper | high | regressions in chat scroll, sticky bottom | Keep FullscreenLayout in the tree initially, only stop using it after C.3 ships. Don't delete it during this phase. |
| Modal positioning is wrong inside CouncilSessionScreen | medium | slash commands can't open dialogs | Validate `/theme` opens dialog correctly during C.3. |
| Permission prompt rendering breaks | medium | tool permission flows fail | Validate in C.3 with a `/write` or similar that requests permission. |
| REPL.tsx becomes harder to read after the refactor | high | future maintenance burden | Accept this — it's worth it for the user-facing improvement. Add a doc comment at the new render entry explaining the slot pattern. |
| User changes their mind mid-rework | low-medium | wasted days of work | Sign off on this plan before any code. Once C.3 starts, no scope adds. |
| Branch rebase pain if main moves | low | merge conflicts | feat/phase-c-session-default branch off current feat/council-mode. Don't merge to main until Phase C is fully shipped. |

---

## 9. Decisions (resolved 2026-06-07)

1. **Center pane during active sessions** → **chat + voice scroll together, side-by-side split.** Chat keeps rendering when council/discover is active; voice output gets its own sub-pane next to it. Center pane is split 50/50 (or thereabouts) during sessions; chat takes full center at idle.
2. **Idle voice list** → **show all 7 council voices in pending state.** Visual reminder of what's available.
3. **Voice list when discover fires** → **show both lists, stacked vertically on the left.** Council voices on top, discover voices below. Both always visible regardless of which mode is active. The non-active mode shows pending; the active mode shows live status.
4. **Status pane at idle** → **cumulative across sessions** via `getTotalCost()` and cost-tracker totals. No elapsed timer at idle.
5. **Slash command dialogs during idle** → **overlay the whole screen.** Matches existing FullscreenLayout behavior; simpler migration.

These decisions reshape §3's layout (already updated above) and add complexity to the width math (§4).

---

## 10. Timeline

Assuming sign-off today and ~3h/day weekday availability:

| Day | Sub-phase | Goal | Hours |
|-----|-----------|------|-------|
| 1 (today) | Plan sign-off + C.1 | useEffectiveTerminalSize shim shipped + gate test passes | 1–2 |
| 2 | C.2a | Stacked-left voice panes + idle voice rendering | 2–3 |
| 3 | C.2b | Split center pane (chat sub-pane + voice-output sub-pane) + ChatPane wrapper | 3–4 |
| 4 | C.3 (part 1) | REPL.tsx restructure scaffold; smoke chat-at-idle | 4–5 |
| 5 | C.3 (part 2) | Modal + permission + slash command verification + live REPL smoke + commit + push | 3–4 |
| **Total** | | | **13–18h** (revised up from 13–15h after layout complexity grew) |

Buffer included in C.3 because that's the unknown-unknowns sub-phase. If C.1 gate fails, abandon Phase C — only ~2h sunk.

---

## 11. What stays the same

- Phase B council/discover wiring keeps working — session view still appears when /council fires, voices light up, etc.
- `bin/council` COLORTERM truecolor default — unchanged.
- All slash commands (`/spend`, `/theme`, `/help`, `/handoff`, etc.) — unchanged behavior, just rendered in different layout.
- Orchestrator code (`councilOrchestrator.ts`, `debateOrchestrator.ts`) — completely untouched.

---

## 12. What this plan does NOT include

- True chunk-by-chunk streaming via AgentTool `onProgress` — still Phase D.
- Tab to switch focused voice — still Phase D.
- Esc to background a running session — still Phase D.
- Per-voice colors via `vendorBadge` — still Phase D.
- Animated stage transitions — already in BACKLOG.
- Removing `FullscreenLayout.tsx` entirely — kept compiling-but-unused after C.3; eventual removal is a follow-up cleanup.

These are all explicitly out of scope for Phase C. Discuss them if/when Phase C lands cleanly.

---

## 13. Decision needed

§9 answered 2026-06-07. Plan reflects user choices:

- Stacked-left voice panes (council on top, discover below)
- Split center pane (chat + voice output side by side during sessions)
- Cumulative status at idle
- Overlay modals
- Show all voices in pending state at idle

Scope grew from ~360 LOC to ~500 LOC, timeline from 13–15h to 13–18h. Still feasible by week's end at ~3h/day.

## 14. C.1 status — shipped

Branch: `feat/phase-c-session-default` (off `feat/council-mode`).

**Shipped**:
- `src/hooks/useEffectiveTerminalSize.ts` — `EffectiveTerminalSizeProvider` + `useEffectiveTerminalSize` hook. Context-based override; falls through to real `useTerminalSize` when no provider in scope. Rows optional (defaults to real terminal rows).
- `src/hooks/useEffectiveTerminalSize.test.tsx` — gate test, 4 cases:
  - Without provider → real terminal size
  - With provider → columns overridden
  - With rows override → both fields overridden
  - Nested providers → inner wins

**Gate passed**: 4/4 tests green. Primitive works as designed.

**Effort**: ~45 min actual (budget 1–2h). Below estimate because the hook pattern is simple and test scaffolding from existing tests (`useApiKeyVerification.test.tsx`) was reusable.

## 15. C.2a status — shipped

Stacked-left voice panes (council + discover always visible) with idle pending rendering.

**Files modified**:
- `src/components/CouncilSession/types.ts` — added `'idle'` to `Stage` union, `VoiceListMode` type, `COUNCIL_VOICE_ROLES` and `DISCOVER_VOICE_ROLES` canonical role lists for idle placeholder rendering
- `src/components/CouncilSession/VoiceList.tsx` — added optional `mode` prop. No rendering change yet — the prop is informational documentation that the screen passes; consumed in C.2b when per-pane behavior diverges
- `src/components/CouncilSession/CouncilSessionScreen.tsx` — major refactor:
  - `session` prop is now `SessionState | null`. Idle is the null case.
  - Resolves voices for both council and discover panes independently. Active mode's voices come from the session; the other shows canonical roles in pending state.
  - Left column wraps both pane Boxes (council on top, discover below) with their own round borders
  - TopBar drops the "session" suffix at idle and shows "council · ready · stage: idle"
  - SessionStatus / StagePane unchanged in this sub-phase; same single-pane center
- `scripts/preview-council-mode.tsx` — new `idle` argv option (`bun run scripts/preview-council-mode.tsx idle`) renders with `session={null}`

**What `idleVoicesFor(mode)` returns**: an array of `Voice` with `status: 'pending'`, `headline: ''`, `output: ''`, `model: ''` (unknown until spawn fires).

**Limitations carried forward to C.2b**:
- StagePane still occupies the entire center pane. The chat sub-pane + voice output sub-pane split is C.2b work.
- `chatContent` / `promptContent` slots not yet added — also C.2b.
- Collapsed (narrow) layout still uses single VoiceList instance for the council list only — Phase D polish if anyone runs at 80–119 cols.

**Verification**: `bun run build` clean, useEffectiveTerminalSize tests still 4/4. Live preview at idle / council / discover all render without error.

**Effort**: ~75 min actual (budget 2–3h).

## 16. C.2b status — shipped

Split center pane (chat + voice-output sub-panes during active session, single chat pane at idle) plus the slot props for REPL integration.

**Files created**:
- `src/components/CouncilSession/ChatPane.tsx` — wraps user-supplied `chatContent` inside an `EffectiveTerminalSizeProvider` so descendants that opt into `useEffectiveTerminalSize` wrap to the pane's allocated columns. Placeholder when `chatContent` is null/undefined (preview-only path).

**Files modified**:
- `src/components/CouncilSession/CouncilSessionScreen.tsx`:
  - Added `chatContent?: ReactNode` and `promptContent?: ReactNode` slot props.
  - Wide-mode center pane now branches: active session renders chat + voice-output sub-panes side-by-side (each ~half the centerOuter width); idle renders a single chat sub-pane spanning the full center width.
  - Command pane renders `promptContent` slot when provided, falling back to the static `SessionCommand` for the preview-only path.
- `src/components/CouncilSession/index.ts` — re-exports `ChatPane` + `ChatPaneProps` + the canonical role lists.
- `scripts/preview-council-mode.tsx` — passes a `MockChat` component as the chat slot so the layout demonstrates the slot wiring. Visible in all three modes (council / discover / idle).

**Width split math** (≥120 cols, active session):
- `centerOuter = terminalCols − VOICE_LIST_WIDTH(18) − STATUS_WIDTH(24) − OUTER_CHROME(4)`
- `chatOuter = floor(centerOuter / 2)`, `voiceOutputOuter = centerOuter − chatOuter`
- At terminalCols=120: centerOuter=74, chat=37, voiceOutput=37
- At terminalCols=200: centerOuter=154, chat=77, voiceOutput=77

**Verification**: `bun run build` clean. useEffectiveTerminalSize tests 4/4. Live preview at idle / council / discover renders chat slot + voice output split (active modes) and single chat pane (idle).

**What this enables for C.3**: REPL.tsx can now pass its existing `Messages + spinner + tool JSX` tree as `chatContent` and its existing `PromptInput` as `promptContent`. The session view becomes the outermost layout and the chat tree lives inside the chat sub-pane.

**Effort**: ~50 min actual (budget 3–4h). Below estimate because the ChatPane primitive is thin and the conditional split was a single JSX edit.

**Next**: C.3 — REPL.tsx integration. Replace the conditional early-return with always-render CouncilSessionScreen; route existing scrollable content into chatContent slot; PromptInput into promptContent slot.

## 17. C.3.1 status — shipped

REPL.tsx restructured: CouncilSessionScreen is now the outermost layout always (post-MCPConnectionManager). The existing scrollable content flows into the `chatContent` slot via `FullscreenLayout`. The existing bottom (PromptInput + permissions + StatusBar etc.) flows into the `promptContent` slot.

**Files modified**:
- `src/screens/REPL.tsx` — three surgical edits:
  - Insert `<CouncilSessionScreen ... chatContent={` opening before `<FullscreenLayout` (line 4668)
  - Replace `</>} bottom={<Box ...>` with `</>} bottom={null} />} promptContent={<Box ...>` to close FullscreenLayout self-contained (no bottom prop), then open promptContent with the same Box
  - Existing closing `</Box>} />` at line ~5101 now closes promptContent + CouncilSessionScreen instead of bottom + FullscreenLayout — same text, different semantic
  - Removed the obsolete `if (sessionState)` early-return block — CouncilSessionScreen handles both nullable and non-null sessions internally

**End-to-end flow at idle**:
1. `./bin/council` launches with `CLAUDE_CODE_NO_FLICKER=1` → alt-screen on
2. REPL renders with `sessionState=null`
3. CouncilSessionScreen renders with `chatContent` = the existing FullscreenLayout-wrapped chat tree (Messages + spinner + tool JSX + modal + overlay + pill + bottomFloat)
4. `promptContent` = the existing Box with PromptInput + StatusBar + permissionStickyFooter + SessionBackgroundHint + dialogs
5. Visual: outer orange-bordered session-view chrome, stacked-left voice panes (council + discover all pending), single chat sub-pane (full center width) with the FullscreenLayout-rendered scrollback, status pane on the right, command pane at the bottom with the real PromptInput

**End-to-end flow during active session**:
- `/council` or `/discover` fires → sessionState populates → re-render
- Council pane lights up live; discover stays pending (and vice versa for /discover)
- Voice-output sub-pane appears next to chat — chat narrows to ~half center width
- Voice progress streams in the voice-output sub-pane
- session-end → sessionState clears → back to idle layout

**Known limitations (C.3.2 work)**:
- **Word wrap**: Messages inside FullscreenLayout still call `useTerminalSize` for word-wrap calculations — they get real terminal columns, not chat-pane-allocated columns. Result: long lines may overflow into voice output sub-pane during active sessions. This is the Phase 3b bug recurring on the chat side. Fix: migrate Messages descendants to `useEffectiveTerminalSize` (the C.1 primitive is in place for exactly this).
- **Modal positioning**: FullscreenLayout's modal slot still renders modals absolute-positioned relative to FullscreenLayout's viewport (which is inside the chat sub-pane). Result: `/theme`, `/spend`, `/help` etc. modals overlay the chat sub-pane only, not the full screen. Cosmetic — they work, just look small. Fix: add `overlayContent` slot to CouncilSessionScreen and route modals there.
- **StatusBar duplication**: the Phase 3a single-line status bar in promptContent now duplicates info shown in the SessionStatus right pane. Cosmetic redundancy — fix is to remove StatusBar from REPL's bottom now that SessionStatus covers it more prominently.
- **Voice output sub-pane uses StagePane placeholder**: still shows `[stage — content TBD]` for non-proposal stages. Real synthesizer/executor/review content is Phase D.

**Verification**: `bun run build` clean. Council launches in alt-screen mode without errors (PTY smoke via `script -q -c 'timeout 2 ./bin/council'` exited cleanly with SIGTERM-from-timeout, not a crash).

**Live smoke pending user confirmation**: needs an actual interactive test in a ≥120-col terminal to verify chat renders in the chat sub-pane, prompt input lands in command pane, slash commands open modals (even if at wrong position), and `/council` triggers the live voice-state updates.

**Effort**: ~35 min actual (budget 4–5h for C.3 part 1). Below estimate because the JSX surgery turned out to be three precise edits rather than a sprawling rewrite — the existing closing `</Box>} />` worked verbatim for the new structure due to balanced bracket arithmetic.

**Next**: C.3.2 — migrate Messages-tree word-wrap to `useEffectiveTerminalSize`, add overlayContent slot for proper modal positioning, remove StatusBar duplication, and live-smoke the integrated screen.

### C.3.1 polish — command pane alignment (user feedback 2026-06-07)

User feedback after smoke: command pane spanning full screen width felt wrong against the narrow voice/status columns on either side. Aligned the command pane with the chat/voice-output center area by adding `marginLeft = VOICE_LIST_WIDTH` and `marginRight = STATUS_WIDTH` at wide widths. The pane now sits "under" the center column rather than spanning the full screen. Collapsed narrow layout (<120 cols) keeps full width since there's no voice list to align to.

One-line edit to `CouncilSessionScreen.tsx`.

## 18. C.3.2 status — partial (height + word wrap shipped)

User feedback after C.3.1: "reduce the height of the command panel as well then move to word wrap." Two changes landed together.

### Height reduction — StatusBar removed

`src/screens/REPL.tsx`:
- Removed `<StatusBar isLoading=... />` from the bottom slot at line ~4699. Its info (cost / elapsed / agent count) duplicated SessionStatus in the right pane, which is always visible. The bar was contributing to the command pane's vertical footprint with redundant data.
- Dropped the now-unused `import { StatusBar } from '../components/StatusBar.js'` at line 24.

This shrinks the command pane by ~2 rows (border + StatusBar line). The `StatusBar.tsx` file itself stays in the tree — it's still used elsewhere conceptually (its width-responsive logic is reference material for future status display work). Could be deleted in a P3 cleanup if no other callers emerge.

### Word wrap — useEffectiveTerminalSize migration

The load-bearing fix for long chat lines overflowing into the voice-output sub-pane during active sessions.

`src/components/Messages.tsx`:
- Swapped `useTerminalSize()` → `useEffectiveTerminalSize()` (single-line change at line ~377).
- Effect propagates through props: Messages reads `columns`, passes it to `MessageRow`, `Divider`, `VirtualMessageList`. All downstream rendering wraps to the chat-sub-pane width when inside `ChatPane`'s `EffectiveTerminalSizeProvider`, falls through to real terminal columns elsewhere (e.g., the transcript view at REPL line ~4527 doesn't have a provider, gets real cols).

`src/components/MarkdownTable.tsx`:
- Same one-line swap. Tables in assistant responses are common and were the second-most-likely source of width overflow.

Other chat-tree consumers of `useTerminalSize` exist (`HistorySearchDialog`, `MessageSelector`, `TaskListV2`, `LogSelector`, `BackgroundTasksDialog`, `Stats`, `PromptInputFooterSuggestions`) but they're modal/dialog-like — appear less commonly during normal chat. Migrate in follow-up commits if user reports overflow in any of them.

`FullscreenLayout.tsx` keeps `useTerminalSize` deliberately — it's the screen-level layout and legitimately needs the real terminal columns (e.g., the modal divider character that does `"▔".repeat(columns)`).

**Verification**: `bun run build` clean. `useEffectiveTerminalSize` tests 4/4. The provider/consumer plumbing was validated in C.1's gate; this migration just adds consumers.

**Effort**: ~25 min actual (budget ~3h for full C.3.2). Word wrap turned out to be 2 single-line swaps because the hook-pattern migration is minimal.

**Still in C.3.2 (not yet done)**:
- **Modal positioning** — `/theme`, `/spend` etc. modals still overlay only the chat sub-pane. Fix: add `overlayContent` slot to CouncilSessionScreen and route the existing FullscreenLayout `modal` prop there with absolute positioning relative to the outer container.

**Effort delta**: ~25 min for the modal slot still pending. Total C.3 (a + 3.1 + 3.2 partial) at ~95 min; budget was 7–9h.
