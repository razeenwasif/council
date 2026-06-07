# TUI Redesign — Onyx-inspired layout, Amber Accent

> Design spec for redesigning Council's TUI to match the visual language of `~/Onyx` (Rust + ratatui TUI Obsidian clone) while swapping its purple accent for amber (`#f59e0b`). Multi-pane focus-aware layout, Onyx palette, polished border chrome. Implementation is phased so each step is independently reviewable.

**Status**: planned. Not implemented.
**Target**: ship before starting Week 1 (Phase 0 eval-harness work) of the research project.
**Estimated effort**: 25–40 hours across 5 phases. Stoppable after any phase.

---

## 1. Vision

Council's current TUI is a vertical scroll: prompt → streaming assistant text → agent panel rendered as a grouped tree at the bottom of message history. Functional but undifferentiated from upstream Claude Code.

Onyx renders as a horizontal three-region layout: sidebar (file tree / navigation), center (editor / preview), right or bottom (status, calendar, contextual info). Borders are focus-aware (active pane = bold accent border; inactive = dim). The whole thing has a kanagawa-flavored palette with warm off-white text on a near-black base, and a strong single accent.

We translate this into Council's domain as:

```
┌─ agents ─────┬─ chat ─────────────────────────────────────────┬─ status ────────────┐
│ ▸ architect  │ user> rename the foo helper to bar              │ tokens   12.4k      │
│   implementer│                                                  │ cost     $0.18      │
│   skeptic    │ ▎ Critic (gpt-4.1-mini):                        │ elapsed  7m 22s     │
│   critic     │   Add a debounce wrapper around the keystroke   │ model    opus-4-7   │
│   tester     │   handler.                                       │                     │
│   security   │                                                  │ ─ active ─          │
│   performance│ ▎ Skeptic (gemini-3.5-flash):                   │ 4/7 done            │
│              │   Check whether the existing throttle config…   │ 2 in flight         │
│              │                                                  │ 1 failed            │
│              │ ❯ _                                              │                     │
└──────────────┴──────────────────────────────────────────────────┴─────────────────────┘
```

- **Left pane** — active agents with status indicators (`▸` focused / `●` running / `✓` done / `✗` failed). Replaces the bottom-of-history agent panel.
- **Center pane** — the chat / REPL stream. Still the primary surface.
- **Right pane** — at-a-glance run state: tokens, cost, elapsed, model in use, completion counts.

Width-responsive: under ~120 columns the right pane collapses to a single bottom status line; under ~80 columns the left pane collapses into a togglable overlay (Onyx pattern).

---

## 2. Palette spec — `onyx-orange` theme

Add as a new theme (`onyx-orange`) alongside the existing 6. Doesn't replace any. Activate via `/theme onyx-orange` or set `theme: onyx-orange` in config.

Built from Onyx's `obsidian_dark()` palette, with `accent` swapped from `#a78bfa` (purple) to `#f59e0b` (amber). Council has ~70 tokens to Onyx's ~20; the extras (semantic colors, diff colors, rainbow shimmer) inherit from Onyx where there's a match and from Council's dark theme where there isn't.

### Core mapping

| Onyx token | Onyx hex | Council target | Council hex |
| --- | --- | --- | --- |
| `bg` | `#1e1e24` | `clawd_background` | `rgb(30,30,36)` |
| `bg_alt` | `#262631` | `userMessageBackground` | `rgb(38,38,49)` |
| `bg_sel` | `#3a3a4d` | `selectionBg` | `rgb(58,58,77)` |
| `fg` | `#dcd7ba` | `text` | `rgb(220,215,186)` |
| `fg_dim` | `#9b97a8` | `inactive` | `rgb(155,151,168)` |
| `fg_subtle` | `#6e6a7c` | `subtle` | `rgb(110,106,124)` |
| `accent` (purple → **amber**) | `#f59e0b` | `autoAccept`, `merged`, `permission` | `rgb(245,158,11)` |
| `link` | `#7aa2f7` | `suggestion`, `briefLabelYou` | `rgb(122,162,247)` |
| `tag` | `#34d399` | `success` | `rgb(52,211,153)` |
| `code` | `#f7768e` | `error` | `rgb(247,118,142)` |
| `heading` | `#e0c889` | (used for headings in markdown) | `rgb(224,200,137)` |
| `heading_alt` (purple) | `#fb923c` (amber variant for h2) | n/a | `rgb(251,146,60)` |
| `border` | `#3a3a4d` | `promptBorder` | `rgb(58,58,77)` |
| `border_focus` (purple → **amber**) | `#f59e0b` | (focused borders) | `rgb(245,158,11)` |

