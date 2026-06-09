# ULTRACODE / Workflow Orchestrator — Architecture for Council

A scripted, general-purpose, resumable multi-agent orchestrator ported into the
Council fork. It complements the two fixed orchestrators Council already ships
(`/council` via `runCouncilFromToolContext`, `/discover` via
`runDebateFromToolContext`) with a programmable runtime: an author writes a
deterministic JavaScript *workflow* that spawns arbitrarily-shaped graphs of
subagents through Council's existing `AgentTool.call()` spawn path.

---

## 1. Motivation & fit

Council today has exactly two orchestration topologies, both hardwired in code:

- **`/council`** — `runCouncil()` in
  `src/coordinator/council/councilOrchestrator.ts`: a fixed 7-voice proposal
  batch → synthesizer → executor → review batch → optional single revision.
- **`/discover`** — `runDebate()` in
  `src/coordinator/council/debateOrchestrator.ts`: a fixed R1 (4) → R2 (4) →
  synthesist → optional verifier.

Both are excellent, but their shape is frozen in TypeScript. Every new quality
pattern (more skeptics per finding, a judge panel, a loop-until-dry finder)
requires editing the orchestrator and recompiling. The *thesis* work — measuring
verification rate per `(prompt class, routing)` pair, recorded in
`council-runs.jsonl` (see `CouncilRunRecord` / `appendRun()` in
`src/utils/councilTelemetry.ts`) — needs to *vary the topology cheaply* to study
which verification structures actually raise correctness.

A workflow runtime makes the topology **data, not code**. The exact quality
patterns the verification-layer research needs become a few lines of script:

- **Adversarial verify** — N skeptics per finding via `parallel()`, kill the
  finding on majority-refute.
- **Perspective-diverse verify** — distinct lens (`opts.agentType`) per
  verifier, mirroring how `runDebate()` assigns a role per researcher.
- **Judge panel** — N attempts scored by M judges, each forced through a
  `schema` (the structured-score tool).
- **Loop-until-dry** — spawn finders until K dry rounds, bounded by `budget`.
- **Completeness critic** — a final `schema`-typed pass that returns a gap list.

Crucially, this reuses *all* of Council's hardened machinery: the
`invokeAgentTool()` driver (`councilSpawn.ts`), the `Promise.allSettled`
fault-tolerant batch idiom, `CostLedger`, the `sessionBus` panel UI, the
`resolveRoleModel()` / `resolveAgentProvider()` routing, and the
`getClaudeConfigHomeDir()` JSONL persistence convention. The workflow runtime is
a **new front-end over the same spawn primitive**, not a parallel stack.

---

## 2. Design overview

A workflow is a plain async JS script. Its body runs inside an injected
async context where `agent()`, `parallel()`, `pipeline()`, `phase()`, `log()`,
`args`, `budget`, and `workflow()` are in scope. The script begins with a pure
literal `export const meta = {...}` (name, description, phases[]) parsed
*statically* (not executed) so the UI can show phases before the run starts.

The runtime is a small interpreter that:

1. Parses & validates `meta`.
2. Constructs a `WorkflowRuntime` object holding: a concurrency semaphore, the
   lifetime agent counter, the `CostLedger` (reused verbatim from
   `councilOrchestrator.ts`), the run journal, the `args`, and a `budget`
   accessor.
3. Binds the script-body hooks. Each hook ultimately funnels every subagent
   spawn through `invokeAgentTool()` (`src/coordinator/council/councilSpawn.ts`)
   — the *single unified entry point to `AgentTool.call()`*.
4. Emits `sessionBus` events (`emit()` from `src/coordinator/council/sessionBus.ts`)
   so `CouncilSessionScreen` paints a live panel, exactly as Council/Debate do.
5. On completion, appends a `WorkflowRunRecord` to the journal.

