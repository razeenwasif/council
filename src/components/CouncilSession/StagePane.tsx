import React from 'react'
import { Box, Text } from '../../ink.js'
import type { Stage, Voice } from './types.js'

const ACCENT = 'rgb(255,106,0)'

/**
 * Agent-thoughts pane content — renders the running transcript of every
 * voice that has produced output this session, followed by the
 * synthesizer's plan and the executor's diff once those stages emit.
 *
 * `voice.output` is cumulative across stages (the session reducer
 * appends every voice-output chunk to the same field — see
 * useSessionState.ts), so "render the voice's output" is the same as
 * "render this voice's full proposal + review + revision history".
 * Nothing gets overwritten when the stage advances.
 *
 * `focusedVoice` is no longer used to scope what renders — it's only
 * kept on the prop so the parent can title the pane with the active
 * voice's name. We render every voice with non-empty output, in role
 * order; the user scrolls to the section they want.
 *
 * Width is determined by the parent screen via `availableColumns`.
 * Word-wrap inside the output uses this explicit value — NO child of
 * this component is allowed to call `useTerminalSize` (the hard rule
 * from COUNCIL_MODE_REDESIGN.md §5).
 */
export type StagePaneProps = {
  stage: Stage
  /** Used by the parent only for the pane title — not consumed here. */
  focusedVoice: Voice | null
  /** All voices in role order (from session state). Each voice's
   *  output field is cumulative across the proposal / review /
   *  revision stages. */
  voices?: readonly Voice[]
  availableColumns: number
  /** Stage-specific output text from session.stageContent. Populated for
   *  synthesis (synthesizer's plan) and execution (executor's diff) via
   *  stage-output events from the spawn adapters. */
  synthesisText?: string
  executionText?: string
}

export function StagePane({
  stage,
  voices,
  availableColumns,
  synthesisText,
  executionText,
}: StagePaneProps): React.ReactNode {
  if (stage === 'idle') {
    return (
      <Box flexDirection="column" paddingX={1} width={availableColumns}>
        <Text dimColor>[idle]</Text>
      </Box>
    )
  }

  const voicesWithOutput = (voices ?? []).filter(v => v.output && v.output.length > 0)

  return (
    <Box flexDirection="column" paddingX={1} width={availableColumns}>
      {voicesWithOutput.map((v, i) => (
        <VoiceSection
          key={`${v.role}-${i}`}
          voice={v}
          availableColumns={availableColumns}
        />
      ))}
      {synthesisText && (
        <StageSection
          title="synthesizer's plan"
          text={synthesisText}
          availableColumns={availableColumns}
        />
      )}
      {executionText && (
        <StageSection
          title="executor — diff"
          text={executionText}
          availableColumns={availableColumns}
        />
      )}
      {voicesWithOutput.length === 0 && !synthesisText && !executionText && (
        <Text dimColor italic>
          [waiting for output…]
        </Text>
      )}
    </Box>
  )
}

function StageSection({
  title,
  text,
  availableColumns,
}: {
  title: string
  text: string
  availableColumns: number
}): React.ReactNode {
  return (
    <Box flexDirection="column" marginTop={1} width={availableColumns}>
      <Box>
        <Text color={ACCENT} bold>
          ── {title} ──
        </Text>
      </Box>
      <Text wrap="wrap">{text}</Text>
    </Box>
  )
}

function VoiceSection({
  voice,
  availableColumns,
}: {
  voice: Voice
  availableColumns: number
}): React.ReactNode {
  const glyph =
    voice.status === 'done'
      ? '✓'
      : voice.status === 'running'
        ? '●'
        : voice.status === 'failed'
          ? '✗'
          : voice.status === 'paused'
            ? '⏸'
            : '·'
  const title = `${glyph} ${voice.role}${voice.model ? ` (${voice.model})` : ''}`
  return (
    <Box flexDirection="column" marginTop={1} width={availableColumns}>
      <Box>
        <Text color={ACCENT} bold>
          ── {title} ──
        </Text>
      </Box>
      <Text wrap="wrap">{voice.output}</Text>
    </Box>
  )
}
