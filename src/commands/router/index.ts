import type { Command } from '../../types/command.js'

const router = {
  type: 'local',
  name: 'router',
  description:
    'Switch the council router strategy (heuristic, LLM classifier, or force solo/council for the next prompt)',
  argumentHint: '[heuristic|llm|solo|council|show]',
  supportsNonInteractive: true,
  load: () => import('./router.js'),
} satisfies Command

export default router
