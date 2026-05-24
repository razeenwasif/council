# Council Changelog

## [Unreleased]

### Council grid TUI + opt-in deterministic REPL hook

P1's last-mile hook and P2's grid TUI both shipped behind opt-in toggles so the proven LLM-coordinator path stays the default.

**Council grid TUI** (`src/components/CouncilGrid.tsx`) — alternative layout for the agent panel that arranges council voices in a 2- or 3-column grid instead of stacked rows. Width-driven (uses `useTerminalSize`): ≥180 cols → 3 columns, ≥100 cols → 2 columns, <100 cols → stacked fallback. Auto-activates when ≥5 council-role agents are present in the same group (the agent-type heuristic in `shouldUseCouncilGrid` keeps the grid out of non-council sub-agent renders). Vendor badges + tinted `›` thinking markers carry through cleanly. The wrapper `CouncilOrStacked` consolidates both checks so the render-function caller (`renderGroupedAgentToolUse`) doesn't have to use Ink hooks directly. 6 unit tests for the activation heuristic.

**Deterministic REPL hook** — when `COUNCIL_DETERMINISTIC=1` is set in the environment, the REPL's `onSubmit` intercepts council-worthy prompts (council mode on + router routes to council + non-slash input) and calls `runCouncilFromToolContext` directly. Bypasses the LLM coordinator entirely. The interception logic lives in `src/coordinator/council/maybeInterceptCouncilPrompt.ts` — pure, testable, 9 unit tests for the result/error formatters. The REPL change in `src/screens/REPL.tsx` is one dynamic-import block (~15 lines, gated entirely on the env flag). Default behaviour is unchanged when the flag isn't set.

To try the deterministic path:
```
COUNCIL_DETERMINISTIC=1 council
> /council on
> add a /health endpoint to the example server
```

The user message + structured assistant result appear in the transcript; the AgentTool agent panel (now possibly grid-rendered) shows live progress per voice. If anything breaks, drop the env flag and the LLM-coordinator path takes over again — no rollback needed.

Council test totals: **60 pass · 0 fail · 141 expects · ~620ms**.

### `/council on|off` toggles mid-session + `/council run <prompt>` deterministic path

Two P1 items closed.

**`/council on|off` now actually toggles** (`src/commands/council/council.ts`). Flips the env vars AND calls `clearAgentDefinitionsCache()` so the next prompt re-reads `getBuiltInAgents()`, which checks the env vars at call time and returns the right agent set. `getCoordinatorSystemPrompt()` is non-cached so the coordinator prompt switches naturally. Help text and CHANGELOG no longer carry the "must relaunch" caveat.

**`/council run <prompt>` is the deterministic-orchestrator path**, exposed as a new subcommand (same `src/commands/council/council.ts`). Builds the spawn adapter from the slash command's `ToolUseContext` and calls `runCouncilFromToolContext`. Reports a structured summary at the end with verdict tally, duration, cost, and the executor output. Distinguishes timeout / cost-ceiling / member-failure errors with role-and-stage-specific messages.

The wiring lives in **`src/coordinator/council/councilSpawn.ts`** — the integration adapter for `runCouncil`. Drives `AgentTool.call()` once per agent with a synthesized `assistantMessage` stub (analytics IDs are random UUIDs — harmless but bogus). Includes `parseVerdict` (block > concern > nit > pass priority on first-200-char head), `buildExecutorPrompt`, and `buildRevisionPrompt`. Convenience wrapper `runCouncilFromToolContext` builds the adapter and invokes the orchestrator in one call. **10 unit tests** for the pure helpers.

The default council mode still uses the LLM-coordinator-with-strict-prompt path. After first-run verification of `/council run`, the REPL turn handler can intercept council-worthy prompts and call `runCouncilFromToolContext` directly — that last-mile work is now the only P1 remaining (tracked in BACKLOG).

Council test totals: **48 pass · 0 fail · 114 expects · ~650ms**.

### `/router llm` classifier wired

