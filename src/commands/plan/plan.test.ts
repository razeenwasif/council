import { afterAll, beforeAll, expect, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import type { AppState } from '../../state/AppStateStore.js'

let call: typeof import('./plan.js').call
let getDefaultAppState: typeof import('../../state/AppStateStore.js').getDefaultAppState

beforeAll(async () => {
  await acquireSharedMutationLock('commands/plan/plan.test.ts')
  ;({ call } = await import('./plan.js'))
  ;({ getDefaultAppState } = await import('../../state/AppStateStore.js'))
})

afterAll(() => {
  releaseSharedMutationLock()
})

function contextWith(state: AppState) {
  let current = state
  return {
    getAppState: () => current,
    setAppState: (f: (prev: AppState) => AppState) => {
      current = f(current)
    },
    get state() {
      return current
    },
  }
}

test('/plan turns plan mode on and remembers the mode to return to', async () => {
  const ctx = contextWith(getDefaultAppState())
  const before = ctx.state.toolPermissionContext.mode
  expect(before).not.toBe('plan')

  const result = await call('', ctx as never)

  expect(result).toMatchObject({ type: 'text' })
  expect(ctx.state.toolPermissionContext.mode).toBe('plan')
  expect(ctx.state.toolPermissionContext.prePlanMode).toBe(before)
})

test('/plan in plan mode reports the plan instead of switching again', async () => {
  const ctx = contextWith(getDefaultAppState())
  await call('', ctx as never)
  const result = await call('', ctx as never)

  expect(ctx.state.toolPermissionContext.mode).toBe('plan')
  expect(result).toMatchObject({ type: 'text' })
  expect((result as { value: string }).value).toContain('Plan mode is on')
})

test('/plan with an unknown argument shows usage and changes nothing', async () => {
  const ctx = contextWith(getDefaultAppState())
  const before = ctx.state.toolPermissionContext.mode
  const result = await call('nonsense', ctx as never)

  expect((result as { value: string }).value).toContain('Usage:')
  expect(ctx.state.toolPermissionContext.mode).toBe(before)
})