### Council-specific tokens

| Token | Choice | Reason |
| --- | --- | --- |
| `claude`, `claudeShimmer`, `briefLabelClaude` | unchanged (`rgb(215,119,87)`) | brand-protected; keep claude orange even when accent is amber |
| `bashBorder` | `rgb(247,118,142)` (Onyx code pink) | bash-blocks visually distinct from regular borders |
| `warning` | `rgb(224,175,104)` (Onyx warning) | matches kanagawa palette |
| `diffAdded` / `diffAddedDimmed` | green derivatives of `#9ece6a` | Onyx success |
| `diffRemoved` / `diffRemovedDimmed` | red derivatives of `#f7768e` | Onyx error |
| `purple_FOR_SUBAGENTS_ONLY` | unchanged | semantic token for agent identification, not the theme accent |
| `orange_FOR_SUBAGENTS_ONLY` | unchanged | same |
| `fastMode` | `rgb(245,158,11)` | the new amber, now globally consistent |

### Why "amber" specifically

`#f59e0b` is what Onyx already uses as its `accent_alt`. It's been visually tuned to harmonize with the rest of the Onyx palette. Stealing it directly is the move with the lowest design risk.

---

## 3. Phased implementation plan

Each phase is independently testable and reviewable. Stop after any phase if it feels like enough.

### Phase 1 — Palette only (3–5h)

**Goal**: ship the `onyx-orange` theme without touching layout. Lowest risk; highest visual ROI.

**Files to touch**:
- `src/utils/theme.ts` — add `onyx-orange` to `THEME_NAMES`, `onyxOrangeTheme` constant, dispatch in `getTheme()`
- `src/components/ThemePicker.tsx` — add to the picker list
- `src/utils/theme.test.ts` (if exists) — add round-trip assertion
- `COUNCIL.md` — document the new theme

**Verification**: switch to the new theme, eyeball every screen (REPL, agent panel, diff viewer, error messages, prompt input). Iterate on any token that looks wrong against the rest.

**Decision gate**: does it *feel* like Onyx with amber? If no → tweak palette before Phase 2. If yes → continue.

### Phase 2 — Border + spinner chrome (4–6h)

**Goal**: standardize border characters and spinner glyphs across the existing layout. No structural changes yet — just making the existing surfaces look like Onyx pieces.