The LLM-based router strategy is no longer a stub. `/router llm` now makes a real chat-completions call to `gemini-3.5-flash` (or whichever model is bound to `agentRouting.classifier` if set, with `gemini-3.5-flash` as the default fallback) and routes solo vs council based on the result.

- `src/coordinator/council/router/llm.ts` — rewritten. Implements `classify()` (one-shot chat call, temperature 0, `max_tokens: 8`, 4s timeout, AbortController-aborted) and a stricter `normalizeClassifierOutput()` that rejects ambiguous responses where both "solo" and "council" appear. Falls back to the heuristic on: missing config, non-2xx response, malformed JSON, network error, timeout, ambiguous parse. Reason string surfaces the failure mode so `/router show` and debug logs are useful.
- Dependency injection: `classify()` and `decideLLM()` accept an optional `fetcher` argument (defaults to `globalThis.fetch`) so the test suite doesn't monkeypatch globals. Same pattern the orchestrator uses.
- `src/coordinator/council/router/llm.test.ts` — new. **21 cases / 46 expects**, all pass under `bun test`. Covers: normalize edge cases (capitalization, quotes, trailing punctuation, preambles, ambiguity rejection), profile resolution from settings (default model + `agentRouting.classifier` override), request shape (URL, Authorization header, body fields), response handling (200 success, non-2xx, malformed body, off-script response), failure modes (network throw, timeout abort), and the full `decideLLM` decision wrapper including heuristic fallback.

Council tests now: **38 pass · 0 fail · 95 expects · ~700ms**.

### Deterministic orchestrator + timeouts + cost ceiling + `/council status` detail

Three BACKLOG P1 items shipped in one pass, plus the P2 status-detail polish.

**`runCouncil()` is now implemented** (`src/coordinator/council/councilOrchestrator.ts`) — full propose → synthesize → execute → review → optional-revise pipeline. Uses dependency injection (`CouncilAdapters` with `spawnProposal` / `spawnSynthesizer` / `spawnExecutor` / `spawnReview`) so the orchestration logic is decoupled from openclaude's `runAgent` machinery. The integration adapter — providing a real `spawnAgent` backed by openclaude internals — is the remaining v2 wiring work, tracked in BACKLOG P1.

**Per-member timeout** built into the orchestrator. Defaults: `memberTimeoutMs = 60_000` for proposals + reviews, `longTimeoutMs = 5 * 60_000` for synthesizer + executor. Implemented via `AbortController` + `Promise.race`; the underlying call sees the abort signal so it can clean up. Throws `CouncilTimeoutError` naming the stage and (when applicable) the role.

**Per-query cost ceiling** built into the orchestrator. Default `costCeilingUsd = 3`. The `CostLedger` accumulates per stage and throws `CouncilCostCeilingError` if accumulated cost would exceed the ceiling, including a pre-flight check before each stage that's hard to abort mid-flight.

**Member failures** surface as `CouncilMemberFailureError` (distinct from timeouts) — caller can choose to retry or fall back without conflating "network blip" with "vendor latency."

**17 unit tests** in `councilOrchestrator.test.ts`, covering: pure helpers (counting, threshold, formatting), happy path, revision triggering on ≥3 blocks (boundary), revision NOT triggering at 2, revision context shape, hung-member timeout, cost-ceiling abort, member-failure wrapping. All pass under `bun test`.

**`/council status` now reports** (in `src/commands/council/council.ts`):
- Council mode + router mode on one line
- Live per-role model bindings (read from `~/.openclaude/settings.json` `agentRouting` + `agentModels`, with endpoint hints) — so users see what's actually wired, not what's documented
- Quorum math reminder (consensus ≥5/7, revision ≥3/7)
- Pointer to COUNCIL.md and BACKLOG.md

BACKLOG entries marked done where appropriate; the "wire orchestrator into the prompt flow" entry rewritten to describe the remaining adapter work specifically.

### Security + Performance seats added (6th and 7th members)

