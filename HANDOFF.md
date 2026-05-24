# Council — Handoff

Current state as of 2026-05-24, end of session that took the project from
v0.1 scaffold to a verified working seven-voice deterministic council.
Everything someone (or future-you) needs to pick up the work.

## What this is

A **seven-member AI council** layered on OpenClaude's coordinator
infrastructure. Architect, Implementer, Skeptic, Critic, Tester, Security
analyst, and Performance analyst each produce a structured proposal in
parallel; a Synthesizer reduces them to one plan; an Executor (the only
role with filesystem access) writes the actual diff; the same seven
voices then review the diff and vote. Two-or-more `block` verdicts
trigger one revision pass. See [COUNCIL.md](COUNCIL.md) for the
user-facing guide.

## Status

**v1 is operationally complete.** P0 and P1 are fully closed; P2 has one
partial item (true N×M grid TUI — the partial done covers ~70% of the UX
goal). Everything else is P3 cleanups or P4 speculative.

Council test suite: **71 pass · 0 fail · 164 expects · ~665ms**.

## Architecture

```
User prompt
    │
    ▼
Router (heuristic | llm | forced solo/council)
    │
    ▼
[isCouncilMode() && route === 'council' && !COUNCIL_LLM_COORDINATOR?]
    │
    │ yes ──► Deterministic orchestrator (DEFAULT)
    │         maybeInterceptCouncilPrompt → runCouncilFromToolContext →
    │           Promise.all([propose × 7])
    │             → synthesizer
    │             → executor (only role with FS / shell tools)
    │             → Promise.all([review × 7])
    │             → optional revise (cap 1; triggers on ≥3 blocks)
    │           → injects user + assistant messages into transcript
    │           → queryGuard.forceEnd()
    │
    │ no  ──► Either handlePromptSubmit (standard openclaude) or, when
    │         COUNCIL_LLM_COORDINATOR=1, the LLM-coordinator-with-strict-
    │         prompt path that lived as the default during v1 development.
    ▼
   (transcript updated)
```

The deterministic path drives openclaude's `AgentTool.call()` directly
through a thin adapter (`buildCouncilAdapters` in `councilSpawn.ts`) so
the agent panel, MCP integration, permission system, etc. all work
unchanged. The integration adapter is the only piece that crosses into
openclaude internals.

## File map

```
COUNCIL.md                              user-facing use guide
CHANGELOG-COUNCIL.md                    every shipped change
BACKLOG.md                              deferred / future work
HANDOFF.md                              this file

src/coordinator/council/
├── councilMode.ts                      isCouncilMode(), getCouncilAgents(),
│                                       getCouncilSystemPrompt() (still used
│                                       by the LLM-coordinator escape hatch)
├── councilOrchestrator.ts              runCouncil() — full implementation,
│                                       dependency-injected. Per-member
│                                       timeout, per-query cost ceiling,
│                                       error classes (CouncilTimeoutError,
│                                       CouncilCostCeilingError,
│                                       CouncilMemberFailureError).
├── councilOrchestrator.test.ts         17 cases / 49 expects
├── councilSpawn.ts                     AgentTool integration adapter.
│                                       ensureMainLoopModel,
│                                       ensureAbortController,
│                                       extractResultText,
│                                       synthesizeToolUseSummary,
│                                       parseVerdict, prompt builders.
├── councilSpawn.test.ts                23 cases / 49 expects
├── maybeInterceptCouncilPrompt.ts      REPL-side hook. Default behaviour;
│                                       opt-OUT via COUNCIL_LLM_COORDINATOR.
│                                       Result + error formatters.
├── maybeInterceptCouncilPrompt.test.ts 9 cases / 25 expects
├── vendorBadge.ts                      ❋ ◆ ✦ ◯ ▲ ✺ ▶ glyph + colour per
│                                       council role
└── router/
    ├── strategy.ts                     routePrompt() + setRouterMode()
    ├── heuristic.ts                    rule-based — ≤6 words / verbs → solo
    ├── llm.ts                          real gemini-3.5-flash classifier,
    │                                   AbortController-aborted, 4s timeout,
    │                                   strict ambiguity-rejecting parse,
    │                                   heuristic fallback on any failure
    └── llm.test.ts                     21 cases / 46 expects

src/tools/AgentTool/built-in/council/
├── prompts.ts                          9 system prompts +
│                                       COUNCIL_COORDINATOR_PROMPT (only
│                                       used by the LLM-coordinator escape
│                                       hatch now)
├── architectAgent.ts                   claude-opus-4-7, structural lens
├── implementerAgent.ts                 deepseek-chat, concrete-code lens
├── skepticAgent.ts                     gemini-3.5-flash, correctness /
│                                       edge-case lens
├── criticAgent.ts                      gpt-4.1-mini, maintainability lens
├── testerAgent.ts                      qwen3.6-plus, test-coverage lens
├── securityAgent.ts                    mistral-large-latest, threat-modeling
├── performanceAgent.ts                 mistral-medium-latest, complexity
├── synthesizerAgent.ts                 gemini-3.5-flash, no tools, judge
└── executorAgent.ts                    claude-opus-4-7, FULL tools, the
                                        only writer. permissionMode:
                                        'bypassPermissions' (sub-agents
                                        can't show interactive prompts).

src/components/
├── CouncilGrid.tsx                     2- or 3-col grid layout when
│                                       terminal ≥100 cols + ≥5 council
│                                       roles in a group. CouncilOrStacked
│                                       wrapper picks grid vs stacked.
├── CouncilGrid.test.ts                 6 cases (activation heuristic)
└── AgentProgressLine.tsx               Rewritten in plain React (was
                                        react-compiler output). Vendor
                                        badges + live thinking preview.

src/commands/council/                   /council on | off | status | run <prompt>
src/commands/router/                    /router heuristic | llm | solo | council | show
```

