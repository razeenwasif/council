import React from 'react'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { renderToString } from '../../utils/staticRender.js'

// mock.restore() doesn't undo mock.module() in Bun: without putting the real
// modules back, every later test file got this fake AppState (no
// AppStateProvider, no toolPermissionContext), which broke /export's plain
// text and the ThemeProvider tests when the whole suite ran.
const realCommandQueue = { ...(await import('../../hooks/useCommandQueue.js')) }
const realAppState = { ...(await import('src/state/AppState.js')) }

describe('PromptInputQueuedCommands', () => {
  beforeEach(async () => {
    await acquireSharedMutationLock('components/PromptInput/PromptInputQueuedCommands.test.tsx')
    mock.module('../../hooks/useCommandQueue.js', () => ({
      useCommandQueue: () => [
        {
          value: 'Use another library',
          mode: 'prompt',
        },
      ],
    }))

    mock.module('src/state/AppState.js', () => ({
      useAppState: (
        selector: (state: { viewingAgentTaskId?: string; isBriefOnly: boolean }) => unknown,
      ) => selector({ viewingAgentTaskId: undefined, isBriefOnly: false }),
    }))
  })

  afterEach(() => {
    try {
      mock.restore()
      mock.module('../../hooks/useCommandQueue.js', () => realCommandQueue)
      mock.module('src/state/AppState.js', () => realAppState)
    } finally {
      releaseSharedMutationLock()
    }
  })

  it('shows a next-turn guidance banner for queued prompt messages', async () => {
    const { PromptInputQueuedCommands } = await import('./PromptInputQueuedCommands.js')

    const output = await renderToString(<PromptInputQueuedCommands />, 100)

    expect(output).toContain('1 message queued for next turn')
    expect(output).toContain('Use another library')
  })
})
