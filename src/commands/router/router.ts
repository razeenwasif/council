import type { LocalCommandCall } from '../../types/command.js'
import {
  getRouterMode,
  setRouterMode,
} from '../../coordinator/council/router/strategy.js'

const HELP = `Usage: /router [heuristic|llm|solo|council|show]

  heuristic  Rule-based routing (default). Short / read-only prompts go
             solo; substantive prompts convene the council. Zero cost.
  llm        One cheap classifier call (gemini-3.5-flash) per prompt
             decides solo vs council. Falls back to heuristic on error.
  solo [N]   Force solo mode for the next N prompts (default 1), then
             revert to the previous adaptive mode.
  council [N]
             Force council mode for the next N prompts (default 1), then
             revert to the previous adaptive mode.
  show       Print the current router mode.`

function parseForcedCount(rest: string[]): number {
  if (rest.length === 0) return 1
  const n = parseInt(rest[0]!, 10)
  if (!Number.isFinite(n) || n < 1) return 1
  return n
}

export const call: LocalCommandCall = async args => {
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  const sub = (tokens[0] ?? 'show').toLowerCase()
  const rest = tokens.slice(1)

  switch (sub) {
    case 'heuristic':
      setRouterMode('heuristic')
      return { type: 'text', value: 'Router: heuristic (rule-based).' }

    case 'llm':
      setRouterMode('llm')
      return {
        type: 'text',
        value:
          'Router: llm (classifier). One gemini-3.5-flash call per prompt decides solo vs council; falls back to heuristic on any failure (timeout, network, ambiguous output, missing settings).',
      }

    case 'solo': {
      const n = parseForcedCount(rest)
      setRouterMode('solo', n)
      return {
        type: 'text',
        value: `Router: solo forced for the next ${n} prompt(s), then reverts.`,
      }
    }

    case 'council': {
      const n = parseForcedCount(rest)
      setRouterMode('council', n)
      return {
        type: 'text',
        value: `Router: council forced for the next ${n} prompt(s), then reverts.`,
      }
    }

    case 'show':
      return { type: 'text', value: `Router mode: ${getRouterMode()}` }

    case 'help':
    case '--help':
    case '-h':
      return { type: 'text', value: HELP }

    default:
      return {
        type: 'text',
        value: `Unknown subcommand "${sub}".\n\n${HELP}`,
      }
  }
}
