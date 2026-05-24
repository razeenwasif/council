import { describe, expect, test } from 'bun:test'
import { shouldUseCouncilGrid } from './CouncilGrid.js'

describe('shouldUseCouncilGrid', () => {
  test('returns true for a full 7-voice council', () => {
    expect(
      shouldUseCouncilGrid([
        'architect',
        'implementer',
        'skeptic',
        'critic',
        'tester',
        'security',
        'performance',
      ]),
    ).toBe(true)
  })

  test('returns true for a 5-voice subset of council roles', () => {
    expect(
      shouldUseCouncilGrid([
        'architect',
        'implementer',
        'skeptic',
        'critic',
        'tester',
      ]),
    ).toBe(true)
  })

  test('returns false for fewer than 5 agents', () => {
    expect(shouldUseCouncilGrid(['architect', 'implementer', 'skeptic', 'critic'])).toBe(
      false,
    )
  })

  test('returns false for a generic sub-agent group', () => {
    expect(
      shouldUseCouncilGrid(['Explore', 'Plan', 'general-purpose', 'verification', 'Explore']),
    ).toBe(false)
  })

  test('returns false when council roles are a minority', () => {
    expect(
      shouldUseCouncilGrid([
        'architect',
        'Explore',
        'Plan',
        'general-purpose',
        'verification',
        'Explore',
      ]),
    ).toBe(false)
  })

  test('returns true when most of a mixed group is council', () => {
    expect(
      shouldUseCouncilGrid([
        'architect',
        'implementer',
        'skeptic',
        'critic',
        'tester',
        'Explore', // one stray non-council agent
      ]),
    ).toBe(true)
  })
})
