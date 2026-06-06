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

### Fix cost-ceiling enforcement in runCouncil (mirrors the runDebate fix)

**Symptom**: Council's `costCeilingUsd` default of $3 is enforced by `CostLedger.recordOrThrow(stage, p.costUsd)` — but in the deterministic AgentTool path, `costUsd` is always 0 (AgentTool.call doesn't expose flat per-call cost). So the ceiling never actually fires; a runaway council could quietly bill multiples of the cap.

**Root cause**: same as the one fixed for `runDebate` in commit (next commit after this one). The orchestrator's local ledger only sees what spawn callbacks report; the global cost-tracker has the truth but isn't consulted.

**Fix**: copy the pattern from `runDebate`/`debate.ts`:
1. Add `getCurrentCost?: () => number` to `CouncilInputs` (defaults to `() => 0` for tests).
2. Update `CostLedger` in `councilOrchestrator.ts` to accept the callback and use `max(recorded, globalDelta)` as the accumulated total.
3. Wire `getTotalCost` in `runCouncilFromToolContext` (`councilSpawn.ts`).
4. Add 3 tests mirroring the debate test cases (per-spawn-cost path, getCurrentCost path, defaults-to-noop preservation).

**Estimate**: ~30 minutes. Direct copy of the debate fix, just applied to a different orchestrator.

**Why P2**: same risk surface as the debate bug — a stuck-spawn loop or runaway tool use could bill way past the configured cap before anyone notices. Council's $3 default is more forgiving than debate's $1, but the safety net is still off.

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

### MCP integrations for the research path

Five MCPs were evaluated against this project's needs. The two tiers below were the survivors — the rest were either redundant with existing tools (web search/fetch, sequential thinking, filesystem MCPs) or only relevant if scope expands (PubMed, GitHub MCP). See `CO-SCIENTIST.md` for context on why these specific capabilities are load-bearing for the planned hypothesis-loop architecture.

**Latency budget caveat (applies to all)**: each `/discover` voice has a 300s timeout. Any MCP that adds >30s per call eats noticeably into the fault-tolerance margin. Benchmark before wiring into the inner loop.

#### Tier 1 — would change observed system behavior

**arXiv MCP** *(highest single-impact addition)*
- *What*: paper search + abstract fetch against arXiv. Several community implementations exist; pick one with PDF-text extraction if possible.
- *Why*: Empiricist (in `/discover`) and the planned Generation/Reflection agents have no way to ground claims in real literature without user-supplied context files. This is the sharpest current limitation of the research path.
- *Wiring*: expose to `empiricistAgent.ts` first, then to the planned Generation + Reflection agents in Co-Scientist. Keep gated behind a flag — Methodologist + Hypothesizer + Devil's Advocate shouldn't have it (different roles, different failure modes).
- *Risks*: rate limits, abstract-only fallback if PDF fetch fails, citation-hallucination still possible if the agent doesn't actually read what it fetched. Validate with a "did the agent quote text that appears in the fetched abstract" check.
- *Estimate*: 1–2 hours wiring once an MCP server is selected; longer if writing a new server. Pilot on `/discover` against a question requiring real literature lookup.

**Wolfram Alpha MCP**
- *What*: structured math/physics/unit computation via Wolfram's API.
- *Why*: both observed `/discover` math slips would have been caught — the `V ∝ ρ⁻³` direction error and the Widrow `Δ²/24 vs Δ²/12` constant. Hypothesizer's "math sanity-check" prompt is currently the only line of defense and has failed in both observed live runs. A computation MCP turns sanity-check from a prompt instruction into a verifiable step.
- *Wiring*: expose to Hypothesizer + Empiricist (the voices most likely to assert quantitative claims). Add a post-generation hook that flags any unverified numerical claim in the position output.
- *Risks*: Wolfram has usage caps; expensive at scale. Limited to textbook formulas — won't help with novel derivations.
- *Estimate*: 2–3 hours. Easier than the Python-execution option; pick this first if not building Co-Scientist soon.

**Code-execution MCP** *(Python sandbox — Pyodide-based, or hosted via Modal/E2B)*
- *What*: in-loop Python execution for numerical sanity checks, unit verification, quick simulations.
- *Why*: same as Wolfram but extends to anything computable. Particularly relevant for the user's GW research since claims like "SNR scales as bit-depth N" or "phase mismatch accumulates as O(√N)" are directly testable, not just argued. Strictly more powerful than Wolfram but more work to integrate safely.
- *Wiring*: same agents as Wolfram (Hypothesizer + Empiricist). Should be allowlisted for write to a scratch dir only.
- *Risks*: sandbox hygiene is non-trivial; latency higher than Wolfram (cold start + execution); agent might run wrong code and "verify" a wrong claim. Add a "what did you run and what was the output" requirement to the position format if used.
- *Estimate*: 4–6 hours if using an existing MCP; longer if rolling sandbox infra. Defer until after arXiv + Wolfram ship.

