import type { Command } from '../../types/command.js'

const spend = {
  type: 'local',
  name: 'spend',
  description:
    'Show per-day and per-model token usage + spend across all council sessions (reads ~/.openclaude/usage.jsonl)',
  argumentHint: '[--today|--7d|--all|--models|--where]',
  supportsNonInteractive: true,
  load: () => import('./spend.js'),
} satisfies Command

export default spend
