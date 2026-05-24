# Council Backlog

Things deliberately not built in v1, grouped by priority. Each item names what's missing, why it was deferred, and a sketch of the work.

## Done (since BACKLOG was first written)

- ✓ **Build and verify** — passing across all commits since `f26bdb3`.
- ✓ **End-to-end smoke** — 6 council-authored artifacts in `src/utils/council/` (formatCost, withRetry, lruCache, clamp, parseQueryString + parseQueryString revision). The parseQueryString run exercised the full block→revision→retry path with all 7 voices reporting.
- ✓ **Vendor badges in agent panel** (`vendorBadge.ts`) — covers the spirit of the original "color-coded role labels" P2 item via a different mechanism (colored glyphs vs. role-name color).
- ✓ **Live thinking preview** in the agent panel — extracts the last sentence-or-clause of the current assistant text and surfaces it italic+dim on the AgentProgressLine status row.
- ✓ **Tester, Security, Performance seats** — council went from 4 → 5 → 7 voices. Quorum math scaled (consensus ≥5/7, revision ≥3/7).

## P1 — high-impact, fits within v1.x

### Wire `/router llm` classifier
**Why deferred**: provider client API surface varies; stubbed to fall back to heuristic.
**Work**: in `src/coordinator/council/router/llm.ts`, replace `classify()` with a real call to `gemini-3.5-flash` via the provider resolver at `src/services/api/agentRouting.ts`. Keep the heuristic fallback for transient API errors.

### Wire the deterministic orchestrator into the prompt flow
**Status**: `runCouncil()` is implemented in `src/coordinator/council/councilOrchestrator.ts` with dependency-injected spawn, per-member timeout, per-query cost ceiling, and unit tests. The remaining work is the **integration adapter** — providing a real `spawnAgent` implementation that invokes openclaude's `runAgent` (or equivalent) and the wiring that routes prompts through `runCouncil` instead of through the LLM-coordinator-with-strict-prompt path.

**Why deferred**: `runAgent` is a 975-line async generator that expects a fully-populated `toolUseContext` (MCP clients, abort controller, permission function, precomputed tool pool, etc.). Constructing this from outside the AgentTool's `call()` handler is substantial openclaude-internal work that doesn't belong in the orchestration logic.

**Work**: (1) add an adapter `spawnAgentViaRunAgent(role, prompt, ...): Promise<Proposal | ...>` that builds the necessary context. (2) Replace the `/council on/off` env-var toggle with a hook into the prompt-submission path that invokes `runCouncil` directly when council mode is active. (3) Remove the LLM-coordinator path (or keep behind a fallback flag during migration).

### Make `/council on|off` actually toggle mid-session
**Why deferred**: agent registration runs through `getAgentDefinitionsWithOverrides` in `src/tools/AgentTool/loadAgentsDir.ts:295`, which is `memoize`d at session start. The coordinator system prompt is similarly resolved once. Flipping `CLAUDE_CODE_COUNCIL_MODE` from the slash command updates `process.env` but neither the agent registry nor the prompt re-reads it. v1 works around this by activating council mode in `bin/council` (env vars set before bundle load) and surfacing the constraint in the `/council` help text.
**Work**: (1) export and call `clearAgentDefinitionsCache()` (already exists at `loadAgentsDir.ts:385`) from the `/council on/off` handler. (2) Force a re-resolve of the coordinator system prompt — likely a new helper in `src/coordinator/coordinatorMode.ts` that other code can call to invalidate any cached prompt string. (3) After both invalidations, the next user prompt should see the new registry + prompt. Risk: in-flight conversations carry context that assumed the previous mode; consider whether toggling mid-thread is even semantically meaningful, or whether the slash command should hard-require a session boundary.

## P2 — UX polish

### 2×2 (or N×M) live grid TUI — partial
**Status**: live thinking preview + vendor badges shipped in the existing stacked agent panel, which covers ~70% of the "see what each voice is doing" UX goal. The original "true grid" remains future work for users who want side-by-side panes per voice instead of stacked rows.
**Work**: build `src/components/CouncilGrid.tsx` — N constrained-size `<Box>` panes in flexbox (probably 2×4 for 7 voices, or 3×3 with one empty slot), each rendering a member's `VerboseAgentTranscript` (see `src/tools/AgentTool/UI.tsx:246`). Width-aware breakpoint to fall back to stacked layout below ~120 cols. Wire into the screen tree so it activates only when `isCouncilMode()` is true and the council is mid-run.

## P3 — cleanup carryover from pre-v1

