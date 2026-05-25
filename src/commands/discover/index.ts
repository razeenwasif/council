import type { Command } from '../../types/command.js'

const discover = {
  type: 'local',
  name: 'discover',
  description:
    'Run a multi-round research debate (4 voices + Synthesist, 2 rounds, structured brief). Use --context to point at a literature review or notes file.',
  argumentHint: '<question> [--context <path> ...] [--out <path>]',
  supportsNonInteractive: true,
  load: () => import('./discover.js'),
} satisfies Command

export default discover
