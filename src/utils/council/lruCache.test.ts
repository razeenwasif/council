import { describe, test, expect } from 'bun:test'
import { LRU } from './lruCache.js'

describe('LRU', () => {
  test('throws on maxSize = 0', () => {
    expect(() => new LRU<string, number>(0)).toThrow()
  })

  test('throws on maxSize = -1', () => {
    expect(() => new LRU<string, number>(-1)).toThrow()
  })

  test('throws on maxSize = 1.5', () => {
    expect(() => new LRU<string, number>(1.5)).toThrow()
  })

  test('throws on maxSize = NaN', () => {
    expect(() => new LRU<string, number>(NaN)).toThrow()
  })

  test('throws on maxSize = Infinity', () => {
    expect(() => new LRU<string, number>(Infinity)).toThrow()
  })

  test('accepts maxSize = 1 (cap=1 edge case)', () => {
    const cache = new LRU<string, number>(1)
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.has('a')).toBe(false)
    expect(cache.has('b')).toBe(true)
    expect(cache.size).toBe(1)
  })

  test('eviction at capacity', () => {
    const cache = new LRU<string, number>(3)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    cache.set('d', 4)
    expect(cache.has('a')).toBe(false)
    expect(cache.size).toBe(3)
    const order = [...cache].map(([k]) => k)
    expect(order).toEqual(['d', 'c', 'b'])
  })

  test('get moves entry to MRU', () => {
    const cache = new LRU<string, number>(3)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    cache.get('a')
    const order = [...cache].map(([k]) => k)
    expect(order).toEqual(['a', 'c', 'b'])
  })

  test('set on existing key updates value and bumps to MRU', () => {
    const cache = new LRU<string, number>(3)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    cache.set('a', 99)
    const order = [...cache].map(([k]) => k)
    expect(order[0]).toBe('a')
    expect(cache.get('a')).toBe(99)
  })

  test('has does not bump', () => {
    const cache = new LRU<string, number>(3)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    cache.has('a')
    const order = [...cache].map(([k]) => k)
    expect(order).toEqual(['c', 'b', 'a'])
  })

  test('miss does not change order', () => {
    const cache = new LRU<string, number>(3)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    cache.get('missing')
    const order = [...cache].map(([k]) => k)
    expect(order).toEqual(['c', 'b', 'a'])
  })

  test('delete then re-add places at MRU', () => {
    const cache = new LRU<string, number>(3)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    expect(cache.delete('b')).toBe(true)
    cache.set('b', 22)
    const order = [...cache].map(([k]) => k)
    expect(order).toEqual(['b', 'c', 'a'])
    expect(cache.delete('missing')).toBe(false)
  })

  test('iteration order after mixed ops', () => {
    const cache = new LRU<string, number>(4)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    cache.set('d', 4)
    cache.get('b')
    cache.set('e', 5) // evicts a
    cache.get('c')
    cache.delete('d')
    const order = [...cache].map(([k]) => k)
    expect(order).toEqual(['c', 'e', 'b'])
  })

  test('iterator is a snapshot', () => {
    const cache = new LRU<string, number>(5)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    const collected: string[] = []
    let mutated = false
    expect(() => {
      for (const [k] of cache) {
        collected.push(k)
        if (!mutated) {
          cache.set('z', 99)
          mutated = true
        }
      }
    }).not.toThrow()
    expect(collected).toEqual(['c', 'b', 'a'])
    expect(collected.includes('z')).toBe(false)
  })

  test('size reflects state', () => {
    const cache = new LRU<string, number>(3)
    expect(cache.size).toBe(0)
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.size).toBe(2)
    cache.set('c', 3)
    cache.set('d', 4) // eviction
    expect(cache.size).toBe(3)
    cache.delete('c')
    expect(cache.size).toBe(2)
  })
})
