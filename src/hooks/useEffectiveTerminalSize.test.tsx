import { PassThrough } from 'node:stream'

import { afterAll, expect, mock, test } from 'bun:test'
import React from 'react'

import { createRoot, Text } from '../ink.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

import {
  EffectiveTerminalSizeProvider,
  useEffectiveTerminalSize,
} from './useEffectiveTerminalSize.js'

/**
 * Phase C.1 gate test — verifies the context shim returns the
 * overridden columns when wrapped, real terminal columns otherwise.
 * This primitive is load-bearing for Phase C; if any of these tests
 * fail, the entire phase pivots or aborts.
 */

await acquireSharedMutationLock('hooks/useEffectiveTerminalSize.test.tsx')

mock.module('../components/design-system/ThemeProvider.js', () => ({
  ThemeProvider: function PassthroughThemeProvider({
    children,
  }: {
    children: React.ReactNode
  }): React.ReactNode {
    return children
  },
}))

function createTestStreams(realColumns: number): {
  stdout: PassThrough
  stdin: PassThrough & {
    isTTY: boolean
    setRawMode: (mode: boolean) => void
    ref: () => void
    unref: () => void
  }
} {
  const stdout = new PassThrough()
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean
    setRawMode: (mode: boolean) => void
    ref: () => void
    unref: () => void
  }
  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}
  ;(stdout as unknown as { columns: number; rows: number }).columns = realColumns
  ;(stdout as unknown as { rows: number }).rows = 40
  return { stdout, stdin }
}

function Probe({ sink }: { sink: { columns: number; rows: number }[] }): React.ReactNode {
  const size = useEffectiveTerminalSize()
  sink.push({ columns: size.columns, rows: size.rows })
  return <Text>{`${size.columns}x${size.rows}`}</Text>
}

afterAll(() => releaseSharedMutationLock('hooks/useEffectiveTerminalSize.test.tsx'))

test('without provider, hook returns real terminal size', async () => {
  const { stdout, stdin } = createTestStreams(120)
  const sink: { columns: number; rows: number }[] = []

  const root = await createRoot({ stdout, stdin })
  root.render(<Probe sink={sink} />)
  // One synchronous render flush is sufficient — useTerminalSize reads
  // process.stdout.columns at mount.
  await new Promise(resolve => setTimeout(resolve, 50))
  root.unmount()

  expect(sink.length).toBeGreaterThan(0)
  expect(sink[0]!.columns).toBe(120)
})

test('with provider, hook returns overridden columns', async () => {
  const { stdout, stdin } = createTestStreams(200)
  const sink: { columns: number; rows: number }[] = []

  const root = await createRoot({ stdout, stdin })
  root.render(
    <EffectiveTerminalSizeProvider columns={42}>
      <Probe sink={sink} />
    </EffectiveTerminalSizeProvider>,
  )
  await new Promise(resolve => setTimeout(resolve, 50))
  root.unmount()

  expect(sink.length).toBeGreaterThan(0)
  expect(sink[0]!.columns).toBe(42)
  // Rows fall through to the real value when not overridden.
  expect(sink[0]!.rows).toBe(40)
})

test('with provider rows override, hook returns both overrides', async () => {
  const { stdout, stdin } = createTestStreams(200)
  const sink: { columns: number; rows: number }[] = []

  const root = await createRoot({ stdout, stdin })
  root.render(
    <EffectiveTerminalSizeProvider columns={42} rows={10}>
      <Probe sink={sink} />
    </EffectiveTerminalSizeProvider>,
  )
  await new Promise(resolve => setTimeout(resolve, 50))
  root.unmount()

  expect(sink.length).toBeGreaterThan(0)
  expect(sink[0]!.columns).toBe(42)
  expect(sink[0]!.rows).toBe(10)
})

test('nested providers — inner override wins', async () => {
  const { stdout, stdin } = createTestStreams(200)
  const sink: { columns: number; rows: number }[] = []

  const root = await createRoot({ stdout, stdin })
  root.render(
    <EffectiveTerminalSizeProvider columns={100}>
      <EffectiveTerminalSizeProvider columns={42}>
        <Probe sink={sink} />
      </EffectiveTerminalSizeProvider>
    </EffectiveTerminalSizeProvider>,
  )
  await new Promise(resolve => setTimeout(resolve, 50))
  root.unmount()

  expect(sink.length).toBeGreaterThan(0)
  expect(sink[0]!.columns).toBe(42)
})
