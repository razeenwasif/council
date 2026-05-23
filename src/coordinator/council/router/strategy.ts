/**
 * Router — decides whether a given user prompt warrants the full council
 * or should go straight to a solo executor (cheaper, faster, no synthesis).
 *
 * Two strategies are available: heuristic (rule-based, ~0 cost) and llm
 * (one cheap classification call). Users switch at runtime with `/router`.
 *
 * The strategy module is intentionally tiny — it returns a decision; the
 * /council and /router slash commands consume the decision and toggle
 * CLAUDE_CODE_COUNCIL_MODE accordingly.
 */

import { decideHeuristic } from './heuristic.js'
import { decideLLM } from './llm.js'

export type RouterMode = 'heuristic' | 'llm' | 'solo' | 'council'

export type RouterDecision =
  | { route: 'solo'; reason: string }
  | { route: 'council'; reason: string }

const STATE: {
  mode: RouterMode
  // For 'solo' / 'council' forced modes, how many prompts remain before
  // we revert to the previous adaptive mode. Defaults to 1 (next prompt
  // only); /router solo N sets it to N.
  forcedRemaining: number
  // The adaptive mode we revert to after a forced run elapses.
  adaptiveMode: 'heuristic' | 'llm'
} = {
  mode: 'heuristic',
  forcedRemaining: 0,
  adaptiveMode: 'heuristic',
}

export function getRouterMode(): RouterMode {
  return STATE.mode
}

export function setRouterMode(mode: RouterMode, forcedRuns = 1): void {
  STATE.mode = mode
  if (mode === 'solo' || mode === 'council') {
    STATE.forcedRemaining = forcedRuns
  } else {
    STATE.adaptiveMode = mode
    STATE.forcedRemaining = 0
  }
}

/**
 * Decide whether to run the council for this prompt. Called by the prompt
 * submission path before the message is dispatched.
 */
export async function routePrompt(
  prompt: string,
): Promise<RouterDecision> {
  // Forced mode burns down a counter, then reverts.
  if (STATE.mode === 'solo') {
    if (STATE.forcedRemaining > 0) STATE.forcedRemaining -= 1
    if (STATE.forcedRemaining === 0) STATE.mode = STATE.adaptiveMode
    return { route: 'solo', reason: 'forced via /router solo' }
  }
  if (STATE.mode === 'council') {
    if (STATE.forcedRemaining > 0) STATE.forcedRemaining -= 1
    if (STATE.forcedRemaining === 0) STATE.mode = STATE.adaptiveMode
    return { route: 'council', reason: 'forced via /router council' }
  }
  if (STATE.mode === 'llm') {
    return decideLLM(prompt)
  }
  return decideHeuristic(prompt)
}
