// common/cache — FIFO-bounded cache container with optional TTL expiry.
// Generic, stateless container (instances hold state). Shared by the runtime
// geocoder, SearchControl suggestions and ExportControl bitmap loading — the
// latter passes an optional eviction hook to release GPU resources on removal.
export class Cache<K, V> {
  private map = new Map<K, { value: V; ts: number }>();

  constructor(
    private readonly max: number,
    private readonly ttlMs = 0,
    private readonly onEvict?: (value: V) => void,
  ) {}

  /** Read a value; expired entries are evicted on access (when ttlMs > 0). */
  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (this.ttlMs > 0 && Date.now() - entry.ts > this.ttlMs) {
      this.map.delete(key);
      this.onEvict?.(entry.value);
      return undefined;
    }
    return entry.value;
  }

  /** Insert (or update) a value; evicts the oldest entry when over capacity. */
  set(key: K, value: V): void {
    const existing = this.map.get(key);
    if (existing) this.onEvict?.(existing.value);
    this.map.set(key, { value, ts: Date.now() });
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) {
        const evicted = this.map.get(oldest);
        this.map.delete(oldest);
        if (evicted) this.onEvict?.(evicted.value);
      }
    }
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  clear(): void {
    if (this.onEvict) {
      for (const entry of this.map.values()) this.onEvict(entry.value);
    }
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
