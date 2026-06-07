import React from 'react'
import { Box, Text } from '../../ink.js'
import type { Voice } from './types.js'

/**
 * Left pane — list of voices with status glyph and role label.
 *
 * Phase A: static render from passed-in voices. Phase D adds Tab-cycle
 * focus + Enter to select. For now the focused voice is indicated by
 * `▸` in orange; others get a space.
 *
 * Width is controlled by the parent screen via flex (typically 16 cols).
 */
export type VoiceListProps = {
  voices: readonly Voice[]
  focusedIndex: number
  availableColumns: number
}

const ACCENT = 'rgb(255,106,0)'

/**
 * Status glyph + color per voice state. The orange `●` for streaming
 * and the orange `▸` for selected echo Onyx's accent pattern.
 */
function statusGlyph(status: Voice['status']): { ch: string; color: string | undefined; dim: boolean } {
  switch (status) {
    case 'running':
      return { ch: '●', color: ACCENT, dim: false }
    case 'done':
      return { ch: '✓', color: 'green', dim: false }
    case 'failed':
      return { ch: '✗', color: 'red', dim: false }
    case 'paused':
      return { ch: '⏸', color: 'yellow', dim: false }
    case 'pending':
    default:
      return { ch: '◯', color: undefined, dim: true }
  }
}

export function VoiceList({ voices, focusedIndex, availableColumns }: VoiceListProps): React.ReactNode {
  // Voice-list reserves: focus arrow (2 chars: '▸ ' or '  '), role label, trailing space + glyph (2).
  const labelMaxLen = Math.max(6, availableColumns - 6)
  return (
    <Box flexDirection="column" paddingX={1} width={availableColumns}>
      {voices.map((v, i) => {
        const isFocused = i === focusedIndex
        const glyph = statusGlyph(v.status)
        const label = v.role.length > labelMaxLen ? `${v.role.slice(0, labelMaxLen - 1)}…` : v.role
        return (
          <Box key={`${v.role}-${i}`} flexDirection="row" justifyContent="space-between">
            <Box>
              <Text color={isFocused ? ACCENT : undefined} bold={isFocused}>
                {isFocused ? '▸ ' : '  '}
              </Text>
              <Text dimColor={glyph.dim} bold={isFocused}>
                {label}
              </Text>
            </Box>
            <Text color={glyph.color} dimColor={glyph.dim}>
              {glyph.ch}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}
