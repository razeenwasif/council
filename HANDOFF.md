# Council v1 — Handoff

State of the v1 scaffold as of 2026-05-24. Everything someone (or future-you) needs to pick up the work.

## What this is

A four-member AI council layered on top of OpenClaude's existing coordinator infrastructure. Architect, Implementer, Skeptic, and Critic propose in parallel; a Synthesizer reduces; an Executor writes; the four reviewers vote on the diff. See [COUNCIL.md](COUNCIL.md) for the user-facing guide.

## Architecture in one diagram

```
User prompt
    │
    ▼
Router (heuristic | llm | forced solo/council)
    │
    ▼
[Council mode env var set?] ──── no ──▶ Standard OpenClaude flow
    │ yes
    ▼
Coordinator LLM follows COUNCIL_COORDINATOR_PROMPT:
    │
    ├── Spawn 4 members in parallel (architect, implementer, skeptic, critic)
    │     • read-only tools only
    │     • each bound to a different model
    │
    ├── On all 4 reports: spawn synthesizer with the proposals
    │
    ├── On synthesizer plan: spawn executor (full tools, claude-opus-4-7)
    │
    ├── On executor diff: spawn 4 members for review
    │
    └── If ≥2 'block' verdicts: spawn executor once more to revise (cap 1)
```

The orchestration is currently **LLM-driven** — the coordinator LLM follows a strict system prompt. v2 will replace this with a **deterministic TypeScript orchestrator** (see `src/coordinator/council/councilOrchestrator.ts` header).

## File map

```
COUNCIL.md                      ← user-facing use guide
CHANGELOG-COUNCIL.md            ← what shipped in v0.1.0
BACKLOG.md                      ← deferred / future work
HANDOFF.md                      ← this file

src/coordinator/council/
├── councilMode.ts              ← isCouncilMode(), getCouncilAgents(), getCouncilSystemPrompt()
├── councilOrchestrator.ts      ← v2 contract sketch — runCouncil() THROWS in v1
└── router/
    ├── strategy.ts             ← routePrompt() + setRouterMode()
    ├── heuristic.ts            ← rule-based router
    └── llm.ts                  ← classifier router (API call stubbed)

src/tools/AgentTool/built-in/council/
├── prompts.ts                  ← all six system prompts + COUNCIL_COORDINATOR_PROMPT
├── architectAgent.ts           ← claude-opus-4-7, structural lens
├── implementerAgent.ts         ← deepseek-v4, concrete-code lens
├── skepticAgent.ts             ← gemini-3.5-flash, risk lens
├── criticAgent.ts              ← gpt-5.5, maintainability lens
├── synthesizerAgent.ts         ← gemini-3.5-flash, no tools, judge
└── executorAgent.ts            ← claude-opus-4-7, full tools, the only writer

src/commands/council/           ← /council on | off | status
src/commands/router/            ← /router heuristic | llm | solo | council | show
```

### Files patched (not created)

- `src/coordinator/workerAgent.ts` — `getCoordinatorAgents()` branches on `isCouncilMode()`
- `src/coordinator/coordinatorMode.ts` — `getCoordinatorSystemPrompt()` branches on `isCouncilMode()` (lazy require to match the existing dead-code-elimination pattern)
- `src/commands.ts` — imports + array entries for `council` and `router`
- `package.json`, `README.md` — gRPC/sponsor cleanup (see CHANGELOG)

## Known TODOs in the code

Grep for `TODO(v` to find these:

1. **`src/coordinator/council/router/llm.ts`** — `classify()` is stubbed and returns `'unwired'`, which causes the strategy to fall back to the heuristic. Wire to a real provider call via `src/services/api/agentRouting.ts`.
2. **`src/coordinator/council/councilOrchestrator.ts`** — `runCouncil()` throws. Implement against `runAgent` (`src/tools/AgentTool/runAgent.ts`) to enable deterministic orchestration. Helpers (`shouldRevise`, `formatProposalsForSynthesizer`) are already there.

## Build status (verified 2026-05-24)

- `bun install` — clean (417 packages)
- `bun run build` — clean (CLI + SDK bundles produced; `dist/cli.mjs` ~21 MB)
- `bun run typecheck` — no council-specific errors. Upstream OpenClaude has ~80 pre-existing type errors in `src/utils/*` that the build is permissive about; they don't touch council code.
- `node bin/council --version` → `0.1.0 (OpenClaude)` — runs cleanly. The "OpenClaude" suffix is a hardcoded source string, not the package name.