Council expands from five to seven voices with two new specialist roles. Both run on free-tier providers — `mistral-large-latest` via Mistral La Plateforme for Security, `llama-3.3-70b-versatile` via Groq for Performance.

- **Security** — threat-modeling / trust-boundary lens. Names specific bug classes (injection, path traversal, SSRF, weak crypto, secret leakage) rather than vague "security concerns." Prompted to defer general correctness to the Skeptic and stay in the security-relevant subset.
- **Performance** — runtime-cost / scaling lens. States the expected N, the chosen complexity, and the failure mode if violated (e.g. "O(n²) collapses at n > 50k"). Prompted to defer correctness to the Skeptic and threat modeling to Security.
- Skeptic prompt updated to explicitly cede threat-modeling and big-O concerns to the new specialists — keeps the voices distinct instead of overlapping.

New files:
- `src/tools/AgentTool/built-in/council/securityAgent.ts` — mistral-large-latest, color: purple
- `src/tools/AgentTool/built-in/council/performanceAgent.ts` — llama-3.3-70b-versatile, color: orange

Updated:
- `prompts.ts` — SECURITY_PROMPT + PERFORMANCE_PROMPT added. All role prompts now read "seven-member council" / "six other council members." SYNTHESIZER_PROMPT reads seven proposals with consensus threshold ≥5. COUNCIL_COORDINATOR_PROMPT spawns 7 in step 1 with both new entries in the role→model table. Revision quorum lifted from `≥2 blocks` (40% of 5) to `≥3 blocks` (43% of 7) — preserves the same proportion.
- `councilMode.ts` — getCouncilAgents() now returns 9 agents (7 voices + synth + executor)
- `councilOrchestrator.ts` — CouncilRole extended with `'security'` and `'performance'`
- `vendorBadge.ts` — security: { '✺', purple, 'Mistral' }, performance: { '▶', orange, 'Groq/Meta' }
- `~/.openclaude/settings.json` — agentModels[mistral-large-latest] (api.mistral.ai/v1), agentModels[llama-3.3-70b-versatile] (api.groq.com/openai/v1), agentRouting.security and .performance
- COUNCIL.md, HANDOFF.md, README.md — count + model table + role list + cost estimates updated

### Tester seat added (5th member, Qwen3.6-Plus)

Council expands from four voices to five with a new **Tester** role focused on test coverage and edge cases. Distinct from the Skeptic (who flags what could break) — the Tester ensures we have tests that *catch* those breaks. Enumerates concrete cases per proposal (boundary values, NaN inputs, empty / max-length / unicode edges) and aligns with existing repo test conventions.

- New: `src/tools/AgentTool/built-in/council/testerAgent.ts` (qwen3.6-plus, color: red, read-only tools)
- New: `TESTER_PROMPT` in `src/tools/AgentTool/built-in/council/prompts.ts`
- Updated: all four existing role prompts now reference "five-member council" / "four other council members"
- Updated: `SYNTHESIZER_PROMPT` reads five proposals, consensus threshold lifted to ≥4 (strong majority)
- Updated: `COUNCIL_COORDINATOR_PROMPT` — Step 1 spawns 5 members in parallel, role table includes Tester (qwen3.6-plus), Step 3 and Step 5 reference five reports, Hard Rules updated
- Updated: `getCouncilAgents()` in `src/coordinator/council/councilMode.ts` returns 7 agents (5 voices + synthesizer + executor)
- Updated: `CouncilRole` type in `councilOrchestrator.ts` extended with `'tester'`
- Updated: `vendorBadge.ts` — `tester: { glyph: '▲', color: 'red', label: 'Alibaba' }`
- Updated: `~/.openclaude/settings.json` — `agentModels["qwen3.6-plus"]` (DashScope international endpoint), `agentRouting.tester = "qwen3.6-plus"`
- Updated: `COUNCIL.md`, `HANDOFF.md`, `README.md` for the count + new model in the table

Revision quorum stays at **≥2 blocks** — feels right as a signal across 5 voices.

