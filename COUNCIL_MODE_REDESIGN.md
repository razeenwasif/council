# Council Mode Redesign — Onyx-style Workspace for `/council` and `/discover`

> Replaces Phases 3b/4/5 of `TUI_REDESIGN.md` (which were structurally blocked by the chat-width wrap bug — see TUI_REDESIGN §14). Instead of grafting panes onto the regular REPL, this design introduces a **distinct session view** that takes over the screen when a council or discover run is active, and returns to the normal chat REPL when the session ends.

**Status**: design draft. Implementation not started.
**Target completion**: 2026-06-14 (Sunday — one calendar week).
**Effort estimate**: ~15–25 hours of focused work spread across the week.
**Companions**: `TUI_REDESIGN.md` (now historical — Phases 1+2 still live; 3a still ships the bottom bar), `assets/Screenshot 2026-06-07 091531.png` (Onyx reference).

---

## 1. Why a separate view, not panes-in-REPL

The Phase 3b smoke test made one thing concrete: Council's regular REPL is **deeply assumption-built around full-terminal-width chat**. Word-wrap calculations across `Messages`, `Markdown`, `Spinner`, and friends all consult `useTerminalSize().columns`. Allocating part of that width to a side pane requires either (a) a sweeping `availableColumns` shim across the render tree, or (b) editing dozens of components to take an explicit width prop.

Either of those is a multi-week rewrite. **Not feasible by next Sunday and not worth it for the marginal win of "status info on the right side of normal chat."**

The Onyx workspace mental model is a better fit. Onyx isn't one big chat with a sidebar — it's a *workspace* where each pane is its own concern, used together when you need them, hidden when you don't. The analog for Council is:

> Regular REPL stays as it is — full-width chat. When you fire `/council` or `/discover`, the entire screen transitions to a **purpose-built session view** designed for that workflow. When the session ends, you return to regular REPL with the result inline.

The session view owns its layout end-to-end, so it can control widths explicitly and never has to fight upstream assumptions.

---

## 2. Vision — what the session view looks like

Target layout at terminal width ≥120 cols:

```
╭─ council session ─ rename foo helper to bar ──────────────── stage: proposal ─╮
│╭ voices ──────╮╭ current — critic (gpt-4.1-mini) ────────╮╭ status ─────────╮│
││▸ architect  ●││ ## Headline                              ││  cost   $0.18   ││
││  implementer●││   Add a debounce wrapper around the      ││  tokens 12.4k   ││
││  skeptic    ●││   keystroke handler                      ││  elapsed 7m 22s ││
││  critic     ●││                                          ││  4/7 running    ││
││  tester     ◯││ ## Position                              ││                 ││
││  security   ◯││   Current keystroke handler invokes...   ││  active:        ││
││  performance◯││   [continued output streaming]           ││  · implementer  ││
│╰──────────────╯╰──────────────────────────────────────────╯╰─────────────────╯│
│╭ command ──────────────────────────────────────────────────────────────────────╮│
││ ❯ /pause                                                                      ││
│╰───────────────────────────────────────────────────────────────────────────────╯│
╰── ctrl-c cancel · esc background · tab switch voice · enter focus ──────────────╯
```

### Pane breakdown

| Pane | Role | Width | Border title |
|------|------|-------|--------------|
| **Top bar** | Title + stage indicator | full | `council session — <prompt summary>` / `stage: <stage>` |
| **Voices** (left) | Voice list with status glyphs | ~16 cols | `voices` |
| **Current** (center) | Focused voice's streaming output OR active stage (synthesizer, executor, reviewers) | flex | `current — <voice> (<model>)` |
| **Status** (right) | Live cost / tokens / elapsed / active list | ~20 cols | `status` |
| **Command** (bottom) | Limited input — `/pause`, `/cancel`, free-form notes | full | `command` |
| **Help bar** (bottom edge) | Keybinding hints | full | (no border) |

### Voice status glyphs

| Glyph | Meaning |
|-------|---------|
| `●` (orange) | Currently streaming |
| `▸` (orange) | Selected for the center pane |
| `✓` (green) | Completed successfully |
| `◯` (dim) | Pending — not yet started |
| `✗` (red) | Failed or timed out |
| `⏸` (yellow) | Paused |

### Stage indicator (top bar)

Cycles through:
- `stage: proposal` — voices generating proposals
- `stage: synthesis` — synthesizer producing the plan
- `stage: execution` — executor writing the diff
- `stage: review` — voices reviewing the diff
- `stage: revision` (if applicable)
- `stage: done` — final brief/diff visible

