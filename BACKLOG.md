# Council Backlog

Things deliberately not built in v1, grouped by priority. Each item names what's missing, why it was deferred, and a sketch of the work.

## P0 — needed for v1 to actually run

### Build and verify
**Why deferred**: scaffold was written without compilation; integration issues will surface on first `bun run build`.
**Work**: `bun install && bun run build && bun run typecheck`. Fix any import path errors (likely candidates: extension `.js` vs `.ts` in imports, missing tool-name re-exports, `BuiltInAgentDefinition` field name drift). Then `bun run smoke`.

### End-to-end smoke test
**Why deferred**: requires API keys for at least Claude Opus, DeepSeek, Gemini Flash, and a GPT-mini.
**Work**: configure provider profiles via `/provider`, run `/council on`, prompt with something substantive ("add a hello world route to the example server"), watch the four members spawn, confirm synthesizer + executor + review pass complete.

## P1 — high-impact, fits within v1.x

### Deterministic TypeScript orchestrator
**Why deferred**: LLM-driven via strict coordinator prompt is cheaper to scaffold and works today.
**Work**: implement `runCouncil()` in `src/coordinator/council/councilOrchestrator.ts`. Call `runAgent` (from `src/tools/AgentTool/runAgent.ts`) four times in `Promise.all`, then once for the synthesizer, then once for the executor, then four times for reviews. Use the helpers already defined (`shouldRevise`, `formatProposalsForSynthesizer`). The `/council` slash command should route to `runCouncil()` directly instead of toggling env vars.
**Payoff**: deterministic flow, no coordinator-LLM token cost, unit-testable.

### Wire `/router llm` classifier
**Why deferred**: provider client API surface varies; stubbed to fall back to heuristic.
**Work**: in `src/coordinator/council/router/llm.ts`, replace `classify()` with a real call to `gemini-3.5-flash` via the provider resolver at `src/services/api/agentRouting.ts`. Keep the heuristic fallback for transient API errors.

### Per-query cost ceiling
**Why deferred**: openclaude has `cost-tracker.ts` infra but enforcement at the council-query boundary needs an integration pass.
**Work**: extend the orchestrator (once deterministic) to track running cost across the pipeline and abort with a structured error if `costCeilingUsd` is exceeded. Default ceiling: $3 per query. Surface as `/council ceiling <usd>` subcommand.

### Per-member timeout
**Why deferred**: same as above — needs orchestrator hookpoints.
**Work**: 60s default per member; abort and degrade gracefully (report which member timed out, ask user whether to proceed with three voices or retry).

## P2 — UX polish

### 2×2 live grid TUI
**Why deferred**: OpenClaude's existing TUI is single-focus with a stacked status panel; building a grid is medium-sized work (Ink/Yoga primitives are present but no existing grid component for this case).
**Work**: build `src/components/CouncilGrid.tsx` — four constrained-size `<Box>` panes in flexbox, each rendering a member's `VerboseAgentTranscript` (see `src/tools/AgentTool/UI.tsx:246`). Width-aware breakpoint to fall back to stacked layout below ~120 cols. Wire into the screen tree so it activates only when `isCouncilMode()` is true and four agents are running.

### Color-coded role labels in default TUI
**Why deferred**: scaffolded but not visually verified.
**Work**: confirm the `color: 'blue' | 'green' | 'red' | 'magenta' | 'cyan' | 'yellow'` fields in each agent definition actually render in `AgentProgressLine`. May need to add custom colors to `agentColorManager.ts`.

### `/council status` returns more detail
**Why deferred**: v1 returns a one-liner.
**Work**: when on, also report: current router mode, last council run's cost + duration, default model bindings (so users can see at a glance which models are wired).

## P3 — cleanup carryover from pre-v1

### Remove vim mode
**Coupling**: `VimTextInput.tsx` is referenced by `PromptInput.tsx`, `textInputTypes.ts`, and the input test suite.
**Work**: replace `VimTextInput` usage with the default text input, drop the import from `textInputTypes.ts`, remove vim-specific test cases, delete `src/vim/`, `src/hooks/useVimInput.ts`, `src/components/VimTextInput.tsx`. Run tests.

### Remove voice mode
**Coupling**: 10+ importers across hooks, components, `ConfigTool`, slash commands.
**Work**: bigger lift than vim. Probably worth keeping until there's a specific reason to strip it — it's not actively in the way.

### Remove unused model providers
**Coupling**: each of `glm/kimi/llama/minimax/mistral/nemotron/qwen/xai/xiaomi-mimo` has paired entries in `src/integrations/{vendors,brands,gateways}/` and tests.
**Work**: pick one provider as a pilot, trace and remove all coupled entries, run `bun test` + `bun run integrations:check`. If clean, repeat for the others.

### Remove unrelated slash commands
**Examples**: `/install-github-app`, `/install-slack-app`, `/onboard-github`, `/chrome`, `/desktop`, `/mobile`, `/benchmark`, `/dream`, `/good-claude`.
**Work**: low-risk one-by-one removal — each command is its own file and an entry in the `COMMANDS` array. Delete the file, remove the import + array entry, build, repeat.

## P4 — speculative future

### Council memory across sessions
Council members lose context between sessions. Persistent role memory (one shared scratchpad per role across a project) would let the Skeptic remember past gotchas, the Architect remember past design decisions, etc. Hook into the existing `agentMemory.ts` infra in `src/tools/AgentTool/`.

### Council voting weights
Right now ≥2 blocks triggers revision. Could weight by role (Skeptic 1.5×, etc.) or by past accuracy (track which member's verdicts predicted actual bugs).

### Per-prompt member swap
`/council swap skeptic <model-id>` to temporarily replace the skeptic's model for the next prompt — useful when debugging or running A/B comparisons.

### Cost budget per session
`/council budget <usd>` to cap total council spend in the current session. Auto-disable when exceeded.

### Council mode for read-only queries
Currently council is overkill for explanations. But "explain this codebase" could benefit from a debate-style council where each member gives a different framing. Different prompt set, different default tools — needs design.