### Remove vim mode
**Coupling**: `VimTextInput.tsx` is referenced by `PromptInput.tsx`, `textInputTypes.ts`, and the input test suite.
**Work**: replace `VimTextInput` usage with the default text input, drop the import from `textInputTypes.ts`, remove vim-specific test cases, delete `src/vim/`, `src/hooks/useVimInput.ts`, `src/components/VimTextInput.tsx`. Run tests.

### Remove voice mode
**Coupling**: 10+ importers across hooks, components, `ConfigTool`, slash commands.
**Work**: bigger lift than vim. Probably worth keeping until there's a specific reason to strip it — it's not actively in the way.

### Remove unused model providers
**Coupling**: each of `glm/kimi/llama/minimax/mistral/nemotron/qwen/xai/xiaomi-mimo` has paired entries in `src/integrations/{vendors,brands,gateways}/` and tests. Note that `mistral` and `qwen` are now actively used by the council seats — those two should stay.
**Work**: pick one provider as a pilot, trace and remove all coupled entries, run `bun test` + `bun run integrations:check`. If clean, repeat for the others.

### Remove unrelated slash commands
**Examples**: `/install-github-app`, `/install-slack-app`, `/onboard-github`, `/chrome`, `/desktop`, `/mobile`, `/benchmark`, `/dream`, `/good-claude`.
**Work**: low-risk one-by-one removal — each command is its own file and an entry in the `COMMANDS` array. Delete the file, remove the import + array entry, build, repeat.

### Migrate config paths `.openclaude/` → `.council/`
**Why deferred**: the rebrand pass renamed user-facing strings but intentionally left `.openclaude*` config paths alone. Renaming them now would orphan the user's existing Anthropic OAuth (`~/.openclaude/.credentials.json`), the council provider profile (`~/.openclaude/.openclaude-profile.json`), settings (`~/.openclaude/settings.json`, `~/.openclaude.json`), shell snapshots, plugins, backups, etc. — every piece of state the CLI writes today. Also there are ~10 test files asserting on the literal strings `.openclaude` / `.openclaude-profile.json`, and the `getClaudeConfigHomeDir()` logic in `src/utils/envUtils.ts` has migration handling for `~/.claude` → `~/.openclaude` that would need a third step.

**Work**:
1. Add a similar one-time migrator in `getClaudeConfigHomeDir()` for `~/.openclaude` → `~/.council` (preserve the existing `~/.claude` → `~/.openclaude` path so users coming from upstream Claude Code still migrate cleanly).
2. Rename the constant `PROFILE_FILE_NAME = '.openclaude-profile.json'` → `'.council-profile.json'` in `src/utils/providerProfile.ts:42` and similar string constants for the settings file (`~/.openclaude.json` → `~/.council.json`).
3. Sweep all string references: `grep -rn "\.openclaude" src` will find them. Update each from the literal `.openclaude` to `.council`.
4. Update test fixtures and assertions in `src/utils/openclaudePaths.test.ts`, `src/utils/openclaudeInstallSurfaces.test.ts`, `src/utils/openclaudeUiSurfaces.test.ts`, and any other `*.test.ts` files matching the grep above.
5. Add a CHANGELOG entry documenting the migration so users understand what moved.
6. Build, run the test suite, smoke-test that an existing user's config gets migrated on first launch.

**Risks**: dropping the migration step would silently orphan user state. The migration itself must be idempotent and safe to run twice (e.g., if both `~/.openclaude` and `~/.council` exist, prefer the newer one and warn). Test on a non-primary user first — there's no clean rollback once the rename runs.

## P4 — speculative future

### Council memory across sessions
Council members lose context between sessions. Persistent role memory (one shared scratchpad per role across a project) would let the Skeptic remember past gotchas, the Architect remember past design decisions, etc. Hook into the existing `agentMemory.ts` infra in `src/tools/AgentTool/`.

### Council voting weights
Right now ≥3 blocks (out of 7) triggers revision. Could weight by role (Skeptic 1.5×, etc.) or by past accuracy (track which member's verdicts predicted actual bugs).

### Per-prompt member swap
`/council swap skeptic <model-id>` to temporarily replace the skeptic's model for the next prompt — useful when debugging or running A/B comparisons.

### Cost budget per session
`/council budget <usd>` to cap total council spend in the current session. Auto-disable when exceeded. (Per-query ceiling already implemented in `runCouncil`; session-wide is a separate layer.)

### Council mode for read-only queries
Currently council is overkill for explanations. But "explain this codebase" could benefit from a debate-style council where each member gives a different framing. Different prompt set, different default tools — needs design.