---

## 3. When session mode activates

Triggered automatically when any of these fire from the REPL:

- `/council` (with router → council decision) or `/council run <prompt>`
- `/discover <question>` (debate mode — same view, slightly different stages)
- Any future multi-agent debate trigger (Co-Scientist mode if ever built)

Mode exits when:

- Session completes → fade to a brief result summary, then back to REPL with the final diff/brief in the chat
- User presses **Esc** → background the session (continues running), return to REPL. Re-enter with `/council show` (TBD).
- User presses **Ctrl-C** → cancel the session, return to REPL

Mode does **not** apply when:

- Single-agent runs (regular Claude conversation)
- Slash commands that don't fan out (`/handoff`, `/theme`, `/spend`, etc.)
- Solo router decisions

---

## 4. Width responsiveness

```
≥120 cols:  three-column layout as shown above
80–119:     single-column with collapsible voice bar at top, status at bottom
<80 cols:   fall back to regular REPL behavior — no session view
```

At <80 cols the screen is too narrow to make the multi-pane layout useful. The user falls back to the existing REPL with the agent panel at the bottom of the scroll history. Council still works there; just no session-mode chrome.

This is a hard rule: **at <80 cols, session view is invisible**. The orchestrator still runs, the agent panel still appears in the chat history. The user sees no change from current behavior.

---

## 5. Architecture

### New components

| Component | Role | Approx LOC |
|-----------|------|------------|
| `CouncilSessionScreen.tsx` | Top-level screen — owns the layout | ~250 |
| `VoiceList.tsx` | Left pane — list of voices with status | ~80 |
| `StagePane.tsx` | Center pane — stage-aware content router | ~100 |
| `VoiceOutput.tsx` | Renders one voice's streaming output (inside StagePane) | ~120 |
| `ExecutorStage.tsx` | Special center-pane content for execution stage (file diffs) | ~80 |
| `SessionStatus.tsx` | Right pane — cost/tokens/elapsed/active | ~80 |
| `SessionCommand.tsx` | Bottom — input for /pause, /cancel, comments | ~60 |
| `useSessionState.ts` | Hook — subscribes to orchestrator events | ~150 |

Approximate total: ~920 LOC of new code, plus REPL.tsx integration.

### State flow

```
   ┌─────────────────────────────────────────────┐
   │  REPL.tsx                                    │
   │                                              │
   │  isInSession ── from useSessionState() ──┐   │
   │      │                                    │   │
   │      ▼ if true                            │   │
   │  ┌─────────────────────────┐              │   │
   │  │ CouncilSessionScreen    │ ◄──── orchestrator events
   │  │  ├─ VoiceList           │       (council, debate)
   │  │  ├─ StagePane           │
   │  │  │   └─ VoiceOutput     │
   │  │  ├─ SessionStatus       │
   │  │  └─ SessionCommand      │
   │  └─────────────────────────┘              │   │
   │      │ when session ends                  │   │
   │      ▼                                    │   │
   │  ┌─────────────────────────┐              │   │
   │  │ FullscreenLayout         │ ◄────────────┘   │
   │  │  (regular REPL)          │                  │
   │  └─────────────────────────┘                  │
   └─────────────────────────────────────────────┘
```

### Bridge from orchestrator to UI

The existing council/debate orchestrators emit progress messages via the `emitStatus` callback. We add an additional event channel:

```ts
interface SessionEvent {
  kind: 'stage-change' | 'voice-state' | 'voice-output' | 'session-end'
  stage?: 'proposal' | 'synthesis' | 'execution' | 'review' | 'done'
  voice?: { role: string; model: string; status: 'pending' | 'running' | 'done' | 'failed' }
  output?: { role: string; chunk: string }
  result?: { brief?: string; diff?: string }
}
```

This is fed by both `councilOrchestrator.ts` and `debateOrchestrator.ts` via new adapter hooks (similar to the existing `prepareBatch` / `completeMember` patterns).

### Width handling — avoiding the Phase 3b bug

**Every child of `CouncilSessionScreen` receives an explicit `availableColumns` prop**. The screen computes the layout at the top:

```ts
const VOICE_LIST_WIDTH = 16
const STATUS_WIDTH = 20
const CENTER_WIDTH = terminalCols - VOICE_LIST_WIDTH - STATUS_WIDTH - 6 // borders + padding
```

No child ever calls `useTerminalSize()`. Text-wrap inside the center pane uses `CENTER_WIDTH` explicitly. Same with status pane fields.

