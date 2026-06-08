/**
 * Council telemetry collector — subscribes to the session bus and writes
 * one CouncilRunRecord to ~/.openclaude/council-runs.jsonl per orchestrator
 * session (between session-start and session-end events).
 *
 * Designed as a bus subscriber so the orchestrator code itself stays
 * unmodified. The bus is already the canonical event surface (see
 * src/coordinator/council/sessionBus.ts).
 *
 * Idempotent: calling startTelemetryCollector() multiple times only
 * registers one subscriber. Safe to call from REPL mount; the React
 * effect cleanup is a no-op for this collector since the lifetime
 * is the process, not the component.
 */
import { subscribe, type SessionEvent } from '../coordinator/council/sessionBus.js'
import {
  appendRun,
  buildRecord,
  capStageContent,
  setVoicePreview,
  type CouncilRunRecord,
} from './councilTelemetry.js'

let current: CouncilRunRecord | null = null
let startMs = 0
const voiceOutputs = new Map<string, string>()
let started = false

function onEvent(event: SessionEvent): void {
  switch (event.type) {
    case 'session-start': {
      startMs = Date.now()
      current = buildRecord({
        kind: event.kind,
        prompt: event.prompt,
        voices: event.voices,
      })
      voiceOutputs.clear()
      return
    }
    case 'voice-state': {
      if (!current) return
      const v = current.voices.find(x => x.role === event.role)
      if (!v) return
      v.status = event.status
      if (event.headline) v.headline = event.headline
      return
    }
    case 'voice-output': {
      if (!current) return
      const prev = voiceOutputs.get(event.role) ?? ''
      const next = prev + event.chunk
      voiceOutputs.set(event.role, next)
      const v = current.voices.find(x => x.role === event.role)
      if (v) setVoicePreview(v, next)
      return
    }
    case 'stage-output': {
      if (!current) return
      const key =
        event.stage === 'synthesis' || event.stage === 'execution'
          ? (event.stage as 'synthesis' | 'execution')
          : null
      if (!key) return
      current.stageContent[key] = (current.stageContent[key] ?? '') + event.chunk
      return
    }
    case 'session-end': {
      if (!current) return
      current.totalDurationMs = Date.now() - startMs
      if (event.result) current.result = { ...event.result }
      capStageContent(current)
      const toWrite = current
      current = null
      voiceOutputs.clear()
      // Fire-and-forget append; we don't want the orchestrator's
      // session-end propagation to wait on disk I/O.
      void appendRun(toWrite)
      return
    }
    case 'stage-change':
      // Stage transitions don't need to be recorded — the presence of
      // synthesis/execution content + voice statuses are already
      // sufficient signal for what stage was reached.
      return
  }
}

export function startTelemetryCollector(): void {
  if (started) return
  started = true
  subscribe(onEvent)
}
