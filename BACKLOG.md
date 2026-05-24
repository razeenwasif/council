# Council Backlog

Things deliberately not built yet, grouped by priority. Each item names what's missing, why it was deferred, and a sketch of the work.

## Done

### v1 scaffold + deterministic-default

- ✓ **Deterministic orchestrator is the default** — `runCouncilFromToolContext` replaces the LLM-coordinator-with-strict-prompt path. Verified end-to-end in a live session (7 voices fan out, executor writes file, reviewers vote, 9/9 tests pass). Integration patches in `councilSpawn.ts` (`ensureMainLoopModel`, `ensureAbortController`, robust result parsing, `synthesizeToolUseSummary` fallback) plus `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` in `bin/council` plus `queryGuard.forceEnd()` after the REPL hook. `COUNCIL_LLM_COORDINATOR=1` is the opt-OUT escape hatch.
- ✓ **Tester, Security, Performance seats** — council went from 4 → 5 → 7 voices. Quorum math scaled (consensus ≥5/7, revision ≥3/7).
- ✓ **Council grid TUI** — N×M layout (2 or 3 columns based on terminal width) for the council agent panel, auto-activated when ≥5 council-role agents share a group. Width-aware fallback to stacked rows.
- ✓ **Vendor badges in agent panel** — colored glyphs per role (covers the spirit of the original "color-coded role labels" P2 item).
- ✓ **Live thinking preview** in the agent panel — extracts the last sentence-or-clause of the current assistant text and surfaces it italic+dim on the AgentProgressLine status row.
- ✓ **`/council on|off` toggles mid-session** — flips env vars + invalidates the agent registry cache. No more "must relaunch" caveat.
- ✓ **`/council run <prompt>`** — explicit deterministic-orchestrator invocation, distinct from the default flow.
- ✓ **`/router llm` classifier wired** — real gemini-3.5-flash call with timeout, AbortController, stricter ambiguity-rejecting parse, full heuristic fallback.

### Live UX overhaul (latest session)

- ✓ **Per-arrival proposal/review previews** — `▎ Critic (gpt-4.1-mini): <headline>` streams as each voice lands instead of dumping all at once. Includes resolved model id in parens via `resolveRoleModel()`.
- ✓ **Stage-done emits** — `✓ Synthesizer done (12.5s)` / `✓ Executor done (3m 3s) — Files created: ...` between long single-agent stages so the spinner is never silent for >a few seconds.
- ✓ **Grouped agent panel in deterministic path** — new `prepareBatch` / `prepareSingle` / `completeMember` adapter hooks inject synthetic tool_use messages (shared `message.id`, unique `tool_use.id`s) so the panel renders the `7 agents finished` tree. Panel tool counts populate via `onProgress` wiring.
- ✓ **Fault-tolerant batches** — `Promise.all` → `Promise.allSettled` for proposal + review phases. 1-2 slow voices no longer kill the whole run; failures surface on `CouncilResult.failures`. New `CouncilQuorumLostError` thrown only when <5 of 7 voices succeed.
- ✓ **Auth failure detection** — `AgentAuthFailureError` + `looksLikeAuthFailure()` catch upstream 401s surfaced as result text. Remediation hint with `/login` instead of plowing through 7 reviews of a non-existent diff.
- ✓ **HEADLINE_DIRECTIVE hoisted to top of every role prompt** — Mistral + claude-opus-4-7 stop dropping the `## Headline` section.
- ✓ **`memberTimeoutMs` 60s → 300s** — combined with fault tolerance, this is now the "voice is truly hung" ceiling, not "voice is slow."
- ✓ **`/handoff` slash command** — spawns the executor one-shot to update `HANDOFF.md`; uses new reusable `runSingleAgentFromToolContext` helper.

### Verified end-to-end with real council-authored code

Six artifacts in `src/utils/council/` (formatCost, withRetry, lruCache, clamp, parseQueryString w/ revision pass, sanitizePath, debounce, once). The parseQueryString and debounce runs exercised the full block→revision→retry path with all 7 voices reporting.

---

## P2 — actively useful, not yet built

