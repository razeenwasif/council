import type { Command } from '../../commands.js'

const verdict: Command = {
  type: 'local-jsx',
  name: 'verdict',
  description:
    'Attach outcome / verification labels to the most recent council run (telemetry)',
  immediate: true,
  load: () => import('./verdict.js'),
}

export default verdict
