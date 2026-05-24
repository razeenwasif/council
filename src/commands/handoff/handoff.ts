import type { LocalCommandCall } from '../../types/command.js'
import {
  AgentAuthFailureError,
  runSingleAgentFromToolContext,
} from '../../coordinator/council/councilSpawn.js'

const HELP = `Usage: /handoff [extra context]

Spawns the executor agent (claude-opus-4-7, full filesystem tools) with a
prompt to update HANDOFF.md — or create it if it doesn't exist — so the
next session can pick up where this one left off.

The executor will:
  - Read the current HANDOFF.md (if present), recent git log, BACKLOG.md,
    CHANGELOG-COUNCIL.md, and any other state files it deems relevant.
  - Diff its understanding against what already exists, focusing on what
    changed in this session.
  - Rewrite HANDOFF.md so a new agent could resume the work cold.

Optional argument: extra context to focus the handoff. Example:
  /handoff focus on the panel-injection work — that's the main thread

Without an argument, the executor decides what's worth recording based on
the current state alone.`

const BASE_HANDOFF_PROMPT = `You are writing HANDOFF.md for the next session of this project. The goal: someone (or future-you) opens this file cold and can pick up the work without re-deriving context.

First, audit the current state:

1. **Read existing state files** — HANDOFF.md (if it exists), BACKLOG.md, CHANGELOG-COUNCIL.md, README.md, COUNCIL.md. Skim them to understand what's documented and what's stale.

2. **Read git state** — \`git log --oneline -30\` for recent commits, \`git status\` for any uncommitted work, \`git diff HEAD --stat\` for the shape of in-flight changes. If anything looks like work-in-progress, that's the highest-value thing to capture.

3. **Read the source tree if needed** — if a recent commit message references files you don't recognize, read the relevant files to understand what shipped.

Then, update or create HANDOFF.md so the next session has:

- **Current status** — what's done, what's mid-flight, what's blocked. Be concrete: file paths, function names, commit SHAs where useful.
- **Recently changed** — what was actually edited this session and why. Distinguish "shipped and verified" from "shipped but untested" from "started but not finished."
- **Known issues** — anything observed but not yet addressed. Include reproducers when possible.
- **Architecture / file map** — only update if structure changed materially. Don't churn the whole map for every session.
- **How to run / verify** — the actual commands that work today, not aspirational ones.
- **Next steps** — prioritized. Each one names files/functions, not vague areas.

Style: terse and specific. Match the existing HANDOFF.md voice (if one exists). Prefer file paths and function names over prose. Don't invent things you didn't verify. If you're unsure whether something is current, mark it explicitly: "(unverified — check before relying)."

When done, briefly summarise what changed in HANDOFF.md (sections added, sections removed, key facts updated). Do not commit — just write the file.`

export const call: LocalCommandCall = async (args, context) => {
  const extraContext = args.trim()

  if (extraContext === '-h' || extraContext === '--help' || extraContext === 'help') {
    return { type: 'text', value: HELP }
  }

  const prompt = extraContext
    ? `${BASE_HANDOFF_PROMPT}\n\n---\n\nExtra context from the user — weight this when deciding what to record:\n${extraContext}`
    : BASE_HANDOFF_PROMPT

  try {
    const result = await runSingleAgentFromToolContext({
      subagent_type: 'executor',
      description: 'Update HANDOFF.md',
      prompt,
      toolUseContext: context,
      canUseTool: context.canUseTool,
      setMessages: context.setMessages,
    })

    const lines: string[] = []
    lines.push(`Handoff written. (cost: $${result.costUsd.toFixed(4)})`)
    lines.push('')
    lines.push('Executor summary:')
    lines.push(result.text)
    return { type: 'text', value: lines.join('\n') }
  } catch (err) {
    if (err instanceof AgentAuthFailureError) {
      return {
        type: 'text',
        value:
          `Handoff failed: authentication error talking to ${err.subagentType}. ` +
          `Run /login in a standard openclaude session to refresh the OAuth token, then retry.`,
      }
    }
    return {
      type: 'text',
      value: `Handoff failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