### Critic model: gpt-5.5 → gpt-4.1-mini

First successful council fan-out surfaced an OpenAI API error: `Function tools with reasoning_effort are not supported for gpt-5.5 in /v1/chat/completions. Please use /v1/responses instead.` The `agentModels` schema only exposes `base_url` + `api_key` (no transport / endpoint-format switch), so the routed call always goes to `/v1/chat/completions`. Swapped the critic to `gpt-4.1-mini` — newer-gen, function-tool-friendly on chat completions, and ~the same price tier. Updated `criticAgent.ts:model`, the role table in `prompts.ts`, `~/.openclaude/settings.json` agentModels + agentRouting, and the model references in `COUNCIL.md` / `HANDOFF.md`.

### Fix: agentRouting was in the wrong config file

`agentRouting` and `agentModels` were being written to `~/.openclaude.json` (the user-state file), but the `SettingsJson` schema reads them from `~/.openclaude/settings.json`. `resolveAgentProvider` saw `settings.agentRouting === undefined`, returned null, and every council sub-agent fell back to the global Anthropic OAuth provider — explaining why `/stats` showed 100% Opus 4.7 even though DeepSeek / Gemini / OpenAI were configured.

Migrated the fields to the correct file. Updated `COUNCIL.md`, `README.md`, and `HANDOFF.md` to point readers at `~/.openclaude/settings.json`.

### Banner redesign — logo mark, thicker wordmark, aurora palette, inline labels

Full visual reset of the startup banner to remove the OpenClaude / Claude Code resemblance.

- **Logo mark** (`src/components/StartupScreen.ts`): new 5×5 mark sitting left of the wordmark — four corner dots (`●`) converging via diagonals (`╲ ╱`) onto a center diamond (`◆`). Visualizes the council story: four voices → one synthesis. Gradient-painted along with the wordmark.
- **Wordmark** (`src/components/StartupScreen.ts`): `LOGO_WORDMARK` is a pixel-block COUNCIL with 2-wide vertical strokes (6 cols per letter, 5 rows tall) — no corner-detail or `╔ ╗ ╚ ╝` box-drawing chrome. Thicker than the initial single-stroke draft for more visual weight.
- **Layout** (`src/components/StartupScreen.ts`): boxed provider panel dropped — `╔══ ║ ╠══ ║ ╚══` borders replaced with inline `label  value` lines and a single status line. `boxRow` helper removed.
- **Palette** (`src/components/StartupScreen.palettes.ts`): new `aurora` palette — purple → pink diagonal gradient, made the new default. The previous `sunset` palette is preserved as a switchable option via `/logo`. Other palettes (forest, ocean, monochrome) unchanged.

### Vendor badges in the agent panel

Each council role's row now leads with a colored glyph identifying the underlying vendor, and the live-thinking line's `›` marker is tinted to match.

- `src/coordinator/council/vendorBadge.ts` (new) — `getCouncilVendorBadge(agentType)` returns `{ glyph, color, label }` for the six council roles, `null` otherwise (non-council sub-agents render unchanged).
- Badges: Anthropic `❋` yellow (architect, executor), Google `✦` blue (skeptic, synthesizer), DeepSeek `◆` cyan (implementer), OpenAI `◯` green (critic). Glyphs are basic Unicode — no Nerd Font required.
- `src/components/AgentProgressLine.tsx` — renders the badge between the tree char and the role name on the header line, and colors the leading `›` of the thinking line in the same vendor color (text body stays dim+italic).

### Live "agent thinking" preview in the agent panel

The two-line agent-progress row in the coordinator-mode agent panel now shows the running agent's current reasoning, not just its last tool call.

