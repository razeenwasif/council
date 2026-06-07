import { useEffect, useReducer } from 'react'
import type { SessionState, Voice } from '../components/CouncilSession/types.js'
import {
  type SessionEvent,
  type SessionListener,
  subscribe,
} from '../coordinator/council/sessionBus.js'

/**
 * Subscribes to the session bus and reduces events into a `SessionState`
 * for `CouncilSessionScreen`. Returns `null` when no session is active —
 * REPL renders the regular chat layout in that case.
 *
 * Lifecycle:
 *   1. `session-start` event arrives → reducer creates initial state from
 *      the supplied voice list (all `pending` status).
 *   2. `voice-state`, `stage-change`, `voice-output` events mutate the
 *      state through the reducer.
 *   3. `session-end` event arrives → reducer returns null, REPL swaps
 *      back to its regular layout. (The result brief/diff is rendered
 *      inline in the chat history by the orchestrator's normal output
 *      path — the session view doesn't own that surface.)
 *
 * The reducer is intentionally pure; all clock-dependent fields
 * (`status.startMs`, etc.) are captured at session-start time.
 */
function reduce(state: SessionState | null, event: SessionEvent): SessionState | null {
  switch (event.type) {
    case 'session-start': {
      const voices: Voice[] = event.voices.map(v => ({
        role: v.role,
        model: v.model,
        status: 'pending',
        headline: '',
        output: '',
      }))
      return {
        prompt: event.prompt,
        kind: event.kind,
        stage: 'proposal',
        voices,
        focusedVoiceIndex: 0,
        status: {
          costUsd: 0,
          totalTokens: 0,
          startMs: Date.now(),
          totalAgents: voices.length,
          runningAgents: 0,
        },
      }
    }
    case 'stage-change':
      if (!state) return state
      return { ...state, stage: event.stage }
    case 'voice-state': {
      if (!state) return state
      const voices = state.voices.map(v =>
        v.role === event.role
          ? {
              ...v,
              status: event.status,
              ...(event.headline ? { headline: event.headline } : {}),
            }
          : v,
      )
      const runningAgents = voices.filter(v => v.status === 'running').length
      // Auto-focus the latest voice that transitioned to running, otherwise
      // keep the current focus index. This way the center pane follows
      // whatever voice is actively streaming when the user hasn't pressed
      // Tab to override.
      let focusedVoiceIndex = state.focusedVoiceIndex
      if (event.status === 'running') {
        const newIdx = voices.findIndex(v => v.role === event.role)
        if (newIdx !== -1) focusedVoiceIndex = newIdx
      }
      return {
        ...state,
        voices,
        focusedVoiceIndex,
        status: { ...state.status, runningAgents },
      }
    }
    case 'voice-output': {
      if (!state) return state
      const voices = state.voices.map(v =>
        v.role === event.role ? { ...v, output: v.output + event.chunk } : v,
      )
      return { ...state, voices }
    }
    case 'stage-output': {
      if (!state) return state
      const prev = state.stageContent?.[event.stage] ?? ''
      return {
        ...state,
        stageContent: { ...(state.stageContent ?? {}), [event.stage]: prev + event.chunk },
      }
    }
    case 'session-end':
      return null
  }
}

export function useSessionState(): SessionState | null {
  const [state, dispatch] = useReducer(reduce, null)

  useEffect(() => {
    const listener: SessionListener = event => dispatch(event)
    return subscribe(listener)
  }, [])

  return state
}