**Files to touch**:
- `src/components/Box.tsx` and friends (Council uses Ink's `<Box borderStyle>` — audit which border styles are in use; standardize on `'round'` matching Onyx's `╭─╮│╰─╯`)
- Anywhere `borderColor` is hardcoded → route through `theme.border` / `theme.border_focus`
- Spinner components → swap to braille-style consistent with Onyx (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`)
- Agent panel borders → focus-aware

**Verification**: every framed surface uses round borders; focused ones use amber; spinners look uniform.

**Decision gate**: is the chrome consistent? Anything still using the upstream Ink defaults?

### Phase 3 — Status pane (right column) (5–8h)

**Goal**: introduce the right-column status pane. First structural change.

**Files to touch**:
- `src/screens/REPL.tsx` — wrap existing center content in a `<Box>` row with a new `<StatusPane>` on the right
- `src/components/StatusPane.tsx` *(new)* — render tokens, cost, elapsed, model, agent counts
- Hook into existing telemetry sources (cost-tracker, sessionStorage, councilOrchestrator's progress callbacks)
- Width responsiveness: collapse to single-line bottom bar at <120 cols

**Verification**:
- Status fields update live during a `/council` run
- Resizing terminal collapses + expands cleanly
- No regression in chat scroll / streaming behavior

**Decision gate**: does the right pane add information density without crowding? If it feels noisy → kill some fields or move them to overlay.

### Phase 4 — Agent sidebar (left column) (8–12h)

**Goal**: move the agent panel from "below the chat" to "left sidebar". The biggest structural change.

**Files to touch**:
- `src/screens/REPL.tsx` — three-column root layout
- `src/components/AgentSidebar.tsx` *(new)* — list of agents with status, headlined output preview, focus indicator
- `src/coordinator/council/councilOrchestrator.ts` — emit per-agent state updates the sidebar can subscribe to (some of this exists; will need adapter glue)
- `src/coordinator/council/debateOrchestrator.ts` — same for debate
- Remove (or hide behind a flag) the existing grouped-bottom agent panel
- Width responsiveness: collapse to overlay (`Ctrl-B` to toggle) at <80 cols

**Verification**:
- All 7 council voices appear in the sidebar during a council run
- All 4 debate voices appear during `/discover`
- Per-agent status (running / done / failed) updates live
- Click / focus a sidebar entry → its full output renders in the center
- Removing the bottom panel doesn't lose any information

**Decision gate**: does the sidebar feel more or less informative than the bottom panel? If less → keep both for now (toggle), don't force the change.

### Phase 5 — Focus management + keyboard polish (5–9h)

**Goal**: Onyx-style multi-pane keyboard navigation. Currently Council's input always goes to the prompt. We'd add `Tab` to cycle panes, `Ctrl-B` to toggle sidebar, etc.

**Files to touch**:
- `src/hooks/useFocus.ts` *(new)* — global focus controller, single source of truth
- All input-handling components consult it before consuming key events
- Status bar shows currently-focused pane
- Documented keybindings in `COUNCIL.md`

**Default keymap**:
- `Tab` — cycle focus (chat → sidebar → status → chat)
- `Ctrl-B` — toggle left sidebar
- `Ctrl-R` — toggle right status pane
- `Ctrl-P` — command palette (matches Onyx)
- `Esc` — return focus to chat
- All existing Council keybindings unchanged

**Decision gate**: does multi-pane focus feel natural, or does it slow down the common-case (chat-only) workflow? If the latter → make multi-pane opt-in via a flag.

---

## 4. What stays the same

- All command behavior (`/council`, `/discover`, `/handoff`, `/spend`, etc.)
- All orchestration logic (council, debate, executor flow)
- All shim provider wiring
- All cost-ledger / telemetry plumbing
- Markdown rendering in the chat stream
- Auto-accept / permission prompts (only their styling changes)

---

## 5. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Ink's flex layout doesn't behave like ratatui's `Layout::default()` | high | medium | prototype Phase 3 layout in isolation before integrating into REPL |
| REPL.tsx (~263 KB) has hidden assumptions about vertical-only layout | medium | high | start Phase 3 with a feature flag; both layouts coexist until validated |
| Agent panel's grouped rendering depends on shared `message.id` — moving it to a sidebar breaks that | medium | medium | Phase 4 must preserve the grouping logic; sidebar reuses existing `applyGrouping` |
| Width responsiveness breaks on small terminals | medium | low | test at 60, 80, 120, 200 columns; collapse rules are simple |
| Research project delayed by UI work | high | medium | hard time-box: Phase 1+2 must ship within 1 week, otherwise pause and start research |
| User decides the deep redesign isn't worth it after seeing Phase 3 | medium | low | each phase is independently shippable; Phase 1 alone is a real improvement |

---

## 6. Backout plan

The redesign lives entirely in `onyx-orange` theme + new components. If a phase ships and feels wrong:

- **Theme**: switch back with `/theme dark`. Both themes remain.
- **Layout phases**: each one is gated by a feature flag (`CLAUDE_CODE_TUI_V3=1` or similar). Default off until the user opts in.
- **Hard rollback**: every phase is its own commit (or series). `git revert` cleanly.

---

## 7. Time-box

If Phases 1+2 take longer than **1 week** of focused work, pause and start the research project. The UI can be revisited between research phases.

This is non-negotiable. The research project is the primary deliverable; the UI is the working environment for the research. A perfect working environment that delays the research by 6 weeks is a worse outcome than a "good enough" environment that ships the research on time.

---

## 8. What gets committed first

If you approve this spec:

1. This document (`TUI_REDESIGN.md`) is committed to `main` as the planning artifact.
2. Phase 1 starts on a new branch `feat/onyx-orange-theme`.
3. Phase 1 ships as a PR you review before merge.
4. Each subsequent phase: same pattern.

No code is written until you sign off on this plan.

---

## 9. Decisions (resolved)

Q1–Q5 resolved 2026-06-06. Recorded here so future-you doesn't re-litigate them.

1. **Light variant** → **dark only.** Doubling the palette work for an unused mode is over-engineering. Add later if the user actually switches to light terminals.
2. **Daltonized + ANSI variants** → **skip both.** No color vision deficiency in the user; modern terminal truecolor support is universal in the user's environment. Add later if either becomes a real need.
3. **Cursor styling** → **deferred to Phase 2.** Initial Q3 answer ("5-line addition to Phase 1") was incorrect — Council's `TextInput.tsx` cursor uses `chalk.inverse` with branches for voice-recording waveform and accessibility mode. Theme-coupling the cursor requires adding a theme token + threading it through `useTextInput`'s `invert` handler. Cleaner to bundle with Phase 2's chrome polish. On `onyx-orange`, `chalk.inverse` against the new dark bg still produces a clearly-visible cursor block.
4. **Agent sidebar (Phase 4)** → **read-only initially.** Interactivity (Enter to navigate to that agent's output anchor in the chat) becomes part of Phase 5's focus-management work, where the global focus controller already exists. Don't entangle Phase 4 scope with focus plumbing.
5. **Status-pane collapse priority** → **cost · elapsed · agent-progress.** When the right column collapses to a single bottom line at narrow widths, those three survive. Tokens and model demoted to the expanded view only.

   Collapsed format:
   ```
    ▎ $0.18 · 7m 22s · 4/7 done · running: implementer, skeptic
   ```
   The "running:" tail truncates with ellipsis as width shrinks.

## 10. Phase 1 status — shipped

Landed in commit `c9fb62f`:

- `src/utils/theme.ts` — added `onyxOrangeTheme` constant (~70 tokens) + `'onyx-orange'` in `THEME_NAMES` + `getTheme()` dispatch. Promoted to default fallback.
- `src/components/ThemePicker.tsx` — new entry in the picker list.
- `~/.openclaude.json` — user-level theme set to `onyx-orange`.

Verification: `bun run build` clean, ThemePicker test green, type-check clean on changed files.

Switch with `/theme onyx-orange` or via the picker.

## 11. Phase 2 status — shipped

Border + spinner chrome standardization. Audit-driven scope:

**Border audit finding**: zero structural changes needed.
- 36 surfaces already use `borderStyle="round"` (Onyx `╭─╮│╰─╯`).
- 5 use `borderStyle="single"` but only for single-edge dividers (`borderTop` only, etc.) — `round` doesn't apply to single-edge cases; the character set is the same.
- 7 use `borderStyle="dashed"` for semantic "needs attention" surfaces (permission prompts, theme preview, plan approval) — preserved as the deliberate visual distinction.
- 5 dynamic `borderStyle={...}` — already resolve to `'round'` or are layout-controlled (Logo, search box) and out of scope.

**Spinner glyphs** changed: `src/components/Spinner/utils.ts` `getDefaultCharacters()` now returns braille frames `['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏']` — universal across terminals, matches Onyx's visual idiom, smoother visually than the previous asterisk/flower sequence. Dropped the macOS/Ghostty/Linux conditional branches since braille renders uniformly everywhere.

**Cursor styling** (deferred from Phase 1): `src/components/TextInput.tsx` now uses an amber (`rgb(245,158,11)`) background with black foreground and SGR 5 (slow blink) when the active theme is `'onyx-orange'`. Other themes keep `chalk.inverse`. Blink degrades gracefully on terminals that ignore SGR 5 — the amber bg always shows. Voice-recording waveform mode and accessibility-mode no-cursor paths preserved untouched.

Verification: `bun run build` clean, TextInput tests green (3 pass / 0 fail).

Not done (genuinely Phase 3+):

- Focus-aware borders (`theme.border` vs `theme.border_focus` on active pane) — depends on the focus-management primitive being built in Phase 5.
- `COUNCIL.md` theme documentation — still discoverable via the picker; full docs deferred to wrap-up.

Effort: ~3h actual (vs. 4–6h budgeted). Border audit being a no-op saved time.

## 12. Phase 3 status — Phase 3a shipped, Phase 3b deferred

Scope cut: the original Phase 3 plan was "full right-column status pane that collapses to a bottom bar at narrow widths." After auditing `src/screens/REPL.tsx` (the 5,101-line root render component using `FullscreenLayout` with `scrollable={...}` + `bottom={...}` props), shipping the full side pane requires modifying `FullscreenLayout` to accept a `rightPane` prop or wrapping the entire `mainReturn`. Both are structurally risky on the highest-trafficked file in the codebase. So Phase 3 was split:

- **Phase 3a (shipped)** — collapsed bottom bar only. Single line above the prompt input area inside the existing `bottom={...}` flex row. No layout surgery. Theme-gated to `onyx-orange`.
- **Phase 3b (deferred)** — full right-column side pane for wide terminals. Requires `FullscreenLayout` surgery. Will revisit after Phase 4/5 if the appetite remains.

**Phase 3a landed**:

- `src/components/StatusBar.tsx` (new, ~110 LOC) — single-line indicator rendering `▎ $0.18 · 7m 22s · 3 running` above the prompt input. Hidden when terminal width <60 cols. Uses an internal `useSecondTick` hook for the live elapsed timer; all hooks called unconditionally to satisfy React's rules-of-hooks (caught a bug during integration where the early-return-then-hook ordering would have thrown when the theme switched at runtime).
- `src/screens/REPL.tsx` — 1 new import, 1 new render line passing through the existing `loadingStartTimeRef`, `totalPausedMsRef`, `pauseStartTimeRef`, `inProgressToolUseIDs` props.

**Data sources hooked in** (no new state):

| Field        | Source                            |
| ------------ | --------------------------------- |
| Cost         | `getTotalCost()` (cost-tracker)   |
| Elapsed      | `loadingStartTimeRef` + paused refs (computed at render) |
| Running      | `inProgressToolUseIDs.size`       |

**Format and behavior**:

- `▎ $0.18 · 7m 22s · 3 running` when actively loading with agents
- `▎ $0.18` when idle (cost-only)
- Elapsed timer hidden when not loading
- Agent count hidden when zero
- Bar hidden entirely when not on `onyx-orange` theme or terminal narrower than 60 cols
- Other themes see no change in REPL layout

**Verification**: `bun run build` clean, ThemePicker + TextInput tests green (4 pass / 0 fail), type-check clean on changed files. No live-REPL smoke test yet — needs a real session to confirm the elapsed timer ticks and the amber accent renders against the dark background.

**Not done (deferred to Phase 3b or later)**:

- Full right-column side pane with `tokens / cost / elapsed / model / agent breakdown` (expanded mode)
- `totalAgentCount` field — currently undefined since the orchestrator's "spawn batch size" isn't exposed to REPL state. Would need a new piece of plumbing from `runCouncilFromToolContext` / `runDebateFromToolContext`. Defer with Phase 3b.
- Width-based switch between bar and pane modes

Effort: ~2h actual on Phase 3a (vs. 5–8h budgeted for the full Phase 3). Phase 3b will be its own pass when scheduled.

## 13. Phase 3b status — full right-column pane

Ships the wide-terminal expanded status pane that complements Phase 3a's bottom bar. Theme-gated to `onyx-orange`, width-gated to `STATUS_PANE_MIN_WIDTH = 120` cols.

**Implementation choice** — external wrap at REPL level (not modifying FullscreenLayout):

After auditing `FullscreenLayout.tsx` (636 LOC, internal vertical column layout with React-Compiler-generated cache slots `_c(47)`), the two viable paths were (A) adding a `rightPane` prop to FullscreenLayout, or (B) wrapping FullscreenLayout in a row layout at the REPL level. Path A required growing the compiler cache and editing dense generated code; Path B leaves FullscreenLayout untouched at the cost of one cosmetic glitch.

**What landed**:

- `src/components/StatusPane.tsx` (new, ~130 LOC) — fixed-width right-column box with left amber border. Shows cost (highlighted in amber) / tokens / elapsed / running, each on its own row with right-aligned values. Width = `STATUS_PANE_WIDTH` (22 cols). Hidden when theme isn't `onyx-orange` or terminal width < `STATUS_PANE_MIN_WIDTH` (120 cols).
- `src/components/StatusBar.tsx` — added upper-bound width gate: returns null when columns ≥ 120 so it steps aside for the pane. Bar + pane are now mutually exclusive based on terminal width.
- `src/screens/REPL.tsx` — wraps the existing `<FullscreenLayout ... />` in `<Box flexDirection="row" flexGrow={1}>` with `<StatusPane>` as a sibling. No changes to FullscreenLayout itself.

**Width behavior** (summarized):

| Width    | Theme is `onyx-orange` | Other themes |
| -------- | --------------------- | ------------ |
| <60 cols  | Nothing               | Nothing      |
| 60–119  | StatusBar (single line above prompt) | Nothing |
| ≥120    | StatusPane (right column) | Nothing |

**Known caveat — cosmetic only**:

`FullscreenLayout` consults `useTerminalSize().columns` for its internal modal divider character (`"▔".repeat(columns)` at the top of slash-command dialogs). Because StatusPane allocates 22 columns via flex, the divider character now overshoots the chat area's actual width by ~22 columns when a modal opens with the pane visible. The line wraps or extends behind/under the pane region. Documented for follow-up; safe to fix by either passing an `availableColumns` prop to FullscreenLayout or by routing terminal-size queries through a context that reflects the flex-allocated width. Not blocking general use.

**Verification**: `bun run build` clean, ThemePicker + TextInput tests 4 pass / 0 fail, type-check clean on changed files. No live-REPL smoke yet — needs running Council in a ≥120-col terminal to confirm the pane renders, the amber border shows, and the bar correctly steps aside.

**Effort**: ~2h actual (within the 5–8h spec budget). Lower than expected because Path B is structurally lighter than Path A.

**Phase 3 (a+b) total**: ~4h actual vs. 5–8h budgeted.

## 14. Phase 3b reverted — the wrap bug was worse than predicted

Smoke test on 2026-06-07 revealed that the cosmetic-only modal-divider caveat was actually a structural problem: **every chat message** with long content gets truncated at the pane border because `useTerminalSize().columns` is consulted not just for the modal divider but for word-wrap calculations across the entire chat render tree. Sample observed truncation:

```
  Given your current branch (feat/tui-status-pane) and uncommitted changes
  to StatusBar.tsx, StatusPane.tsx, and REPL.tsx, I'm guessing you may want
  input on the Phase 3b status pane wo
```

The trailing "rk" of "work" is hidden behind the pane region. The tool became unusable for normal chat.

**Reverted in this commit**:
- Row-wrap of FullscreenLayout in `src/screens/REPL.tsx` — undone, restores full-width chat
- Upper-bound width check in `src/components/StatusBar.tsx` — undone, bar now shows on all widths ≥60 cols on the onyx-orange theme
- StatusPane import in REPL — removed (component file kept in tree for future revival)

**StatusPane.tsx kept in the tree**:
- The file remains as dormant code with no callers
- Can be revived once an `availableColumns` context-shim is in place across the chat render tree
- See `COUNCIL_MODE_REDESIGN.md` for the alternative design direction that supersedes Phase 3b

**Also in this commit — palette adjustment**:
- Accent color swapped from amber `rgb(245,158,11)` to electric orange `rgb(255,106,0)` (Council's existing `fastMode` color, now unified as the theme accent). Pure orange rather than amber/yellow.
- All amber references in `theme.ts`, `StatusBar.tsx`, `StatusPane.tsx`, and `TextInput.tsx` updated to the new value.

**Phase 4/5 of the original spec (focus management, agent sidebar) are now obsolete** — the council-window redesign documented in `COUNCIL_MODE_REDESIGN.md` supersedes them. This document is now historical; refer to the new doc for active work.

## 15. Component deletions (cleanup pass, post-Phase C)

`src/components/StatusBar.tsx` and `src/components/StatusPane.tsx` deleted. Both were dormant after Phase C — StatusBar's responsibilities moved to `CouncilSession/SessionStatus.tsx` (the always-visible right pane), and StatusPane never had any callers (was Phase 3b dead code kept around as a reference). The Phase 3a status sections (§12) and Phase 3b sections (§13, §14) remain in this doc as historical record but the source files they reference no longer exist.
