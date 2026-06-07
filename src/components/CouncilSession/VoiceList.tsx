import React from 'react'
import { Box, Text } from '../../ink.js'
import type { Voice, VoiceListMode } from './types.js'

/**
 * Voice list pane — renders a list of voices with status glyph and role
 * label. Phase C's stacked-left layout uses two instances of this
 * component (one for council voices, one for discover voices), each
 * bound to a single mode.
 *
 * Width is controlled by the parent screen via flex (typically 16 cols).
 */
export type VoiceListProps = {
  /** Voices to render. May be empty (idle) — caller passes the canonical
   *  role list with pending status in that case (see COUNCIL_VOICE_ROLES
   *  and DISCOVER_VOICE_ROLES in types.ts). */
  voices: readonly Voice[]
  /** Index of focused voice within `voices`. Pass -1 when no focus
   *  belongs to this pane (i.e. session is active in the OTHER mode). */
  focusedIndex: number
  availableColumns: number
  /** Which mode this list represents. Drives the pane's identity even
   *  when not rendering active voices — at idle, the council pane still
   *  shows the 7 council role names; the discover pane still shows the
   *  4 discover role names. */
  mode?: VoiceListMode
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
