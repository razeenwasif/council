import type { Command } from '../../types/command.js'

const voiceTest = {
  type: 'local',
  name: 'voice-test',
  description:
    'Run a single Council/Debate voice in isolation (one role + one model + one prompt) — fast iteration substitute for full /council or /discover',
  argumentHint: '<role> <model-tag> "<prompt>"',
  supportsNonInteractive: false,
  load: () => import('./voice-test.js'),
} satisfies Command

export default voiceTest