### Fix "0 tokens" shown in agent panel for non-Anthropic providers

**Symptom**: panel cells for DeepSeek, Gemini, OpenAI, Qwen, Mistral agents show `· 0 tokens` even after the agent completes successfully with real work. Only claude-opus-4-7 (Architect, Executor) shows non-zero token counts.

**Root cause**: `calculateAgentStats` in `src/tools/AgentTool/UI.tsx:639-644` reads `usage.input_tokens` / `usage.output_tokens` / `usage.cache_creation_input_tokens` / `usage.cache_read_input_tokens` from the latest progress message's `data.message.message.usage`. The progress messages flow through openclaude's provider normalization layer. Non-Anthropic providers don't always populate those fields when their chat-completions responses are converted to BetaMessage shape — some return `usage` at a different path, some don't return it at all on streaming chunks, and the normalizer doesn't backfill from the final response.

**Work**:
1. Add a small test that fakes a non-Anthropic provider response (DeepSeek shape) and runs it through the existing provider normalizer; assert `usage.input_tokens` is populated on the resulting AssistantMessage.
2. Trace the normalization path for each non-Anthropic provider — most live in `src/integrations/vendors/*` and pipe through a shared OpenAI-compatible response handler. Identify where usage gets dropped.
3. The fix is likely a single function that maps `response.usage.prompt_tokens` → `betaUsage.input_tokens` and `response.usage.completion_tokens` → `betaUsage.output_tokens`, applied at the right point in the normalizer.
4. Validate against each provider used by the council (DeepSeek for Implementer, Gemini for Skeptic/Synthesizer, OpenAI for Critic, Qwen for Tester, Mistral for Security/Performance).

**Estimate**: ~1 day. The grep + trace is the bulk of the work; the actual fix is small.

**Why P2**: actively confusing during runs. Users can't tell which voices used the most resources.

### Total usage diagrams + spend tracking

**What**: a `/usage` command that shows per-model + per-day token/spend tables, optionally with a sparkline or bar chart for the last N days. Persistent ledger so spend tracks across sessions.

**Why deferred**: needs the "0 tokens" fix first — without per-call usage data flowing through the panel, there's no source of truth to aggregate. Also needs a per-call cost field; currently `costUsd: 0` in the deterministic path because `AgentTool.call` doesn't expose a flat cost in its result.

**Work**:
1. Surface per-call cost from AgentTool's result (look for a `costTracker.getTotalForToolUseId(...)` or similar that the LLM-coordinator path already uses for `/stats`).
2. Add a persistent ledger (`~/.openclaude/usage.jsonl` — append-only, one record per spawn). Schema: `{timestamp, role, model, inputTokens, outputTokens, costUsd, durationMs, council_run_id}`.
3. Write to the ledger from `completeMember` (we already have role + summary at that point).
4. Build `/usage` command — render a table grouped by model + day. Use the same `boxen`-ish rendering style as `/stats`. Optional `--last 7d` flag.
5. Optional v2: ASCII sparkline of daily spend.

**Estimate**: ~1-2 days. Ledger + command is straightforward; the value depends on the "0 tokens" fix above being done first.

**Why P2**: high signal-to-noise once #1 lands.

---

## P3 — cleanup carryover from pre-v1

None of these block anything; they're hygiene as opportunities arise.

### Remove vim mode
**Coupling**: `VimTextInput.tsx` is referenced by `PromptInput.tsx`, `textInputTypes.ts`, and the input test suite.
**Work**: replace `VimTextInput` usage with the default text input, drop the import from `textInputTypes.ts`, remove vim-specific test cases, delete `src/vim/`, `src/hooks/useVimInput.ts`, `src/components/VimTextInput.tsx`. Run tests.

### Remove voice mode
**Coupling**: 10+ importers across hooks, components, `ConfigTool`, slash commands.
**Work**: bigger lift than vim. Probably worth keeping until there's a specific reason to strip it — it's not actively in the way.

