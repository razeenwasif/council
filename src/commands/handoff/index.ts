import type { Command } from '../../types/command.js'

const handoff = {
  type: 'local',
  name: 'handoff',
  description:
    'Spawn the executor to update (or create) HANDOFF.md so the next session can pick up where this one left off',
  argumentHint: '[extra context]',
  supportsNonInteractive: true,
  load: () => import('./handoff.js'),
} satisfies Command

export default handoff
