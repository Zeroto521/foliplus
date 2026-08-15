// core/events/EventBus — lightweight publish/subscribe event bus.
// Per-map (attached via ensureEvents underneath map.foliplus). Components
// subscribe to semantic events (LAYER_CHANGE, MODE_CHANGE, ...) instead of
// wiring to raw Leaflet map events — decoupled, auto-unbindable, and testable.
export type EventHandler = (...args: unknown[]) => void;

export class EventBus {
  private listeners = new Map<string, Set<EventHandler>>();

  /** Subscribe to an event; returns an unsubscribe function. */
  on(event: string, handler: EventHandler): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return () => this.off(event, handler);
  }

  /** Remove a specific handler for an event. */
  off(event: string, handler: EventHandler): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this.listeners.delete(event);
  }

  /** Emit an event to all subscribers (call order = subscription order). */
  emit(event: string, ...payload: unknown[]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    // Copy before iterating so handlers may subscribe/unsubscribe during emit.
    for (const handler of [...set]) {
      handler(...payload);
    }
  }

  /** Remove all listeners for every event. */
  clear(): void {
    this.listeners.clear();
  }

  /** Number of events with at least one listener (diagnostics/tests). */
  get eventCount(): number {
    return this.listeners.size;
  }
}