### Remove unused model providers
**Coupling**: each of `glm/kimi/llama/minimax/nemotron/xai/xiaomi-mimo` has paired entries in `src/integrations/{vendors,brands,gateways}/` and tests. **Keep `mistral` and `qwen`** — actively used by council seats (Security/Performance and Tester).
**Work**: pick one provider as a pilot, trace and remove all coupled entries, run `bun test` + `bun run integrations:check`. If clean, repeat for the others.

### Remove unrelated slash commands
**Examples**: `/install-github-app`, `/install-slack-app`, `/onboard-github`, `/chrome`, `/desktop`, `/mobile`, `/benchmark`, `/dream`, `/good-claude`.
**Work**: low-risk one-by-one removal — each command is its own file and an entry in the `COMMANDS` array. Delete the file, remove the import + array entry, build, repeat.

### Migrate config paths `.openclaude/` → `.council/`
**Why deferred**: the rebrand pass renamed user-facing strings but intentionally left `.openclaude*` config paths alone. Renaming now would orphan the user's existing Anthropic OAuth (`~/.openclaude/.credentials.json`), the council provider profile (`~/.openclaude/.openclaude-profile.json`), settings (`~/.openclaude/settings.json`, `~/.openclaude.json`), shell snapshots, plugins, backups, etc. ~10 test files assert on the literal strings `.openclaude` / `.openclaude-profile.json`, and the `getClaudeConfigHomeDir()` logic in `src/utils/envUtils.ts` has migration handling for `~/.claude` → `~/.openclaude` that would need a third step.

**Work**:
1. Add a one-time migrator in `getClaudeConfigHomeDir()` for `~/.openclaude` → `~/.council` (preserve the existing `~/.claude` → `~/.openclaude` path so users coming from upstream Claude Code still migrate cleanly).
2. Rename the constant `PROFILE_FILE_NAME = '.openclaude-profile.json'` → `'.council-profile.json'` in `src/utils/providerProfile.ts:42` and similar string constants for the settings file (`~/.openclaude.json` → `~/.council.json`).
3. Sweep all string references: `grep -rn "\.openclaude" src` will find them.
4. Update test fixtures and assertions in `src/utils/openclaudePaths.test.ts`, `src/utils/openclaudeInstallSurfaces.test.ts`, `src/utils/openclaudeUiSurfaces.test.ts`, and any other `*.test.ts` files matching the grep above.
5. Add a CHANGELOG entry documenting the migration so users understand what moved.
6. Build, run the test suite, smoke-test that an existing user's config gets migrated on first launch.

**Risks**: dropping the migration step would silently orphan user state. The migration must be idempotent and safe to run twice (e.g., if both `~/.openclaude` and `~/.council` exist, prefer the newer one and warn). Test on a non-primary user first — there's no clean rollback once the rename runs.

---

## P4 — speculative future

### Council memory across sessions
Council members lose context between sessions. Persistent role memory (one shared scratchpad per role across a project) would let the Skeptic remember past gotchas, the Architect remember past design decisions, etc. Hook into the existing `agentMemory.ts` infra in `src/tools/AgentTool/`.

### Council voting weights
Right now ≥3 blocks (out of 7) triggers revision. Could weight by role (Skeptic 1.5×, etc.) or by past accuracy (track which member's verdicts predicted actual bugs).

### Per-prompt member swap
`/council swap skeptic <model-id>` to temporarily replace the skeptic's model for the next prompt — useful when debugging or running A/B comparisons.

### Cost budget per session
`/council budget <usd>` to cap total council spend in the current session. Auto-disable when exceeded. (Per-query ceiling already implemented in `runCouncil`; session-wide is a separate layer. Depends on per-call cost capture from the "usage tracking" P2 work above.)

### Council mode for read-only queries
Currently council is overkill for explanations. But "explain this codebase" could benefit from a debate-style council where each member gives a different framing. Different prompt set, different default tools — needs design.

### True N×M grid TUI with full per-voice panes
Current grid is a 2- or 3-column layout sharing the `AgentProgressLine` row style. Side-by-side panes per voice (full `VerboseAgentTranscript` in each cell) is the remaining P2-UI work. Was noted in HANDOFF; deferred because the current grid covers ~70% of the UX goal.