This is the *one* hard rule that makes the multi-pane layout actually work. Phase 3b violated it by reusing the regular REPL chat rendering inside a flex-shrunk container. Session view sidesteps the problem by owning its render tree end-to-end.

---

## 6. Implementation phases

5 phases, sized for the 7-day window with ~3–4 focused hours per day given uni load.

### Phase A — Static scaffold (Day 1 — Mon, 3h)

**Goal**: render the session view layout with hard-coded mock data, no real orchestration.

- Create `CouncilSessionScreen.tsx` with the 3-pane layout
- Create `VoiceList`, `StagePane`, `SessionStatus`, `SessionCommand` stubs
- Mock 7 voices with hardcoded states (running, pending, done)
- Mock streaming output in the center pane
- Mock cost/elapsed/active list in the status pane
- Width-responsive collapse logic (≥120, 80–119, <80)
- **No real wiring yet** — purely visual

**Verification**: `bun run build` clean. Launch Council. Open a route that renders the new screen with mock data (could be a debug `/council-preview` slash command or just temporarily render unconditionally). Eyeball the layout at multiple widths.

**Gate**: does the layout look right and resize cleanly?

### Phase B — Wire to council orchestrator state (Day 2–3 — Tue+Wed, 6h)

**Goal**: real `/council run <prompt>` produces a session view that shows live voice state and streams output.

- Build `useSessionState` hook with subscriber pattern (subscribe to orchestrator events, return current session shape)
- Add session-event emission to `councilOrchestrator.ts`:
  - `stage-change` on every transition
  - `voice-state` on every Promise.allSettled result
  - `voice-output` from progress callbacks (some plumbing — the AgentTool already streams via `onProgress`, just need to route those into the session bus)
  - `session-end` on final return
