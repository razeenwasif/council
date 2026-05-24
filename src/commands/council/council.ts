import type { LocalCommandCall } from '../../types/command.js'
import { isCouncilMode } from '../../coordinator/council/councilMode.js'
import { getRouterMode } from '../../coordinator/council/router/strategy.js'
import { getSettings_DEPRECATED } from '../../utils/settings/settings.js'
import { clearAgentDefinitionsCache } from '../../tools/AgentTool/loadAgentsDir.js'
import {
  CouncilCostCeilingError,
  CouncilMemberFailureError,
  CouncilQuorumLostError,
  CouncilTimeoutError,
} from '../../coordinator/council/councilOrchestrator.js'
import {
  AgentAuthFailureError,
  runCouncilFromToolContext,
} from '../../coordinator/council/councilSpawn.js'

const HELP = `Usage: /council [status|on|off|run <prompt>]

  status        Report whether council mode is currently on, the router
                mode, and the per-role model bindings.
  on            Enable council mode for subsequent prompts. Flips env vars
                and invalidates the agent registry cache so the next
                prompt sees the seven council agents.
  off           Disable council mode. Symmetric to \`on\`.
  run <prompt>  Explicitly run the deterministic orchestrator (runCouncil)
                on a given prompt. Uses runCouncilFromToolContext under
                the hood — distinct from the default LLM-coordinator
                path. Useful for testing the deterministic orchestrator
                while it's still being verified.

\`on\` and \`off\` take effect on the *next* user prompt. The current
conversation context (if any) carries over; only the agent registry and
system prompt change. To run a non-council session from the start, set
COUNCIL_OFF=1 before launching:
  COUNCIL_OFF=1 council`

// Fallback role→model map. Used when settings.json has no per-role binding
// (the agent falls back to the global provider in that case). Mirrors the
// defaults documented in COUNCIL.md.
const DEFAULT_ROLE_MODEL: Record<string, string> = {
  architect: 'claude-opus-4-7 (global Anthropic OAuth)',
  implementer: 'deepseek-chat',
  skeptic: 'gemini-3.5-flash',
  critic: 'gpt-4.1-mini',
  tester: 'qwen3.6-plus',
  security: 'mistral-large-latest',
  performance: 'mistral-medium-latest',
  synthesizer: 'gemini-3.5-flash',
  executor: 'claude-opus-4-7 (global Anthropic OAuth)',
}

function formatModelTable(): string {
  const settings = (getSettings_DEPRECATED() ?? {}) as {
    agentRouting?: Record<string, string>
    agentModels?: Record<string, { base_url?: string }>
  }
  const routing = settings.agentRouting ?? {}
  const models = settings.agentModels ?? {}

  const rows: string[] = ['  Role          Model                     Endpoint hint']
  rows.push('  ─────────────────────────────────────────────────────────────────')

  const order = [
    'architect',
    'implementer',
    'skeptic',
    'critic',
    'tester',
    'security',
    'performance',
    'synthesizer',
    'executor',
  ]

  for (const role of order) {
    const modelId = routing[role]
    if (modelId) {
      const baseUrl = models[modelId]?.base_url
      const hint = baseUrl ? ` ${baseUrl.replace(/^https?:\/\//, '').split('/')[0]}` : ''
      rows.push(`  ${role.padEnd(13)} ${modelId.padEnd(25)}${hint}`)
    } else {
      const fallback = DEFAULT_ROLE_MODEL[role] ?? '(global default)'
      rows.push(`  ${role.padEnd(13)} ${fallback}`)
    }
  }

  return rows.join('\n')
}

function formatCouncilResultSummary(result: {
  proposals: Array<{ role: string; modelId: string; text: string }>
  plan: { text: string }
  execution: { summary: string }
  reviews: Array<{ role: string; verdict: string }>
  revised?: { summary: string }
  failures?: Array<{ role: string; stage: string; reason: string; isTimeout: boolean }>
  totalCostUsd: number
  totalDurationMs: number
}): string {
  const verdictTally = result.reviews.reduce<Record<string, number>>(
    (acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] ?? 0) + 1 }),
    {},
  )
  const tallyStr = ['pass', 'nit', 'concern', 'block']
    .filter(v => (verdictTally[v] ?? 0) > 0)
    .map(v => `${verdictTally[v]} ${v}`)
    .join(' · ')

  const failures = result.failures ?? []

  const lines: string[] = []
  lines.push(
    `Council finished — ${result.proposals.length} proposals, ${tallyStr}.`,
  )
  if (failures.length > 0) {
    const failSummary = failures
      .map(f => `${f.role} (${f.stage}, ${f.isTimeout ? 'timeout' : 'error'})`)
      .join(', ')
    lines.push(
      `⚠ ${failures.length} voice${failures.length === 1 ? '' : 's'} failed: ${failSummary}.`,
    )
  }
  const costSuffix =
    result.totalCostUsd > 0
      ? ` (running total in /cost, history in /spend)`
      : ` (unavailable — see /cost and /spend)`
  lines.push(
    `Duration: ${(result.totalDurationMs / 1000).toFixed(1)}s · Cost this run: $${result.totalCostUsd.toFixed(4)}${costSuffix}`,
  )
  if (result.revised) {
    lines.push(`Revision applied: ${result.revised.summary}`)
  }
  lines.push('')
  lines.push('Executor output:')
  lines.push(result.execution.summary)
  return lines.join('\n')
}

