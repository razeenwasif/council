/**
 * Generic LRU (Least Recently Used) cache with a fixed maximum size.
 *
 * Semantics:
 *   - `get` and `set` bump the touched entry to MRU (most-recently-used).
 *   - `has` does NOT count as a use and does not change order.
 *   - Iteration yields entries as a snapshot in MRU -> LRU order; mutations
 *     to the cache during iteration do not affect the in-flight iterator.
 *   - When `set` causes size to exceed `maxSize`, the LRU entry is evicted.
 */

export class LRU<K, V> implements Iterable<[K, V]> {
  #map = new Map<K, V>()
  #maxSize: number

  constructor(maxSize: number) {
    if (!Number.isInteger(maxSize) || maxSize <= 0) {
      throw new TypeError(
        `LRU: maxSize must be a positive integer (got ${String(maxSize)})`,
      )
    }
    this.#maxSize = maxSize
  }

  get(key: K): V | undefined {
    if (!this.#map.has(key)) return undefined
    const value = this.#map.get(key) as V
    this.#map.delete(key)
    this.#map.set(key, value)
    return value
  }

  set(key: K, value: V): void {
    if (this.#map.has(key)) {
      this.#map.delete(key)
    }
    this.#map.set(key, value)
    while (this.#map.size > this.#maxSize) {
      const oldest = this.#map.keys().next().value as K
      this.#map.delete(oldest)
    }
  }

  /** Membership check. Does not count as a use. */
  has(key: K): boolean {
    return this.#map.has(key)
  }

  delete(key: K): boolean {
    return this.#map.delete(key)
  }

  get size(): number {
    return this.#map.size
  }

  *[Symbol.iterator](): IterableIterator<[K, V]> {
    const snapshot = [...this.#map]
    for (let i = snapshot.length - 1; i >= 0; i--) {
      yield snapshot[i]
    }
  }
}
