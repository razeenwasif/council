import React from 'react'
import { Box, Text } from '../../ink.js'
import type { Stage, Voice } from './types.js'

/**
 * Center pane — renders content for the currently active stage.
 *
 * Phase A: only handles the "proposal" stage by showing the focused
 * voice's streaming output. Stages 'synthesis', 'execution', 'review',
 * 'revision', 'done' will get dedicated content components in Phase B
 * (the executor stage needs file-diff rendering; the synthesis stage
 * needs a plan view; etc.). For now they fall back to a placeholder.
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
}

const ACCENT = 'rgb(255,106,0)'

export function StagePane({ stage, focusedVoice, availableColumns }: StagePaneProps): React.ReactNode {
  if (stage === 'proposal' && focusedVoice) {
    return <VoiceOutputView voice={focusedVoice} availableColumns={availableColumns} />
  }
  return (
    <Box flexDirection="column" paddingX={1} width={availableColumns}>
      <Text dimColor>[{stage} stage — content TBD in Phase B]</Text>
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
