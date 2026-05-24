import { describe, expect, test } from 'bun:test'
import {
  formatCouncilError,
  formatCouncilResult,
} from './maybeInterceptCouncilPrompt.js'
import {
  CouncilCostCeilingError,
  CouncilMemberFailureError,
  CouncilQuorumLostError,
  CouncilTimeoutError,
} from './councilOrchestrator.js'
import { AgentAuthFailureError } from './councilSpawn.js'

describe('formatCouncilResult', () => {
  test('summarises proposals, verdicts, duration, cost, and executor output', () => {
    const out = formatCouncilResult({
      proposals: Array.from({ length: 7 }, (_, i) => ({
        role: `role-${i}`,
        modelId: `m-${i}`,
        text: `proposal ${i}`,
      })),
      plan: { text: 'unified plan' },
      execution: {
        summary: 'Added src/utils/x.ts (24 lines); bun test passes.',
      },
      reviews: [
        { role: 'architect', verdict: 'pass', findings: [] },
        { role: 'implementer', verdict: 'pass', findings: [] },
        { role: 'skeptic', verdict: 'concern', findings: ['edge case'] },
        { role: 'critic', verdict: 'nit', findings: ['naming'] },
        { role: 'tester', verdict: 'pass', findings: [] },
        { role: 'security', verdict: 'pass', findings: [] },
        { role: 'performance', verdict: 'pass', findings: [] },
      ],
      totalCostUsd: 0.42,
      totalDurationMs: 87300,
    })

    expect(out).toContain('7 proposals')
    expect(out).toContain('5 pass')
    expect(out).toContain('1 nit')
    expect(out).toContain('1 concern')
    expect(out).toContain('87.3s')
    expect(out).toContain('$0.4200')
    expect(out).toContain('Added src/utils/x.ts')
  })

  test('mentions failed voices when some did not deliver', () => {
    const out = formatCouncilResult({
      proposals: Array.from({ length: 6 }, (_, i) => ({
        role: `role-${i}`,
        modelId: `m-${i}`,
        text: `proposal ${i}`,
      })),
      plan: { text: 'p' },
      execution: { summary: 'wrote a file' },
      reviews: [],
      failures: [
        { role: 'implementer', stage: 'proposal', reason: 'timed out after 180000ms', isTimeout: true },
      ],
      totalCostUsd: 0.1,
      totalDurationMs: 5000,
    })
    expect(out).toContain('⚠')
    expect(out).toContain('1 voice failed')
    expect(out).toContain('implementer')
    expect(out).toContain('timeout')
    expect(out).toContain('Run continued')
  })

  test('mentions the revision pass when one occurred', () => {
    const out = formatCouncilResult({
      proposals: [],
      plan: { text: 'p' },
      execution: { summary: 'initial' },
      reviews: [],
      revised: { summary: 'revised: fixed proto-pollution guard' },
      totalCostUsd: 0,
      totalDurationMs: 0,
    })
    expect(out).toContain('Revision pass applied')
    expect(out).toContain('fixed proto-pollution guard')
  })
})

describe('formatCouncilError', () => {
  test('formats CouncilTimeoutError with stage + role', () => {
    const out = formatCouncilError(
      new CouncilTimeoutError('proposal', 60_000, 'skeptic'),
    )
    expect(out).toContain('timed out')
    expect(out).toContain('proposal')
    expect(out).toContain('skeptic')
    expect(out).toContain('60000ms')
  })

  test('formats CouncilCostCeilingError with ceiling + actual', () => {
    const out = formatCouncilError(
      new CouncilCostCeilingError(3, 3.42, 'review:critic'),
    )
    expect(out).toContain('$3')
    expect(out).toContain('review:critic')
    expect(out).toContain('$3.4200')
  })

  test('formats CouncilMemberFailureError with role + stage + reason', () => {
    const out = formatCouncilError(
      new CouncilMemberFailureError(
        'security',
        'proposal',
        new Error('upstream 429 rate-limited'),
      ),
    )
    expect(out).toContain('security')
    expect(out).toContain('proposal')
    expect(out).toContain('upstream 429')
  })

  test('falls back to generic message for unknown error shapes', () => {
    expect(formatCouncilError(new Error('boom'))).toContain('boom')
    expect(formatCouncilError('a string error')).toContain('a string error')
  })

  test('formats AgentAuthFailureError thrown directly (synth/executor stage)', () => {
    const out = formatCouncilError(
      new AgentAuthFailureError('executor', 'Please run /login · API Error: 401'),
    )
    expect(out).toContain('Authentication failure')
    expect(out).toContain('executor')
    expect(out).toContain('/login')
  })

  test('formats CouncilQuorumLostError with the failure list and remediation hint', () => {
    const out = formatCouncilError(
      new CouncilQuorumLostError('proposal', 4, 5, [
        { role: 'implementer', stage: 'proposal', reason: 'timed out', isTimeout: true },
        { role: 'critic', stage: 'proposal', reason: 'rate limit', isTimeout: false },
        { role: 'security', stage: 'proposal', reason: 'auth_error', isTimeout: false },
      ]),
    )
    expect(out).toContain('quorum lost')
    expect(out).toContain('4 of 5')
    expect(out).toContain('implementer')
    expect(out).toContain('critic')
    expect(out).toContain('security')
    expect(out).toContain('/login')
  })

  test('formats AgentAuthFailureError wrapped in CouncilMemberFailureError (proposal/review stage)', () => {
    const out = formatCouncilError(
      new CouncilMemberFailureError(
        'architect',
        'proposal',
        new AgentAuthFailureError('architect', 'authentication_error'),
      ),
    )
    expect(out).toContain('Authentication failure')
    expect(out).toContain('architect')
    expect(out).toContain('/login')
  })
})
