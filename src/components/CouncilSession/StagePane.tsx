import React from 'react'
import { Box, Text } from '../../ink.js'
import type { Stage, Voice } from './types.js'

const ACCENT = 'rgb(255,106,0)'

/**
 * Center pane — renders content for the currently active stage.
 *
 * - `proposal` / `review` / `revision`: focused voice's output (each
 *   voice has its own output field accumulated from voice-output events)
 * - `synthesis`: synthesizer's plan text from session.stageContent.synthesis
 * - `execution`: executor's diff + summary from session.stageContent.execution
 * - `done`: placeholder; the final result renders inline in the chat
 *   scrollback via the existing executor message-emission path
 * - `idle`: nothing to show
 *
 * Width is determined by the parent screen via `availableColumns`.
 * Word-wrap inside the output uses this explicit value — NO child of
 * this component is allowed to call `useTerminalSize` (the hard rule
 * from COUNCIL_MODE_REDESIGN.md §5).
 */
export type StagePaneProps = {
  stage: Stage
  focusedVoice: Voice | null
  availableColumns: number
  /** Stage-specific output text from session.stageContent. Populated for
   *  synthesis (synthesizer's plan) and execution (executor's diff) via
   *  stage-output events from the spawn adapters. */
  synthesisText?: string
  executionText?: string
}

export function StagePane({
  stage,
  focusedVoice,
  availableColumns,
  synthesisText,
  executionText,
}: StagePaneProps): React.ReactNode {
  if (stage === 'proposal' || stage === 'review' || stage === 'revision') {
    if (focusedVoice) {
      return <VoiceOutputView voice={focusedVoice} availableColumns={availableColumns} />
    }
  }
  if (stage === 'synthesis') {
    return (
      <StageTextView
        title="synthesizer's plan"
        text={synthesisText}
        availableColumns={availableColumns}
      />
    )
  }
  if (stage === 'execution') {
    return (
      <StageTextView
        title="executor — diff"
        text={executionText}
        availableColumns={availableColumns}
      />
    )
  }
  return (
    <Box flexDirection="column" paddingX={1} width={availableColumns}>
      <Text dimColor>[{stage} stage]</Text>
    </Box>
  )
}

function StageTextView({
  title,
  text,
  availableColumns,
}: {
  title: string
  text: string | undefined
  availableColumns: number
}): React.ReactNode {
  return (
    <Box flexDirection="column" paddingX={1} width={availableColumns}>
      <Box marginBottom={1}>
        <Text color={ACCENT} bold>
          {title}
        </Text>
      </Box>
      {text ? (
        <Text wrap="wrap">{text}</Text>
      ) : (
        <Text dimColor italic>
          [waiting for output…]
        </Text>
      )}
    </Box>
  )
}

function VoiceOutputView({
  voice,
  availableColumns,
}: {
  voice: Voice
  availableColumns: number
}): React.ReactNode {
  const title = `current — ${voice.role} (${voice.model})`
  return (
    <Box flexDirection="column" paddingX={1} width={availableColumns}>
      <Box marginBottom={1}>
        <Text color={ACCENT} bold>
          {title}
        </Text>
      </Box>
      {voice.output ? (
        <Text wrap="wrap">{voice.output}</Text>
      ) : (
        <Text dimColor italic>
          [waiting for output…]
        </Text>
      )}
    </Box>
  )
}
