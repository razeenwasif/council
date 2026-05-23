import type { RouterDecision } from './strategy.js'

// Cheap rule-based routing. Designed to be conservative — when the
// heuristic isn't confident, default to council. Mistakes are recoverable
// (the user can /router solo for the next prompt), so a slight bias
// toward council is fine.

const SOLO_TRIGGERS = [
  /^\s*(rename|format|lint)\b/i,
  /^\s*(explain|what does|what is|what's|how does)\b/i,
  /^\s*(read|show|cat|grep|find|list)\b/i,
  /^\s*(undo|revert|cancel)\b/i,
]

const TRIVIAL_WORD_THRESHOLD = 6

export function decideHeuristic(prompt: string): RouterDecision {
  const trimmed = prompt.trim()
  const words = trimmed.split(/\s+/).filter(Boolean)

  // Empty / very short — solo. Council is overkill for one-liners.
  if (words.length <= TRIVIAL_WORD_THRESHOLD) {
    return {
      route: 'solo',
      reason: `prompt is ${words.length} word(s); below council threshold (${TRIVIAL_WORD_THRESHOLD})`,
    }
  }

  // Read-only / explanatory queries — solo.
  for (const pattern of SOLO_TRIGGERS) {
    if (pattern.test(trimmed)) {
      return { route: 'solo', reason: `matched solo trigger: ${pattern}` }
    }
  }

  // Default: council. Anything substantive enough to warrant 4-way review.
  return {
    route: 'council',
    reason: 'substantive prompt — convening council',
  }
}
