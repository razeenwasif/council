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
- ✓ **Council telemetry Phase 1 (outcome + verification capture)** — `~/.openclaude/council-runs.jsonl` appended by `councilTelemetryCollector` (a session-bus subscriber, no orchestrator changes). `/verdict outcome` labels runs, `/verdict verify` attaches verifier verdicts (the hook for thesis-relevant external-critic data). Records carry per-voice model + output preview, synthesis + execution text, capped fields for storage hygiene. Subsequent phases of the original "self-improving council" entry (Phase 2 eval harness, Phase 3 verdict calibration, Phase 4 prompt evolution, Phase 5 model-routing learning) stay deferred — they were gated on this data substrate. See `src/utils/councilTelemetry.ts`, `src/utils/councilTelemetryCollector.ts`, `src/commands/verdict/`.
- ✓ **Tool-stripping for fan-out voices** — added `Read`/`Glob`/`Grep` to `disallowedTools` across 9 fan-out role definitions (council: skeptic/critic/tester/security/performance + debate: hypothesizer/empiricist/devilsAdvocate/methodologist). Closes the small-model tool-call loop trap that blew past `CLAUDE_CODE_MAX_OUTPUT_TOKENS` on Gemma 12b → Phi-4-mini → Qwen 4b. Done unconditionally (not conditional on routed model) because the project committed to local-only Council voices and these review roles never needed file access anyway. Originally tracked under the "Council prompts ↔ local-Gemma adherence" P2 entry — fix #2 ("Empty allowedTools") landed as the cheaper unconditional variant.

### Verified end-to-end with real council-authored code

Six artifacts in `src/utils/council/` (formatCost, withRetry, lruCache, clamp, parseQueryString w/ revision pass, sanitizePath, debounce, once). The parseQueryString and debounce runs exercised the full block→revision→retry path with all 7 voices reporting.

---

## P2 — actively useful, not yet built

### ✓ Fix cost-ceiling enforcement in runCouncil (mirrors the runDebate fix) — SHIPPED 2026-06-09

**Shipped** as documented in the fix sketch below. `CouncilInputs.getCurrentCost?: () => number` added to `councilOrchestrator.ts`; `CostLedger` rewritten to accept the callback, snapshot `startGlobalCost` on construction, and use `max(recorded, globalDelta)` as the accumulated total via `bestEstimateAccumulated()`. `runCouncilFromToolContext` in `councilSpawn.ts` wires `getTotalCost` through. Three orchestrator tests added covering the per-spawn-cost path, the getCurrentCost path, and the default-to-noop preservation. Build clean. The deterministic AgentTool path's costUsd=0 no longer hides cost-ceiling overruns — the global tracker is consulted as a backstop.

### Original entry (kept for context):

**Symptom**: Council's `costCeilingUsd` default of $3 is enforced by `CostLedger.recordOrThrow(stage, p.costUsd)` — but in the deterministic AgentTool path, `costUsd` is always 0 (AgentTool.call doesn't expose flat per-call cost). So the ceiling never actually fires; a runaway council could quietly bill multiples of the cap.

**Root cause**: same as the one fixed for `runDebate` in commit (next commit after this one). The orchestrator's local ledger only sees what spawn callbacks report; the global cost-tracker has the truth but isn't consulted.

**Fix**: copy the pattern from `runDebate`/`debate.ts`:
1. Add `getCurrentCost?: () => number` to `CouncilInputs` (defaults to `() => 0` for tests).
2. Update `CostLedger` in `councilOrchestrator.ts` to accept the callback and use `max(recorded, globalDelta)` as the accumulated total.
3. Wire `getTotalCost` in `runCouncilFromToolContext` (`councilSpawn.ts`).
4. Add 3 tests mirroring the debate test cases (per-spawn-cost path, getCurrentCost path, defaults-to-noop preservation).

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

### ✓ Add explicit length caps to council + debate role prompts — SHIPPED 2026-06-08

All council + debate role prompts now carry explicit "Length budget" + "STOP after [last section]" directives. Targets: council voices 400-700 words, council synth 800-1200, debate r1 400-600, debate r2 350-550, debate brief 800-1400, council review <200. Caps fire on Claude and small models that respect instructions (Phi, R1, Qwen). Caveat: Gemma 4 family (12B, 26B) **ignores length caps** at the synthesist scale — same architectural quirk visible across both model sizes. Root cause behind the synthesist rerouting to `deepseek-r1:7b-council` documented under "Mixed local-only routing baseline" in CONTEXT.md project history.

### Original entry (kept for context):

#### ~Add explicit length caps to council + debate role prompts (Gemma 26b verbosity)~

**Symptom**: with tool-stripping in place and `<think>` blocks scrubbed, the remaining failure mode is `gemma4:26b-council` voices (methodologist, synthesist) and `qwen3:4b-council` voices (empiricist, r2 round) producing as much legitimate content as `max_tokens` allows. At 32 K cap, they emit 32 K. At 16 K, they emit ~16 K. Not a loop — just verbose elaboration of each prompt subsection.

**Root cause**: the role prompts in `src/tools/AgentTool/built-in/{council,debate}/prompts.ts` were tuned for Claude/Opus, which auto-bounds based on natural pacing + RLHF brevity priors. Gemma family lacks that natural bound — given a prompt that lists Headline / Position / Reasoning / Evidence / Confidence / Press-on-others as required sections, Gemma fills each section exhaustively because there's no instruction telling it not to.

**Fix** (~1 h):
1. In each role prompt (POSITION_PROMPT, REVIEW_PROMPT, SYNTHESIST_PROMPT, EXECUTOR_PROMPT, etc.) add explicit length directives:
   - Voice positions: "Keep your full response under ~800 words. Each section should be 1-3 paragraphs."
   - Synthesist brief: "The complete brief should be under ~1500 words. Be concise."
   - Reviews: "Verdict + reason in under ~200 words."
2. Test against Gemma 26b — should hit the natural stop before max_tokens.
3. Test against Claude when quota resets — verify the brevity directive doesn't suppress useful detail.

**Why P2**: blocks the synthesist from completing on the current local-only fleet. Without it, every `/discover` and `/council` truncates mid-brief regardless of cap.

**Workaround until shipped**: `CLAUDE_CODE_MAX_OUTPUT_TOKENS=12288` (set 2026-06-08) — voices fit, synthesist often truncates anyway but at least the appendix is preserved.

### ✓ Strip `<think>` blocks from voice output at the orchestrator layer — SHIPPED 2026-06-08

Implemented in `src/utils/stripThinkBlocks.ts` + applied at all five orchestrator return paths (`researcherFromAgentTool`, `synthesistFromAgentTool`, `proposalFromAgentTool`, `synthesizerFromAgentTool`, `reviewFromAgentTool`). Handles closed `<think>…</think>` blocks AND unclosed (truncated) blocks; falls back to empty when only thinking was emitted. Confirmed working with R1 + Qwen 3 voices — telemetry previews and brief appendix now show clean position text, no scratch work.

**Deferred sub-item**: capture the stripped thinking into a `voice.thinking` archive field so the trace is preserved for thesis analysis rather than discarded. Plumbing: add `voice.thinking?: string` to the `Voice` type, a `voice-thinking` bus event, and a parallel collector path that captures `<think>` content the stripper drops. Not blocking — research can proceed with the current strip-only behavior. Saves CoT for offline analysis.

### Original entry (kept for context):

#### ~Strip `<think>` blocks from voice output at the orchestrator layer~

**Symptom**: voices routed to thinking-mode models (`deepseek-r1:7b-council`, `qwen3:4b-council` — Qwen 3 family enabled thinking in 2025) emit `<think>...</think>` chain-of-thought blocks before their actual structured answer. R1's thinking can run 5–10 K tokens on dense topics; Qwen 3's is smaller but non-trivial. This content currently lands verbatim in `voice.output`, with three downstream consequences:

1. **Brief bloat.** The synthesist receives the thinking as if it were part of the position. Either the brief includes scratch work as analysis (false signal), or the synthesist itself wastes context-window on parsing it.
2. **Agent-thoughts pane bloat.** The user sees a wall of CoT before the actual headline/position/reasoning sections, making it hard to scan whether the voice's *conclusion* was good.
3. **Telemetry bloat.** The captured `outputPreview` (first 500 chars) is often *entirely* thinking, with the real position past the truncation point. Means the record's at-a-glance scan value is degraded for any run involving R1/qwen3 voices.

