# Telemetry Plan — Phase 1 of Self-Improving Council

> Execution plan for the "Outcome telemetry" phase of the self-improving-council backlog entry. Lives separately from `BACKLOG.md` so it's hand-offable — pick it up when the research project's Week 0 prep is done, or hand it to an agent.

**Status**: planned, not started.
**Backlog ref**: BACKLOG.md, P4 → "Self-improving council" → Phase 1.
**Estimated effort**: 6–10 hours focused work (BACKLOG says 4–6h; 6–10h is realistic accounting for tests + the slash command).
**Prerequisite for**: Phase 2 (eval harness), and also for the verification-layer research project's per-run measurements.

---

## 1. Goal

Persist every Council and Debate run to `~/.openclaude/council-runs.jsonl` so:

1. The user can review past runs as a debugging trace.
2. Future phases (eval harness, verdict calibration, prompt evolution) have a data substrate to learn from.
3. The verification-layer research project (`ROADMAP.md` Phase 1) can measure per-run cost + per-voice contributions without standing up a separate logging system.

Append-only JSONL, opt-in by default, never network-shipped.

---

## 2. Why this scope, why now

- **High signal-to-effort**: the in-memory `CouncilResult` already carries 90% of the data we want; this is mostly plumbing.
- **Compounds across two ambitions**: the same ledger powers both the self-improving council (eventually) and the research-project measurements (immediately).
- **Phase 1 is independently useful** even if Phases 2–5 are never built. Pure debugging value as soon as it lands.

Why not yet: research Week 0 prep is the bottleneck for the research artifact. This plan is the "ready when you are" version.

---

## 3. Data model

One JSONL line per run. Schema (frozen as `schemaVersion: 1`):

```json
{
  "schemaVersion": 1,
  "runId": "uuid-v4",
  "kind": "council" | "debate",
  "timestamp": "2026-06-03T14:30:00.000Z",
  "sessionId": "uuid-v4",
  "promptHash": "sha256:abc123...",
  "promptLength": 142,
  "router": {
    "mode": "heuristic" | "llm" | "forced-solo" | "forced-council",
    "decision": "council" | "solo",
    "reason": "string"
  },
  "voices": [
    {
      "role": "architect" | "implementer" | ...,
      "model": "claude-opus-4-7",
      "headline": "Add a debounce wrapper around...",
      "stage": "proposal" | "review" | "r1" | "r2",
      "durationMs": 12345,
      "tokensIn": 8421,
      "tokensOut": 1923,
      "costUsd": 0.0245,
      "status": "success" | "timeout" | "error",
      "errorReason": "string | null"
    }
  ],
  "synthesizer": {
    "model": "gemini-3.5-flash",
    "durationMs": 12500,
    "costUsd": 0.0012,
    "citedProposals": ["architect", "tester", "skeptic"]
  },
  "executor": {
    "model": "claude-opus-4-7",
    "durationMs": 183000,
    "costUsd": 0.0867,
    "filesTouched": ["src/utils/council/debounce.ts", "src/utils/council/debounce.test.ts"],
    "revisionPasses": 0
  },
  "reviewers": [
    { "role": "skeptic", "model": "gemini-3.5-flash", "verdict": "pass" | "nit" | "concern" | "block", "summary": "..." }
  ],
  "outcome": {
    "marked": false,
    "value": null,
    "markedAt": null,
    "notes": null
  },
  "totals": {
    "durationMs": 480000,
    "costUsd": 0.18,
    "voiceCount": 7,
    "failureCount": 0
  },
  "failures": [
    { "role": "implementer", "stage": "proposal", "isTimeout": true, "reason": "..." }
  ]
}
```

### Schema notes

- **Don't log full proposal text by default.** Headlines only. Adds up fast for 100 runs × 7 voices × ~5KB each = 3.5MB and it's mostly redundant with files on disk. Add `runs-full.jsonl` (opt-in via flag) for full text if needed later.
- **`promptHash` not full prompt**: privacy + size. Add `--include-prompt` flag for opt-in full retention.
- **`outcome` defaults to unmarked**. User marks via slash command (§6) after the run.
- **`schemaVersion: 1`** — bump on breaking changes. Readers must filter by version.

---

## 4. Integration points (files to touch)

