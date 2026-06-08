/**
 * Side-column status widgets for the council session view:
 *
 *  - GitStatusPane         — branch · ahead/behind · M/A/?/D counts +
 *                            tail of dirty files (status glyph + path)
 *  - SessionTasksPane      — last N TaskCreate entries with status glyphs
 *
 * Read-only and update via subscriptions.
 */
import React from 'react'

import { Box, Text } from '../../ink.js'
import { useGitStatus } from '../../hooks/useGitStatus.js'
import { useTasksV2 } from '../../hooks/useTasksV2.js'
import type { GitFileEntry } from '../../utils/gitStatusReader.js'

const FILE_TAIL = 8
const TASK_TAIL = 8

export function GitStatusPane({
  availableColumns,
}: {
  availableColumns: number
}): React.ReactNode {
  const status = useGitStatus()

  if (!status.inRepo) {
    return (
      <Box paddingX={1} flexDirection="column" width={availableColumns}>
        <Text dimColor italic>
          (not in a git repo)
        </Text>
      </Box>
    )
  }

  return (
    <Box paddingX={1} flexDirection="column" width={availableColumns}>
      <Box flexDirection="row">
        <Text>● </Text>
        <Text wrap="truncate-end">{status.branch ?? '(detached)'}</Text>
      </Box>
      {(status.ahead > 0 || status.behind > 0) && (
        <Box flexDirection="row">
          <Text dimColor>↑ </Text>
          <Text>{status.ahead}</Text>
          <Text dimColor>  ↓ </Text>
          <Text>{status.behind}</Text>
        </Box>
      )}
      {status.staged > 0 && (
        <Box flexDirection="row">
          <Text color="green">✚ </Text>
          <Text>{status.staged}</Text>
          <Text dimColor> staged</Text>
        </Box>
      )}
      {status.modified > 0 && (
        <Box flexDirection="row">
          <Text color="yellow">● </Text>
          <Text>{status.modified}</Text>
          <Text dimColor> dirty</Text>
        </Box>
      )}
      {status.deleted > 0 && (
        <Box flexDirection="row">
          <Text color="red">✗ </Text>
          <Text>{status.deleted}</Text>
          <Text dimColor> deleted</Text>
        </Box>
      )}
      {status.untracked > 0 && (
        <Box flexDirection="row">
          <Text dimColor>? </Text>
          <Text>{status.untracked}</Text>
          <Text dimColor> untracked</Text>
        </Box>
      )}
      {status.staged === 0 &&
        status.modified === 0 &&
        status.deleted === 0 &&
        status.untracked === 0 && (
          <Text dimColor italic>clean</Text>
        )}
      {status.files.length > 0 && (
        <>
          {/* Thin divider so the file list visually separates from the
              count summary above. */}
          <Box marginTop={1}>
            <Text dimColor>{'─'.repeat(Math.max(1, availableColumns - 2))}</Text>
          </Box>
          {status.files.slice(-FILE_TAIL).reverse().map((f, i) => (
            <FileRow
              key={`${f.status}-${f.path}-${i}`}
              entry={f}
              pathWidth={Math.max(8, availableColumns - 4)}
            />
          ))}
          {status.files.length > FILE_TAIL && (
            <Text dimColor italic>
              +{status.files.length - FILE_TAIL} more
            </Text>
          )}
        </>
      )}
    </Box>
  )
}

function FileRow({ entry, pathWidth }: { entry: GitFileEntry; pathWidth: number }): React.ReactNode {
  const { status, path } = entry
  const x = status[0]!
  const y = status[1]!
  // Glyph priority: untracked > deleted > staged > modified
  let glyph = '·'
  let color: string | undefined
  if (status === '??') {
    glyph = '?'
    color = 'gray'
  } else if (y === 'D' || x === 'D') {
    glyph = '✗'
    color = 'red'
  } else if (x !== ' ' && x !== '?') {
    glyph = '✚'
    color = 'green'
  } else if (y === 'M' || x === 'M') {
    glyph = '●'
    color = 'yellow'
  }
  const trimmed = trimPath(path, pathWidth)
  return (
    <Box flexDirection="row">
      <Text color={color}>{glyph} </Text>
      <Text wrap="truncate-start">{trimmed}</Text>
    </Box>
  )
}

function trimPath(path: string, max: number): string {
  if (path.length <= max) return path
  return '…' + path.slice(-(max - 1))
}

export function SessionTasksPane({
  availableColumns,
}: {
  availableColumns: number
}): React.ReactNode {
  const tasks = useTasksV2()
  const empty = !tasks || tasks.length === 0
  // Newest first; pending/in_progress before completed for visibility.
  const sorted = empty
    ? []
    : [...tasks!].sort((a, b) => {
        const order = (s: string) =>
          s === 'in_progress' ? 0 : s === 'pending' ? 1 : 2
        return order(a.status) - order(b.status)
      })
  const tail = sorted.slice(0, TASK_TAIL)
  // Layout: hint at top so it's visible from the first frame. The
  // earlier flexGrow-spacer-pin-to-bottom approach broke on first
  // render — see ScratchpadPane for the same fix.
  return (
    <Box paddingX={1} flexDirection="column" width={availableColumns}>
      <Text dimColor italic>(assistant-managed)</Text>
      {empty ? (
        <Text dimColor italic>(no tasks yet)</Text>
      ) : (
        <>
          {tail.map(t => {
            const glyph =
              t.status === 'completed'
                ? '✓'
                : t.status === 'in_progress'
                  ? '▶'
                  : '☐'
            const color =
              t.status === 'in_progress' ? 'green' : t.status === 'completed' ? 'gray' : undefined
            return (
              <Box key={t.id} flexDirection="row">
                <Text color={color}>{glyph} </Text>
                <Text dimColor={t.status === 'completed'} wrap="truncate-end">
                  {t.subject || t.activeForm || t.description || '(untitled)'}
                </Text>
              </Box>
            )
          })}
          {sorted.length > TASK_TAIL && (
            <Text dimColor italic>+{sorted.length - TASK_TAIL} more</Text>
          )}
        </>
      )}
    </Box>
  )
}
