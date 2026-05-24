import { describe, test, expect } from 'bun:test'
import { formatCost } from './formatCost.js'

describe('formatCost', () => {
  test('formats zero', () => {
    expect(formatCost(0)).toBe('$0.00')
  })

  test('formats sub-dollar amount', () => {
    expect(formatCost(0.42)).toBe('$0.42')
  })

  test('pads trailing zero', () => {
    expect(formatCost(12.5)).toBe('$12.50')
  })

  test('formats just under thousand', () => {
    expect(formatCost(999.99)).toBe('$999.99')
  })

  test('formats grouping boundary at thousand', () => {
    expect(formatCost(1000)).toBe('$1,000.00')
  })

  test('formats large grouped amount', () => {
    expect(formatCost(1234567.5)).toBe('$1,234,567.50')
  })

  test('formats negative value', () => {
    expect(formatCost(-3.2)).toMatch(/^-\$3\.20$/)
  })

  test('returns $0.00 for NaN', () => {
    expect(formatCost(NaN)).toBe('$0.00')
  })

  test('returns $0.00 for Infinity', () => {
    expect(formatCost(Infinity)).toBe('$0.00')
  })
})