| File | Change | Lines (est) |
|------|--------|-------------|
| `src/utils/councilRunsLedger.ts` *(new)* | Mirror `usageLedger.ts` pattern. `appendCouncilRun`, `readCouncilRuns`, `markOutcome` | ~120 |
| `src/coordinator/council/councilOrchestrator.ts` | Capture telemetry fields throughout run; emit at end | ~30 |
| `src/coordinator/council/debateOrchestrator.ts` | Same pattern for debate runs | ~30 |
| `src/coordinator/council/councilSpawn.ts` | Call ledger writer in `runCouncilFromToolContext` after `runCouncil` returns | ~10 |
| `src/coordinator/council/debateSpawn.ts` | Same for `runDebateFromToolContext` | ~10 |
| `src/commands/councilOutcome/councilOutcome.ts` *(new)* | `/council outcome <accept\|reject\|partial\|needed-fix> [--notes "..."]` | ~80 |
| `src/commands/index.ts` *(or wherever COMMANDS array lives)* | Register new command | ~3 |
| `src/utils/settings/settings.ts` | New setting `councilRunsLedgerEnabled` (default true) | ~5 |
| `tests/utils/councilRunsLedger.test.ts` *(new)* | Unit tests for appender, reader, outcome marker | ~150 |
| `tests/coordinator/council/councilOrchestrator.test.ts` | Add assertions that telemetry payload has expected fields | ~30 |
| `BACKLOG.md` | Mark Phase 1 done; add `## Done` entry | ~5 |
| `CHANGELOG-COUNCIL.md` | Note the addition | ~3 |

**No new dependencies.** Uses existing fs + crypto + UUID utilities.

---

## 5. Implementation sequence

Build in this order; each step is independently testable.

### Step 1 — Ledger primitive (1–2h)

- New file `src/utils/councilRunsLedger.ts`.
- Functions: `appendCouncilRun(entry)`, `readCouncilRuns({sinceDays?, kind?})`, `markRunOutcome(runId, outcome)`.
- Write a `Run` TypeScript interface matching §3 schema exactly.
- Open with `O_APPEND | O_CREAT`; one JSONL line per write; never overwrite.
- For `markRunOutcome`: append a *new* line of `{type: "outcome-mark", runId, outcome}` rather than rewriting the original entry. Reader joins these on `runId` at read time. Keeps the file append-only.
- Tests: write 5 entries, read back, mark outcome on entry 3, re-read and verify mark applied.

### Step 2 — Hook into council orchestrator (1–2h)

- In `councilOrchestrator.ts`, accumulate the telemetry struct as the run progresses (already most of this data is in scope; just need to gather it).
- At the natural finalization point (after the final `CouncilResult` is built, before returning), construct the telemetry entry and pass it to a callback.
- The callback is wired in `councilSpawn.ts`'s `runCouncilFromToolContext` — that's where we have access to the ledger writer.
- Tests: run a synthetic council with mocked spawners; verify the entry written matches expected shape.

### Step 3 — Same for debate orchestrator (1h)

- Identical pattern in `debateOrchestrator.ts` + `debateSpawn.ts`.
- Telemetry entry has `kind: "debate"` and `voices[].stage: "r1" | "r2"`.
- No executor / reviewer sections (debate has no executor); leave those fields absent rather than null.

### Step 4 — `/council outcome` slash command (1–2h)

- New file `src/commands/councilOutcome/councilOutcome.ts`.
- Parser: `<accept | reject | partial | needed-fix> [--notes "string"]`.
- Default behavior: mark the most recent run (by `timestamp`) for the current session.
- Flag: `--run <runId>` to mark a specific run (in case user wants to mark a prior one).
- Tests: parse all valid invocations, error on invalid, smoke-test that mark actually appends an outcome line.

### Step 5 — Settings + opt-out (30min)

- Add `councilRunsLedgerEnabled` to settings, default `true`.
- In the ledger writer, no-op if disabled.
- Document in COUNCIL.md's "Defaults" section.

### Step 6 — Tests + smoke (1h)

- Unit tests for everything new.
- Integration smoke: run `/council run "rename foo to bar"` (cheap), check `~/.openclaude/council-runs.jsonl` has a new entry, run `/council outcome accept`, check the outcome line was appended.

### Step 7 — Docs + BACKLOG update (30min)

- Update `BACKLOG.md`: move Phase 1 to "Done", add a one-line summary.
- Update `CHANGELOG-COUNCIL.md` with the addition.
- Add a one-paragraph note to `COUNCIL.md` documenting the ledger location + opt-out flag.

---

## 6. Slash command spec — `/council outcome`