Two issues caught and fixed during first build:
- `criticAgent.ts` — `color: 'magenta'` not in `AgentColorName` (`red | blue | green | yellow | purple | orange | pink | cyan`). Changed to `'purple'`.
- `councilOrchestrator.ts` — removed an unresolved import of `AgentMessage` from `types/message.js`.

## Still unverified at runtime

What the build can't tell you:

1. **Model IDs** — `deepseek-v4`, `gemini-3.5-flash`, `gpt-5.5` are the literal strings the user specified. Compile-time the build doesn't validate them against the provider registry — that happens at runtime when an agent is spawned. If a model isn't registered, the agent will fall through to the global default (or error, depending on provider config). Verify by configuring providers via `/provider` and running an end-to-end test.
2. **End-to-end smoke** — never actually convened a council. Needs configured provider profiles for at least Anthropic, DeepSeek, Google, and OpenAI (or one gateway covering all). See "Recommended next steps" below.
3. **Cosmetic branding** — startup banner, tagline, version label, and `bin/council` script have been rebranded to Council. Other strings (welcome notices, MCP server description, update messages) still say "OpenClaude" — none are blocking.

## Recommended next steps in order

### 1. Configure providers (P0, ~15 min)

Launch the CLI and run `/provider` to configure profiles for the four vendors the council binds:

```bash
council                       # from any directory (symlinked into ~/.local/bin)
# or, from the repo:
cd ~/Council && bun run start
```

```
/provider
```

Configure: Anthropic (for Claude Opus), DeepSeek (OpenAI-compatible), Google (for Gemini), OpenAI (for GPT-mini). Either four separate profiles or one gateway profile with `agentRouting` doing the per-role binding (see [COUNCIL.md](COUNCIL.md)).

### 2. End-to-end smoke (P0, ~15 min)

```
/council on
/router heuristic
```

Then prompt: *"Add a /health endpoint to the example HTTP server that returns 200 with a JSON body containing the current uptime."*

Expected: four members spawn, synthesizer summarizes, executor writes the route, four reviewers vote. If any step fails, the failing member's task notification will say what.

### 3. Then pick from [BACKLOG.md](BACKLOG.md) by priority

P1 work in order: deterministic orchestrator → router LLM classifier → cost ceiling → per-member timeout. Each is bounded and unlocks real product behavior.

## Things to be cautious about

- **Don't loosen the executor's exclusivity.** Only the executor writes files. The four council members have `disallowedTools` listing every write tool — if you find yourself adding read-write tools to a council member, you're probably solving a different problem than the council solves.
- **Don't add a second LLM revision loop.** v1 caps revisions at 1. If the executor's first attempt + reviewers + one revise still doesn't satisfy the council, that's a signal to surface to the user, not to keep trying. Cost and time bound out fast.
- **Don't reach for `councilOrchestrator.runCouncil()` in v1.** It throws. The v1 path is `/council on` → coordinator-LLM follows the prompt.
- **Don't delete `src/voice/`, `src/vim/`, or unused model providers** without coordinated patching — they're coupled to other files (see CHANGELOG "Deferred" section).
- **Don't run `bun run build` and assume silence means success** — type-check separately (`bun run typecheck`). Bun's build is permissive about some type errors.

## Where the scaffolding stopped and "real product" begins

Everything below the line "Coordinator LLM follows COUNCIL_COORDINATOR_PROMPT" in the architecture diagram is **dependent on upstream OpenClaude infrastructure that we did not modify**. The council leverages:

- Coordinator mode (`feature('COORDINATOR_MODE')` + env var)
- `AgentTool` for spawning workers
- `SendMessageTool` for continuing workers
- The task-notification XML message flow
- `agentRouting` config in `~/.openclaude/settings.json` (NOT `~/.openclaude.json` — distinct files; the schema lives in `SettingsJson` which `getSettings_DEPRECATED()` reads from `~/.openclaude/settings.json`)
- Ink/Yoga TUI for the existing stacked agent panel

If upstream openclaude changes any of those primitives, the council will need to adapt. The integration surface is intentionally narrow — three functions overridden (`getCoordinatorAgents`, `getCoordinatorSystemPrompt`, plus `isCouncilMode` as the activation gate) and two slash commands added. That's all the council is, structurally.
