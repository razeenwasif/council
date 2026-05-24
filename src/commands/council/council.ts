import type { LocalCommandCall } from '../../types/command.js'
import { isCouncilMode } from '../../coordinator/council/councilMode.js'
import { getRouterMode } from '../../coordinator/council/router/strategy.js'
import { getSettings_DEPRECATED } from '../../utils/settings/settings.js'

const HELP = `Usage: /council [status|on|off]

  status  Report whether council mode is currently on, the router mode,
          and the per-role model bindings (resolved from settings.json
          agentRouting + agentModels).
  on      No-op in v1 — council mode must be active at session start because
          the agent registry is memoized at first read. The \`council\`
          binary sets the env vars before launch, so council mode is on by
          default. To run without council, set COUNCIL_OFF=1 and relaunch.
  off     Same constraint as \`on\` — toggling at runtime won't unregister
          the council agents. Relaunch with COUNCIL_OFF=1 council to run
          a non-council session.

The \`on\`/\`off\` no-op constraint is tracked in BACKLOG.md (P1) — proper
runtime toggling requires invalidating the agent definitions cache and
re-applying the coordinator system prompt mid-session.`

const RESTART_NOTE =
  '\n\nNote: agent registration happens once at session start (memoized). To change council state, relaunch:\n' +
  '  - council                  → council mode on (default)\n' +
  '  - COUNCIL_OFF=1 council    → council mode off'

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
  // Read agentRouting at status time so the user sees the live config, not a
  // cached copy. getSettings_DEPRECATED loads from ~/.openclaude/settings.json.
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
      // Not routed → falls back to global provider
      const fallback = DEFAULT_ROLE_MODEL[role] ?? '(global default)'
      rows.push(`  ${role.padEnd(13)} ${fallback}`)
    }
  }

  return rows.join('\n')
}

export const call: LocalCommandCall = async args => {
  const sub = args.trim().toLowerCase() || 'status'

  switch (sub) {
    case 'on':
      process.env.CLAUDE_CODE_COUNCIL_MODE = '1'
      process.env.CLAUDE_CODE_COORDINATOR_MODE = '1'
      return {
        type: 'text',
        value:
          (isCouncilMode()
            ? 'Council mode: ON (env vars set). '
            : 'Council mode env vars set, but ') +
          'agent registry was already built at session start — flipping at runtime will not re-register the council agents.' +
          RESTART_NOTE,
      }

    case 'off':
      delete process.env.CLAUDE_CODE_COUNCIL_MODE
      return {
        type: 'text',
        value:
          'Council mode env var cleared, but agents registered at startup will remain registered for this session.' +
          RESTART_NOTE,
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
