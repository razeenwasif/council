/**
 * /plan: turn on plan mode, or show the current plan.
 *
 * Lazy-loaded (implementation in plan.ts), the same pattern as /cache-stats.
 * The ExitPlanMode, FileWrite and FileEdit tools point users here ("/plan to
 * edit", "/plan to preview").
 */
import type { Command } from '../../commands.js'

const plan = {
  type: 'local',
  name: 'plan',
  description: 'Turn on plan mode, or show the current plan (/plan open edits it)',
  argumentHint: '[open]',
  supportsNonInteractive: false,
  load: () => import('./plan.js'),
} satisfies Command

export default plan
