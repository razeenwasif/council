import type { RouterDecision } from './strategy.js'

// LLM-based classifier. One cheap call (default: gemini-3.5-flash) to a
// classification prompt. Falls back to heuristic if the model is unreachable
// or returns an unparseable answer — the router should never block on a
// transient API hiccup.
//
// v1 STATUS: shape is stable but the actual API call is stubbed (we don't
// want to commit to a specific provider client here — that lives in
// src/services/api/*.ts and varies per provider). The stub falls through to
// the heuristic so the router stays usable until this is wired.

import { decideHeuristic } from './heuristic.js'

const CLASSIFIER_MODEL = 'gemini-3.5-flash'

const CLASSIFIER_PROMPT = `You are a router. Classify this user request as either "solo" (small enough that one agent handles it cleanly: renames, format/lint, simple file reads, single-line edits, explanations of existing code) or "council" (warrants a four-way design review before code changes: new features, multi-file refactors, design decisions, anything ambiguous).

Output exactly one word: solo or council. No explanation, no punctuation.

Request:
`

export async function decideLLM(prompt: string): Promise<RouterDecision> {
  try {
    // TODO(v1.1): wire to the actual provider client. See
    // src/services/api/agentRouting.ts for the resolver and
    // src/integrations/models/gemini.ts for the gemini model registry.
    // For now we fall through to the heuristic so /router llm is selectable
    // without breaking the prompt path.
    const raw = await classify(prompt)
    if (raw === 'solo') {
      return { route: 'solo', reason: `classifier (${CLASSIFIER_MODEL}) → solo` }
    }
    if (raw === 'council') {
      return {
        route: 'council',
        reason: `classifier (${CLASSIFIER_MODEL}) → council`,
      }
    }
    return decideHeuristic(prompt)
  } catch {
    return decideHeuristic(prompt)
  }
}

// Placeholder — replace with a real call to the gemini-3.5-flash backend.
// Returns 'unwired' so callers fall back to the heuristic.
async function classify(_prompt: string): Promise<string> {
  // Intentionally unwired in v1. See header comment.
  void CLASSIFIER_PROMPT
  return 'unwired'
}
