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
   *  the `unknown[]` branch and take any arguments.
   *
   *  Delivery is a bare loop over the handlers, in subscription order. A
   *  handler that throws propagates to the emitter immediately and the
   *  handlers behind it in this round do not run. Components publish as the
   *  *last* step of an operation precisely so this is observable but safe: the
   *  state the operation wrote is committed either way, and a retry after
   *  catching the error converges. A handler that hands its failure off
   *  instead of throwing is unaffected. */
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

  /** Emit an event whose payload is one layer's current state, superseding any
   *  in-flight delivery of the same (event, id). A synchronous rewrite inside a
   *  handler — a subscriber correcting its own table, another control bouncing
   *  the value back — emits a newer payload for the same id while the older
   *  delivery is still walking its handlers. Without this, the handlers behind
   *  the reentry point would receive the superseded value *after* the fresh
   *  one: final state correct, last payload stale. With it, the older delivery
   *  stops at the reentry point and only the newest write reaches the rest.
   *
   *  The payload itself stays a plain snapshot — a handler that stores it and
   *  reads later sees the value as of this emit, not whatever came after.
   *  `supersedeKey` is the layer id; the map is keyed by event + id so a
   *  CHANGE can never abort an INTENT for the same layer. */
  emitSuperseding<K extends string>(
    event: K,
    supersedeKey: string,
    ...payload: K extends keyof EventPayloadMap
      ? EventPayloadMap[K] extends void
        ? []
        : [NonNullable<EventPayloadMap[K]>]
      : unknown[]
  ): void;
  emitSuperseding(event: string, supersedeKey: string, ...payload: unknown[]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    // Replace the in-flight token first: the loop of whichever delivery is
    // currently walking this (event, id) sees the swap and stops. This emit
    // then delivers fresh to everyone from the start. The token is cleaned up
    // in a finally so a handler that throws cannot strand it — exceptions
    // propagate to the emitter by contract, and a stranded token would grow
    // the map with every (event, id) that ever threw.
    const token = {};
    const key = `${event}\u0000${supersedeKey}`;
    this.superseding.set(key, token);
    try {
      for (const handler of [...set]) {
        if (this.superseding.get(key) !== token) return;
        handler(...payload);
      }
    } finally {
      // Only delete our own token. A newer emit replaced it mid-delivery —
      // that delivery owns the cleanup, and deleting its token here would let
      // a third, even newer round run unsuperseded against the same key.
      if (this.superseding.get(key) === token) this.superseding.delete(key);
    }
  }

  private superseding = new Map<string, object>();

  /** Remove all listeners and any in-flight supersede tokens. */
  clear(): void {
    this.listeners.clear();
    this.superseding.clear();
  }
}

export { EventBus };
export type { EventHandler };
