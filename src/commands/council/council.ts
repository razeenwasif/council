import type { LocalCommandCall } from '../../types/command.js'
import { isCouncilMode } from '../../coordinator/council/councilMode.js'

const HELP = `Usage: /council [status|on|off]

  status  Report whether council mode is currently on or off.
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

export const call: LocalCommandCall = async args => {
  const sub = args.trim().toLowerCase() || 'status'

  switch (sub) {
    case 'on':
      // Flip the env vars anyway so anything reading them mid-session (e.g.
      // a future call to isCouncilMode()) sees the new value. Does not
      // re-register agents — surface that loud and clear.
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

    case 'status':
      return {
        type: 'text',
        value: isCouncilMode()
          ? 'Council mode: ON (CLAUDE_CODE_COUNCIL_MODE=1)'
          : 'Council mode: OFF',
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