### Files patched (not created)

- `src/coordinator/workerAgent.ts` — `getCoordinatorAgents()` branches on
  `isCouncilMode()`, returns the 9 council-set agents.
- `src/coordinator/coordinatorMode.ts` — `getCoordinatorSystemPrompt()`
  branches on `isCouncilMode()` for the LLM-coordinator escape-hatch path.
- `src/commands.ts` — registry entries for `council` and `router`.
- `src/screens/REPL.tsx` — `onSubmit` calls
  `maybeInterceptCouncilPrompt(...)` before `handlePromptSubmit`; calls
  `queryGuard.forceEnd()` after a successful interception.
- `src/components/StartupScreen.ts` — Council banner (logo mark + thicker
  pixel-block COUNCIL wordmark + aurora purple→pink palette + inline
  label/value provider info, dropped the boxed panel).
- `src/components/StartupScreen.palettes.ts` — added `aurora` palette and
  made it default.
- `src/tools/AgentTool/UI.tsx` — `renderGroupedAgentToolUse` now wraps the
  stacked rows in `CouncilOrStacked` so the grid kicks in for council
  scenarios. `extractLastAgentActivity` provides the live thinking text.
- `bin/council` — sets `CLAUDE_CODE_COORDINATOR_MODE=1`,
  `CLAUDE_CODE_COUNCIL_MODE=1`, and `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`
  before bundle load. The first two are gated on `!COUNCIL_OFF`; the third
  also exempts the `COUNCIL_LLM_COORDINATOR=1` escape hatch (which needs
  async dispatch).
- `package.json`, `README.md` — original gRPC / sponsor cleanup (see
  `CHANGELOG-COUNCIL.md`).

## Integration patches (the bug walk)

Each of these patches is permanent — they bridge a real gap between our
deterministic spawn adapter and openclaude's `runAgent`. The
LLM-coordinator path supplies these fields naturally; our path has to
patch them in.

All live in `src/coordinator/council/councilSpawn.ts`:

1. **`ensureMainLoopModel(ctx)`** — `getAgentModel` →
   `getBedrockRegionPrefix` → `extractModelIdFromArn` calls `.startsWith`
   on an undefined `mainLoopModel`. Filled from settings.model or
   `claude-opus-4-7` fallback. Patched in commit `578b2f6`.
2. **`ensureAbortController(ctx, parentSignal)`** — `runAgent` reads
   `toolUseContext.abortController.signal` unconditionally for sync
   agents. Created and linked to the orchestrator's per-member abort
   signal so timeouts reach the underlying agent. Commit `7f20e46`.
3. **`extractResultText` + `synthesizeToolUseSummary`** — robust text
   extraction from `AgentTool.call()` results; salvages a low-confidence
   proposal when an agent emits only tool_uses with no final text. Commit
   `f40c075`.
4. **`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`** in `bin/council` —
   coordinator mode would otherwise route every spawn into the
   background-task lifecycle (returning `async_launched` instead of a
   real result). Sync dispatch is required by the deterministic
   orchestrator. Commit `3bf4264`.
5. **`queryGuard.forceEnd()` after interception** — REPL's loading
   spinner state isn't cleared when we bypass `handlePromptSubmit`.
   Commit `ed0c355`.

Plus a non-`councilSpawn.ts` patch:
6. **Coordinator-prompt escape hatch** — the strict-prompt LLM-coordinator
   path (still in `prompts.ts`) is preserved for `COUNCIL_LLM_COORDINATOR=1`
   rollback. The strict prompt expects async dispatch; that's why the env
   flag also turns sync dispatch off.

## Build / runtime status

- `bun install` — clean (417 packages).
- `bun run build` — clean (CLI ~21 MB + SDK bundles).
- `bun run typecheck` — no council-specific errors. ~80 pre-existing
  upstream errors in `src/utils/*` that the build is permissive about;
  they don't touch council code.
