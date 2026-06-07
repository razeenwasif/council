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

9. **Don't emit on the session bus from anywhere except `councilSpawn.ts` or `debateSpawn.ts`.** The bus has one canonical lifecycle: `session-start` → events → `session-end`. Random emissions from elsewhere will desync the React state with reality. If you need a new event type, add it to `sessionBus.ts`'s `SessionEvent` union and route it through the existing emit sites.

10. **Don't disable the `COLORTERM=truecolor` default in `bin/council`.** Without it, chalk downgrades RGB to 256-color, and the entire onyx-orange theme renders as flat gray. The user spent debug time finding this — don't regress it.

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

*Last updated: 2026-06-02. If this file is more than two months old when you read it, prefer the named source docs over this summary.*
