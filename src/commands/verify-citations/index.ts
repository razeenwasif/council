import type { Command } from '../../types/command.js'

const verifyCitations = {
  type: 'local',
  name: 'verify-citations',
  description:
    'Scan a /discover brief (or latest if unspecified) for arXiv IDs and HTTP-check that each resolves. Catches confident-sounding arXiv-ID confabulations the verifier role may miss.',
  argumentHint: '[<brief path>] [--timeout=<ms>]',
  supportsNonInteractive: false,
  load: () => import('./verify-citations.js'),
} satisfies Command

export default verifyCitations