- `bun test src/coordinator/council/ src/components/CouncilGrid.test.ts`
  — 71 pass / 0 fail / 164 expects / ~665ms.
- `council --version` → `0.1.0 (Council)`.
- **End-to-end verified**: `council` (default deterministic path)
  successfully convened all 7 vendor models, executor wrote
  `src/utils/council/example-server.ts` + tests, 9/9 tests pass under
  `bun test`.

## How to actually use it (quick reference)

```bash
council                                 # default — deterministic path, council on
COUNCIL_OFF=1 council                   # disable council entirely (standard openclaude)
COUNCIL_LLM_COORDINATOR=1 council       # escape hatch: pre-flip LLM-coordinator path
```

Inside the session:

```
/council status                         # live model bindings + quorum math
/council on   /  off                    # toggle mid-session (effective next prompt)
/council run <prompt>                   # explicit deterministic invocation
/router heuristic | llm | solo | council | show
```

Provider config lives in `~/.openclaude/settings.json` under `agentModels`
+ `agentRouting`. NOT `~/.openclaude.json` — the two files exist side by
side; the agent-routing schema is read from `settings.json` via
`getSettings_DEPRECATED()`. The user-state file (`~/.openclaude.json`)
holds OAuth tokens, project per-cwd settings, install metadata, etc.

## Things to be cautious about

- **Don't loosen the executor's exclusivity.** Only the executor writes
  files. The seven voice members have `disallowedTools` listing every
  write tool — adding read-write to a council voice is almost certainly
  solving a different problem.
- **Don't add a second revision pass.** v1 caps revisions at 1. If the
  executor's first attempt + reviewers + one revise still doesn't
  satisfy the council, that's a signal to surface to the user, not to
  keep iterating. Cost and time bound out fast otherwise.
- **`COUNCIL_LLM_COORDINATOR=1` is a real, working rollback.** If a user
  ever hits an edge case the deterministic path doesn't handle, they
  set this env flag and the LLM-coordinator path kicks back in.
- **Don't delete `src/voice/`, `src/vim/`, or unused model providers**
  without coordinated patching. The `mistral` and `qwen` providers are
  now load-bearing for council seats; the rest are eligible for removal
  but each has paired entries in `src/integrations/{vendors,brands,gateways}/`
  and tests.
- **Don't run `bun run build` and assume silence means success.** Bun's
  build is permissive about type errors. `bun run typecheck` separately.

## What openclaude infrastructure we depend on

The council layer is intentionally narrow. Upstream changes to any of
these could require adaptation:

- `feature('COORDINATOR_MODE')` flag + `CLAUDE_CODE_COORDINATOR_MODE` env.
- `AgentTool.call()` — the integration surface our `councilSpawn.ts`
  drives.
- `runAgent` — what `AgentTool.call` invokes. Our spawn adapter patches
  the context AgentTool passes to it.
- `getSettings_DEPRECATED()` + `SettingsJson` schema (for `agentRouting`,
  `agentModels`).
- `Ink` + `useTerminalSize` for the grid TUI.

If openclaude changes any of those, the patch helpers in `councilSpawn.ts`
are the first place to look.

## Recommended next steps (none required — v1 is operational)

Listed in priority order — none of these block normal use.

1. **Bank some real-world usage.** The deterministic path has one
   end-to-end success but is otherwise unproven across diverse prompts.
   Run a few real council prompts; if anything misbehaves, the error
   surfaces will be informative (stack tails, role + stage labels).
2. **True N×M grid TUI** — current grid is a 2- or 3-column layout sharing
   the `AgentProgressLine` row style. Side-by-side panes per voice
   (full `VerboseAgentTranscript` in each cell) is the remaining P2
   work.
3. **P3 cleanups** as opportunities arise — vim mode removal is the
   smallest, config-path migration is the largest, none are urgent.
4. **P4 speculative items** — council memory across sessions, voting
   weights, etc. Wait for a real use case.

## History

- 2026-05-24, early session: v0.1 scaffold — 4 council members, LLM-
  coordinator path with strict prompt, no integration patches.
- 2026-05-24, mid-session: Tester (5th), Security + Performance
  (6th and 7th). agentRouting fixed to read from the right
  settings file.
- 2026-05-24, late session: `runCouncil` orchestrator + tests + opt-in
  REPL hook (gated on `COUNCIL_DETERMINISTIC=1`). `/router llm`
  classifier wired. `/council on|off` mid-session toggle.
- 2026-05-24, end of session: live-session verification of the
  deterministic path. Four integration patches landed during
  verification. Default flipped — deterministic is the default, the
  LLM-coordinator path is preserved as `COUNCIL_LLM_COORDINATOR=1`
  escape hatch.