#### Tier 2 — setup-worth, not behavior-changing yet

**Semantic Scholar / OpenAlex MCP**
- *What*: citation graph queries — "what papers cite X", "what does paper Y cite", author/venue metadata.
- *Why*: complements arXiv with cross-paper validation that arXiv search alone can't provide. Lower-impact than arXiv because the Empiricist's current failure mode is "no literature access at all," not "can't find related work to a known paper."
- *Wiring*: same call site as arXiv MCP (Empiricist). Wire after arXiv is proven valuable.
- *Risks*: API rate limits; some papers have no citation data; OpenAlex coverage varies by domain.
- *Estimate*: 1 hour once arXiv MCP integration pattern is established.

**Memory MCP** *(Mem0, MCP-memory-keeper, or similar)*
- *What*: persistent key-value or graph memory across sessions, exposed as MCP tools.
- *Why*: directly maps to Co-Scientist's "Context Memory" component documented in `CO-SCIENTIST.md`. Could hold the hypothesis pool + Elo state + Scientist feedback across sessions, which is required for the closed-loop tournament to work.
- *Wiring*: **do not adopt before building the in-process Context Memory primitive** (roadmap step 1 in `CO-SCIENTIST.md`). Picking an MCP first would couple the data model to that MCP's schema before we know what shape we actually want. Re-evaluate after roadmap step 5.
- *Risks*: state divergence between MCP and in-process state; vendor lock-in; data model coupling.
- *Estimate*: not yet — sequence after `CO-SCIENTIST.md` step 5 (Evolution agent) at the earliest.

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
Right now ≥3 blocks (out of 7) triggers revision. Could weight by role (Skeptic 1.5×, etc.) or by past accuracy (track which member's verdicts predicted actual bugs). *Now subsumed as Phase 3 of the self-improving council entry below — leaving the standalone item here as a pointer.*

### Self-improving council

Close the feedback loop: the council currently runs once, emits a diff, and forgets everything. Outcome data (was the diff accepted? did it need a revision pass? did the user reject it? did tests fail later?) is thrown away. With that signal captured, the council can improve along three axes — voting calibration, prompt evolution, and model routing — without retraining anything.

**This is not a single feature.** Five phases below, each independently shippable and each providing value on its own. The honest assessment is that *full* automated self-improvement is unlikely to converge at single-user scale (the signal is too sparse). What *will* work is telemetry + human-in-the-loop iteration, with progressively more automation as the data builds up.

#### Phase 1 — Outcome telemetry *(prerequisite, no learning yet)*

Without this, none of the later phases are possible. Log to `~/.openclaude/council-runs.jsonl`:

- Run ID, timestamp, prompt hash, router decision (heuristic/llm/forced)
- Per-voice: role, resolved model, proposal text, headline, duration, cost, success/failure
- Synthesizer plan + which proposals it cited (parse from output structure)
- Executor diff + files touched + revision-pass count
- Per-reviewer: verdict, model, summary
- **Outcome**: accepted / rejected / partial / needed-manual-fix — set by the user via slash command (`/council outcome <accept|reject|partial>`) immediately after the run

Default opt-in. Append-only, like `usage.jsonl`. Provides immediate value as a debugging trace even before any learning happens.

**Estimate**: ~4–6 hours. Mostly piping existing in-memory `CouncilResult` to disk plus a new slash command.

#### Phase 2 — Eval harness *(prerequisite for any prompt/model change)*

Pick 30–50 logged runs with clear outcomes. Replay them with modified prompts or model bindings and measure delta. Two replay modes:

- **Offline replay**: feed the original prompt through the council with new prompts/models; compare to the original outcome judgment (was the new diff better/worse/same in terms of what the original outcome suggested?).
- **Counterfactual scoring**: for runs the user marked "needed manual fix," store the user's actual fix. New runs that produce closer-to-that-fix score higher.

This is the foundation that makes Phase 3–5 not blind. Without it, every "improvement" is a guess.

**Estimate**: 1–2 days. Replay framework + a scoring rubric.

#### Phase 3 — Verdict calibration *(formerly the standalone voting-weights item)*

Lowest data requirement, simplest signal. Track per-voice: did this voice's block/concern verdicts predict a real outcome problem (revision needed, user rejection, post-merge bug filed)?

- Compute precision/recall per voice on the captured outcomes.
- Adjust block-weighting: voices with high precision get >1.0× weight; voices with high false-positive rate get <1.0×.
- Auto-tune the quorum threshold (currently ≥3 blocks → revision) based on the weighted-precision data.

Conservative defaults: don't deviate more than ±50% from baseline weights without ≥20 runs of evidence per voice. Surface the per-voice calibration in `/council stats` so the user can see why weights drifted.

**Estimate**: 2–3 days after Phases 1+2.

#### Phase 4 — Prompt evolution *(human-gated, never auto-shipped)*

A meta-reviewer agent runs nightly (or on `/council improve`) over the last N logged runs. For each role, it identifies recurring failure patterns and proposes prompt tweaks. The proposal is a *diff against the current prompt file*, written to a review queue.

- The user reviews each proposed diff via `/council review-prompts`.
- Approved diffs land via the existing edit infrastructure.
- Each change is A/B-tested via the Phase 2 eval harness on a held-out replay set before being applied — if eval score regresses, the change is rejected automatically.

Crucially: never apply a prompt change without (a) human review, and (b) eval-harness confirmation. Auto-evolving prompts in a tight loop is the most likely path to silent quality regression.

**Estimate**: 1 week. The meta-reviewer is a new agent (similar in spirit to Co-Scientist's Meta-review), but operating over council telemetry rather than research hypotheses.

#### Phase 5 — Model routing learning

Per-prompt-class model recommendations. Cluster historical prompts (embeddings + simple k-means) and track which model-binding configuration produced the best outcomes per cluster. Surface as suggestions (`/council suggest-models <prompt>` returns "for this kind of prompt, consider routing Implementer to gpt-4.1-mini") — not as auto-swaps.

Lowest priority of the five — model routing changes are easy to do manually and the signal is the weakest of the three.

**Estimate**: ~1 week, mostly because of the embedding + clustering infrastructure (which is also needed for the Co-Scientist Proximity agent — shared investment).

#### Risks + honest limitations

- **Sparse-signal problem at single-user scale**. You generate ~1–10 council runs per day; even Phase 3 (the simplest) needs ~20 runs per voice to be meaningful, so calibration won't be informative for weeks.
- **Goodhart's law**. Optimizing for "user accepts the diff" can mean producing diffs that *look* agreeable rather than diffs that are *correct*. Mitigate by capturing a delayed-outcome signal (post-merge bug rate, test failures within N days) and weighting it higher than instant acceptance.
- **Outcome bias**. The user marking "accepted" doesn't mean the council was right — it means the user didn't catch the bug yet. Same fix: lag the signal.
- **Confounding**. Was the run successful because of prompt X, or because the input happened to be easy? Eval harness controls for this somewhat by replaying the *same* prompts, but the harness itself can only score against outcomes already observed.
- **Replay drift**. Models update behind the scenes; a replay 6 months later isn't reproducing the same conditions. Pin replay model versions where the providers allow it.
- **Privacy**. Logged runs contain whatever prompts the user typed. Keep the telemetry local (`~/.openclaude/`); never ship to a remote endpoint without explicit opt-in.

#### Sequencing recommendation

Build **Phase 1 first and stop there until you've accumulated 30+ runs of telemetry**. That's the genuinely high-value step — even without any later phase, having the data lets you eyeball patterns and tweak prompts yourself (which is what's been happening informally for `/discover` already — the math-slip → Hypothesizer prompt update was exactly this loop, but run manually with the data living in your head). Phase 2+ is only worth building once the data clearly shows where the automated leverage would be.

**Total estimate if all phases ship**: ~3 weeks of focused work, but spread over months because Phases 3+ are gated on telemetry accumulation.

### Per-prompt member swap
`/council swap skeptic <model-id>` to temporarily replace the skeptic's model for the next prompt — useful when debugging or running A/B comparisons.

### Cost budget per session
`/council budget <usd>` to cap total council spend in the current session. Auto-disable when exceeded. (Per-query ceiling already implemented in `runCouncil`; session-wide is a separate layer. Depends on per-call cost capture from the "usage tracking" P2 work above.)

### Council mode for read-only queries
Currently council is overkill for explanations. But "explain this codebase" could benefit from a debate-style council where each member gives a different framing. Different prompt set, different default tools — needs design.

### True N×M grid TUI with full per-voice panes
Current grid is a 2- or 3-column layout sharing the `AgentProgressLine` row style. Side-by-side panes per voice (full `VerboseAgentTranscript` in each cell) is the remaining P2-UI work. Was noted in HANDOFF; deferred because the current grid covers ~70% of the UX goal.

### Animated stage transitions in council mode session view
Currently the session view in `COUNCIL_MODE_REDESIGN.md` v1 does hard cuts between stages (proposal → synthesis → execution → review → done). A brief 100–200ms fade or color-flash highlighting the new stage in the top bar would make the transitions feel less abrupt and reinforce the multi-stage mental model. Deferred from v1 because (a) Ink's animation primitives are limited compared to web animations and (b) keeping the v1 surface minimal lets the rest of the redesign ship by the planned Sunday. Revisit once the v1 session view has had a few weeks of use — animated transitions only land if the hard-cut version actually feels jarring in practice.
