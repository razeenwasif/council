import React from 'react'
import { Box, Text } from '../../ink.js'
import { EffectiveTerminalSizeProvider } from '../../hooks/useEffectiveTerminalSize.js'

/**
 * Chat sub-pane — wraps user-provided `chatContent` (the REPL's
 * Messages / spinner / tool JSX render tree) inside an
 * `EffectiveTerminalSizeProvider` so descendants that switch from
 * `useTerminalSize` → `useEffectiveTerminalSize` wrap to this pane's
 * column allocation instead of the real terminal width.
 *
 * Per PHASE_C_PLAN.md §4 ("Width handling"), this is the load-bearing
 * primitive that lets the chat content live inside a flex-shrunk
 * sub-pane without the Phase 3b wrap bug.
 *
 * Migration policy (documented here as a reminder): components inside
 * `chatContent` need to call `useEffectiveTerminalSize` to pick up this
 * override. Calling `useTerminalSize` directly still returns the real
 * terminal columns and will overflow.
 *
 * When `chatContent` is null/undefined, the pane renders a placeholder
 * so the preview script can show the layout without needing real chat.
 */
export type ChatPaneProps = {
  /** Total width allocated to this sub-pane, including its own border. */
  availableColumns: number
  /** REPL chat content (Messages + spinner + tool JSX) or null. */
  chatContent?: React.ReactNode
}

export function ChatPane({
  availableColumns,
  chatContent,
}: ChatPaneProps): React.ReactNode {
  // Interior width = outer width minus 1 char each side for the round border.
  const interior = Math.max(0, availableColumns - 2)

  if (!chatContent) {
    return (
      <Box paddingX={1} width={interior}>
        <Text dimColor italic>
          [chat scrollback — REPL slot wired in C.3]
        </Text>
      </Box>
    )
  }

  return (
    <EffectiveTerminalSizeProvider columns={interior}>
      {chatContent}
    </EffectiveTerminalSizeProvider>
  )
}
