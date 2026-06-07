/**
 * Shared types for the council/discover session view.
 *
 * See COUNCIL_MODE_REDESIGN.md for the full architecture. In Phase A
 * these are consumed by the static scaffold with mock data; in Phase B
 * they wire to the real council/debate orchestrator events.
 */

export type Stage =
  | 'proposal'
  | 'synthesis'
  | 'execution'
  | 'review'
  | 'revision'
  | 'done'

export type VoiceStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'paused'

export interface Voice {
  /** Role label shown in the voice list (e.g. "architect", "skeptic"). */
  role: string
  /** Resolved model id (e.g. "claude-opus-4-7"). Shown in the center pane title. */
  model: string
  /** Current status — drives the glyph in the voice list. */
  status: VoiceStatus
  /** Most recent headline parsed from the voice's output. Empty when not yet emitted. */
  headline: string
  /** Streaming output text (full so far). Center pane renders this for the focused voice. */
  output: string
}

export interface SessionStatus {
  /** Cumulative cost in USD across the session so far. */
  costUsd: number
  /** Cumulative input + output tokens. 0 means unknown. */
  totalTokens: number
  /** Epoch ms when the session started. 0 means not started. */
  startMs: number
  /** Total agents (voices) in the session. */
  totalAgents: number
  /** Count currently in `running` status. */
  runningAgents: number
}

export interface SessionState {
  /** Original user prompt that started the session. */
  prompt: string
  /** Session kind — drives stage names and voice count expectations. */
  kind: 'council' | 'discover'
  /** Current stage. */
  stage: Stage
  /** All voices in role order. */
  voices: Voice[]
  /** Index into voices[] of the voice currently focused in the center pane. */
  focusedVoiceIndex: number
  /** Live status snapshot for the right pane. */
  status: SessionStatus
}
