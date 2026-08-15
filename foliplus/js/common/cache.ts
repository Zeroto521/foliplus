// common/cache — FIFO-bounded cache container.
// Generic, stateless container (instances hold state). Shared by the runtime
// geocoder and reusable by future modules (EventBus, ModeManager, ...).
export class Cache<K, V> {
  private map = new Map<K, V>();

  constructor(private readonly max: number) {}

  get(key: K): V | undefined {
    return this.map.get(key);
  }

  /** Insert (or update) a value; evicts the oldest entry when over capacity. */
  set(key: K, value: V): void {
    this.map.set(key, value);
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