- `src/tools/AgentTool/UI.tsx` — new `extractLastAgentActivity()` walks `progressMessages` backwards and returns either `{ kind: 'thinking', text }` (last sentence-or-clause from the most recent assistant text block, truncated to ~80 chars with `…` head if longer) or `{ kind: 'tool', text }` (falls back to the existing `extractLastToolInfo` extractor). Whichever kind of activity is most recent wins.
- `src/components/AgentProgressLine.tsx` — `lastToolInfo: string | null` prop replaced with `lastActivity: AgentActivity | null`. The status line now renders thinking as `› <text>` (italic, dim) and tool info as before.
- Component was previously emitted by the React Compiler with manually-tracked cache slots; rewritten as plain React because the slot count is fragile when extending the conditional logic. Memoization isn't load-bearing here — the component renders once per agent per progress update.

Removed the matching BACKLOG entry (was P2 under UX polish).



Changes specific to the Council fork of OpenClaude. For upstream OpenClaude changes see [CHANGELOG.md](CHANGELOG.md).

## [0.1.0] — 2026-05-24 — v1 scaffold

Initial scaffold of the four-member council workflow on top of OpenClaude's coordinator mode.

### Added

**Council agent definitions** (`src/tools/AgentTool/built-in/council/`)
- `architectAgent.ts` — structural/design lens, bound to `claude-opus-4-7`
- `implementerAgent.ts` — concrete-code lens, bound to `deepseek-v4`
- `skepticAgent.ts` — risk/edge-case lens, bound to `gemini-3.5-flash`
- `criticAgent.ts` — maintainability/tradeoff lens, bound to `gpt-5-1-mini`
- `synthesizerAgent.ts` — judge that unifies the four proposals, bound to `gemini-3.5-flash`, no tools
- `executorAgent.ts` — full-tool worker that writes the actual diff, bound to `claude-opus-4-7`
- `prompts.ts` — role system prompts + the strict coordinator workflow prompt

The four council members (architect/implementer/skeptic/critic) are restricted to read-only tools (`Read`, `Grep`, `Glob`); `Bash`, `FileEdit`, `FileWrite`, `NotebookEdit`, `ExitPlanMode`, and `AgentTool` are disallowed. Only the executor holds destructive tools.

**Council mode wiring** (`src/coordinator/council/`)
- `councilMode.ts` — `isCouncilMode()`, `getCouncilAgents()`, `getCouncilSystemPrompt()` (env-var driven via `CLAUDE_CODE_COUNCIL_MODE=1`)
- `councilOrchestrator.ts` — type contracts (`Proposal`, `SynthesizedPlan`, `ExecutorResult`, `Review`, `CouncilResult`) and helper pure functions (`countBlockingReviews`, `shouldRevise`, `formatProposalsForSynthesizer`). `runCouncil()` body throws — v1 is LLM-driven; v2 will implement deterministic orchestration here.
- `router/strategy.ts` — `routePrompt(prompt) → { route: 'solo' | 'council' }`, runtime-switchable mode
- `router/heuristic.ts` — rule-based router (≤6 words / read-only verbs → solo)
- `router/llm.ts` — classifier strategy shape with stub; falls back to heuristic until the API call is wired

**Coordinator integration patches**
- `src/coordinator/workerAgent.ts` — `getCoordinatorAgents()` returns the six council agents when council mode is on; otherwise the previous worker set
- `src/coordinator/coordinatorMode.ts` — `getCoordinatorSystemPrompt()` returns the strict council workflow prompt when council mode is on; otherwise the existing delegation prompt

**Slash commands**
- `/council on | off | status` — `src/commands/council/`
- `/router heuristic | llm | solo [N] | council [N] | show` — `src/commands/router/`
- Both registered in `src/commands.ts` (`COMMANDS` array)

**Documentation**
- `COUNCIL.md` — use guide (commands, model bindings, routing rules, cost expectations, troubleshooting)
- `CHANGELOG-COUNCIL.md` — this file
- `BACKLOG.md` — future additions and known v1 gaps
- `HANDOFF.md` — state of the scaffold, known TODOs, recommended next steps

### Changed

