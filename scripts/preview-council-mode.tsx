#!/usr/bin/env bun
/**
 * Visual preview script for the council-mode session view.
 *
 * Usage:
 *   bun run scripts/preview-council-mode.tsx                  # council mock
 *   bun run scripts/preview-council-mode.tsx discover         # discover mock
 *   bun run scripts/preview-council-mode.tsx idle             # idle state (no session)
 *
 * The script mounts the static CouncilSessionScreen with hard-coded
 * mock data so we can eyeball the layout at the current terminal width.
 * No orchestrator wiring; no input handling — Phase A scaffold only.
 *
 * Exit with Ctrl-C.
 */

// NOTE: chalk reads COLORTERM at module-init time, BEFORE this script's
// top-level statements run (ESM imports hoist). So setting
// process.env.COLORTERM here is too late — set it at the shell:
//
//   COLORTERM=truecolor bun run scripts/preview-council-mode.tsx
//
// Or `export COLORTERM=truecolor` in your shell rc. The real `bin/council`
// binary sets COLORTERM itself before any bundle import, so the production
// launch path doesn't need this dance.

import React from 'react'
import { enableConfigs } from '../src/utils/config.js'
import { render, Box, Text, useInput } from '../src/ink.js'
import {
  CouncilSessionScreen,
  MOCK_COUNCIL_SESSION,
  MOCK_DISCOVER_SESSION,
} from '../src/components/CouncilSession/index.js'

// Council's ThemeProvider reads global config during its initial mount.
// Standalone scripts (no main bootstrap) must enable config access first
// or render throws "Config accessed before allowed."
enableConfigs()

const arg = process.argv[2] ?? 'council'
const kind: 'council' | 'discover' | 'idle' =
  arg === 'discover' ? 'discover' : arg === 'idle' ? 'idle' : 'council'
const session =
  kind === 'idle'
    ? null
    : kind === 'discover'
      ? MOCK_DISCOVER_SESSION
      : MOCK_COUNCIL_SESSION

/** Placeholder chat content for the preview script — fakes a multi-turn
 *  conversation so the chat sub-pane has something to show alongside
 *  the voice output pane in active-session mode. The real REPL injects
 *  its `Messages` + spinner + tool JSX tree here in C.3. */
function MockChat(): React.ReactNode {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text dimColor>user</Text>
      </Box>
      <Box marginBottom={1}>
        <Text>rename the foo helper to bar across the codebase</Text>
      </Box>
      <Box marginBottom={1}>
        <Text dimColor>assistant</Text>
      </Box>
      <Box marginBottom={1}>
        <Text>
          I'll convene the council to deliberate on the rename approach. Watch
          the voices light up in the panel to your left as each member produces
          their proposal in parallel.
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text dimColor>user</Text>
      </Box>
      <Box>
        <Text>perfect, watching now</Text>
      </Box>
    </Box>
  )
}

function App(): React.ReactNode {
  const [cols, setCols] = React.useState(process.stdout.columns ?? 120)
  const [input, setInput] = React.useState('')
  React.useEffect(() => {
    const onResize = () => setCols(process.stdout.columns ?? 120)
    process.stdout.on('resize', onResize)
    return () => {
      process.stdout.off('resize', onResize)
    }
  }, [])

  // Minimal preview-only keystroke handling. Phase D wires real input via
  // Council's PromptInput primitives. For now: typed chars build a buffer,
  // backspace pops, Enter clears, ctrl-c exits the script.
  useInput((char, key) => {
    if (key.return) {
      setInput('')
      return
    }
    if (key.backspace || key.delete) {
      setInput(s => s.slice(0, -1))
      return
    }
    if (char && !key.ctrl && !key.meta && char.length === 1) {
      setInput(s => s + char)
    }
  })

  return (
    <Box flexDirection="column">
      <Box paddingX={1} marginBottom={1}>
        <Text dimColor>
          preview · {kind} · {cols} cols · ctrl-c to exit · enter clears input
        </Text>
      </Box>
      <CouncilSessionScreen
        session={session}
        terminalColumns={cols}
        commandValue={input}
        chatContent={<MockChat />}
      />
    </Box>
  )
}

const instance = await render(<App />)
await instance.waitUntilExit()
process.exit(0)
