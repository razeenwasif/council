import type { Command } from '../../types/command.js'

const council = {
  type: 'local',
  name: 'council',
  description:
    'Enable, disable, or inspect council mode (four-way propose → synthesize → execute → review pipeline)',
  argumentHint: '[on|off|status]',
  supportsNonInteractive: true,
  load: () => import('./council.js'),
} satisfies Command

export default council