```
  /workflow <scriptPath|inline> {args}
            │
            ▼
  src/commands/workflow/workflow.ts           (LocalCommandCall)
            │ reads script text, parses meta
            ▼
  WorkflowRuntime  (src/coordinator/workflow/runtime.ts)
   ┌──────────────────────────────────────────────┐
   │ injected globals:                             │
   │   agent()   parallel()   pipeline()           │
   │   phase()   log()   budget   args   workflow()│
   │                                               │
   │ semaphore(min(16,cores-2))   lifetimeCap=1000 │
   │ CostLedger (reused)          journal (JSONL)  │
   └───────────────┬───────────────────────────────┘
                   │ every agent() →
                   ▼
  invokeAgentTool()      (councilSpawn.ts)
   ─ patch ToolUseContext (ensureMainLoopModel,
     ensureAbortController, providerOverride)
   ─ Promise.race vs abort signal
   ─ extractResultText / looksLikeAuthFailure
                   │
                   ▼
  AgentTool.call() → runAgent()  (src/tools/AgentTool/)
   ─ resolveAgentProvider() → ProviderOverride
   ─ resolveAgentTools() (tool gating)
                   │
                   ▼
  OpenAI shim (openaiShim.ts) → LOCAL FLEET (Ollama/vLLM)
                   ▲
                   │ events
  sessionBus.emit() ─────────► CouncilSessionScreen panel
  appendRun() / updateRun() ─► ~/.openclaude/workflow-runs.jsonl
```

### Hook → primitive mapping

| Workflow hook | Council primitive it builds on |
|---|---|
| `agent(prompt, opts)` | one `invokeAgentTool()` call (`councilSpawn.ts`) |
| `parallel(thunks)` | `Promise.allSettled` (Council batch idiom), throw→null map |
| `pipeline(items, ...stages)` | per-item independent chains, no cross-stage barrier |
| `phase(title)` / `log(msg)` | `emit()` stage-change / stage-output on `sessionBus` |
| `budget` | `CostLedger` (`bestEstimateAccumulated()` + `getTotalCost`) |
| `workflow(ref, args)` | recursive `WorkflowRuntime` (depth ≤ 1) |
| `args` | the JSON parsed from the `/workflow` arg string |

---

## 3. The `agent()` primitive

`agent(prompt, opts?)` is the heart of the runtime. Signature:

```ts
agent(prompt: string, opts?: {
  label?: string
  phase?: string
  schema?: JSONSchema
  model?: string
  isolation?: 'worktree'
  agentType?: string
}): Promise<any>
```

Implementation (`src/coordinator/workflow/agent.ts`):

1. **Budget & lifetime gate.** Before spawning, check
   `lifetimeCount >= 1000` (throw `WorkflowAgentCapError`) and
   `budget.total != null && budget.spent() >= budget.total` (throw
   `WorkflowBudgetExhaustedError`). This mirrors `CostLedger.ensureHeadroomOrThrow()`.

2. **Acquire a semaphore slot** (§5). `agent()` only proceeds when a slot is free.

3. **Resolve the model.** Priority:
   - `opts.model` if provided →
   - else `resolveRoleModel(opts.agentType ?? opts.label ?? 'default')`
     (`resolveRoleModel` in `councilSpawn.ts`, which consults
     `settings.agentRouting`, then `FALLBACK_ROLE_MODEL`, then the role slug).
   The resolved string is turned into a `ProviderOverride` via
   `resolveAgentProvider(name, subagentType, getInitialSettings())`
   (`src/services/api/agentRouting.ts`). For the local-only rule (§8) we route
   through `agentModels` so `providerOverride.baseURL` points at the Ollama/vLLM
   endpoint and `openaiShim.ts` carries the request.

4. **Spawn via `invokeAgentTool()`.** We construct `InvokeAgentToolInputs`:
   - `subagent_type` = `opts.agentType ?? 'workflow-agent'` (a new generic
     built-in agent definition, §7).
   - `description` = `opts.label ?? phase`.
   - `prompt` = the user prompt (with the StructuredOutput contract appended if
     `schema` is set — see below).
   - `toolUseContext` = the command's context, run through
     `ensureMainLoopModel()` and `ensureAbortController()` (both in
     `councilSpawn.ts`) and patched with `providerOverride`.
   - `parentSignal` = the per-agent timeout signal created by a `withTimeout()`
     wrapper (reused from `councilOrchestrator.ts`).
   `invokeAgentTool()` returns `{ text, inputTokens, outputTokens, costUsd,
   finishReason }`. We record cost via `CostLedger.recordOrThrow('agent', costUsd)`.