export const call: LocalCommandCall = async (args, context) => {
  const trimmed = args.trim()
  const firstSpace = trimmed.indexOf(' ')
  const sub = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace))
    .toLowerCase() || 'status'
  const rest = firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1).trim()

  switch (sub) {
    case 'on': {
      process.env.CLAUDE_CODE_COUNCIL_MODE = '1'
      process.env.CLAUDE_CODE_COORDINATOR_MODE = '1'
      clearAgentDefinitionsCache()
      return {
        type: 'text',
        value:
          'Council mode ON. Next prompt will convene seven members → synthesizer → executor → review.',
      }
    }

    case 'off': {
      delete process.env.CLAUDE_CODE_COUNCIL_MODE
      clearAgentDefinitionsCache()
      return {
        type: 'text',
        value:
          'Council mode OFF. Next prompt uses the standard openclaude flow.',
      }
    }

    case 'run': {
      if (!rest) {
        return {
          type: 'text',
          value:
            'Usage: /council run <prompt>\n\n' +
            'Runs the deterministic orchestrator (runCouncil) on the given prompt. ' +
            'See HELP for the difference from the default LLM-coordinator path.',
        }
      }
      // The slash command's context extends ToolUseContext — pass it through
      // to the spawn adapter unchanged.
      try {
        const result = await runCouncilFromToolContext({
          userPrompt: rest,
          toolUseContext: context,
          canUseTool: context.canUseTool,
          emitStatus: () => {},
        })
        return { type: 'text', value: formatCouncilResultSummary(result) }
      } catch (err) {
        // Auth failures land both directly (synth/executor stages) and
        // wrapped in CouncilMemberFailureError (proposal/review stages).
        const inner =
          err instanceof CouncilMemberFailureError ? err.underlying : err
        if (inner instanceof AgentAuthFailureError) {
          return {
            type: 'text',
            value:
              `Authentication failure during council. Agent: ${inner.subagentType}. ` +
              `Run /login in a standard openclaude session to refresh the OAuth token, then retry. ` +
              `(claude-opus-4-7 is the global Anthropic OAuth provider — both Architect and Executor share it.)`,
          }
        }
        if (err instanceof CouncilQuorumLostError) {
          const failSummary = err.failures
            .map(f => `${f.role}(${f.isTimeout ? 'timeout' : 'error'})`)
            .join(', ')
          return {
            type: 'text',
            value:
              `Council quorum lost — only ${err.succeededCount} of ${err.required} required voices succeeded at stage "${err.stage}". ` +
              `Failed: ${failSummary}. Check provider status / credentials and retry.`,
          }
        }
        if (err instanceof CouncilTimeoutError) {
          return {
            type: 'text',
            value: `Council timed out at stage "${err.stage}"${err.role ? ` (${err.role})` : ''} after ${err.timeoutMs}ms.`,
          }
        }
        if (err instanceof CouncilCostCeilingError) {
          return {
            type: 'text',
            value: `Council hit cost ceiling ($${err.ceilingUsd}) at stage "${err.stage}". Accumulated: $${err.accumulatedUsd.toFixed(4)}.`,
          }
        }
        if (err instanceof CouncilMemberFailureError) {
          const innerMsg = err.underlying instanceof Error ? err.underlying.message : String(err.underlying)
          return {
            type: 'text',
            value: `Council member ${err.role} failed during ${err.stage}: ${innerMsg}`,
          }
        }
        return {
          type: 'text',
          value: `Council run failed: ${err instanceof Error ? err.message : String(err)}`,
        }
      }
    }

    case 'status': {
      const councilOn = isCouncilMode()
      const router = getRouterMode()
      const headerLine = councilOn
        ? 'Council mode: ON  ·  router: ' + router
        : 'Council mode: OFF  ·  router: ' + router
      const body = '\n\nModel bindings (live, from ~/.openclaude/settings.json):\n' + formatModelTable()
      const footer =
        '\n\nQuorum: consensus ≥5 of 7 (strong majority); revision triggers on ≥3 of 7 block verdicts.\n' +
        'See COUNCIL.md for role lenses; BACKLOG.md for unfinished work.'
      return { type: 'text', value: headerLine + body + footer }
    }

    case 'help':
    case '--help':
    case '-h':
      return { type: 'text', value: HELP }

    default:
      return {
        type: 'text',
        value: `Unknown subcommand "${sub}".\n\n${HELP}`,
      }
  }
}
