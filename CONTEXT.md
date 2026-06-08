# CONTEXT.md — Agent Orientation

> Read this first. It is the shortest path from "cold start" to "useful work" on this repo. If a section seems out of date, check the named source file; this document is a pointer, not the source of truth.

---

## What this repo is

**Council** is a multi-agent LLM coordinator built on top of the openclaude / Claude Code lineage. It runs in two modes:

1. **`/council`** — a 7-voice code-review debate (Architect, Implementer, Skeptic, Critic, Tester, Security, Performance) + Synthesizer + Executor. Fires per-prompt against engineering tasks.
2. **`/discover`** — a 4-voice multi-round research-question debate (Hypothesizer, Empiricist, Devil's Advocate, Methodologist) + Synthesist. Writes structured Markdown briefs.

It is also the engineering substrate for an **active research project** (see next section).

The codebase is TypeScript + Bun. The system shells out to multiple LLM providers (Anthropic, Gemini, OpenAI, DeepSeek, Qwen, Mistral) via "shim providers" that adapt each vendor's API to a single internal interface.

---

## The active research project

The user is building a research paper on top of the Council infrastructure:

> **Information-Preserving Quantization of Domain-Specialist Fine-Tunes for Verification in Multi-Agent Scientific Reasoning Systems.**

Short version: frontier API models (Claude, Gemini, GPT) stay the primary reasoners, but a locally-hosted quantized fine-tune of Gemma-4-31B acts as a *verification layer* checking domain-specific claims (gravitational-wave physics + quantization is the pilot domain). The contribution is a controlled ablation across bit-depths (FP16 → Q2) comparing PTQ and QAT.

**This research is the user's primary motivation.** Pull requests, feature additions, and refactors should be evaluated against whether they help or hinder it. Anything that doesn't is lower priority than (a) keeping the engineering stack stable and (b) advancing the planning docs.

For full context: `ROADMAP.md`, `RESEARCH_PROPOSAL.md`, `WEEKLY_PLAN.md`, `LITERATURE_REVIEW.md`, `SYSTEMS_STACK.md`, `CO-SCIENTIST.md`.

---

## User profile

- **Razeen Wasif** (`razeen.wasif66@gmail.com`). Solo researcher.
- Background: gravitational-wave physics + signal processing + ML + quantization. Working on quantization-induced SNR degradation in GW trigger pipelines.
- Primary motivation right now: **portfolio for PhD applications and research jobs**. Optimizing for a publishable paper + reproducible system + open-source artifact.
- Working environment: **WSL2 (Ubuntu) on Windows 11**, RTX 4090 (24 GB), AMD 7800X3D, 64 GB DDR5, ~500 GB SSD free.
- Has paid Claude + Gemini subscriptions (Premium-tier Overleaf as well).
- Wants terse, direct communication. No corporate-speak, no hedging beyond what's actually warranted. Prefers surgical edits over sprawling refactors.

---

## Where to look (file map)

Authoritative references for different needs:

| If you need… | Read… |
| --- | --- |
| Overall project use-guide | `README.md`, `COUNCIL.md` |
| Current target architecture (Co-Scientist long-term) | `CO-SCIENTIST.md` |
| Research project plan with diagrams | `ROADMAP.md` |
| Week-by-week todos for the research | `WEEKLY_PLAN.md` |
| Hardware-specific tooling guide | `SYSTEMS_STACK.md` |
| Formal research proposal (markdown) | `RESEARCH_PROPOSAL.md` |
| Literature survey (markdown) | `LITERATURE_REVIEW.md` |
| LaTeX rendered proposal + lit review | `paper/proposal.tex`, `paper/literature_review.tex`, `paper/references.bib` |
| Open work items | `BACKLOG.md` (organized P2 / P3 / P4) |
| Per-session handoff state | `HANDOFF.md` |
| Project history | `CHANGELOG-COUNCIL.md` |
| Runtime code (the Council system) | `src/` (TypeScript, ~2500 files) |
| Debate code specifically | `src/coordinator/council/`, `src/commands/discover/` |
| Built-in agent definitions | `src/tools/AgentTool/built-in/` |
| TUI palette/border/spinner work (Phases 1–3a) | `TUI_REDESIGN.md` (§14 documents Phase 3b revert) |
| Council-mode session view design + status | `COUNCIL_MODE_REDESIGN.md` (§11 Phase A, §12 Phase B) |
| Phase C design (session view as default layout) | `PHASE_C_PLAN.md` |
| Session view components | `src/components/CouncilSession/`, `scripts/preview-council-mode.tsx` |
| Session bus + state hook | `src/coordinator/council/sessionBus.ts`, `src/hooks/useSessionState.ts` |
| Effective terminal-size shim (Phase C primitive) | `src/hooks/useEffectiveTerminalSize.ts` |
| Chat sub-pane (wraps slot in EffectiveTerminalSizeProvider) | `src/components/CouncilSession/ChatPane.tsx` |
| Single-pane center (workspace + agent-thoughts pane, Alt+1/Alt+2 scroll-focus toggle) | `src/components/CouncilSession/CouncilSessionScreen.tsx` (`WorkspacePane`), `src/components/CouncilSession/StagePane.tsx` (accumulating voice output + synthesis + execution), scroll-focus state in `src/screens/REPL.tsx` (`scrollFocus`) |
| Left-column system monitor (CPU/RAM/GPU/disk/net/proc, polls 2s) | `src/components/CouncilSession/SystemMonitor.tsx`, `src/utils/systemStats.ts` |
| Side-column status widgets (git status + files, tasks) | `src/components/CouncilSession/SidePanes.tsx` (`GitStatusPane`, `SessionTasksPane`), `src/hooks/useGitStatus.ts`, `src/utils/gitStatusReader.ts` (5s poll), `src/hooks/useTasksV2.ts` |
| Persistent scratchpad (`/note <text>` etc.) | `src/utils/scratchpadStore.ts` (file-backed at `~/.openclaude/scratchpad.json`, atomic write-then-rename), `src/hooks/useScratchpad.ts`, `src/commands/note/` |
| Copy full chat transcript (`/copy all`) | `src/commands/copy/copy.tsx` — `all`/`chat`/`history` arg routes through `renderMessagesToPlainText` (`src/utils/exportRenderer.tsx`) and `setClipboard()` (`src/ink/termio/osc.ts`) |
| Council run telemetry (JSONL log + outcome/verification slash command) | `src/utils/councilTelemetry.ts` (types + writer/reader/updater + runs cache + subscribe API), `src/utils/councilTelemetryCollector.ts` (session-bus subscriber that writes records on `session-end`), `src/commands/verdict/` (`/verdict outcome` / `/verdict verify` / `/verdict list`), `~/.openclaude/council-runs.jsonl` (append-only log) |
| Voice-isolation harness (`/voice-test <role> <model-tag> "<prompt>"`) | `src/commands/voice-test/` (slash command), extended `invokeAgentTool` in `src/coordinator/council/councilSpawn.ts` (`providerOverride` + inferred `finishReason`), single-line override at `src/tools/AgentTool/runAgent.ts:348`, telemetry at `~/.openclaude/voice-tests.jsonl`. Lets you test one role × one model × one prompt in ~15-30s instead of ~200s full `/discover`. |
| Verifier role (Co-Scientist Reflection minimal subset — post-synthesist fact-check) | `src/tools/AgentTool/built-in/debate/verifierAgent.ts` (agent definition, tool-stripped, default model `deepseek-r1:7b-council`), `VERIFIER_PROMPT` in `prompts.ts` (3 flagging lenses), `verifierFromAgentTool` + `buildVerifierPrompt` in `debateSpawn.ts`, `SpawnVerifier` + `DebateAdapters.spawnVerifier?` + `DebateResult.verification?` in `debate.ts`, orchestrator integration in `debateOrchestrator.ts` (runs after synthesist, never throws), `formatVerifierSection` in `debateBriefWriter.ts` (appends `## Verification Notes` to brief). Surfaces as a 6th voice in the discover voice list (alongside synthesist) so `voice-state running → done` lights up the agent thoughts pane. |
| arXiv MCP server (empiricist grounding — partial: server connects, model invocation unreliable on local fleet) | `.mcp.json` at repo root (project-scope, uvx-launched `arxiv-mcp-server`), updated `EMPIRICIST_PROMPT` with `<arxiv_mcp_grounding>` directive listing the 4 MCP tools (`mcp__arxiv__search_papers` etc.). Caveat: only Mistral Nemo handles MCP tool-calls reliably through Ollama's OpenAI-compat shim; llama3.1:8b loops, phi4-mini loops, Nemo completes-but-doesn't-invoke (mentions tool names as text without actual calls). See BACKLOG "MCP tool-call compatibility audit" entry. |
| Past-session reading view (persists across Council restarts) | `src/hooks/useCouncilRuns.ts` (runs-cache hook), `PastSessionView` in `CouncilSessionScreen.tsx` (renders telemetry record via `StagePane` when no live session running). Navigation: `Alt+H` older / `Alt+L` newer (gated on `scrollFocus='agent'` + no live session). REPL holds `pastSessionOffset` state; auto-bumps to preserve selection when a new run lands while user is browsing older. |
| Strip `<think>` blocks from voice output (DeepSeek-R1 / Qwen 3 thinking-mode handling) | `src/utils/stripThinkBlocks.ts` (one-shot stripper), applied at all five orchestrator return paths (`researcherFromAgentTool`, `synthesistFromAgentTool`, `proposalFromAgentTool`, `synthesizerFromAgentTool`, `reviewFromAgentTool`). Handles closed `<think>…</think>` blocks AND unclosed (truncated) blocks. Voice output, brief appendix, telemetry preview, and synthesist input all see clean text. |
| Local-model routing config (agentRouting + agentModels) | `~/.openclaude/settings.json` (NOT `~/.claude/` — Council's fork still uses the legacy path, see hard rule #15); defaults in `src/coordinator/council/councilSpawn.ts:569` (`FALLBACK_ROLE_MODEL`); schema in `src/utils/settings/types.ts:739` — `agentModels` requires both `base_url` AND `api_key` (any non-empty string works for local Ollama) |
| Self-improving council telemetry plan | `TELEMETRY_PLAN.md` |

---

## Repository topology

Two GitHub repos are in play:

| Repo | Purpose |
| --- | --- |
| `razeenwasif/Council` (this one) | Full system — code, all docs, canonical paper source in `paper/` |
| `razeenwasif/quant-specialist-paper` | Overleaf-synced LaTeX-only mirror (~7 files). Tracked at `~/Research/quant-specialist-paper/` locally. |

The paper repo exists because Overleaf's GitHub import counts files across the entire repository — even on Premium, Council's ~2,500 files exceed the 2,000-file limit. The paper repo bypasses that.

**Sync direction is one-way: Council → quant-specialist-paper → Overleaf.** Run `make sync-overleaf` from `paper/` to propagate `.tex` / `.bib` changes. The Makefile target enforces this.

---

## Working conventions

### Git

- **Branch policy**: `main` is the working trunk. `feat/*` branches for in-progress features; merge to main when stable.
- **Commit message style**: imperative, scoped. Patterns in use:
  - `feat(scope): ...` — new functionality
  - `fix(scope): ...` — bug fix
  - `docs(scope): ...` or `docs: ...` — documentation
  - `chore: ...` — non-functional cleanup
  - Body explains the *why*, not the *what*. The diff shows the what.
- All commits authored by Claude include the trailer:
  ```
  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```
- **Never amend commits** unless explicitly requested. Always create a new commit.
- **Never force-push to main.**

### When to commit, when to push

- **Never commit without explicit user instruction.** "Make this change" is not "commit it."
- "commit and push" is the standard imperative. If only "commit" is said, do not push.
- The user often reads the diff before approving the commit — don't bundle multiple logical changes into one commit unless asked.

### Code edits

- Prefer the smallest possible change that solves the stated problem.
- Don't add error handling, validation, or abstractions for cases that don't exist.
- **No comments unless the *why* is non-obvious.** Don't restate what well-named code already says. Don't reference the current task or PR.
- TypeScript: existing code uses tabs in some files, spaces in others — match the file you're editing.

### File creation discipline

- **Don't create new docs unless they're clearly load-bearing.** README inflation is the most common AI-agent failure mode here.
- If the user asks "can you document X," ask whether they want a new doc or an addition to an existing one — usually the latter.

---

## Hard rules — things to NOT do

1. **Don't restore OSS-community boilerplate.** `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `release-please-config.json`, GitHub issue templates, etc. were all deliberately removed in commit `2e36441`. This is a personal research repo, not a community OSS project.

2. **Don't break the Overleaf sync.** The `paper/Makefile`'s `sync-overleaf` target depends on:
   - `~/Research/quant-specialist-paper/` existing as a git clone of the standalone repo
   - The current branch being `main`
   - No uncommitted changes to `proposal.tex`, `literature_review.tex`, `preamble.tex`, `references.bib`, `Makefile`, `.gitignore`
   If you change `paper/` files, also run the sync (or remind the user to).

3. **Don't auto-launch `/ultrareview` or similar premium-charging commands.** These are user-triggered and metered. Suggest, don't execute.

4. **Don't add features to Council without checking `BACKLOG.md` first.** Many seemingly-good additions are already listed as deferred-on-purpose with rationale.

5. **Don't refactor `src/coordinator/council/` or `src/coordinator/council/debate*` lightly.** These files have been carefully tuned for fault tolerance, panel rendering, cost ledger enforcement, and provider attribution. Read the file headers + adjacent comments before changing anything load-bearing.

6. **Don't suggest replacing frontier models with local quantized ones in the running system.** The research project explicitly investigates the *hybrid* architecture (frontier reasoners + local verifiers). A wholesale replacement misses the point.

7. **Don't push to `quant-specialist-paper:main` directly from outside the sync target.** Use `make sync-overleaf` from `Council:paper/`. Manual edits to the standalone repo will silently drift from `Council:paper/`.

8. **Don't add `useTerminalSize()` calls inside `src/components/CouncilSession/*`.** Those components compute their layout from an explicit `availableColumns` prop passed by `CouncilSessionScreen`. Calling `useTerminalSize` inside any descendant breaks the multi-pane layout — that's the bug that killed Phase 3b of the original `TUI_REDESIGN`. See `COUNCIL_MODE_REDESIGN.md` §5 "Width handling" for the load-bearing reason.

   **Choosing between `useTerminalSize` and `useEffectiveTerminalSize`** (Phase C addition):
   - `useTerminalSize` → real terminal size. Use it at the screen root or anything painting backgrounds across the whole viewport.
   - `useEffectiveTerminalSize` (in `src/hooks/useEffectiveTerminalSize.ts`) → respects an `EffectiveTerminalSizeProvider` ancestor when present, falls through to real terminal otherwise. Use it in components that may end up inside a flex-allocated sub-pane and need to wrap to that pane's width (`Messages`, `Markdown`, anything with column-clamped layout).
   - Default for new chat-tree components: `useEffectiveTerminalSize`. The performance cost of the indirection is negligible; the cost of getting it wrong is the Phase 3b wrap bug.

9. **Don't emit on the session bus from anywhere except `councilSpawn.ts` or `debateSpawn.ts`.** The bus has one canonical lifecycle: `session-start` → events → `session-end`. Random emissions from elsewhere will desync the React state with reality. If you need a new event type, add it to `sessionBus.ts`'s `SessionEvent` union and route it through the existing emit sites.

10. **Don't disable the `COLORTERM=truecolor` default in `bin/council`.** Without it, chalk downgrades RGB to 256-color, and the entire onyx-orange theme renders as flat gray. The user spent debug time finding this — don't regress it.

11. **Don't disable the `CLAUDE_CODE_NO_FLICKER=1` default in `bin/council`.** This is what makes Council take over the terminal like nvim / yazi / less (alt-screen mode). Without it, Council renders inline in the existing shell scrollback — clutters history, breaks the workspace mental model the user explicitly designed for. Auto-disabled under tmux -CC regardless (alt-screen + mouse tracking corrupts terminal state there); see `src/utils/fullscreen.ts` for the full guard logic.

12. **Don't auto-route plain text to `/council run` or `/discover`.** Phase 3a tried this; it fired the 7-agent council orchestrator for trivial inputs like "hi", burning minutes per turn under sync agent dispatch. Plain text → normal Claude chat; orchestrators run only when the user explicitly invokes `/council run X` or `/discover X`. (The dual-pane workspace layout that originally hosted this auto-routing was itself reverted to a single-pane center on 2026-06-08 — see project history. The "no auto-routing" rule still applies regardless of layout.)

13. **For per-message side-data, key WeakMaps on the message object, not its `uuid`.** Lesson from the dual-pane scrollback filter (since removed in the 2026-06-08 single-pane revert): system / progress / hook-result / streaming-chunk messages don't all carry a `uuid`, so a `Map<uuid, pane>` silently dropped them and leaked them into the wrong pane. The original fix was `WeakMap<messageObject, pane>` keyed on object identity. If you ever need to attach per-message side-data again, use the WeakMap-on-object pattern.

14. **Don't assume Council's API auth is broken just because the API returns `"plan_type":"free"`.** First verify which file is actually being read (see #15 — Council uses `~/.openclaude/`, not `~/.claude/`). If routing is correct, `"free"` in a 429 from Anthropic is the rate-limit category label *after* the Max-tier monthly allotment is exhausted (`resets_in_seconds` ≈ 29 days = monthly cycle). Council reads the OAuth token from `<config_home>/.credentials.json` (via `getClaudeAIOAuthTokens()` in `src/utils/auth.ts`) and sends it as a Bearer token (`src/services/api/client.ts:502-505`). The fix is provider routing (override Anthropic-bound roles in `~/.openclaude/settings.json` `agentRouting`), not patching auth code.

15. **Council's config home is `~/.openclaude/`, NOT `~/.claude/`.** Resolution lives in `src/utils/envUtils.ts:169` (`getClaudeConfigHomeDir()`). Order: `claudeConfigHomeDirOverride` (test-only) → `process.env.CLAUDE_CODE_CONFIG_DIR` → migrated `~/.openclaude/` → legacy `~/.claude/` if `.openclaude` doesn't exist. On this machine `~/.openclaude/` exists (created by an earlier Claude Code session), so all settings, credentials, history, etc. live there. Edits to `~/.claude/settings.json` will be silently ignored. Same applies to `.credentials.json`. The legacy path is preserved as a P3 cleanup item in BACKLOG.md but until that's done, ALWAYS edit `~/.openclaude/`.

16. **Don't let `/onboard-github` quietly set `CLAUDE_CODE_USE_GITHUB=1` in `~/.openclaude/settings.json`'s `env:` block without intent.** The settings module replays `env:` entries into `process.env` at Council startup. Once `CLAUDE_CODE_USE_GITHUB=1` is set, `isAnthropicAuthEnabled()` returns false (`auth.ts:122`), all OpenAI-compatible traffic routes to `models.github.ai`, and Anthropic OAuth is silently disabled. If `/login` autocomplete misroutes a user into `/onboard-github` and they accept, this state persists across sessions. Diagnostic: `cat ~/.openclaude/settings.json | grep -A3 env`. Fix: remove the `env` block (or just delete the `CLAUDE_CODE_USE_GITHUB`/`OPENAI_MODEL` entries inside it).

17. **`agentRouting` only routes subagents, NOT the main loop.** The only caller of `resolveAgentProvider()` is `src/tools/AgentTool/runAgent.ts:348` — the subagent dispatch path. The main conversation loop never builds a `providerOverride` and falls through to the default Anthropic SDK client, which sends the configured `model` name to `api.anthropic.com` with the OAuth Bearer. Implications: (a) setting `model: "gemma4:..."` in settings.json alone is NOT enough to route the main loop to Ollama — the request still goes to Anthropic and either gets rejected (unknown model) or 429s (quota); (b) to route the main loop to an OpenAI-compatible provider, you MUST also set `env: { CLAUDE_CODE_USE_OPENAI: "1", OPENAI_BASE_URL: "...", OPENAI_API_KEY: "...", OPENAI_MODEL: "..." }` in settings.json so the API client picks the OpenAI shim path. Council voices (subagents) still get routed correctly via `agentRouting` regardless. Practical consequence: you can't mix-and-match Anthropic + non-Anthropic at the main-loop level without code changes.

18. **Anthropic's `"plan_type":"free"` in a 429 means Max-tier overage, NOT free-tier auth.** When you exhaust your Pro/Max monthly Code allotment, Anthropic responds with a 429 whose body labels you as `"free"` plus `eligible_promo: null` and a `resets_in_seconds` of roughly 29 days (monthly cycle). The OAuth token is still valid; you're just past the budget. The fingerprint `eligible_promo: null` distinguishes this from GitHub Models' free-tier rejection (GitHub Models doesn't have that field). Don't mistake this for an auth misconfiguration — fix is routing (off-Anthropic for the rest of the month), not credentials.

19. **Council voices stay on local Ollama-hosted models — don't suggest rerouting to Claude/Opus/cloud APIs as a remediation.** Decision made 2026-06-08 after observing tool-call loops on multiple small models (Gemma 12b → Phi-4-mini → Qwen 4b). The thesis (*Information-Preserving Quantization of Domain-Specialist Fine-Tunes for Verification in Multi-Agent Scientific Reasoning Systems*) requires the local fleet to *be* the agentic substrate; routing voices to Claude would conflate "what the small models can do" with "what the frontier model patched up" and make the central claim unfalsifiable. Claude is the *external verifier* — the user pastes the synthesizer brief / executor diff to Claude for critique (`/verdict verify ...` captures the verdict), but Claude never runs as a Council seat. The `agentRouting` block in `~/.openclaude/settings.json` converges on a stable local fleet (gemma e4b/26b-council, phi4-mini, qwen3:4b, deepseek-r1:7b, qwen2.5-coder:7b — all `-council` tuned variants). If a small model fails on a role, fix the role (strip tools, tighten prompt) or swap to a different local model — don't escape to Claude.

20. **Council fan-out voices (skeptic/critic/tester/security/performance + hypothesizer/empiricist/devils_advocate/methodologist) have zero tools — by design, since 2026-06-08.** The role definitions in `src/tools/AgentTool/built-in/{council,debate}/*Agent.ts` now disallow `Read`, `Glob`, `Grep` in addition to the existing write-tool bans. Reason: small models routed through Ollama's OpenAI-compat shim emit malformed tool-call schemas → retry loop → blow past `CLAUDE_CODE_MAX_OUTPUT_TOKENS` before erroring. Killing tool access kills the trap. These voices are *judges* (they receive the proposal + context already), not investigators — they don't need file access. Heavy roles (`architect`, `implementer`, `synthesizer`, `executor`) keep tools because they're on 26b-council which handles tool-call format correctly. If you re-enable tools on a fan-out voice, expect the loop to come back the next time it's routed to a small model.

---

## Frequent context-switches

This repo serves four workstreams in parallel; be careful which one you're operating in:

1. **Engineering the Council system itself** (TypeScript in `src/`) — changes go through tests, often touch the AgentTool / coordinator integration. Read the relevant file's docstring before editing.
2. **TUI / council-mode redesign** (`src/components/CouncilSession/`, `src/coordinator/council/sessionBus.ts`, `src/hooks/useSessionState.ts`, `src/ink/render-border.ts`, `bin/council`) — Onyx-inspired session view for `/council` and `/discover`. Phase A + B shipped; Phase C/D/E pending. See `COUNCIL_MODE_REDESIGN.md` for the full plan.
3. **Documenting the research project** (Markdown at root + LaTeX in `paper/`) — the planning suite. Lower stakes, but cross-references between docs must stay coherent.
4. **Running experiments** (planned, not yet started — see `WEEKLY_PLAN.md`) — once Phase 0 begins, training scripts, eval harness, and ML tooling will live in a separate location (likely `~/Research/quant-specialist/`), not inside this repo.

When the user says "the project" without qualification, they usually mean #3 + #4 (the research). When they say "the codebase" or "Council," they mean #1. When they say "the redesign" or "council mode," they mean #2.

---

## The Overleaf workflow (because it's not obvious)

The user's paper writing flow:

1. Edit `paper/*.tex` (or `RESEARCH_PROPOSAL.md` / `LITERATURE_REVIEW.md` and regenerate LaTeX) on `Council:main`.
2. Commit on main.
3. Run `cd paper && make sync-overleaf`. This pushes the .tex / .bib changes into `razeenwasif/quant-specialist-paper:main`.
4. Overleaf pulls from `quant-specialist-paper` automatically (or via "Pull from GitHub" in the Overleaf UI).
5. Review the rendered PDF in Overleaf.

If the user edits in Overleaf directly (closer to submission deadline), they pull changes back via the recipe in `paper/Makefile` and `~/Research/quant-specialist-paper/README.md`.

**Don't suggest edits to `quant-specialist-paper` directly via gh CLI / web UI / etc. — go through Council.**

---

## Project history worth knowing

- The repo was forked / built on top of openclaude (which was itself built on Claude Code). Some leftover constants and config paths still reference `~/.openclaude/` — these are deliberately kept for now (see BACKLOG P3 entry for migration plan).
- The Council system has been verified end-to-end with real council-authored code: six artifacts in `src/utils/council/` (formatCost, withRetry, lruCache, clamp, parseQueryString w/ revision pass, sanitizePath, debounce, once). These exercise the full propose → synthesize → execute → review → revision flow.
- The `/discover` system has been run against real research (gravitational-wave SNR quantization). Observed failure modes (math slips: `V ∝ ρ⁻³` direction error, Widrow `Δ²/24 vs Δ²/12` constant) directly motivated the verification-layer architecture being proposed.
- **Dual-pane center, then reverted to single-pane (2026-06-07 → 2026-06-08).** Originally the center split into a council workspace pane + research workspace pane (Alt+1/Alt+2 focus swap, per-pane drafts, WeakMap-tagged scrollback, ghost previews). It worked but pane-overlap bugs leaked messages between panes and submit routing was ambiguous (a prompt typed in research could fire council voices). Reverted 2026-06-08: center is now (a) a single workspace pane on the left (chat + prompt input) and (b) an agent-thoughts pane on the right (full column height). The user invokes `/council` or `/discover` explicitly to route a prompt — there's no per-pane auto-routing. `Alt+1` / `Alt+2` repurposed as a **scroll-focus toggle**: which pane gets the orange border + receives bare PgUp/PgDn + Alt+arrow scroll keys. `Shift+PgUp/PgDn` / `Shift+↑/↓` retained as a force-agent fallback. Phasing log: §14 of `COUNCIL_MODE_REDESIGN.md`.
- **Accumulating StagePane (2026-06-08).** The agent-thoughts pane previously showed only the focused voice's `output` field — when another voice took focus, the prior voice's content vanished. Reframed to render *every* voice with non-empty `output` in role order, each in its own `── glyph role (model) ──` section, followed by the synthesizer's plan and the executor's diff. Nothing gets overwritten as the session progresses (the reducer at `src/hooks/useSessionState.ts:86` already appends every voice-output chunk cumulatively across stages — render path just stopped throwing the prior sections away). Scroll up to read earlier voices, scroll down to follow streaming. `stickyScroll={true}` on the inner `ScrollBox` keeps you pinned to the bottom while a new voice is streaming.
- **Side-column status widgets (2026-06-08).** Left column under voice lists: `system` pane (CPU/RAM/GPU/disk/net/proc, polls 2s) + `git` pane (branch · ahead/behind · staged/dirty/deleted/untracked counts + tail of dirty files with status glyphs, polls 5s via the `gitStatusReader` singleton — one subprocess regardless of how many subscribers). Right column under `status`: `scratchpad` pane (file-backed at `~/.openclaude/scratchpad.json`, atomic write-then-rename with `.bak` rescue on parse failure; `/note <text>` / `/note clear` / `/note list`) + `tasks` pane (TaskCreate tail via `useTasksV2()`; assistant-managed, no user-facing slash command). The originally-separate `files` pane was consolidated into the `git` pane on the same day. Slash-command hints render at the *top* of the scratchpad and tasks panes (one dim line each — `/note <text> · clear · list` and `(assistant-managed)`) so they're visible from the first frame; the earlier "pin to bottom via a `flexGrow={1}` spacer" approach collapsed on Yoga's first measure pass when the parent height hadn't propagated yet. The right-column pane flex setup uses `flexGrow + flexShrink` without an explicit `flexBasis={0}` for the same reason — matches the working left-column pattern.
- **`/copy all` for full-chat clipboard (2026-06-08).** Extended the existing `/copy` (which copies the latest assistant message with a code-block picker) with `all` / `chat` / `history` argument. Routes through `renderMessagesToPlainText` for transcript serialization and the existing `setClipboard()` for platform-aware clipboard writes (pbcopy / wl-copy / xclip / xsel / OSC 52 / tmux load-buffer). Also writes a fallback to `$TMPDIR/claude/chat.md` for terminals without clipboard write support.
- **Tool-stripping for fan-out voices (2026-06-08).** Repeated `CLAUDE_CODE_MAX_OUTPUT_TOKENS` runaway failures on Gemma 12b → Phi-4-mini → Qwen 4b traced to a single trap: small models attempt OpenAI-compat tool calls, Ollama's shim can't parse the format, retry loop blows past the cap. Diagnosed in BACKLOG P2 ("Council prompts ↔ local-Gemma adherence"). Fix: added `FILE_READ_TOOL_NAME`, `GLOB_TOOL_NAME`, `GREP_TOOL_NAME` to `disallowedTools` for all 9 fan-out role definitions (`skeptic`, `critic`, `tester`, `security`, `performance`, `hypothesizer`, `empiricist`, `devilsAdvocate`, `methodologist` — `synthesist` already had them disallowed). Heavy roles (`architect`, `implementer`, `synthesizer`, `executor`) retain tool access because they're on 26b-council which handles tool-call format correctly. See hard rule #20. Trade-off: when Claude becomes available again, fan-out voices on Claude *also* lose read tools, but per hard rule #19 we're not routing Council to Claude anyway.
- **Council telemetry Phase 1 (2026-06-08).** Append-only JSONL log at `~/.openclaude/council-runs.jsonl`, one record per orchestrator session. Capture path: `councilTelemetryCollector` subscribes to the session bus and writes on `session-end` — orchestrator code itself is untouched. Each record holds runId / timestamp / kind / prompt + sha-256 hash / per-voice (role, model, status, headline, output length + 500-char preview) / synthesis + execution text (50 K char cap) / final result / total duration. `/verdict outcome <accept|reject|partial|manual>` labels the most recent run; `/verdict verify <correct|partial|incorrect> <notes>` appends a verification record (mechanism for capturing Claude's external critiques in a structured way — directly relevant to the thesis evaluation methodology); `/verdict list [N]` browses recent runs. Records mutate in place via full-file rewrite (single-user, sequential — no locking yet; would matter only if a background process ever wrote concurrently). Schema is versioned for future migrations. The BACKLOG P4 "Self-improving council" entry Phase 1 is now shipped — Phases 2+ (eval harness, verdict calibration, prompt evolution, model routing learning) stay pending.
- **Mixed local-only routing baseline (2026-06-08, then refined later same day).** After several iterations of failure-mode debugging, the converged `~/.openclaude/settings.json` agentRouting is: heavy roles (`architect`, `implementer`, `executor`) → `gemma4:26b-council`; structured-output fan-out (`critic`, `tester`, `security`, `performance`) → `phi4-mini:3.8b-council`; **`methodologist` + `empiricist` → `llama3.1:8b-council`** (Gemma 26b kept cap-hitting; qwen3:4b was lossy on thinking; Llama 8B respects length caps where Gemma family doesn't); explicit chain-of-thought generation (`hypothesizer`, `devils_advocate`) → `deepseek-r1:7b-council`; **`synthesist` + `synthesizer` → `mistral-nemo:12b-council`** (after a clean A/B/C: R1 produced verbose, schema-deviant briefs and confabulated voice IDs; Nemo gave 3.5× speedup, full schema compliance, and voice-citation discipline — the only local model to date that emits `(r1-X, r2-Y)` parenthetical citations); broad pattern recognition (`skeptic`) → `gemma4:e4b-council`. Main chat loop on `gemma4:e4b-council` for fast interactive. `qwen2.5-coder:7b-council` is built and registered in `agentModels` but unrouted — available for A/B against the 26b executor when code-heavy tasks need a specialist. All variants are tuned via `/tmp/<model>-council.Modelfile` (temperature 0.1–0.3, repeat_penalty 1.1–1.2, num_ctx 4096–16384 depending on family). `OLLAMA_NUM_PARALLEL=4` and `OLLAMA_HOST=0.0.0.0:11434` in `/etc/systemd/system/ollama.service.d/override.conf`. `CLAUDE_CODE_MAX_OUTPUT_TOKENS=24576` (rose to 32k → fell to 12k → rose to 16k → settled at 24k as iterations bound the cap-hit failure modes vs legitimate-content needs).
- **Voice-isolation harness shipped (2026-06-08).** `/voice-test <role> <model-tag> "<prompt>"` fires one role × one model × one prompt in 15-30s instead of the ~200s a full `/discover` costs. Backed by `runAgent.ts:348` honoring caller-set `toolUseContext.options.providerOverride` (single-line additive change); `invokeAgentTool` gains optional `providerOverride` input and `finishReason: 'stop' | 'length'` output (cap-hit detection inferred from `outputTokens >= max_tokens - 5`). Telemetry at `~/.openclaude/voice-tests.jsonl`. The harness changed the iteration velocity meaningfully — six single-voice experiments cost <3 minutes vs ~20 minutes of full-pipeline runs, which is how the synthesist routing converged in a single sitting rather than across a week.
- **Methodology finding (2026-06-08): reasoning-distilled models excel at hypothesis generation but underperform at structured synthesis.** Cross-comparison across this session's `/discover` runs converged on a real finding worth surfacing in the thesis: DeepSeek-R1 (a reasoning distill of Qwen-7B) produces the most substantive content when given the `hypothesizer` / `devils_advocate` *generation* role, but fails as the `synthesist` — its thinking-mode reasoning produces verbose, schema-deviant output that doesn't reliably bind with format directives. Tightening the synthesist prompt with a `<critical_citation_rule>` block did not bring R1 into compliance; even given strict parenthetical-citation requirements, R1 used inline "r1-empiricist found that..." mentions instead and hallucinated voice IDs not in the input. Instruction-tuned generalists (Mistral Nemo 12B, observed) are better suited to synthesis: they obey structural directives, emit voice citations, and terminate within the schema. The asymmetry is consistent with the "reasoning models reason about intent; instruction-tuned models pattern-match format" distinction the paper would benefit from documenting.
- **Synthesist prompt tightened with strict citation directive (2026-06-08).** `SYNTHESIST_PROMPT` in `src/tools/AgentTool/built-in/debate/prompts.ts` gained an XML-wrapped `<critical_citation_rule>` block at the top, modeled after the existing `HEADLINE_DIRECTIVE` pattern. Requires parenthetical `(r1-X, r2-Y)` citations on every substantive claim in convergent-claim / disagreements / predictions / open-questions sections, with right/wrong format examples and a "check yourself" rule. Also adds a specific SIKE-class warning ("do not name algorithms / papers / standards that no voice cited"). Effective on Nemo (Nemo respected the format even before the tightening); ineffective on R1 (R1 reinterprets it as a "Sources:" list rather than inline citations). Documented in BACKLOG as the data point that led to filing the Verifier-role entry (Co-Scientist Reflection-agent minimal subset).
- **Verifier role shipped (2026-06-08).** Post-synthesist fact-check pass. Runs automatically after `/discover` synthesist completes (when `DebateAdapters.spawnVerifier` is provided, which `buildDebateAdapters` does by default). Verifier reads the synthesist's brief + all 8 voice positions, applies three flagging lenses (appendix contradiction / named-entity confabulation / ungrounded specificity), emits `## Verification Notes` Markdown that gets appended to the brief file. Never blocks brief output — failures degrade to a "verifier failed" notes section. Surfaces as a voice card in the agent thoughts pane (alongside the 4 researchers + synthesist = 6 voices total). Default model: `deepseek-r1:7b-council`. First successful run 2026-06-08T07:11Z: ran in 9.7s, output 48 chars `<none>` (R1's thinking ate most of the budget — quality tuning is the next iteration). Documents structural fix for SIKE-class confabulations Nemo synthesist tends to produce; the verifier exists as the safety net.
- **arXiv MCP partial integration (2026-06-08).** `.mcp.json` at repo root configures `uvx arxiv-mcp-server`. Empiricist prompt updated with mandatory grounding directive (search_papers → read_paper → cite). Server connects successfully (`/mcp list` shows arxiv connected). HOWEVER: only Mistral Nemo handles MCP tool calls reliably; llama3.1:8b and phi4-mini cap-hit in tool-call loops; Nemo completes-but-doesn't-invoke (treats tool names as text rather than calling them). Net: arXiv MCP infrastructure shipped, but production routing for the empiricist still uses parametric memory because no local model reliably invokes MCP tools through Ollama's shim. Tracked in BACKLOG "MCP tool-call compatibility audit" with two distinct failure modes documented.
- **`<think>` block stripping at orchestrator layer (2026-06-08).** DeepSeek-R1 and Qwen 3 family models emit explicit `<think>...</think>` chain-of-thought blocks before their final answer. `src/utils/stripThinkBlocks.ts` is applied at all five orchestrator return paths (researcher / synthesist / proposal / synthesizer / review) so voice text, brief content, telemetry previews, and synthesist input all see clean text. Handles both closed blocks and unclosed (truncated) blocks. The trace itself is discarded — capturing it to a separate `voice.thinking` field is a deferred BACKLOG follow-up.
- **Role-prompt length caps (2026-06-08).** All council + debate role prompts gained explicit "Length budget: X words" directives + "STOP after [last section]" instructions. Targets: council voices 400-700 words, council synth 800-1200, debate r1 400-600, debate r2 350-550, debate brief 800-1400, council review <200. Tuning was needed because the prompts were originally calibrated for Claude (which auto-bounds via RLHF brevity priors); local models (Gemma especially) keep generating until `max_tokens` cuts them off. Still imperfect — Gemma 4 family ignores length caps at synthesist scale (root cause behind rerouting synthesist to R1).
- **Persistent past-session view (2026-06-08).** When no live session is in progress, the agent thoughts pane reads the most recent telemetry record from `~/.openclaude/council-runs.jsonl` and renders it via `PastSessionView`. The reader hook (`useCouncilRuns`) lazy-hydrates the runs cache from disk on mount, so the pane shows past content across Council restarts. Navigation: `Alt+H` (older) / `Alt+L` (newer), gated on `scrollFocus='agent'` AND no live session. The user can browse the full history of council/discover runs in the pane without ever opening artifact files on disk. Telemetry's `voice.outputFull` field (capped at 30K chars per voice) is the storage backing this view.
- **Left-column system monitor (2026-06-07).** Fills the dead space under the discover voice list. Tracks CPU / RAM / GPU+VRAM / disk MB/s / network MB/s / this-process resource use. Linux-first reader (`/proc/stat`, `/proc/meminfo`, `nvidia-smi`, `/proc/diskstats`, `/proc/net/dev`); each source independently try/catched. Polls every 2 s. Color-codes %: yellow ≥60, red ≥85.
- **Local Gemma routing via Ollama (2026-06-07 setup session).** User configured Ollama on WSL2 with `OLLAMA_HOST=0.0.0.0:11434`, `OLLAMA_MAX_LOADED_MODELS=2`, `OLLAMA_KEEP_ALIVE=5m`. Bounded-context model variants created: `gemma4:e4b-council` (16K ctx) and `gemma4:12b-council` (8K ctx). `~/.claude/settings.json` routes the 5 scout-tier roles (skeptic, critic, tester, empiricist, devils_advocate) to e4b and the 9 heavy roles (architect, implementer, security, performance, synthesizer, executor, hypothesizer, methodologist, synthesist) to 12b. Both models stay resident on a 24 GB GPU (~15 GB total). Main-loop chat = e4b. Trigger for switch: user's Claude Max account hit the monthly cap. Ollama exposes an OpenAI-compatible endpoint at `/v1/chat/completions`; Council reaches it via `agentModels[<model>].base_url`. Anthropic auth path still works for any role mapped back to a Claude model.

---

## Slash commands (in-system, not for agents to invoke programmatically)

The Council runtime defines slash commands the user types in the REPL. Notable ones an agent should be aware of (but not invoke directly):

- `/council`, `/router` — toggle multi-agent mode + router
- `/discover` — fire a research-debate run
- `/spend` — local cross-session usage ledger
- `/handoff` — spawn executor to update `HANDOFF.md`
- `/ultrareview` (a.k.a. `/code-review ultra`) — multi-agent cloud review, **user-triggered and billed**

Code for these lives under `src/commands/`.

---

## What to do when uncertain

If the next step isn't obvious:

1. Re-read this file's section relevant to the task.
2. Check the named source doc (`ROADMAP.md`, `BACKLOG.md`, etc.).
3. Use `git log --oneline -10` to see what was recently done — it often hints at where the work is heading.
4. Ask the user a short clarifying question before making changes that touch shared infrastructure (paper sync, council orchestrator, AgentTool integration).
5. **Default to small, reversible changes** over big speculative ones.

---

*Last updated: 2026-06-08. If this file is more than two months old when you read it, prefer the named source docs over this summary.*
