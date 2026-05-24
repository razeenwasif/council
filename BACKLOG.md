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
- ✓ **Stuck-spinner fix after council interception** — `resetLoadingState()` now called alongside `queryGuard.forceEnd()` in REPL so `userInputOnProcessing` clears (was keeping the spinner visible indefinitely after the council finished).
- ✓ **0-tokens panel display fixed** — `claude.ts:2265` now mutates `usage` object fields in place rather than re-assigning, so AgentTool's progress-message snapshots (held by reference) see the final token totals. Anthropic now shows input+output; shim providers (DeepSeek, Gemini, OpenAI, Qwen, Mistral) show real values instead of 0.
- ✓ **`/spend` command + usage ledger** — append-only `~/.openclaude/usage.jsonl` written on each session-end (via `saveCurrentSessionCosts`). Command supports `--today`, `--7d`, `--30d`, `--all`, `--models`, `--where`. Renders per-day cost table with top-model column + ASCII sparkline trend.

### Verified end-to-end with real council-authored code

Six artifacts in `src/utils/council/` (formatCost, withRetry, lruCache, clamp, parseQueryString w/ revision pass, sanitizePath, debounce, once). The parseQueryString and debounce runs exercised the full block→revision→retry path with all 7 voices reporting.

---

## P2 — actively useful, not yet built

### Add pricing-table entries for shim provider models

**Symptom**: `/spend --models` now correctly shows shim providers (deepseek-chat, gemini-3.5-flash, qwen3.6-plus, mistral-large-latest, mistral-medium-latest, gpt-4.1-mini) in the breakdown — that part landed in `c428f0e`. But the cost numbers for those rows are calculated at **claude-opus-4-7 rates** because openclaude's pricing table doesn't have entries for them. Result: an Implementer turn that actually cost ~$0.001 on DeepSeek shows up as ~$0.05 at opus rates.

**Root cause**: `calculateUSDCost(resolvedModel, usage)` in `claude.ts:2282` uses `resolvedModel` (which is `options.model`, the parent main-loop model — usually claude-opus-4-7) for the cost math. We deliberately kept this when fixing the attribution bug because the alternative (use `providerOverride.model`) would return $0 for any model missing from the pricing table — hiding spend entirely. So the dollar values are intentionally approximate.

**Work**:
1. Find openclaude's pricing table. Likely in `src/utils/modelCost.ts` (where `calculateUSDCost` lives) or a JSON file it imports.
2. Add per-model entries for the council's shim providers. Reference real pricing:
   - DeepSeek: deepseek-chat input ~$0.27/1M, output ~$1.10/1M (cache discount)
   - Gemini Flash: gemini-3.5-flash input ~$0.30/1M, output ~$2.50/1M (or free tier)
   - Qwen: qwen3.6-plus input ~$0.40/1M, output ~$1.20/1M (DashScope)
   - Mistral Large: ~$2.00/1M input, ~$6.00/1M output
   - Mistral Medium: ~$0.40/1M input, ~$2.00/1M output
   - OpenAI gpt-4.1-mini: ~$0.40/1M input, ~$1.60/1M output
3. In `claude.ts:2282`, change `calculateUSDCost(resolvedModel, usage)` to `calculateUSDCost(attributionModel, usage)` (where `attributionModel` is the providerOverride-aware variant we already compute).
4. Verify: run a council prompt, then `/spend --today` — deepseek/gemini/mistral rows should show realistic costs (cents, not dollars) and the total should drop accordingly.

**Estimate**: ~2-3 hours. Mostly research (verifying current per-million-token pricing for each provider) + a small JSON/code edit. Risk is low — `calculateUSDCost` already handles "model not in table" gracefully (returns 0), so a partial fix is safe.

**Why P2**: actively misleading. A user looking at `/spend --models` and thinking "wow, deepseek is expensive" would be drawing the wrong conclusion.

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