- In REPL.tsx, branch on `isInSession`: render `CouncilSessionScreen` instead of `FullscreenLayout`
- Hook session state into VoiceList (status glyphs), StagePane (focused voice's output), SessionStatus (cost/elapsed/agent count)
- Esc key: background the session (state held, REPL returns)
- Ctrl-C: cancel via existing AbortController

**Verification**: run `/council run "rename foo to bar"` in a wide terminal. Session view appears. Voices light up as they start. Output streams in the center pane. Status updates live.

**Gate**: does the council flow work end-to-end through the new view, and does the chat REPL still work in normal mode?

### Phase C — Wire to discover orchestrator (Day 4 — Thu, 2h)

**Goal**: same session view also handles `/discover` (debate mode).

- Add session-event emission to `debateOrchestrator.ts` (mirror Phase B)
- Stage names map: `r1` / `r2` / `synthesist` → `proposal` / `revision` / `synthesis`
- Voice list adapts: 4 voices instead of 7
- StagePane handles round transitions

**Verification**: `/discover "What is gravitational lensing?"` shows session view with 4 voices, two rounds, then synthesist. Brief appears in the regular REPL when session ends.

**Gate**: does discover work in session view as cleanly as council does?

### Phase D — Polish + keybindings (Day 5 — Fri, 3h)

- Tab to switch focused voice in VoiceList → center pane updates
- Up/Down arrow to scroll the center pane (the voice's output may be long)
- `/pause` slash command in SessionCommand (mid-session)
- `/resume` after pause
- Help bar text at bottom of screen
- Color accents: orange (`rgb(255,106,0)`) for active/focused, dim for pending
- Background mode: when Esc is pressed, the session continues but UI returns to REPL. The bar at the bottom of REPL shows `▎ session running — /council show to return`

**Verification**: keyboard navigation feels right. Tab cycles cleanly. Esc → return → `/council show` → back to session.

### Phase E — Tests + smoke + ship (Day 6–7 — Sat+Sun, 4h)

- Unit tests for `useSessionState` (subscribe/unsubscribe, event handling, state shape)
- Snapshot tests for `CouncilSessionScreen` at three widths (140, 100, 70)
- Live smoke: full council run, full discover run, background+return, cancel mid-stream
- Update `COUNCIL.md` with the new mode
- Mark `TUI_REDESIGN.md` Phases 4/5 explicitly as superseded (already done in §14)

**Final gate**: live smoke test of all three scenarios passes. Commit + merge to main.

---

## 7. Timeline (calendar)

| Day | Date | Phase | Goal | Hours |
|-----|------|-------|------|-------|
| Sun | 2026-06-07 | (this) | Design doc + sign-off | 1 |
| Mon | 2026-06-08 | A | Static scaffold | 3 |
| Tue | 2026-06-09 | B (part 1) | Session state hook + council emit | 3 |
| Wed | 2026-06-10 | B (part 2) | REPL integration + wiring complete | 3 |
| Thu | 2026-06-11 | C | Discover wiring | 2 |
| Fri | 2026-06-12 | D | Polish + keybindings | 3 |
| Sat | 2026-06-13 | E (part 1) | Tests + smoke | 2 |
| Sun | 2026-06-14 | E (part 2) | Final smoke + ship | 2 |
| **Total** | | | | **~19h** |

Buffer: ~3–6h built in for surprises (real estimate likely 20–25h).

---

## 8. What this does NOT include

Explicit non-goals for v1:

- **Multi-session view** — only one session active at a time. No tabs of past sessions.
- **File tree pane** like Onyx's left strip. Council doesn't browse files the same way.
- **Graph / backlinks panes** — irrelevant for a multi-agent debate session.
- **Persisted session history** as a UI surface (the JSONL telemetry from `TELEMETRY_PLAN.md` is separate).
- **Interactive voice reordering** in the VoiceList.
- **Live editing of the prompt mid-session** — the session is locked to its initial prompt.
- **The dormant `StatusPane.tsx`** from Phase 3b is not used here. The right-column status in session view is a *different* component (`SessionStatus.tsx`) because the data + layout assumptions differ.

These are candidates for v2.

---

## 9. Decisions (resolved 2026-06-07)

1. **Background mode behavior** → **continue running silently.** Esc backgrounds the session; orchestrator keeps emitting events; the screen doesn't render them until the user runs `/council show`. A thin status hint at the bottom of regular REPL indicates a session is alive.
2. **`/discover` long output** → **first 200 lines scrollable** in the StagePane during the synthesist stage. Full brief lands in the regular REPL after session ends.
3. **Voice color coding** → **per-voice, reusing `vendorBadge.ts` palette** (the existing colors from Phase 1 vendor-badge work). Center pane title still uses orange accent for the focused voice's name.
4. **Modal commands during session** → **read-only allowed, write-rejected.** `/spend`, `/status`, `/theme`, `/help` work mid-session. `/council`, `/discover`, `/handoff` reject with "session already active — Esc to background it first."
5. **Stage transition animation** → **hard cut for v1.** Animated transitions added to BACKLOG as P4 future polish.

---

## 10. Reference

- `assets/Screenshot 2026-06-07 091531.png` — Onyx workspace shot for visual direction
- `TUI_REDESIGN.md` — Phase 1 (theme), Phase 2 (chrome), Phase 3a (status bar) — all still live. §14 documents the Phase 3b revert that motivated this redesign.
- `src/coordinator/council/councilOrchestrator.ts` — primary source of council events
- `src/coordinator/council/debateOrchestrator.ts` — primary source of debate events
- `src/coordinator/council/vendorBadge.ts` — per-voice color tokens to reuse
- `src/components/StatusPane.tsx` — dormant from Phase 3b. Reference for the SessionStatus implementation but not directly reused.

## 11. Phase A status — shipped

Landed in commit `62c6048` (initial scaffold) and `5cbcd35` (truecolor + border-bg + Onyx bg).

**Files created** under `src/components/CouncilSession/`:

| File | Role |
|------|------|
| `types.ts` | `SessionState` / `Voice` / `Stage` / `VoiceStatus` type definitions |
| `mockData.ts` | `MOCK_COUNCIL_SESSION` (7-voice mid-proposal) + `MOCK_DISCOVER_SESSION` (4-voice just started) |
| `VoiceList.tsx` | Left pane — status glyphs (`● ▸ ✓ ◯ ✗ ⏸`) |
| `StagePane.tsx` | Center pane — focused voice's output; placeholder for non-proposal stages until Phase B/D |
| `SessionStatus.tsx` | Right pane — cost / tokens / elapsed / active list with `useSecondTick` |
| `SessionCommand.tsx` | Bottom command bar — static visual stub (real input wires in Phase D) |
| `CouncilSessionScreen.tsx` | Top-level layout — per-pane round borders via Council's `borderText`, solid `#1e1e24` bg, width-responsive collapse |
| `index.ts` | Public re-exports |

Plus `scripts/preview-council-mode.tsx` — standalone Ink renderer with mock data:

```bash
COLORTERM=truecolor bun run scripts/preview-council-mode.tsx           # council
COLORTERM=truecolor bun run scripts/preview-council-mode.tsx discover  # discover
```

**The hard rule honored** (`§5`): every child receives explicit `availableColumns`. No child calls `useTerminalSize()`. This is what makes the multi-pane layout work without the Phase 3b wrap bug.

**Surprises discovered + fixed during Phase A**:

- Ink's `backgroundColor` doesn't auto-inherit through child Boxes — applied defensively to every pane.
- Ink's render layer didn't apply Box `backgroundColor` to border characters — modified `src/ink/render-border.ts` to do so when `backgroundColor` is set. Zero regression risk (conditional behavior). Side benefit: any future component using `backgroundColor` + `borderStyle` gets solid borders for free.
- `COLORTERM` env var unset by default in WSL terminals — chalk downgraded RGB to 256-color, snapping every dark-with-tint color to gray. Fixed in `bin/council` so the whole onyx-orange theme renders in actual truecolor now, not just session view.

**Effort**: Phase A budget was 3h; actual ~5h after color-debug iteration.

## 12. Phase B status — shipped (MVP)

Replaces the static mock data with live event-driven state from the council / debate orchestrators. Running `/council` or `/discover` now causes the REPL to swap to the session view.

**Files created**:

| File | Role |
|------|------|
| `src/coordinator/council/sessionBus.ts` | Module-level event bus — `emit()` / `subscribe()` / `clearAllListeners()` |
| `src/hooks/useSessionState.ts` | React hook — subscribes to bus, reduces events into `SessionState`, returns null when no session |

**Files modified**:

| File | Change |
|------|--------|
| `src/coordinator/council/councilSpawn.ts` | `runCouncilFromToolContext` wraps with try/finally and emits `session-start` / `session-end`. `buildCouncilAdapters` wraps each spawn callback to emit `voice-state` (running → done/failed), `voice-output` (text on settle), and `stage-change` (proposal → synthesis → execution → review) |
| `src/coordinator/council/debateSpawn.ts` | Same pattern for `/discover`: kind=`discover`, voices=`RESEARCH_ROLES`, stages map round 1→proposal, round 2→revision, synthesist→synthesis |
| `src/screens/REPL.tsx` | `useSessionState` hook at the top; early-return `<CouncilSessionScreen>` when sessionState is non-null; falls through to regular REPL otherwise |

**End-to-end flow**:

1. User types `/council run "..."` → orchestrator fires
2. `emit('session-start', voices)` → hook updates state → REPL swap
3. As proposals spawn: `emit('voice-state', running)` → voice glows orange ●
4. As proposals settle: `emit('voice-output', text)` + `emit('voice-state', done, headline)` → ✓ + headline + text in center pane
5. Stage transitions: `emit('stage-change', stage)` → top bar updates
6. Orchestrator returns → `finally { emit('session-end') }` → state → null → REPL falls through to regular chat
7. Result diff/brief renders inline in regular chat via existing executor path

**Verification done**: `bun run build` clean, 36/0 tests pass on debate orchestrator + ThemePicker. Live REPL smoke pending user confirmation.

**Effort**: Phase B budget was 6h; actual ~3h thanks to the clean adapter-callback pattern already in the orchestrators.

## 13. What's deferred to Phase C / D

**Note (2026-06-07)**: Phase C scope was reframed mid-Phase-B based on user feedback — the session view becomes the *outermost layout always*, not just a session-mode replacement. See `PHASE_C_PLAN.md` for the dedicated plan including layout decisions (stacked-left voice panes, split center, cumulative idle status).

Carried over from `§6` phase plan; explicitly not in Phase B MVP:

- **Phase C — discover-specific polish**: discover voices wire through the same adapter pattern as council. Should "just work" but needs smoke against a real `/discover` run.
- **Phase D — keybindings + polish**:
  - `Esc` to background the session (state held; REPL falls through; `/council show` re-enters)
  - `Tab` to cycle focused voice (currently auto-focuses the last-running voice)
  - `Ctrl-P` palette / `Ctrl-B` sidebar toggle
  - Per-voice colors via `vendorBadge.ts` (currently all use the single orange accent)
  - Real chunk-by-chunk streaming via AgentTool's `onProgress` (currently text arrives in one shot on spawn settle)
  - Synthesizer / Executor / Review stage content in the center pane (currently shows `[stage — content TBD in Phase B]` placeholder; the executor stage particularly needs a file-diff renderer)
  - `SessionCommand` real input wiring (currently a static visual stub)
- **Phase E — tests + ship**:
  - Unit tests for `useSessionState` (subscribe/unsubscribe, reducer transitions)
  - Snapshot tests for `CouncilSessionScreen` at three widths (140 / 100 / 70)
  - Live smoke covering full council + full discover + cancel mid-stream
