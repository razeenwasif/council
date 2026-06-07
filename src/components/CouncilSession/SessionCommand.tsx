import React from 'react'
import { Box, Text } from '../../ink.js'

/**
 * Bottom command bar — minimal prompt for in-session commands
 * (/pause, /resume, /skip, /comment, etc.).
 *
 * Phase A: static visual scaffold only. Phase D wires keybindings +
 * actual input handling via existing PromptInput primitives.
 *
 * Width is the full available width of the parent screen.
 */
export type SessionCommandProps = {
  /** Current command buffer text. Phase A renders the mock value. */
  value: string
  availableColumns: number
}

const ACCENT = 'rgb(255,106,0)'

export function SessionCommand({ value, availableColumns }: SessionCommandProps): React.ReactNode {
  return (
    <Box paddingX={1} width={availableColumns}>
      <Text color={ACCENT}>❯ </Text>
      <Text>{value}</Text>
      <Text color={ACCENT}>▏</Text>
    </Box>
  )
}
