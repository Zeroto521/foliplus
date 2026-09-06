// core/events/EventBus — lightweight publish/subscribe event bus.
// Per-map (attached via ensureEvents underneath map.foliplus). Components
// subscribe to semantic events (LAYER_CHANGE, MODE_CHANGE, ...) instead of
// wiring to raw Leaflet map events — decoupled, auto-unbindable, and testable.
import type { EventPayloadMap } from "./const.js";

type EventHandler = (...args: unknown[]) => void;

class EventBus {
  private listeners = new Map<string, Set<EventHandler>>();

  /** Number of events with at least one listener (diagnostics/tests). */
  get eventCount(): number {
    return this.listeners.size;
  }

  /** Subscribe to a known event (typed payload). */
  on<K extends keyof EventPayloadMap>(
    event: K,
    handler: (payload: EventPayloadMap[K]) => void,
  ): () => void;
  /** Subscribe to any event (generic fallback). */
  on(event: string, handler: EventHandler): () => void;
  on(event: string, handler: EventHandler): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();

      this.listeners.set(event, set);
    }

    set.add(handler);
    return () => this.off(event, handler);
  }

  /** Remove a specific handler for a known event (typed payload). */
  off<K extends keyof EventPayloadMap>(
    event: K,
    handler: (payload: EventPayloadMap[K]) => void,
  ): void;
  /** Remove a specific handler for any event (generic fallback). */
  off(event: string, handler: EventHandler): void;
  off(event: string, handler: EventHandler): void {
    const set = this.listeners.get(event);
    if (!set) return;

    set.delete(handler);
    if (set.size === 0) this.listeners.delete(event);
  }

  /** Emit a known event (typed payload). */
  emit<K extends keyof EventPayloadMap>(
    event: K,
    ...payload: EventPayloadMap[K] extends undefined ? [] : [EventPayloadMap[K]]
  ): void;
  /** Emit any event (generic fallback). */
  emit(event: string, ...payload: unknown[]): void;
  emit(event: string, ...payload: unknown[]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    // Copy before iterating so handlers may subscribe/unsubscribe during emit.
    for (const handler of [...set]) handler(...payload);
  }

  /** Remove all listeners for every event. */
  clear(): void {
    this.listeners.clear();
  }
}

export { type EventHandler, EventBus };
