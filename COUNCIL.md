# Council — Use Guide

A five-member AI council that debates an engineering request before any code is written. The Architect, Implementer, Skeptic, Critic, and Tester each produce a structured proposal in parallel; a Synthesizer reduces them to one plan; an Executor writes the actual diff; then the five council members review the diff before it's presented to you.

## What you get

```
prompt → [4 council members propose in parallel] → synthesizer → executor → [4 reviewers] → diff
                  ↑                                                  ↓
            (read-only tools)                              (full filesystem/shell)
```

- **Diverse perspectives**: each member is a different model running a different role lens. Disagreement is signal, not noise.
- **Single executor**: only one agent (Claude Opus) ever writes files. No worktree merges, no race conditions.
- **Review pass**: the same five members re-read the executor's diff and vote `pass | nit | concern | block`. Two or more `block` triggers one revision pass.
- **Router**: not every prompt needs the full council. The router decides per-prompt whether to convene or pass through to a solo executor.

## Quick start

```bash
# In an OpenClaude session
/council on        # turn council mode on
/router heuristic  # rule-based gating (default)
```

Then prompt normally:

```
> Refactor the auth middleware to use JWT instead of sessions
```

You'll see five members spawn in parallel, then synthesis, then execution, then review. The final diff lands in your session for accept/reject.

## Commands

### `/council`

| Subcommand | Effect |
|---|---|
| `/council on` | Enable council. Sets `CLAUDE_CODE_COUNCIL_MODE=1` and `CLAUDE_CODE_COORDINATOR_MODE=1`. |
| `/council off` | Disable council. Reverts to standard single-agent flow. |
| `/council status` | Print whether council mode is on or off. |

### `/router`

| Subcommand | Effect |
|---|---|
| `/router heuristic` | Rule-based routing (default). Free. Short / read-only prompts go solo; substantive prompts convene the council. |
| `/router llm` | One classifier call (`gemini-3.5-flash`) per prompt decides solo vs council. Falls back to heuristic on API error. *Note: classifier API call is stubbed in v1 — see Backlog.* |
| `/router solo [N]` | Force solo for the next N prompts (default 1), then revert. |
| `/router council [N]` | Force council for the next N prompts (default 1), then revert. |
| `/router show` | Print current router mode. |

## Default model bindings

| Role | Model | Lens | Has tools |
|---|---|---|---|
| Architect | `claude-opus-4-7` | structure, boundaries, design | Read-only (Read, Grep, Glob) |
| Implementer | `deepseek-chat` | concrete code, minimal diff | Read-only |
| Skeptic | `gemini-3.5-flash` | risks, edge cases, what could break | Read-only |
| Critic | `gpt-4.1-mini` | maintainability, six-months-from-now | Read-only |
| Tester | `qwen3.6-plus` | test coverage, edge cases, observable seams | Read-only |
| Synthesizer | `gemini-3.5-flash` | unify the five proposals | None |
| Executor | `claude-opus-4-7` | execute the plan, write the diff | Full (Bash, Edit, Write) |

Override any binding per-role in `~/.openclaude/settings.json`:

```json
{
  "agentRouting": {
    "implementer": "deepseek-chat",
    "skeptic":     "gemini-3.5-flash",
    "critic":      "gpt-4.1-mini",
    "tester":      "qwen3.6-plus",
    "synthesizer": "gemini-3.5-flash"
  }
}
```

(`architect`, `executor`, `default` are omitted — they fall back to the global provider, which is the Anthropic OAuth Max subscription.)

You'll also need provider profiles for each vendor (`/provider` to set up).

## Heuristic routing rules

The default heuristic sends a prompt **solo** when:
- Prompt is ≤ 6 words
- Starts with `rename`, `format`, `lint`
- Starts with `explain`, `what does`, `what is`, `what's`, `how does`
- Starts with `read`, `show`, `cat`, `grep`, `find`, `list`
- Starts with `undo`, `revert`, `cancel`

Anything else convenes the council. The bias is intentional: when the heuristic isn't confident, run the council. You can always override with `/router solo`.

## Cost expectations

Approximate cost per non-trivial council prompt (varies with prompt length and codebase size):

- Council propose pass: ~$0.10–0.45 (5 members × cheap-to-mid models; Tester via Qwen's 1M-free-tokens promo is effectively free for now)
- Synthesizer: ~$0.01–0.05
- Executor: ~$0.50–2.00 (this dominates; it's Claude Opus doing real work via OAuth Max — covered by subscription within rate limits)
- Review pass: ~$0.06–0.25 (5 verdicts now)
- **Total: ~$0.70–2.75**

Solo mode skips all but the executor, so simple prompts cost the same as standard OpenClaude.

> Per-query hard cost ceiling is on the [Backlog](BACKLOG.md) — not enforced in v1.

## Troubleshooting

**"Agent type 'architect' not found"**
Council mode isn't on. Run `/council on` first.

**"Model 'deepseek-v4' is not registered"**
The model ID in the agent definition doesn't match what your provider registry knows. Edit `src/tools/AgentTool/built-in/council/implementerAgent.ts` to use a registered ID, or set up provider routing in `~/.openclaude/settings.json`.

**Council convenes but only 3 members report**
v1 stops on member failure — by design, three voices isn't enough. Check the failed member's task notification for the error (usually an API/auth issue with the bound provider).

**Want to see what each member said?**
Press ↓ to focus the agent panel, then Enter on any member to zoom into its transcript. Ctrl+O toggles transcript mode.

**Want to force council off for one prompt?**
`/router solo` runs the next prompt solo, then reverts.

## What's not in v1

See [BACKLOG.md](BACKLOG.md). Notable gaps:
- The 2×2 live grid TUI (v1 uses OpenClaude's existing stacked agent panel).
- Deterministic TypeScript orchestrator (v1 is LLM-driven via a strict coordinator prompt).
- LLM router classifier (stub falls back to heuristic).
- Per-query cost ceiling enforcement.
