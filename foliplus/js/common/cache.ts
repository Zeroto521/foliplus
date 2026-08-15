// common/cache — FIFO-bounded cache container with optional TTL expiry.
// Generic, stateless container (instances hold state). Shared by the runtime
// geocoder and reusable by future modules (EventBus, ModeManager, ...).
export class Cache<K, V> {
  private map = new Map<K, { value: V; ts: number }>();

  constructor(
    private readonly max: number,
    private readonly ttlMs = 0,
  ) {}

  /** Read a value; expired entries are evicted on access (when ttlMs > 0). */
  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (this.ttlMs > 0 && Date.now() - entry.ts > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** Insert (or update) a value; evicts the oldest entry when over capacity. */
  set(key: K, value: V): void {
    this.map.set(key, { value, ts: Date.now() });
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
