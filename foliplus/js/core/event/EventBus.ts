// core/events/EventBus — lightweight publish/subscribe event bus.
// Per-map (attached via ensureEvents underneath map.foliplus). Components
// subscribe to semantic events (LAYER_CHANGE, MODE_CHANGE, ...) instead of
// wiring to raw Leaflet map events — decoupled, auto-unbindable, and testable.
import type { EventPayloadMap } from "./type.js";

type EventHandler = (...args: unknown[]) => void;

class EventBus {
  private listeners = new Map<string, Set<EventHandler>>();

  /** Number of events with at least one listener (diagnostics/tests). */
  get eventCount(): number {
    return this.listeners.size;
  }

  /** Subscribe to a known event (typed payload).
   *
   *  The payload type is our *contract* — every in-tree emit passes it, so the
   *  handler can rely on a defined value. Callers outside the type system (a
   *  third-party script firing a bare `emit(event)`) are not covered by the
   *  contract, and a handler may defensively null-check the payload for that
   *  case (see the LAYER_CHANGE guards in LayerControl/HeatmapControl). */
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

  /** Emit an event. A known event (in `EventPayloadMap`) requires its payload
   *  when the payload is non-void — the conditional rest tuple makes an
   *  omitted payload a type error at the emit site, which is the load-bearing
   *  contract: every in-tree emit of a data-bearing event passes its payload
   *  so subscribers can rely on a defined value. A void-payload event takes
   *  no argument. Unknown events (a third-party string not in the map) match
   *  the `unknown[]` branch and take any arguments. */
  emit<K extends string>(
    event: K,
    ...args: K extends keyof EventPayloadMap
      ? EventPayloadMap[K] extends void
        ? []
        : [NonNullable<EventPayloadMap[K]>]
      : unknown[]
  ): void;
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

export { EventBus };
export type { EventHandler };