- `package.json` — removed `dev:grpc`, `dev:grpc:cli` scripts and `@grpc/grpc-js`, `@grpc/proto-loader` dependencies (gRPC server is unused in the Council fork)
- `README.md` — removed Sponsors, Star History, Setup Guides (broken links to deleted `docs/`), Headless gRPC Server, VS Code Extension sections; trimmed nav

### Removed

- `ANDROID_INSTALL.md`, `PLAYBOOK.md` — fork-specific upstream docs
- `vscode-extension/`, `web/`, `docs/`, `python/` — unrelated upstream targets
- `src/grpc/`, `src/server/`, `src/proto/`, `scripts/start-grpc.ts`, `scripts/grpc-cli.ts` — gRPC headless server (not used by the Council fork)

### Deferred

These items were inspected during cleanup but deferred — coupling is heavier than a safe pre-build pass allows. Revisit post-v1 when the build can verify removals.

- `src/vim/` — `VimTextInput` wired into `PromptInput.tsx`, `textInputTypes.ts`, and tests
- `src/voice/` — 10+ importers across hooks, components, `ConfigTool`, and slash commands
- 9 unused model providers (`glm`, `kimi`, `llama`, `minimax`, `mistral`, `nemotron`, `qwen`, `xai`, `xiaomi-mimo`) — each has paired entries in `src/integrations/{vendors,brands,gateways}/` and tests

### Project rename

- Project renamed from `@gitlawb/openclaude` to `council` (`package.json`)
- Binary renamed from `openclaude` to `council` (`bin/council`)
- Project moved from `~/Council/openclaude/` to `~/Council/`
- `README.md` retitled; OpenClaude attribution preserved further down

### Rebranding pass

- Startup banner rewritten — single `LOGO_COUNCIL` ASCII (7 letters, 9 cols × 6 rows each) replaces the two-line OPEN / CLAUDE logos in `src/components/StartupScreen.ts`
- Tagline updated: `Any model. Every tool. Zero limits.` → `Four voices. One plan. Real code.`
- Banner footer: `openclaude vX` → `council vX`
- Version label: `0.1.0 (OpenClaude)` → `0.1.0 (Council)` — touches `src/main.tsx` (Commander `.version()`) and `src/entrypoints/cli.tsx` (the early `--version` short-circuit)
- `bin/council` header comment and error message rewritten to drop OpenClaude branding
- Other OpenClaude strings (welcome notices, update messages, MCP server description, etc.) intentionally left for a later cosmetic pass — none are blocking

### Global command

- Symlinked `~/.local/bin/council` → `~/Council/bin/council`. `~/.local/bin` is already on PATH (and so is `~/.bun/bin` if you prefer), so `council` now runs from any directory. Symlink means a rebuild auto-updates the binary without a re-link step.
- Removed: `bun run start` is still available as a fallback but no longer needed for normal launch.

### Verified

- `bun install` — 417 packages installed, no errors
- `bun run build` — CLI bundle built clean (`dist/cli.mjs`, ~21 MB) + SDK bundle
- `bun run typecheck` — no council-specific errors. Two issues caught during scaffolding and fixed:
  - `criticAgent.ts` color changed from `magenta` to `purple` (`AgentColorName` union doesn't include `magenta`)
  - `councilOrchestrator.ts` — removed unresolved `AgentMessage` type import that no longer exists in `types/message.js`
- `node bin/council --version` → `0.1.0 (OpenClaude)` — runs cleanly; label still says "OpenClaude" because it's hardcoded in source. Cosmetic, can be rebranded later.
- Upstream OpenClaude has ~80 pre-existing type errors across `src/utils/*` that do not touch council code or block the build (Bun's bundler is permissive about these)

### Known v1 limitations

See [BACKLOG.md](BACKLOG.md) for the full list. Highlights:
- TUI uses OpenClaude's existing stacked agent panel — no 2×2 live grid yet
- `councilOrchestrator.runCouncil()` is not wired (v1 is LLM-driven)
- `/router llm` classifier API call is stubbed
- No per-query cost ceiling enforcement