5. **Result handling.**
   - No `schema` → return `text` (already extracted by `extractResultText()`).
   - `schema` set → parse the StructuredOutput tool call (below), validate,
     return the object.
   - Auth failure → `invokeAgentTool()` already throws `AgentAuthFailureError`;
     we let it propagate so the script (or `parallel()`) can surface `/login`.
   - Agent died / produced nothing usable → return `null` (matches the
     "skipped/dies → null" semantic; `synthesizeToolUseSummary()` fallback in
     `councilSpawn.ts` covers degraded output before we decide it's null).

### Schema-forced StructuredOutput

When `opts.schema` is supplied, the subagent must emit a single
`StructuredOutput` tool call whose argument validates against the JSON Schema.
We implement this as a **synthetic, per-spawn tool** rather than relying on the
model's free-text:

- The `workflow-agent` definition's `getSystemPrompt({ toolUseContext })`
  (the `BuiltInAgentDefinition.getSystemPrompt` closure, `loadAgentsDir.ts`)
  appends: *"You must call the `StructuredOutput` tool exactly once with an
  argument matching this schema: `<schema JSON>`. Do not answer in prose."*
- A `StructuredOutput` tool is injected into the agent's tool list for that
  spawn only. Tool gating via `resolveAgentTools()` (`agentToolUtils.ts`) is
  set so the agent's `tools` allow `StructuredOutput` (+ read-only tools) and
  `disallowedTools` bars mutation tools unless `isolation: 'worktree'`.
- After the spawn, we look for the `StructuredOutput` tool_use in the result.
  `invokeAgentTool()`'s `extractResultText()` already walks `content[]`; we add
  a sibling extractor that pulls the matching tool_use input. Validate with
  the same JSON-schema validator the StructuredOutput tool registers.
- **Retry on mismatch.** On validation failure, re-spawn (up to `N=2`
  retries) appending the validator error to the prompt. This is the local-model
  weak-tool-call mitigation (§10). If `settings.agentModels[model].supportsTools
  === false`, `openaiShim.ts` strips the tools field — in that case we fall back
  to a *fenced-JSON* contract (ask for ```json … ``` and `JSON.parse` it) rather
  than a tool call, since the model cannot emit tool_use at all.

### `providerOverride` threading

`providerOverride` flows top-down exactly as documented for the existing path:
`agent()` → `invokeAgentTool()` patches `toolUseContext.options.providerOverride`
→ `AgentTool.call()` → `runAgent()` (line ~353 applies it, winning over the
agent definition's own model) → `query()` → `queryModel()` →
`getAnthropicClient()` → `createOpenAIShimClient()`. We never set an
`Authorization` header (stripped for SSRF safety); the local endpoint key lives
in `providerOverride.apiKey`.

---

## 4. Script execution model

The script is *deterministic JS*. It is **not** evaluated with `eval`. Two viable
sandboxes, in order of preference:

**(A) Restricted async Function constructor (default).** Wrap the script body in
`new Function('rt', 'with(rt){ return (async () => { <body> })() }')` where `rt`
is the injected-globals object. This is what the runtime ships first: fast, no
extra deps, and the script already runs in-process (it must, to reach
`AgentTool.call()` and the shared `CostLedger`). The `meta` export is parsed
*before* execution by stripping the `export const meta = ( … );` literal and
`JSON5`-parsing it — we never run that line as code.

**(B) `node:vm` context (hardening upgrade, P3+).** Compile with
`new vm.Script(source)` and run in a `vm.createContext(injectedGlobals)`. This
gives a real global isolation boundary. It does *not* sandbox against malicious
scripts (vm is not a security boundary), but it cleanly prevents the script from
reaching ambient `require`/`process` unless we expose them.

**Determinism enforcement (required for resume, §6).** The runtime *bans
non-deterministic builtins* inside the script scope so the journal replay is
exact:

- `Date.now`, `new Date()` (no-arg), `Math.random`, `process.hrtime`,
  `crypto.randomUUID`, `performance.now` are shadowed in the injected scope to
  throw `WorkflowNonDeterminismError`.
- Timestamps must enter via `args` (e.g. `args.now`) or be stamped *after* the
  run by the journal writer (which uses `randomUUID()` / `new Date()` from
  `councilTelemetry.ts` — outside the script scope, so replay is unaffected).
- The `runId` is generated by the runtime (via `newRunId()` from
  `councilTelemetry.ts`), passed *in* to the script context read-only, never
  generated by the script.

**Injected globals.** `agent`, `parallel`, `pipeline`, `phase`, `log`, `args`,
`budget`, `workflow`, plus a frozen `console` proxy that routes `console.log`
through `log()`. Nothing else: no `fs`, no `fetch`, no `require`.

---

## 5. Concurrency & scheduling

- **Semaphore cap.** `min(16, os.cpus().length - 2)`. A simple async semaphore
  (FIFO queue of resolvers) guards `agent()`. Slots are acquired in `agent()`
  before `invokeAgentTool()` and released in a `finally`. This is the workflow
  analogue of the implicit `Promise.allSettled` width in `runCouncil()` (7
  voices), but generalized and *queued* so a `parallel([... 50 thunks])` doesn't
  spawn 50 concurrent agents.

- **`parallel(thunks)` = barrier.** Runs all thunks concurrently (each thunk
  internally calls `agent()` and so is semaphore-gated) and awaits all via
  `Promise.allSettled`. Rejected settlements map to `null` (never rejects the
  outer promise) — identical to how `settlementToFailure()` keeps
  `runCouncil()` going when a member fails. Use only when you need every result
  together (dedup, zero-result early-exit, cross-item compare).

- **`pipeline(items, s1, s2, …)` = no barrier.** Each item flows through all
  stages as an independent chain (`items.map(it => s1(it).then(s2)…)`), so item
  A can be in stage 3 while item B is still in stage 1. Stage callback gets
  `(prevResult, originalItem, index)`. A throwing stage drops *that item* to
  `null`; siblings continue. This is the **default** for multi-stage work and
  has no equivalent in the fixed orchestrators (Council is strictly
  stage-barriered).

- **Lifetime cap.** A monotonic counter on `WorkflowRuntime`; `agent()` throws
  `WorkflowAgentCapError` at 1000. A single `parallel`/`pipeline` call is capped
  at 4096 items (validated at call entry).

- **Abort.** The command's `context.abortController.signal` is the root. Each
  `agent()` wraps its spawn in `withTimeout()` (from `councilOrchestrator.ts`)
  with the root as `parentSignal`, so user-cancel and per-agent timeout both
  abort cleanly and the semaphore slot is released in `finally`.

---

## 6. Run journal & resume

Journal file: `~/.openclaude/workflow-runs.jsonl`, resolved via
`getClaudeConfigHomeDir()` and written with the same append idiom as
`appendRun()` in `src/utils/councilTelemetry.ts` (best-effort, errors swallowed,
one JSON object per line). We add a sibling module
`src/utils/workflowJournal.ts` rather than overloading `CouncilRunRecord`.

**Two record kinds, both JSONL:**

1. **Run record** (`WorkflowRunRecord`) — one per run, written on completion
   (and updated via an `updateRun`-style rewrite for final status). Fields,
   mirroring `CouncilRunRecord`: `schemaVersion`, `runId` (from `newRunId()`),
   `timestamp`, `scriptPath`, `scriptHash` (sha-256 of source, 16 hex, via
   `createHash` as in `buildRecord()`), `argsHash`, `phases`, `agentCount`,
   `totalCostUsd`, `totalDurationMs`, `status`.

2. **Call journal** (`workflow-journal-<runId>.jsonl`) — the replay substrate.
   Every `agent()` call appends one line **in call order**:
   ```jsonc
   { "seq": 12, "callKey": "<hash>", "prompt": "...", "opts": {...},
     "result": <string|object|null>, "costUsd": 0.0, "tokens": {...} }
   ```
   `callKey = sha256(seq ⧺ promptHash ⧺ canonicalJSON(opts))`. We journal
   `(prompt, opts, result)` for *every* spawn, capped with `cap()` from
   `councilTelemetry.ts` to keep line sizes bounded (the 30k/50k caps apply).

**Resume.** Relaunch with `{ scriptPath, resumeFromRunId }`:

- Load `workflow-journal-<resumeFromRunId>.jsonl` into an ordered array.
- Re-execute the script. The runtime keeps a `replayCursor`. On each `agent()`
  call it computes the live `callKey` and compares to
  `journal[replayCursor].callKey`:
  - **Match** → return the cached `result` *instantly* (no spawn, no semaphore,
    no cost), advance the cursor. This is why determinism must be enforced: the
    same `seq` must produce the same `(prompt, opts)` to hash-match.
  - **Mismatch** (script edited, or a new/changed call) → stop replaying from
    here; this call and all subsequent calls run live and re-journal. We replay
    the **longest unchanged prefix**.
- Same script + same `args` → 100% cache hit, run completes ~instantly (only the
  final record is rewritten).

`parallel`/`pipeline` complicate ordering: concurrent `agent()` calls don't have
a deterministic wall-clock order. We assign `seq` by **lexical call site +
deterministic enumeration index** (the index passed to `pipeline`/`parallel`
thunks), *not* by completion order — so replay keys are stable regardless of
which agent finished first.

---

## 7. The `/workflow` slash command

**Registration** (follows the established local-command pattern):

- `src/commands/workflow/index.ts` — exports the `Command` object:
  `{ type: 'local', name: 'workflow', description: '…', supportsNonInteractive:
  false, argumentHint: '<scriptPath|inline> [json-args]', load: () =>
  import('./workflow.js') }`. Lazy-loaded, per the mandatory `load()` idiom.
- `src/commands.ts` — add `import workflow from './commands/workflow/index.js'`
  near the other imports (~line 2–180) and push `workflow` into the `COMMANDS()`
  array (~line 286–398), gated behind a new `feature('WORKFLOW_SCRIPTS')` flag —
  reusing the existing `feature()` gating mechanism already used in `commands.ts`
  (e.g. `feature('PROACTIVE')`, `feature('KAIROS')` at ~line 82–89).

**`LocalCommandCall` surface** (`src/commands/workflow/workflow.ts`):

```ts
export const call: LocalCommandCall = async (args, context) => { … }
```

Behavior:

1. Parse `args`: first token is either an absolute/`~`-expanded `scriptPath`
   (read with `readFileSync`, like `discover-sweep.ts` does for its prompts
   file) **or** `--inline` followed by a fenced script body; the remainder is a
   JSON object passed to the script as `args`. Support
   `--resume=<runId>`, `--background`, and `--heap-stop-pct=N` (default 80).
2. Statically parse `export const meta`; reject if missing/non-literal.
3. Build the `WorkflowRuntime` from `context` (it carries `abortController`,
   `canUseTool`, `setMessages`, `options.tools`, `getAppState`/`setAppState`).
4. `emit()` a `session-start` event declaring the phases (so
   `CouncilSessionScreen` renders the panel) — the same bus Council/Debate use.
5. Run the script. Each `agent()` injects a grouped tool_use placeholder via
   `buildAgentToolUsePlaceholder()` and a matching `buildAgentToolResultMessage()`
   on completion (both from `councilSpawn.ts`) through `context.setMessages`, so
   the **agent panel renderer is reused unchanged** — a workflow phase with ≥2
   agents paints exactly like a Council voice batch.
6. Return a `LocalCommandResult` of `{ type: 'text', value: <summary> }`
   (run id, phase timings, agent count, cost, journal path, resume hint).

**Foreground vs background.** Foreground is the default (the panel streams).
`--background` runs the script detached using Council's background-task path so
the REPL stays interactive; the run record + journal are the source of truth and
`--resume` reattaches.

**The `workflow-agent` built-in.** A new `BuiltInAgentDefinition`
(`src/tools/AgentTool/built-in/workflow/workflowAgent.ts`, registered in
`builtInAgents.ts` → `getBuiltInAgents()`), `model: 'default'` (overridden per
call by `providerOverride`), `omitClaudeMd: true` (token budget), a
`getSystemPrompt()` that injects the StructuredOutput contract when present, and
`disallowedTools` barring mutation tools unless the spawn is worktree-isolated.

---

## 8. Constraints & risks

- **V8 heap leak on long runs.** Council leaks ~31 MB/run (documented in
  `discover-sweep.ts`'s `--heap-stop-pct` help). A 1000-agent workflow will OOM.
  We **reuse the discover-sweep heap-stop pattern verbatim**: `heapUsedFraction()`
  via `getHeapStatistics()` from `node:v8`, checked after each *completed* phase
  (post-GC-opportunity). When it exceeds `--heap-stop-pct` (default 80), the
  runtime stops cleanly, flushes the journal, and returns a summary instructing
  the user to relaunch and `--resume=<runId>` — replay skips all completed
  `agent()` calls instantly, so the second process picks up where the first
  stopped on a fresh heap.

- **Local-only voices.** Per project memory (`project_local_only_council`),
  workflow agents must route to local Ollama/vLLM models only. `agent()`
  resolves through `resolveRoleModel()` / `resolveAgentProvider()` against
  `settings.agentModels`, which point at local `base_url`s; we add a guard that
  *rejects* a resolved `providerOverride` whose `baseURL` is a non-local host
  (unless an explicit `--allow-remote` escape hatch is set). The external
  verifier (Claude) is never a workflow agent — it remains out-of-band.

- **Sync dispatch requirement.** `AgentTool.call()` / `runAgent()` and the
  `getAgentDefinitionsWithOverrides` memoization assume env vars are set before
  bundle load and a single in-process dispatch loop. The runtime spawns through
  the *same* `invokeAgentTool()` driver Council uses, so no new dispatch path is
  introduced; the semaphore simply queues onto it.

- **Cost-ceiling integration.** `budget` is backed by the existing `CostLedger`
  (`councilOrchestrator.ts`), constructed with `getTotalCost` from
  `src/cost-tracker.ts` as the `getCurrentCost` callback. `budget.spent()` =
  `ledger.bestEstimateAccumulated()` (max of per-spawn sum and global delta —
  important because deterministic-path agents report `costUsd = 0`).
  `budget.remaining()` = `total - spent()`. `agent()` throws once
  `spent() >= total`, enabling loop-until-budget. Default ceiling matches
  Council ($3) unless `meta` or `args` overrides it.

---

## 9. Phased implementation plan

**P0 — Minimal `agent()` + `parallel()` (foreground only).** ~2–3 days.
- Create `src/coordinator/workflow/runtime.ts` (WorkflowRuntime, semaphore,
  lifetime cap, CostLedger wiring).
- Create `src/coordinator/workflow/agent.ts` (`agent()` → `invokeAgentTool()`;
  model resolution via `resolveRoleModel`/`resolveAgentProvider`; no schema yet).
- Create `src/coordinator/workflow/concurrency.ts` (`parallel()` via
  `Promise.allSettled`, throw→null).
- Create `src/coordinator/workflow/scriptEval.ts` (Function-constructor sandbox,
  static `meta` parse, determinism shadows).
- Create `src/commands/workflow/index.ts` + `workflow.ts`; register in
  `src/commands.ts`.
- Create `src/tools/AgentTool/built-in/workflow/workflowAgent.ts`; register in
  `builtInAgents.ts`.
- Wire `sessionBus.emit()` session-start/stage-output and panel placeholders
  (`buildAgentToolUsePlaceholder` / `buildAgentToolResultMessage`).

**P1 — `pipeline()` + `phase()`/`log()` + journal write.** ~2 days.
- Add `pipeline()` (no-barrier per-item chains) to `concurrency.ts`.
- Add `phase()`/`log()` → `sessionBus` stage-change/stage-output.
- Create `src/utils/workflowJournal.ts` (`WorkflowRunRecord`, call-journal
  append via the `appendRun()`/`cap()` idiom, `getClaudeConfigHomeDir()` path).
- Add `--heap-stop-pct` guard (reuse `heapUsedFraction()`/`getHeapStatistics()`
  pattern from `discover-sweep.ts`).
- Add `schema`-forced StructuredOutput (synthetic tool + validate + retry) in
  `agent.ts`.

**P2 — Resume.** ~2 days.
- Add `replayCursor` + `callKey` hashing to `runtime.ts`/`agent.ts`.
- Deterministic `seq` assignment for `parallel`/`pipeline` thunks.
- `--resume=<runId>` in `workflow.ts`: load journal, replay longest unchanged
  prefix, re-run from first mismatch.
- Determinism enforcement test suite (banned builtins throw).

**P3 — Worktree isolation + `budget` + nested `workflow()`.** ~3–4 days.
- `opts.isolation: 'worktree'`: spawn into a fresh git worktree (via the
  `EnterWorktree`/`ExitWorktree` tools) so parallel file-mutating agents don't
  collide; gate mutation tools on this flag in `resolveAgentTools()`.
- `budget` accessor fully wired to `CostLedger` + `getTotalCost`.
- `workflow(nameOrRef, args)`: recursive `WorkflowRuntime` (depth ≤ 1; reject
  deeper nesting).
- Optional `node:vm` sandbox upgrade in `scriptEval.ts`.

---

## 10. Open questions

1. **Script safety.** The Function-constructor / `node:vm` sandbox is *not* a
   security boundary — a workflow script runs in-process with full module reach
   if it escapes the injected scope. Acceptable for a single trusted local user,
   but do we want a real isolate (worker thread) before workflows can be shared?
   That breaks the shared-`CostLedger`/in-process-`AgentTool` assumption (§8).

2. **Worktree support on the local setup.** `opts.isolation: 'worktree'` assumes
   git worktrees work in this WSL2 environment and that local Ollama agents can
   safely run tools against an isolated tree. Need to confirm `EnterWorktree`
   behaves under the sync-dispatch model and that worktree cleanup is reliable
   on heap-stop / abort.

3. **Schema validation vs weak local tool-call compliance.** Local models often
   fail to emit clean tool_use — this is the **known MCP tool-call loop issue**
   the codebase already mitigates (`openaiShim.ts` strips `tools` when
   `settings.agentModels[model].supportsTools === false`; `finish_reason`
   normalization at lines ~1476–1481). For `schema`-forced StructuredOutput,
   how many retries before we fall back to fenced-JSON parsing? Should the
   fallback be automatic per-model based on `supportsTools`, or signalled by the
   script author? And should a persistent schema-mismatch return `null` (drop
   the agent) or surface a typed `WorkflowSchemaError` so `parallel()` can
   majority-vote around it — the latter matches the adversarial-verify pattern
   the thesis wants.

4. **Journal size & rewrite cost.** `updateRun()` rewrites the entire JSONL
   (fine at single-user scale per `councilTelemetry.ts`). A 1000-agent run's
   call journal could be large; do we keep the per-run call journal in a
   separate `workflow-journal-<runId>.jsonl` (proposed) and only the summary in
   the shared `workflow-runs.jsonl`, to avoid rewriting the big file?

---

## Provenance

Drafted 2026-06-10 via a 5-agent exploration workflow: four parallel `Explore`
agents mapped Council's real orchestration internals, AgentTool spawn layer,
command/tool registration, and model-routing/telemetry conventions; an architect
agent synthesized those maps against the ultracode/Workflow primitive spec. All
21 load-bearing symbols referenced above were verified to exist in `src/` before
this doc was committed. Backlog tracking: see the `[ ] Ultracode` P2 entry in
`BACKLOG.md`. This is a *design*, not an implementation — no runtime code exists
yet; the phased plan in §9 is the build order.