```
/council outcome accept                       # mark last run accepted
/council outcome reject                       # mark last run rejected
/council outcome partial --notes "good plan, executor missed edge case"
/council outcome needed-fix --notes "..."
/council outcome accept --run <runId>         # mark a specific run
/council outcome show                         # show last 10 runs and their outcome status
/council outcome show --unmarked              # show runs without outcomes
```

Output of `/council outcome show` is a table:

```
runId       timestamp           kind     voices  outcome      notes
abc123      2026-06-03 14:30   council  7       accepted     —
def456      2026-06-03 14:15   debate   4       —            —
...
```

---

## 7. Testing strategy

- **Unit tests** for the ledger primitive (Step 1): proven pattern from `usageLedger.test.ts`.
- **Orchestrator integration tests**: extend the existing `councilOrchestrator.test.ts` and `debateOrchestrator.test.ts` to assert telemetry payload shape.
- **Slash command tests**: argument parsing, error paths, integration with the ledger.
- **End-to-end smoke** (manual, documented in `HANDOFF.md`): run a cheap council prompt, verify ledger entry, mark outcome, verify outcome appended.
- **No new test infra** — everything uses the existing `bun test` setup.

---

## 8. Edge cases to handle

1. **Concurrent writes** from parallel council runs (rare but possible if the user fires two `/council` in rapid succession). JSONL append is atomic on POSIX; should be safe. Add a `pidWriter` field to the entry for forensics if needed later.
2. **Ledger file corruption** (partial line from a killed process). Reader skips malformed lines and logs a warning; doesn't crash.
3. **No `~/.openclaude/` directory** on first run. Writer creates it (mode 700) on first append.
4. **Outcome marked twice**: take the latest mark; surface both timestamps in `/council outcome show` if they disagree.
5. **Run fails entirely** (all voices timeout, quorum lost). Still write a telemetry entry with `totals.failureCount > 0` and `outcome.marked: false`. Failed runs are useful data.
6. **Cost-ceiling enforcement fires** mid-run. Entry is written with whatever progress was made; `failures[]` includes the ceiling-hit reason.
7. **User edits or deletes the ledger file manually**. Don't try to recover — reader treats it as ground truth.
8. **Schema migration in the future** (Phase 2+ might need more fields). Bump `schemaVersion`, write a migrator function. Phase 1 ships with `schemaVersion: 1`; never touch it after.

---

## 9. Out of scope (explicitly deferred)

- **Cross-session aggregation queries** beyond `show --unmarked` (Phase 2 eval harness will build the proper query surface).
- **Replay framework** for running historical prompts against new model bindings (Phase 2).
- **Per-voice precision/recall calibration** (Phase 3).
- **Auto-evolved prompts** (Phase 4 — explicitly human-gated).
- **Per-prompt-class model routing** (Phase 5).
- **Network-shipped telemetry** (never).
- **Per-voice full proposal text** in the default ledger (only headlines; full text via `--include-text` opt-in flag, deferred).

---

## 10. Risk + dependencies

- **Risk: silent data loss** if the orchestrator fails before the telemetry write. Mitigation: write at the *earliest reasonable* finalization point, not the latest. Catch and log errors from the ledger write itself but don't let them propagate (telemetry must never break a council run).
- **Risk: schema lock-in**. Once `schemaVersion: 1` is shipped, changing fields breaks readers. Mitigation: the schema in §3 is intentionally generous; ship it with all fields even if some are always-null initially.
- **No external dependencies.** Pure stdlib + existing project utilities.
- **Depends on**: nothing. This is a self-contained addition.

---

## 11. Hand-off to an agent

If running this via an agent later, the one-liner prompt would be:

> "Implement Phase 1 telemetry per TELEMETRY_PLAN.md. Mirror the existing usageLedger.ts pattern. Build steps 1–6 in order, run tests after each step. Don't change schema fields once committed. Commit each step separately so the user can review per-step."

The agent should be told to NOT push, NOT skip tests, and NOT add features beyond §3's schema.

---

## 12. After Phase 1 ships

The ledger immediately powers two things:

1. **Manual review of past runs** — the user can grep / jq the JSONL to spot patterns.
2. **Per-run cost + voice-contribution measurement** for the verification-layer research project (`ROADMAP.md` Phase 1 baseline characterization can use this directly instead of re-implementing logging).

Decision point at ~30 runs of accumulated telemetry: is there enough signal to justify building Phase 2 (eval harness)? Re-evaluate then.
