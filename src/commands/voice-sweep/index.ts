import type { Command } from '../../types/command.js'

const voiceSweep = {
  type: 'local',
  name: 'voice-sweep',
  description:
    'Run a role × model matrix automatically (loops /voice-test in-Council). Reads prompts from scripts/voice-sweep-prompts.json and model tags from agentModels. Use --dry-run to preview the plan.',
  argumentHint: '[--roles=r1,r2] [--models=m1,m2] [--by=model|role] [--limit=N] [--dry-run]',
  supportsNonInteractive: false,
  load: () => import('./voice-sweep.js'),
} satisfies Command

export default voiceSweep
