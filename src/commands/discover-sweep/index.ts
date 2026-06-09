import type { Command } from '../../types/command.js'

const discoverSweep = {
  type: 'local',
  name: 'discover-sweep',
  description:
    'Run /discover automatically across a list of prompts (e.g. council-specialists Phase 2 bootstrap). Reads the paste-format prompts file produced by seed_council_synthetic.py.',
  argumentHint: '<prompts-file> [--limit=N] [--pause=Sec] [--skip-completed] [--continue-on-error]',
  supportsNonInteractive: false,
  load: () => import('./discover-sweep.js'),
} satisfies Command

export default discoverSweep