**Root cause**: thinking is structural in R1 (hard-baked into the distillation, no toggle). Qwen 3 *can* be disabled via `/no_think` in the system prompt or chat template, but doing so loses one of the reasons the model was added to the fleet. The right framing is: thinking is *valuable* (it's why these models were chosen for `hypothesizer`/`devils_advocate`/`empiricist`) — but it's *intermediate*, not the answer. It should be captured separately, not concatenated with the final position.

**Fix** (~3-5 h):
1. Add a chunk-rewriter to `councilSpawn.ts` and `debateSpawn.ts` voice-output emission paths. State machine: when an open `<think>` tag is seen in the streamed chunks, route subsequent chunks to a separate sink until the closing `</think>` is seen; then resume routing to the normal voice-output sink.
2. Add a `voice.thinking?: string` field to the `Voice` type in `src/components/CouncilSession/types.ts`. Populate from the side sink.
3. Add a new session-bus event `voice-thinking` (analogous to `voice-output`) so the React reducer can append to `voice.thinking` without touching `voice.output`.
4. Update the StagePane to render thinking as a collapsed/dim section below the main voice content (default-hidden, expand on focus or via a keybind).
5. Update `councilTelemetryCollector` to capture a `thinkingPreview` field (first 500 chars of thinking) alongside `outputPreview`, so the telemetry record carries both signals separately.

**Why P2**: directly relevant to the user's thesis methodology — having clean voice positions and *separately archived* thinking traces is exactly the kind of structured artifact a paper on "verification in multi-agent reasoning systems" wants. The R1/qwen3 voices are part of the fleet specifically *because* their reasoning is interesting; the fix is plumbing that interest into a usable representation, not suppressing it.

**Workaround until shipped**: `CLAUDE_CODE_MAX_OUTPUT_TOKENS=32768` (bumped 2026-06-08) absorbs the bloat at the cap layer. Brief content will include thinking verbatim. Acceptable for iteration; not acceptable for the paper.

### Council prompts ↔ local-Gemma adherence

**Symptom**: when council/discover voices are routed to local Gemma 4 models (e4b, 12b) via Ollama's OpenAI-compatible endpoint, two failure modes appear consistently:

1. **Gemma 12b on the `performance` role (and likely `architect`, `security`) loops on tool calls.** The role definitions allow Read/Grep/Glob; Gemma 12b attempts to invoke them, the Ollama OpenAI shim's tool-call format isn't a clean match for what Gemma produces, the model retries → output blows past `CLAUDE_CODE_MAX_OUTPUT_TOKENS` (seen at 32K and 64K caps, both hit).
2. **Gemma e4b on the `executor` role narrates instead of producing a diff.** Returns natural-language explanations of what it plans to do ("Let me begin the refactoring process by executing Phase 1: Context Acquisition...") rather than the unified diff the executor prompt asks for.

Together: Council can dispatch local voices, get proposals, synthesize, but the executor produces unusable output and 12b voices occasionally hang.

**Root cause**: the system prompts in `src/tools/AgentTool/built-in/council/prompts.ts` and `src/tools/AgentTool/built-in/council/<role>Agent.ts` were tuned against Claude / GPT / DeepSeek — models with strong instruction-following on hard format constraints + structured tool-call output. Gemma family models are weaker on both axes:
- Their OpenAI-compat tool-call format through Ollama is sometimes malformed (the shim can't parse it), leading to retry loops.
- They have a strong bias toward narrating reasoning even when told not to.

The repo's coordinator architecture already assumes per-voice tools — there's no built-in way to say "this voice has no tools when running on this provider."

**Fix** (in increasing order of work):

1. **Tighten the executor prompt with explicit Gemma-friendly examples** (~1-2h). In `src/tools/AgentTool/built-in/council/prompts.ts`, the `EXECUTOR_PROMPT` already says "produce a diff" — add a worked example showing exact unified-diff format, prefixed by "DO NOT narrate. DO NOT explain. Output ONLY the diff starting with `--- a/`...". May still fail under Gemma — but easy to ship and may help.
2. **Empty `allowedTools` per voice when routed to local model** (~3-4h). Voices that don't need to write (skeptic, critic, tester, security, performance, architect proposal-stage) can run with zero tools and just produce structured analysis. Requires plumbing the routed model name back into the agent definition before dispatch, OR adding a `localModelToolPolicy` field per agent. Killing tool access kills the tool-call retry loop entirely.
3. **Pre-process Gemma tool-call output to normalize the format** (~6-8h). Detect Gemma's actual format quirks, rewrite into the OpenAI tool-call spec before the shim consumes it. Brittle long-term — better to wait for Ollama / vLLM upstream fixes.
4. **Switch local-routed roles to a model family with better instruction-following** (~variable). Qwen 3, DeepSeek-V3-Lite, Llama 4 Scout — all reportedly stronger than Gemma 4 on instruction adherence + tool-call format. Cost: re-pull, re-tune Modelfile, re-route. Worth benchmarking but bigger surface area.

**Estimate**: fix #1 is the quickest meaningful win (1-2h). #2 is the structurally-correct fix (3-4h) and the one to land before doing serious local-multi-agent research.

**Why P2**: every push toward "Council runs entirely on local hardware" is blocked by this. The user's research thesis ("Information-Preserving Quantization of Domain-Specialist Fine-Tunes for Verification in Multi-Agent Scientific Reasoning Systems") explicitly relies on local quantized models being usable as council voices — at minimum as verifiers. Today they're not, because their output is either an infinite tool-call loop or a polite narrative. Fix #1 + #2 unblock the verification-layer experiments planned in `ROADMAP.md`.

**Context** (from the 2026-06-07 setup session): all-Gemma routing works end-to-end at the dispatch level (verified after fixing the `~/.openclaude/` vs `~/.claude/` config-home trap — see hard rule #15). The remaining failures are downstream of dispatch. Working config snapshot:
- `model`: `gemma4:e4b-council`
- All 14 council/discover roles routed to `gemma4:e4b-council` (12b kept blowing past max_tokens on `performance`)
- Modelfile params: `num_ctx 16384`, `num_predict 4096`, `temperature 0.1`, `top_k 64`, `repeat_penalty 1.2`
- `env.CLAUDE_CODE_MAX_OUTPUT_TOKENS=65536` (raised twice from 32K → 64K → 65K trying to outrun the loop; once tool-call loops are killed, can drop back to default)

### TUI render-perf — measurement-gated optimizations

A list of TUI/render perf improvements surfaced in a 2026-06-07 review. Documented here so we don't lose them; **do NOT speculatively ship these** — the rule is measure first, then pick the one(s) the data justifies. Listed in execution order, with each later item gated on the previous.

**Phase 1 — instrumentation (do first, regardless)** *(~3-4 h)*
- *What*: expose Ink's existing frame-phase metrics (`renderer`, `diff`, `optimize`, `write`, `yoga`, `commit`, `patches`, `yogaLive`) behind a debug flag. `FpsTracker` + the phase counters are already in `src/ink/ink.tsx` — just need a `/perf` slash command or `COUNCIL_PERF=1` env that prints a ring-buffer summary every N seconds.
- *Why*: every other item on this list is a guess without it. The hot path could be Yoga commit, ANSI diffing, terminal write, React fiber commits, or upstream cache eviction — they look identical in subjective "feels slow."
- *Output*: a per-second log showing the breakdown so a session profile can answer "what's actually expensive?"

**Phase 2 — risk-free fix (ship even without data)** *(~1 h)*
- *What*: pause spinners, shimmers, and elapsed-time tickers when their owning pane is unfocused or their associated tool is inactive. `SessionStatus.tsx` and `StatusPane.tsx` have 1-second timers that should only tick when the pane is the focused one (post-Phase-2-dual-pane, that means only one of the two workspace panes ticks).
- *Why*: established pattern in the repo (existing comments around it); no risk; concrete waste eliminated.

**Phase 3 — measurement-gated picks** *(do at most one or two of these per cycle, ordered by expected ROI from the Phase 1 profile)*
- **LRU cache for `HighlightedCode`** *(~2 h, ship IF profile shows syntax highlighting dominates the diff/optimize phase)*: key by `filePath + codeHash + width + theme + dim`. Bounded size (50-100 entries). Especially impactful for tool outputs / diffs that get remounted while scrolling.
- **Memoize derived arrays in Council views** *(~1-2 h surgical, ship IF profile shows commit/yoga spikes from re-renders of unstable parent props)*: `runningVoices`, pane title objects, repeated border/title config. ONLY the specific arrays that profiling fingers — do not blanket-apply `useMemo`.
- **Bound retained caches** *(~2-4 h, ship IF profile shows memory growth from a specific cache without TTL)*: this is conditional on identifying the leak point — message-history caches, syntax-highlight outputs, search indices. Bound the offending one specifically.

**Phase 4 — defer indefinitely unless data forces them**
- *Incremental message store in `Messages.tsx`*: existing O(n) rebuild is bounded (n=200 worst-case non-virtual; viewport-only in virtual mode). Replacing it with a derived-state store is a real refactor with regression risk. Don't touch unless profiling shows it's the dominant cost AND sessions regularly exceed n=200 messages.
- *Worker-thread offload for Markdown / syntax highlighting*: worker IPC overhead (serialize → postMessage → deserialize → postMessage back) is its own ~5-15ms tax per round-trip. Net loss unless the UI thread is genuinely blocked for >50ms sustained AND the Phase 3 LRU cache hasn't already solved it.

**Why P2**: every dual-pane + Council UX iteration gets more sensitive to render lag — multi-agent dispatches already serialize 14 voice spawns, so any UI-thread cost compounds. But this is also exactly the territory where speculative refactors waste days. The phasing here is the actual guardrail.

---

## P3 — cleanup carryover from pre-v1

None of these block anything; they're hygiene as opportunities arise.

### MCP tool-call compatibility audit across local model fleet — TWO distinct failure modes observed

**Symptom / motivation**: 2026-06-08 — empiricist role with arxiv MCP integration enabled tested across three local models:
- `llama3.1:8b-council`: **cap-hit, tool-call loop** (attempted invocation, Ollama shim format mismatch, retry loop until 24K cap exhausted)
- `phi4-mini:3.8b-council`: **cap-hit, tool-call loop** (surprising — Phi-4-mini was specifically positioned by Microsoft as agent-tool-friendly, but its tool format doesn't survive Ollama's OpenAI-compat shim either)
- `mistral-nemo:12b-council`: **completed cleanly, but did NOT actually invoke MCP tools** — produced 2400+ chars of fabricated citations and parametric-memory hallucinations dressed up as MCP-grounded evidence. Mentioned tool names as text but never called them. **STRICTLY WORSE than the cap-hit failure mode** because the output looks grounded but is entirely fabricated.

**Two distinct local-model failure modes** mapped to the arxiv-MCP empiricist:

1. **Tool-call loop** (llama3.1, phi4-mini): model attempts invocation, format mismatch causes retry loop, output budget exhausted with no useful content.
2. **Tool-call abstention with falsified output** (mistral-nemo): model interprets "use tool X" instruction as "mention tool X in output," produces normal-looking response with completely fabricated citations. *Looks* like grounded research, isn't.

Concrete example of (2) — Nemo's empiricist output cited "Grove-Oggier-Delauney-Bonnet, 2022, arXiv:2211.15086" — author surname mash is fabricated; Grover's algorithm is misattributed to "Grove"; a "Schrödinger's horse" referenced; "Moore & Thriges 2017" invented. The output also literally includes the string `mcp__arxiv__search_papers` in the text, treating the tool name as evidence rather than invoking it.

This is a **load-bearing finding for the thesis's local-Council architecture**: MCP tool grounding (the central mitigation for confabulation) is currently only viable for one of seven models in the fleet. The verification-layer claim depends on local models being able to reliably integrate external knowledge sources via MCP, and that capability is much narrower than the model-instruction-following capability we measured earlier.

**Why P2**: documents a real architectural constraint. Until either Ollama's tool-call shim improves OR more models are validated, only Mistral Nemo can host MCP-grounded voices. Worth a survey + write-up for the paper's evaluation chapter.

**Work** (~3-4 h, testing-heavy):
1. Build a small test harness over `/voice-test`: fire each routed model through a known-MCP-requiring prompt, capture (model, status, tool-call attempts via Council's tool-use telemetry, time, output). Targets to test: gemma4:e4b-council, gemma4:12b-council, gemma4:26b-council, phi4-mini:3.8b-council, qwen3:4b-council, deepseek-r1:7b-council, qwen2.5-coder:7b-council, mistral-nemo:12b-council, llama3.1:8b-council, llama3.1:8b-instruct (if pulled separately for vanilla comparison).
2. For each: emit one MCP tool call (e.g., `mcp__arxiv__search_papers`); observe whether the call completes, returns mangled response, or loops.
3. Document the working set as `mcpToolCallCompatible: true` in agentModels (new field) for future routing decisions.
4. Update CONTEXT.md hard rules to note: for MCP-grounded roles, only Nemo (and any future certified models) is viable.

**Why this matters for the thesis**: the paper's quantization-vs-verification angle has an implicit assumption that quantized models can use MCP tools. If only one model family supports this, the paper's claims about local-substrate-as-substrate need a caveat — the verification layer's grounding step has a narrow model compatibility profile. That's not a deal-breaker (it's a finding) but it's worth explicitly stating.

---

**Loop-bug investigation update (2026-06-08, late session)**:

Pulled the Llama 3.1 chat template via `ollama show llama3.1:8b-council --template`. Concrete data:
- Llama 3.1's template instructs tool-call emission as inline JSON: `{"name": "function_name", "parameters": {...}}`
- Tool *results* are expected back as `role: tool` messages, rendered into the template as `<|start_header_id|>ipython<|end_header_id|>` blocks.
- Council's OpenAI shim sends tools in OpenAI-standard format → Ollama's template formatter substitutes them into the system message per its Modelfile → model is told to emit JSON.

Three hypothesis branches for where the loop comes from, ranked by likelihood:

1. **Parse-side failure** (most likely). Llama 3.1 emits the JSON with extra surrounding text ("Sure, I'll call the search tool: {...}") or markdown fences (```json {...} ```). Ollama's tool-call extractor expects a clean JSON object and fails to detect the call. The JSON ends up as plain content text. The shim doesn't recognize it as a structured `tool_calls` delta. Model sees no `ipython` response → retries → loop. *Diagnostic*: capture the raw delta.content from a /voice-test run where this happens; check if it contains JSON.

2. **Round-trip failure**. Tool call parses fine on the way out, but when Council sends the tool RESULT back, it's formatted as `role: tool` per OpenAI spec. Llama's template expects this and renders as `ipython`. But the shim might be wrapping the result content with prefixes ("Tool result for X:") or escaping JSON inside it. Diagnostic: log the messages array sent to Ollama on the round-trip request after a successful first tool call.

3. **Accumulation bug** (least likely given Ollama is mature). Structured `tool_calls` arrive correctly across stream chunks but the shim's per-index buffer at `openaiShim.ts:1306-1370` accumulates partial-JSON args incorrectly when the delta arrives in unusual chunk shapes. Diagnostic: would only show up by inspecting `activeToolCalls.get(tc.index)` buffer evolution.

**Reproduction plan** (next session):
```bash
# Enable Ollama debug output to capture raw exchanges
OLLAMA_DEBUG=1 ollama serve  # restart with verbose
# (Or: journalctl -u ollama -f to tail the existing serve)

# Run a single empiricist call against llama3.1 with MCP available
/voice-test empiricist llama3.1:8b-council "Find one arXiv paper about post-quantum lattice security and read its abstract."

# Inspect the Ollama journal for the request/response pair — look at what
# Llama emitted in its assistant message before the cap-hit fired. The
# format of that message tells us which hypothesis branch is the live one.
```

After capturing, the fix is one of:
- Hypothesis 1: extend the shim's `parseRawToolCallsRequestedText` to also match JSON-object-with-name-and-parameters inline patterns (Llama 3.1 native format), so when Ollama's parser misses, the shim catches.
- Hypothesis 2: clean up the shim's tool-result message serialization to match Llama's expected format (no prefix, no escape).
- Hypothesis 3: rewrite the delta accumulator to handle out-of-order chunk arrival.

Status: data-gathering deferred to next session; investigation tracked here.

### Center workspace pane stops scrolling after a run completes

**Symptom** (2026-06-08, user-reported): after a `/voice-test` (and likely any slash-command) run completes, the center workspace / REPL pane no longer responds to PageUp / PageDown / arrow scroll input. Issuing `/copy all` temporarily restores scrolling — a one-off workaround that strongly suggests a focus / re-render issue rather than a content / overflow issue.

**Strong hypothesis**: `REPL.tsx:4817` mounts a `<ScrollKeybindingHandler>` whose `isActive` gate is:
```ts
isActive={isFullscreenEnvEnabled() && (centeredModal != null || !focusedInputDialog || focusedInputDialog === 'tool-permission')}
```
If `focusedInputDialog` is set to a value OTHER than `'tool-permission'` (and no `centeredModal` is open), `isActive` becomes `false` and the keybind handler stops processing scroll input. After a long-running slash command completes, the slash-command UI may leave `focusedInputDialog` in a stale non-default state instead of clearing it back to `undefined`. `/copy all` works because it triggers a re-render that pushes the dialog state back to `undefined`, re-enabling the keybind handler.

**Investigation plan** (~30-60 min):
1. Add temporary `logForDebugging` calls at `REPL.tsx:2127` (`getFocusedInputDialog`) + `REPL.tsx:4817` (the isActive computation) — log when `focusedInputDialog` changes and what the `isActive` resolves to.
2. Reproduce: launch Council, run a slash command, observe the post-completion state. The logs should show whether `focusedInputDialog` is sticking to a non-undefined value.
3. If confirmed: find what's holding the dialog state open. Likely the slash-command result rendering leaves an unclosed modal/dialog component. Look at `/handoff` and `/voice-test` result paths — they return `{ type: 'text', value: ... }` which should be a one-shot render with no dialog state.
4. Also worth checking the secondary `<ScrollKeybindingHandler>` at `REPL.tsx:4669` (the unconditional one) — if both are mounted simultaneously, ordering / `event.stopImmediatePropagation()` interactions could be at play.

**Why P2**: a usability bug, not a correctness bug — the data still gets written to JSONL, just the scrollback browsing is blocked. Workaround (`/copy all`) is known. Worth fixing because the user works in the REPL during long sweeps and needs to scroll past long outputs.

**Why not P1**: not blocking the Phase 1 sweep or thesis work. Triggered after each run but recoverable in one keystroke.

### ✓ Suppress `tools` field in OpenAI shim for models that don't declare tool capability — SHIPPED 2026-06-08

**Shipped** as a per-model `supportsTools?: boolean` field on `agentModels[<tag>]` in `~/.openclaude/settings.json`. The OpenAI shim looks up the flag via `getInitialSettings()` at the tool-conversion site in `openaiShim.ts:1883`; when `false`, the entire tools block is skipped before the request is built. Also tightened the error classifier (`openaiErrorClassification.ts:isToolCompatibilityMessage`) to match Ollama's "does not support tools" wording so the existing self-heal retry path catches misconfigured models as a backstop.

Set `supportsTools: false` on the 5 known-bad models: `phi4:14b-council`, `mathstral:7b-council`, `meditron:7b-council`, `olmo-3:7b-council`, `falcon3:10b-council`. Verified end-to-end via `/voice-test` pilot — all four new specialists now reach the model and return content; the previous 0.2s 400-error path is gone.

### Original entry (kept for context):

**Symptom**: `phi4:14b` (and likely other completion-only Ollama models) reject any request with a `tools` field, returning `400: does not support tools`. Council's OpenAI-compat shim at `src/services/api/openaiShim.ts` sends `tools: [...]` on every request — even when the role has all tools disallowed and the array is effectively empty. The receiving model strictly checks the field's *presence*, not its contents, against its manifest's tool-capability declaration.

**Discovered 2026-06-08** via `/voice-test synthesist phi4:14b-council "..."` — 0.2 s rejection from Ollama. Blocks Phi-4 14B from being a Council voice despite Phi-4's strong instruction-following capacity.

### `/voice-test` harness loses partial output on cap-hit (NEW — discovered 2026-06-08)

**Symptom**: when a voice cap-hits during a `/voice-test` invocation, the harness records the API error string (`"Claude's response exceeded the 24576 output token maximum…"`) as `output` and the actual accumulated content is discarded. Observed during the Phase 1 pilot — `olmo-3:7b-council` ran for 250s generating >24K tokens; we know FROM the Ollama log it produced ~28K tokens, but the JSONL record contains only the 162-character error message. This loses the most diagnostic signal: *what was the model rambling about* (verbose-on-topic vs runaway-gibberish vs topic-drift).

**Work** (~1 h):
1. In `src/commands/voice-test/voice-test.ts`, when the AgentTool call fails with the "exceeded output token maximum" error, intercept and try to recover the partial assistant content from the message stream before discarding.
2. Add a new status value `'cap-hit'` (distinct from `'complete'` which currently masquerades for cap-hit cases) — finishReason was probably "length" but isn't being surfaced; see also the related `finishReason` plumbing fallback noted in the original `/voice-test` plan.
3. Record both `outputPartial: string` (the recovered content, up to the existing 30K char cap) and `outputLen: number` (uncapped accumulated length, for cap-hit detection comparison vs `max_tokens_requested`).
4. Verify by re-running OLMo-3 on the empiricist prompt — should now record the actual ~28K-character ramble, which can be inspected for topic-drift vs verbose-on-topic classification.

**Why P2**: blocks classification of the most interesting Phase 1 failure mode (length-cap noncompliance). Currently we can detect cap-hit but can't say *what kind of failure* it was — that's the difference between "verbose model, recoverable via stricter cap" and "broken model, exclude from fleet." Both diagnoses feed the thesis methodology chapter directly.

### ✓ Citation verification harness — SHIPPED 2026-06-09

**Shipped** as `/verify-citations` slash command. Scope: arXiv IDs only (this iteration). Author-name confabulations (e.g. "Yang & Hodgkiasz, 2023" — actual case from the quantization-calibration brief) require a different lookup strategy and stay deferred to a v2.

  - `src/commands/verify-citations/verify-citations.ts` — extracts arXiv IDs from a brief (regex `\b\d{4}\.\d{4,5}\b`), HEAD-checks each against `https://arxiv.org/abs/<id>` in parallel with a configurable timeout (default 5 s), flags any that 404 / 503 / time out.
  - With no args: scans the most-recently-modified `.md` in `~/Research/debates/`. With a path arg: scans that file. `--timeout=<ms>` flag.
  - Appends `citationsVerified: { id, url, status, resolves, checkedAt, errorMessage? }[]` to the matching record in `~/.openclaude/council-runs.jsonl` (match by `briefPath` — best-effort no-op if no match).
  - Prints per-ID `[OK]` / `[FAIL]` summary to the REPL with the failure mode (HTTP code / timeout / error).

**Deferred (P3 — v2 work)**:
- Auto-trigger from session-end (currently manual `/verify-citations` invocation). Hook into the existing `councilTelemetryCollector` session-bus subscriber to fire after each `/discover` brief lands.
- Auto-attach a `/verdict verify incorrect` when ≥1 ID fails to resolve.
- Author/title verification — would catch the "Yang & Hodgkiasz" class of confabulation that arXiv-ID checks miss. Likely strategy: Semantic Scholar API by title hash, or arXiv search by author+year. Both have rate-limit considerations.

### Original entry (kept for context):

**Symptom**: even with arXiv MCP grounding the empiricist (when shipped), there's no automated check that the citations in a debate brief actually resolve. Prior runs have produced confident-sounding arXiv IDs that 404 — the model invented the ID from a plausible-looking date + index. A verifier loop catches these without any human read.

### Benchmark / regression harness

**Symptom**: no way to answer "did my last prompt change improve brief quality?" without running a half-dozen `/discover` invocations by hand and reading each. The current iteration loop is anecdotal; the thesis needs reproducible measurement.

**Work** (~3-4 h):
1. Fixed `~/Research/benchmark-questions.jsonl` with 10-20 questions spanning the project's domains (PQC, GW SNR quantization, distributed graph algorithms, RAG-hallucination — whatever covers your thesis's hypothesis space).
2. New slash command `/bench run [N]` fires each question through `/discover` (or `/council` — argument-toggleable) and captures the resulting telemetry record by reading `~/.openclaude/council-runs.jsonl` newest-N entries.
3. Output: CSV at `~/.openclaude/bench/<timestamp>.csv` of (question, kind, durationMs, completed-voices, status-distribution, outcome, verdict-count, verdict-distribution).
4. Optional follow-up: `/bench diff <run-A-ts> <run-B-ts>` to render a side-by-side comparison.

**Why P2**: the thesis's evaluation chapter wants exactly this artifact — a deterministic, reproducible benchmark across prompt/model variants. Without it, claims about "routing X gives better briefs" remain vibes. The harness IS the evaluation methodology.

### Investigate git context leakage into synthesist brief (data leak bug)

**Symptom**: 2026-06-08 — a `/discover` brief with synthesist routed to `deepseek-r1:7b-council` emitted literal git commit SHAs from the current repo's history *inside the brief's "Strongest convergent claim" section*:

> "NIST has initiated a standardization process (**39c6ce4 feat(council): synthesist debugging - strip-think + length-caps**…; **e142f94 fix(ui): first-render layout for scratchpad + tasks side panes**) targeting robust, quantum-resistant algorithms…"

Those are real commit SHAs from the current Council session — `39c6ce4` and `e142f94` are commits we made earlier this same day. The synthesist's input should be ONLY (a) the user prompt and (b) the 8 voice positions — no git state, no environment, no file paths.

**Why this matters**: synthesist + fan-out voices all have file-system tools (Read/Glob/Grep/Bash/Edit/Write) disallowed via the agent definitions (CONTEXT.md hard rule #20). The empiricist on `llama3.1:8b-council` was the only voice with potentially-tool-equipped role in this run; tool-stripping should have prevented any voice from reading git state.

**Hypotheses to investigate** (in order of likelihood):
1. **CLAUDE.md / context-file auto-injection** — Council may auto-include CLAUDE.md or other top-level context files in the agent prompt. If CLAUDE.md mentions recent commits OR if git log is in the prompt context somewhere, the synthesist would see and synthesize over it. Check `src/utils/contextInjection.ts` or equivalent.
2. **Inherited `ToolUseContext`** — slash commands receive a `ToolUseContext` whose `options` may include cached state from earlier turns in the REPL session. If git log was emitted in scrollback and somehow got embedded, the synthesist might receive it as "additional context."
3. **Empiricist tool-call escape** — `llama3.1:8b-council` empiricist might be using Read/Bash via some shim path that bypasses the role's `disallowedTools` list. Verify by inspecting empiricist's position text in the appendix of `~/Research/debates/2026-06-08-15-56-how-will-the-advent-of-practical-quantum.md` for any reference to commit hashes.
4. **DeepSeek-R1 thinking-mode access** — R1 may have some prompt-construction quirk where its thinking step inspects something accessible. Less likely but worth ruling out by seeing if Nemo or other models also exhibit this on the same data.

**Work** (~2-4 h to diagnose, depends on what we find):
1. Cat the offending brief file in full; identify the EXACT origin of the SHAs (which voice's position contains them, or only the synthesist's section).
2. Grep `~/.openclaude/council-runs.jsonl` for "39c6ce4" — find which voice's `outputFull` first contained the leak.
3. Trace upstream from that voice's input — was the SHA in `prompt` or `output`?
4. If from prompt: bug in context construction; fix in `buildResearcherPrompt` / `buildSynthesistPrompt`.
5. If from output: bug in tool gating (a voice with tool access leaked).

**Why P2**: data leak between Council's internal state (git history, file system) and the model's input/output is a *thesis-relevant integrity issue* — the paper's verification architecture assumes voices reason only over what's provided. If voices have backdoor access to repo state, the experimental design is contaminated. Worth diagnosing before more runs accumulate confusable telemetry.

**Workaround until diagnosed**: don't route synthesist to `deepseek-r1:7b-council` — keep on `mistral-nemo:12b-council` which (in observed runs) doesn't exhibit this leak. The leak may be R1-specific (thinking-mode quirk) or may be present on Nemo too just unnoticed.

### Domain Specialist role for `/discover` (and optionally `/council`)

**Symptom / motivation**: the thesis's central architectural claim is that **domain-specialist fine-tuned quantized models slot into the multi-agent council as one of the voices** — locally hosted, narrowly scoped, complementary to frontier generalists. Council currently has no role slot for this; the 4-voice debate (hypothesizer / empiricist / devils_advocate / methodologist) is all generalist analytical lenses. Adding a `domain_specialist` role creates the experimental scaffold the paper requires.

**Why P2**: this is the paper's experiment surface, not just another voice. Without it, the thesis has nowhere to plug in "the fine-tuned GW-physics+quantization specialist we trained as part of this work." Stubbing the role now (with a generic strong model + domain-specific system prompt) means the fine-tuned model is a drop-in replacement when it's ready — no orchestrator surgery needed at swap time.

**Sequencing prerequisites**:
1. Verifier role shipped (existing voices need to be reliable before adding a 5th).
2. arXiv MCP shipped (so the specialist isn't competing with confabulating empiricist).
3. `/discover` synthesist proven stable at 5-voice input (current synthesist prompt assumes 4 — needs update).

**Architectural design choices**:

| Decision | Choice | Rationale |
|---|---|---|
| Role placement | 5th voice in `/discover`, full r1 + r2 participation. Optional 10th voice in `/council` for domain-relevant engineering tasks. | r1 lets the specialist contribute first-principles domain claims; r2 lets generalist voices engage with them and vice versa. |
| Initial model (stub) | `gemma4:26b-council` with domain-prefixed system prompt | Largest local model gives best chance of recalling domain-specific facts. Stub gets replaced with the user's fine-tuned GW-physics-quantization model when training completes. |
| Tool access | Same fan-out disallow list: no Read/Glob/Grep/Edit/Write/Bash. Future: arXiv MCP allowed (specialist needs lit access to ground domain claims). | Don't re-introduce the loop-trap surface. |
| Position format | Standard r1 / r2 output formats + dedicated "Domain Evidence" section | Distinguishes domain-specific findings from generic citations. Drives the synthesist's `# Brief` toward attributing specialist contributions distinctly. |
| Synthesist integration | Update `SYNTHESIST_PROMPT` to expect 5 r1 + 5 r2 positions (currently hardcoded 4). Add "Domain insights" subsection. | Required — synthesist won't surface the specialist's contribution as distinct unless prompted. |
| Telemetry shape | No schema change needed — `voices[]` array already variable-length. | `councilRunRecord.voices.length` jumps from 4 to 5 (or 8→10 across r1+r2). |
| Domain selection | First implementation: hardcoded to GW physics + quantization (user's thesis domain). Future: configurable via `~/.openclaude/settings.json` `domainSpecialist.domain` field. | Don't over-engineer. The thesis has one domain; build for that, generalize later. |

**Prompt sketch** (the load-bearing part):

```
You are the Domain Specialist. Your lens is gravitational-wave
detection physics and signal-processing-under-quantization. You
bring deep domain knowledge that the other four voices
(hypothesizer / empiricist / devils_advocate / methodologist) cannot.

Your job:
1. Recognize when the question is in or near your domain. If yes,
   contribute the strongest claim that REQUIRES domain knowledge —
   something the other voices would miss without your expertise.
2. If the question is far from your domain, say so explicitly in
   "## Domain relevance" (one sentence) and then contribute what you
   can from analogous principles, with the caveat clearly noted.

For r1: produce a position grounded in domain-specific evidence.
Cite real papers (LIGO O3/O4 papers, Newman-Saulson noise modeling,
Adhikari thermal-noise budgets, Widrow quantization noise scaling),
real instruments (LIGO, Virgo, KAGRA, future Cosmic Explorer), and
real metrics (effective range Mpc, BNS horizon distance, characteristic
strain h_c, sensitivity floor near 100 Hz). Vague "GW detectors are
sensitive to noise" claims are unacceptable — name the specific
noise floor.

For r2: engage with the other voices' positions specifically through
your domain lens. Examples of legitimate moves:
- "r1-methodologist proposes X. In a GW context, X fails at frequencies
  below ~30 Hz because of seismic noise — see <citation>."
- "r1-empiricist cites Y. The analogous result for our quantized SNR
  case would be <derived claim> — assuming bit-depth N ≥ 12."

Output format: standard r1/r2 schema + add "## Domain evidence" section
listing 3-5 domain-specific citations or instrument-level facts.

Length budget: same as other voices (400-600 words r1, 350-550 r2).
```

**Implementation work** (~3-4 h):
1. New file `src/tools/AgentTool/built-in/debate/domainSpecialistAgent.ts` — `BuiltInAgentDefinition`, tool-stripped, model defaults to `gemma4:26b-council`.
2. New `DOMAIN_SPECIALIST_PROMPT` in `src/tools/AgentTool/built-in/debate/prompts.ts`.
3. Extend `debateSpawn.ts` to spawn 5 voices in r1 + 5 in r2. Voice list extension in `runDebate` opts.
4. Update `SYNTHESIST_PROMPT` to add "## Domain insights" subsection in the brief schema.
5. Wire `domain_specialist` into `agentRouting` in settings.json.
6. Update telemetry collector test cases — verify 5-voice records parse correctly.
7. Test via `/voice-test domain_specialist gemma4:26b-council "<GW-relevant question>"`.

**What this does NOT solve**:
- The QUALITY of the domain specialist's reasoning — that's the thesis's experimental work (fine-tuning + quantization study), not infrastructure.
- Cross-domain coverage — one specialist per fleet at a time. Multi-domain debates would need orchestrator-level extension (route to different specialists per question type).
- Replacing the fine-tuned model is left as a routing change in settings.json — the orchestrator doesn't need to change.

### Counterfactual / Falsifier role for `/discover`

**Symptom / motivation**: in observed `/discover` runs (this session's Q-Day debates especially), the four voices often produce a **consensus echo** — all four substantially agree on the convergent claim, with only stylistic framing differences. The synthesist then writes a brief about that convergence. There's no voice whose job is to **attack the consensus from outside**: devils_advocate counters *specific positions* but doesn't take the meta-position "the convergent claim is wrong; what would we expect if so?"

Observed in the Q-Day debates: 4 of 4 R1 voices agreed Shor's breaks RSA → PQC transition needed. The "Surviving disagreements" sections were minor timeline quibbles, not actual disagreements. The synthesist faithfully represented that consensus but didn't (couldn't) flag whether the consensus itself might be wrong.

**Why P2**: forces falsifiability discipline at the brief level. The thesis paper argues for adversarial verification as part of the multi-agent architecture; this role is one operational mechanism. Different from devils_advocate (which is rhetorical/per-position) and from Verifier (which is fact-checking/per-claim) — this is **meta-claim attack**.

**Sequencing prerequisites**:
1. Verifier role shipped (the existing fact-checking layer should land first; counterfactual is an additional rigor layer, not a replacement).
2. Synthesist proven stable on Nemo at 5+ voices (depends on Domain Specialist work above OR can be done independently).

**Architectural design choices**:

| Decision | Choice | Rationale |
|---|---|---|
| Role placement in pipeline | **Runs AFTER r2 completes, BEFORE synthesist invocation**. Not a generative voice — a reactive challenger. | Counterfactual needs to see ALL r1 + ALL r2 positions to identify what's converging. Running it as a parallel r1 voice would have nothing to attack. |
| Initial model | `deepseek-r1:7b-council` (primary), `claude-opus-4-7` when available (premium tier) | Counterfactual reasoning is exactly R1's strength — its `<think>` block is genuinely useful here (then stripped at the orchestrator layer like other R1 voices). Reasoning > schema compliance for this role. |
| Tool access | Same fan-out disallow list — no Read/Glob/Grep/Edit/Write/Bash | Pure reasoning over text given as input. |
| Output format | Structured: "Convergent claim identified" + "Counterfactual assumption" + "Distinguishing observations" + "Which voice would be most wrong" | Synthesist integrates this as a "## Counterfactual challenges" section in the brief schema. |
| Synthesist integration | Update SYNTHESIST_PROMPT to expect a counterfactual input + add `## Counterfactual challenges` brief section | Required — synthesist must explicitly address counterfactuals in its "Confidence + caveats." |
| Telemetry shape | Add `counterfactual?: { text: string, model: string, durationMs: number }` to `CouncilRunRecord` | Joined to the run; queryable via /verdict list. |
| Empty-case handling | Voice MUST emit "(no clear convergent claim — voices genuinely diverge)" + stop, if applicable | Don't invent a target to attack. Conservative bias. |

**Prompt sketch**:

```
You are the Counterfactual. You are NOT a voice in the debate. Your
job is to attack the CONSENSUS from outside, not to contribute another
position.

You will receive:
- The user's question
- All r1 positions from the 4 (or 5) voices
- All r2 positions

Your task, in order:

1. Identify the strongest CONVERGENT claim forming across the voices.
   This is the consensus the synthesist would otherwise capture in
   "## Strongest convergent claim." Name it in one sentence.
   - If voices genuinely diverge with no convergent claim, output
     exactly: "(no clear convergent claim — voices genuinely
     diverge)" and STOP. Do not invent a target to attack.

2. Assume the convergent claim is FALSE. State what would be true
   instead, in one sentence. Be specific: not "X might not happen"
   but "instead of X, Y would be observed."

3. Name 1-3 DISTINGUISHING OBSERVATIONS — concrete, measurable
   observations that would differ between "claim true" and "claim
   false." Each observation must be:
   - Stated as a falsifiable prediction (specific metric, specific
     threshold, specific timeframe)
   - Not currently observable (otherwise the claim would already be
     falsified or confirmed)

4. Name WHICH VOICE would have to be most wrong for your counter-
   factual to hold. Cite the voice's r1 or r2 position ID. Explain
   in one sentence why that voice's contribution is the weakest
   link if the consensus turns out wrong.

Output format (mandatory):

## Counterfactual challenges

### Convergent claim identified
<one sentence — the consensus you're attacking>

### Counterfactual assumption
<one sentence — what would be true instead>

### Distinguishing observations
- <observation 1>
- <observation 2>
- <observation 3 if applicable>

### Weakest link voice
<voice ID + one-sentence rationale>

Length budget: 250-400 words total. Stop after "Weakest link voice."
Do NOT propose alternative consensus or hedge. The whole role is
"assume wrong, derive consequences" — neutrality defeats the point.

Be conservative on edge cases: if uncertain whether a claim is the
convergent one, do not attack a weak target. Empty output is better
than fabricated counterfactual.
```

**Implementation work** (~3-4 h):
1. New file `src/tools/AgentTool/built-in/debate/counterfactualAgent.ts` — `BuiltInAgentDefinition`, tool-stripped, model `deepseek-r1:7b-council`.
2. New `COUNTERFACTUAL_PROMPT` in `prompts.ts`.
3. New `counterfactualFromAgentTool` in `debateSpawn.ts`. Runs AFTER r2 collection, BEFORE `synthesistFromAgentTool`. Receives all 8-10 positions; emits one structured challenge document.
4. Update `buildSynthesistPrompt` to include counterfactual output as an additional input section. Update `SYNTHESIST_PROMPT` to add `## Counterfactual challenges` brief section and to explicitly address them in `## Confidence + caveats`.
5. Extend `CouncilRunRecord.counterfactual` field; collector captures `<voice-output role='counterfactual'>` events.
6. Test via full `/discover` on a question with known consensus tendency (e.g., the Q-Day question — voices reliably converge on Shor → PQC).

**What this does NOT solve**:
- Forces falsifiability discipline at the brief level but doesn't verify factual content of any specific claim — that's Verifier's job (complementary layer).
- May produce its own confabulations when imagining alternatives. Mitigation: the "conservative bias / empty output preferred" instruction in the prompt + explicit "no clear convergent claim → stop" branch.
- Doesn't catch all consensus failures — only ones where there IS a clear convergent claim. Truly diverse debates may have nothing to counterfactually attack, which is also signal worth surfacing.

### Cross-Disciplinary Bridge role for `/discover` (Tier 2 — niche but thesis-relevant)

**Symptom / motivation**: research questions spanning multiple fields lose context when each voice reasons only within the obvious domain. The user's thesis topic (GW physics + quantization + multi-agent systems) is *exactly* such a cross-field intersection — three distinct literatures, each with established techniques that the others may benefit from importing. Currently no voice's job is to bridge.

**Why P2** (lower priority than Tier 1): niche but niche-correct for this thesis specifically. Adds value when the question genuinely spans fields (which the user's thesis topic does) and would be redundant when the question is single-domain. Sequencing-deferred behind Domain Specialist + Counterfactual + arXiv MCP because those have broader payoff first.

**Sequencing prerequisites**:
1. Domain Specialist role shipped (the Bridge is its complement — Domain Specialist provides depth in one field; Bridge provides breadth across multiple).
2. arXiv MCP shipped (the Bridge would benefit from cross-domain literature search).
3. Used judgmentally — not every `/discover` question needs the Bridge; orchestrator should detect or accept a flag.

**Architectural design choices**:

| Decision | Choice | Rationale |
|---|---|---|
| Role placement | Optional 5th voice (configurable). Activated when the orchestrator detects multi-domain keywords OR via a `--bridge` flag on `/discover`. | Niche role; running it always dilutes the standard 4-voice signal on single-domain questions. |
| Initial model | `mistral-nemo:12b-council` (broad knowledge + schema discipline) | Nemo's instruction-following + broad pre-training matches the "import findings from adjacent fields" workload. |
| Tool access | Same disallow list. Future: arXiv MCP allowed (cross-domain literature search is exactly this role's job). | Future MCP integration is the multiplier. |
| Position format | Standard r1 / r2 + "## Adjacent fields" section | Distinguishes bridge contributions from native-domain ones. |
| Activation heuristic | Initially: opt-in via slash arg `/discover --bridge "question"`. Future: automatic detection via keyword classifier or LLM router. | Don't auto-add cost where it isn't earned. Manual opt-in keeps research velocity high. |

**Prompt sketch**:

```
You are the Cross-Disciplinary Bridge. Your job is to import perspective
from fields ADJACENT to but not centrally on the topic of the question.

For each question, identify 2-3 adjacent fields where structurally
SIMILAR problems have been studied. For each:
- Name the field
- Name a SPECIFIC finding (paper, theorem, technique) from that field
- Assess whether the analogy holds in the target domain — and where
  it breaks

Examples of legitimate adjacency (not exhaustive):
- Cryptography ↔ coding theory ↔ error-correcting codes
- Neural network training ↔ statistical mechanics ↔ spin glass models
- Quantization noise ↔ signal processing ↔ information theory
- LLM hallucination ↔ neuroscience ↔ confabulation in amnesia patients
- Multi-agent debate ↔ scientific peer review ↔ Markov chain Monte Carlo

DO NOT just list adjacent fields. The deliverable is concrete imports:
"Field X studied problem Y with technique Z; here is why Z does/does
not work in our domain."

DO NOT bridge to a field you cannot name a real finding from. Confabulating
adjacent-field claims is worse than skipping the role — say "no clean
adjacency for this question" if you can't ground a real import.

Output format:

## Headline
<one sentence stating the most useful adjacent-field import>

## Adjacent fields
- **Field 1 (name)**: <finding + analog in current domain + caveat>
- **Field 2 (name)**: <finding + analog + caveat>
- **Field 3 if applicable**: <...>

## Where the analogy breaks
<one paragraph — be honest about where each import doesn't translate>

Length budget: 400-600 words. Conservative: 2 strong adjacencies
beat 5 weak ones.
```

**Implementation work** (~3 h):
1. New file `src/tools/AgentTool/built-in/debate/bridgeAgent.ts` — `BuiltInAgentDefinition`, tool-stripped (initially; arXiv-MCP-enabled in future), default model `mistral-nemo:12b-council`.
2. New `BRIDGE_PROMPT` in `prompts.ts`.
3. Wire into `debateSpawn.ts` as an OPTIONAL 5th voice (not unconditional like Domain Specialist). Activated by the `--bridge` flag passed to `/discover`.
4. Update `SYNTHESIST_PROMPT` conditionally — if Bridge voice present, add "## Cross-disciplinary imports" brief section.
5. Test via full `/discover --bridge` on a known cross-field question.

**What this does NOT solve**:
- Cross-domain analogy quality is bounded by the model's actual breadth of knowledge — Nemo at 12B has wide but shallow coverage. Many adjacencies will be weak.
- Auto-activation heuristic is not in scope (manual opt-in only). A future router could detect multi-domain questions and activate.
- Bridge confabulation is its own failure mode — the prompt's conservative "say no adjacency if you can't ground it" is the only mitigation without arXiv MCP gating.

### Verifier role for `/discover` briefs (Co-Scientist Reflection-agent minimal subset)

**Symptom / motivation**: discovered 2026-06-08 — the synthesist on `mistral-nemo:12b-council` confidently confabulated "SIKE" as a current PQC adoption target. SIKE (Supersingular Isogeny Key Encapsulation) was *cryptographically broken* in July 2022 by Castryck-Decru (arxiv 2208.08178) and disqualified from NIST's final standardization. The synthesist had no signal to recognize this — none of the voice positions explicitly flagged SIKE as broken, and the model's parametric memory of "PQC candidates" included SIKE from older training data. **No layer in the current pipeline catches this class of error before the user (or external verifier) reads the brief.**

This is the **minimal Co-Scientist Reflection-agent**, documented broadly in `CO-SCIENTIST.md`. It does NOT do Generation, Ranking (Elo), Evolution, Proximity, or Meta-review. It is purely a *post-synthesis fact-check pass* over the synthesist's brief.

**Why P2**: directly produces a verification layer — the central architectural claim of the user's research thesis ("Information-Preserving Quantization of Domain-Specialist Fine-Tunes for Verification in Multi-Agent Scientific Reasoning Systems"). Right now Claude (this assistant) IS the verification layer; adding a local verifier role makes the verification step *internal to Council* and produces methodology evidence for "small local models + dedicated verifier ≥ small local models alone."

**Complement to arXiv MCP** (separate P2 entry above): arXiv MCP closes confabulation at the empiricist *source* (so the brief never inherits fake citations); Verifier closes confabulation at the brief *output* (so even if upstream voices confabulate, the brief gets flagged). Both layers, working together, are the real fix.

**Sequencing prerequisites** (do not start this before):
1. Current routing experiments stabilized (in flight 2026-06-08).
2. arXiv MCP shipped — verifier benefits from being able to check claims against real papers too, not just voice positions.

**Architectural design choices**:

| Decision | Choice | Rationale |
|---|---|---|
| Role placement in pipeline | After `synthesistFromAgentTool` returns, before brief is written to disk | Verifier reads the just-produced brief + all 8 voice positions (r1 + r2) as context; emits notes that get appended to the brief file as a `## Verification Notes` section. |
| Verifier model | `deepseek-r1:7b-council` (primary), Claude Opus when quota available (fallback) | R1's thinking-trace shape is well-suited to "examine claim X against evidence Y" reasoning. Empirically (this session) R1 was the one model whose factual content was reliably more grounded than its competitors. Mistral Nemo as backup local-judge if R1 fails on a specific run. |
| Verifier prompt structure | "You are NOT a voice in the debate. You are a verifier. Read the brief and the appendix positions. Flag claims in the brief that: (a) contradict evidence in the appendix, (b) cite algorithms / papers / standards by name in ways that look suspect (e.g., 'SIKE' as a current standard), (c) make quantitative claims without grounding (e.g., specific dates, percentages, qubit counts) that the voice positions don't support. For each flag: quote the specific brief sentence, explain the concern, suggest a check the user could run." | Three failure modes specifically targeted: brief-vs-appendix contradiction, name-confabulation, ungrounded specificity. Each is a real failure observed in this session's runs. |
| Verifier output format | Markdown subsection appended to the brief file:<br><br>```\n## Verification Notes\n\n### Suspect claims\n- **Claim**: "<verbatim brief quote>"\n  - **Concern**: <why suspect>\n  - **Suggested check**: <action user can take>\n```<br><br>If zero flags, emits "### No suspect claims found." instead. | Single-section append minimizes disruption. Empty-state is explicit so users know the verifier ran but found nothing (vs. "didn't run"). |
| Voice positions input | Pass full text of all 8 positions (r1 + r2) + the synthesist's brief. Strip `<think>` blocks (already done by `stripThinkBlocks`). | Full context lets verifier check brief claims against the original voice evidence. |
| Capture in telemetry | Extend `CouncilRunRecord.verification` field with the verifier's flagged claims + reasoning + verdict count. Separate from human `verifications` array. | Joined-to-run, queryable via /verdict list. Enables thesis-level analysis of "what % of briefs had ≥1 flag?" |
| Tools disallowed | Same as fan-out voices: no Read/Glob/Grep/Edit/Write/Bash. Pure analysis. | Verifier reads the brief text given as input — doesn't go fishing the filesystem. |
| Failure mode | Verifier output goes through `stripThinkBlocks` + the existing cap-hit detection. If verifier itself cap-hits or errors, brief is finalized WITHOUT verification notes + telemetry records `verification: { status: 'failed', reason: '<message>' }`. | Don't block brief output on verifier failure — verifier is an additive safety net, not a hard gate. |

**Verifier prompt sketch** (the load-bearing part — design now, refine when implementing):

```
You are the Verifier. You are NOT one of the four voices that just debated.
Your role is post-synthesis fact-checking.

You will receive:
  1. The Brief produced by the Synthesist.
  2. The full text of all 8 voice positions (r1 + r2) that fed into it.

Your job: identify claims in the Brief that are suspect. Apply these
three lenses, in order:

  (a) Appendix contradiction. Does any claim in the Brief contradict
      evidence stated by a voice in the Appendix? If yes, flag.
  (b) Named-entity confabulation. Does the Brief name specific
      algorithms, papers, standards, organizations, products, or
      dates that look like they might be invented? Standards bodies,
      protocol names, and version numbers are especially error-prone.
      Examples of red flags: "Falcon was standardized in 2024"
      (drafted, not finalized as FIPS); "SIKE is being adopted"
      (broken 2022); "RFC 9999 specifies X" (verify the RFC exists).
  (c) Ungrounded specificity. Does the Brief assert a quantitative
      claim (date, percentage, qubit count, key size, etc.) that
      none of the voice positions justify? Flag the specific number.

For each flagged claim, output:
  - The verbatim sentence from the Brief
  - One sentence on the specific concern
  - One specific action the user could take to verify (search arxiv
    for X, check the NIST CSRC page for Y, etc.)

Do NOT rewrite the Brief. Do NOT propose corrections. Do NOT flag
anything that is supported by an appendix voice (even if you'd phrase
it differently). Conservative: when uncertain, do not flag.

Output format (mandatory):

## Verification Notes

### Suspect claims
<list, or the literal text "(none)" if zero flags>

End your response immediately after the list. Length budget:
~300-500 words across all flags combined. Two-three precise flags
beats ten vague ones.
```

**Implementation work** (when prerequisites met, ~3-4 h):
1. New file `src/tools/AgentTool/built-in/debate/verifierAgent.ts` — `BuiltInAgentDefinition` with the verifier prompt, fully tool-stripped (`disallowedTools` matches the other fan-out voices).
2. New `VERIFIER_PROMPT` in `src/tools/AgentTool/built-in/debate/prompts.ts`.
3. New `verifierFromAgentTool(args)` in `src/coordinator/council/debateSpawn.ts` — mirrors `synthesistFromAgentTool` signature, takes the brief text + all positions, returns the verification notes.
4. Wire into `runDebate` after synthesist completes — extend the brief file write to append the verification section.
5. Extend `CouncilRunRecord` (in `src/utils/councilTelemetry.ts`) with `verification?: { notes: string; flagCount: number; status: 'ok' | 'failed'; reason?: string }`.
6. Update `PastSessionView` to render the verification section when present.
7. New agentRouting entry: `verifier` → `deepseek-r1:7b-council` (or `claude-opus-4-7` when available).

**What this does NOT solve** (intentionally — those are separate layers):
- Doesn't fix the *cause* of confabulation in the voices themselves — that's arXiv MCP's job.
- Doesn't produce new positions from critiques — that's Co-Scientist's Evolution agent (separate, larger work).
- Doesn't rank positions by quality — that's the Elo tournament entry (also separate).

These three (arXiv MCP, Verifier, Elo tournament) are independent additions, each closing a different gap. The Verifier is the simplest to ship and the most directly thesis-aligned.

### Pairwise Elo tournament over `/discover` voices (Co-Scientist Ranking-agent minimal subset)

**Symptom / motivation**: `/discover` produces 4 voice positions in r1 and 4 r2 responses, then a synthesist brief. The voices are evaluated only implicitly (the synthesist weights them subjectively, and human verification via `/verdict` is single-judge). There's no ordered measurement of "which voice produced the strongest position this round" — so we can't say "empiricist on llama3.1:8b consistently beats empiricist on qwen3:4b on prompts of class X," which is exactly the kind of evaluation chapter the thesis needs.

This is a **minimal subset of the Co-Scientist Ranking-agent** documented in `CO-SCIENTIST.md`. It does NOT implement Evolution (deriving new hypotheses from winners), Proximity (clustering related hypotheses), or Meta-review. Those layer on later if/when this primitive proves useful.

**Why P2**: directly produces a publishable evaluation artifact for the thesis — Elo trajectories per voice tagged with model routing become the quantitative evidence the paper needs for "routing X gives better positions on prompts of class Y." Gated on voice-quality stabilization (next P2 items: arXiv MCP for grounding, benchmark harness for input).

**Sequencing prerequisites** (do not start this before):
1. Voice routing stabilized — currently in flux (2026-06-08 baseline vs llama3.1:8b/mistral-nemo:12b A/B in progress).
2. arXiv MCP shipped (closes confabulation gap; tournament over confabulators ranks fabrications equally and adds noise).
3. Benchmark harness shipped (provides the fixed-question input for tournament-over-questions evaluation).

**Architectural design choices** (decide now, even if implementation deferred):

| Decision | Choice | Rationale |
|---|---|---|
| Tournament structure | Round-robin, `C(4,2) = 6` pairs per round | 4 voices is small enough that bracket is wasteful; full round-robin gives complete pairwise data, parallelizable into 6 concurrent judge calls |
| Judge mechanism | Single judge per pair (initially) | 3× cost of multi-judge isn't worth it until we see signal stability across runs; multi-judge with majority vote is a P3 extension if results are noisy |
| Judge model | Claude Opus 4.7 when quota available; `mistral-nemo:12b-council` as local fallback | Mistral Nemo's schema discipline + voice-citation behavior makes it the best non-Claude judge in current fleet. Document this choice — judge model selection is itself a methodology variable |
| Elo K-factor | 24 (FIDE-style adaptive: K=40 for ratings < 2100, K=24 for 2100-2399, K=10 for ≥2400) | Standard adaptive K; faster initial calibration, slower drift once stable |
| Initial rating | 1500 per voice per debate | Stateless per-debate by default. Optional: persistent per-(role, model-tag) Elo accumulated across debates for the thesis's longitudinal data |
| r1 vs r2 separation | Independent tournaments; capture r1-Elo and r2-Elo separately | r2 has different rules (must engage with others) so its quality criteria differ. Conflating them obscures the "did r2 actually refine, or just restate?" signal |
| Tie/draw handling | Allow draws; judge prompt explicitly enumerates win/draw/lose | Forcing a binary choice on near-equal positions introduces spurious Elo deltas |
| Storage | Extend `~/.openclaude/council-runs.jsonl` record with `tournament: { r1Elo: {role: rating}, r2Elo: {...}, judgments: [{a, b, winner, reasoning}] }` | Reuses the existing telemetry path; keeps tournament data joined to the run that produced it |
| Persistent Elo (optional) | New file `~/.openclaude/voice-elo.jsonl` — one line per (role, model-tag) updated with K-factor across debates | Only enable when ≥20 debates accumulated; before that, per-debate Elo is more informative than noisy cumulative |

**Judge prompt sketch** (the most load-bearing part of the design):

```
You are judging two positions on the same research question.

Question: <verbatim user prompt>
Position A (by <role_a>, round <N>):
<position A text>

Position B (by <role_b>, round <N>):
<position B text>

Compare on three axes (weight equally):
  1. Factual accuracy — claims that are verifiably correct beat plausible-but-confabulated ones.
  2. Mechanistic reasoning — concrete causal chains beat hand-wavy generalities.
  3. Specificity — named algorithms / metrics / standards beat vague references.

Output STRICTLY:
  verdict: "A" | "B" | "draw"
  reasoning: <1-3 sentences, name the specific axis where the winner pulled ahead>

Do NOT cite the role names in your reasoning — judge on content only.
```

**Why each axis**: factual-accuracy = the thesis's core concern (verification of multi-agent reasoning); mechanistic-reasoning = differentiates rigorous from rhetorical; specificity = the failure mode local models exhibit (Gemma's "vague PQC overview" vs Methodologist's "ε_phys < 10⁻³ threshold").

**Implementation work** (when prerequisites met, ~4-6 h):
1. New module `src/coordinator/council/debateTournament.ts` — exports `runTournament(positions: Position[], judgeModel: string)` → returns judgments + Elo deltas.
2. Integration point: `debateSpawn.ts` after r1 collection, again after r2 collection. Sequential to the existing flow; doesn't change synthesist behavior.
3. New session-bus event: `tournament-result` (so the agent thoughts pane could render the bracket live in a future extension).
4. Extend `CouncilRunRecord` (`src/utils/councilTelemetry.ts`) with the `tournament` field.
5. Optional `/elo-leaderboard` slash command — reads `voice-elo.jsonl`, prints per-(role, model-tag) rating.

**What this does NOT solve** (intentionally — those are later phases):
- Evolution: deriving better positions from tournament winners + critique. The full Co-Scientist payoff comes from this; ranking alone just measures.
- Proximity / clustering: identifying when two voices independently arrived at the same position.
- Meta-review: producing a tournament-wide synthesis that goes beyond what the synthesist already does.

Track those as Co-Scientist Phase 2+ when this minimal ranking proves useful.

### Session-only file list in the `git` side pane

**Symptom**: the `git` pane's file list is sourced from `git status --porcelain`, so it shows any file that was already dirty before the session started — not just files touched by tools in the current session. Honest as "what would I commit right now," but slightly off as "what did the agent change this turn." The wider integration (file-list lives in the same pane as the count summary) shipped 2026-06-08 after the original right-column `files` widget was consolidated into the left `git` pane.

**Work** (~3-4 h): instrument the Edit / Write / MultiEdit / Bash tool dispatch sites to record file mutations into a session-scoped `Set<string>` (mirroring the `chatHistorySource` singleton pattern). Pass that into `GitStatusPane` and intersect with `status.files` so only session-touched files render as the primary list; pre-existing dirties either move into a small `+N stale` footer or get tinted dim. Skip when Bash writes are too noisy to identify (heuristic: only count paths that match the workdir prefix).

**Why P3**: the current widget isn't *wrong* — status flags and paths are accurate — it's just slightly misaligned with how the user mentally framed it. Pure quality-of-life.

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

**Note (2026-06-08)**: a scaled-down precursor shipped as the `/voice-test` slash command — runs ONE role + ONE model + ONE prompt in isolation (~15-30 s) and writes a JSONL record to `~/.openclaude/voice-tests.jsonl`. Good for testing a single voice's compliance with a prompt change. The full Phase 2 below (replay logged council/discover RUNS through modified prompts/models, scored against original outcomes) is still the right end-state but `/voice-test` covers the high-frequency "does this voice still work" case in the meantime.

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
