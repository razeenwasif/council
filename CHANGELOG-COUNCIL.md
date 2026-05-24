# Council Changelog

## [Unreleased]

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
