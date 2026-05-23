import type { LocalCommandCall } from '../../types/command.js'
import { isCouncilMode } from '../../coordinator/council/councilMode.js'

const HELP = `Usage: /council [on|off|status]

  on      Enable council mode for subsequent prompts. Sets
          CLAUDE_CODE_COUNCIL_MODE=1 and CLAUDE_CODE_COORDINATOR_MODE=1.
  off     Disable council mode. Reverts to standard (single-agent) flow.
  status  Report whether council mode is currently on or off.`

export const call: LocalCommandCall = async args => {
  const sub = args.trim().toLowerCase() || 'status'

  switch (sub) {
    case 'on':
      // Council rides on top of coordinator mode — flip both. Reading
      // these env vars is what isCouncilMode() and isCoordinatorMode()
      // check, and the agent registry + system prompt branches off them.
      process.env.CLAUDE_CODE_COUNCIL_MODE = '1'
      process.env.CLAUDE_CODE_COORDINATOR_MODE = '1'
      return {
        type: 'text',
        value:
          'Council mode ON. Next prompt will convene architect, implementer, skeptic, critic → synthesizer → executor → review.',
      }

    case 'off':
      delete process.env.CLAUDE_CODE_COUNCIL_MODE
      // Leave CLAUDE_CODE_COORDINATOR_MODE as-is — the user may have
      // enabled coordinator mode independently. /council toggles only the
      // council layer.
      return {
        type: 'text',
        value: 'Council mode OFF. Reverted to standard single-agent flow.',
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
