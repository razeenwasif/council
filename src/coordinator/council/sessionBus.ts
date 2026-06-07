/**
 * Cross-tree event channel for council/discover session UI.
 *
 * The orchestrators (runCouncil, runDebate) run in the AgentTool dispatch
 * path, outside React's render tree. The session UI (CouncilSessionScreen)
 * lives in React. This module bridges them with a tiny subscription bus:
 *
 *   - Orchestrator-adjacent code (councilSpawn, debateSpawn) calls `emit()`
 *     at key state transitions: session-start, voice-state, stage-change,
 *     voice-output, session-end.
 *
 *   - React's `useSessionState` hook subscribes via `subscribe()`, reduces
 *     events into a `SessionState`, and feeds CouncilSessionScreen.
 *
 * Module-level singleton — there is at most one active session per
 * Council process, so a global bus is simpler than threading context.
 * Multi-session would require a per-session bus instance, but that
 * scenario is not in scope (see COUNCIL_MODE_REDESIGN.md §8 non-goals).
 */

import type { Stage, VoiceStatus } from '../../components/CouncilSession/types.js'

/** Event union — every transition the session view cares about. */
export type SessionEvent =
  | {
      type: 'session-start'
      kind: 'council' | 'discover'
      prompt: string
      voices: Array<{ role: string; model: string }>
    }
  | { type: 'stage-change'; stage: Stage }
  | {
      type: 'voice-state'
      role: string
      status: VoiceStatus
      /** Optional headline parsed from the voice's output once it finishes. */
      headline?: string
    }
  | { type: 'voice-output'; role: string; chunk: string }
  | {
      type: 'session-end'
      /** Optional final brief (discover) or diff (council) for the REPL transition. */
      result?: { brief?: string; diff?: string }
    }

export type SessionListener = (event: SessionEvent) => void

const listeners = new Set<SessionListener>()

export function emit(event: SessionEvent): void {
  // Iterate over a copy so a listener that unsubscribes during emit
  // doesn't perturb the iteration.
  for (const fn of Array.from(listeners)) {
    try {
      fn(event)
    } catch {
      // Never let a listener error break the orchestrator emit chain.
    }
  }
}

export function subscribe(fn: SessionListener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Convenience for tests + cleanup; not normally used in production paths. */
export function clearAllListeners(): void {
  listeners.clear()
}
