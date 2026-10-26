// core/events/EventBus — lightweight publish/subscribe event bus.
// Per-map (attached via ensureEvents underneath map.foliplus). Components
// subscribe to semantic events (LAYER_CHANGE, MODE_CHANGE, ...) instead of
// wiring to raw Leaflet map events — decoupled, auto-unbindable, and testable.
import { createLogger } from "#common/log.js";
import { EVENT_POLICY, type EventPolicy } from "./const.js";
import type { EventPayloadMap } from "./type.js";

const log = createLogger("EventBus");

type EventHandler = (...args: unknown[]) => void;

/** Who owns a subscription. Internal (the control that owns the event) always
 *  runs before external observers, regardless of subscription order — a
 *  third party that subscribes early can never read half-cleared state before
 *  the owner has handled the event. */
type ListenerPhase = "internal" | "external";

/** What a settled delivery observed: the value a handler threw. The wrapper
 *  exists because `undefined` is a legal thrown value — `undefined` from the
 *  dispatch means "nothing was thrown", not "a handler threw undefined". */
type DispatchFailure = { readonly error: unknown };

type Listener = { fn: EventHandler; phase: ListenerPhase };

/** One event's record: the declared policy rides next to the listeners, so the
 *  exception contract cannot be chosen at a call site (see publish /
 *  SettledOperation). The snapshot caches the ordered listener list and is
 *  invalidated on subscribe/unsubscribe, so a delivery never copies per emit;
 *  inFlight holds the supersede tokens for in-progress deliveries of this
 *  event. */
interface EventEntry {
  policy: EventPolicy;
  listeners: Listener[];
  snapshot: Listener[] | null;
  inFlight: Map<string, object>;
}

const DEFAULT_POLICY: EventPolicy = { kind: "terminal" };

/** Policy of an event that was never subscribed (still declared in the
 *  table). Unknown third-party strings default to terminal — loud rather than
 *  silently best-effort. */
const policyOf = (event: string): EventPolicy =>
  (EVENT_POLICY as Record<string, EventPolicy>)[event] ?? DEFAULT_POLICY;

class EventBus {
  private entries = new Map<string, EventEntry>();

  /** The owning map, when the bus is attached per-map. Used for the optional
   *  per-map diagnostic hook (map.foliplus.onError) and kept optional so the
   *  bus is still constructible in isolation. */
  constructor(private readonly map?: L.Map | null) {}

  /** Number of events with at least one listener (diagnostics/tests). */
  get eventCount(): number {
    return this.entries.size;
  }

  /** Total listeners across every event (diagnostics/tests; complement to
   *  eventCount, which counts events with listeners — listenerCount exposes a
   *  listener leak even when every event keeps at least one). */
  get listenerCount(): number {
    let n = 0;
    for (const e of this.entries.values()) n += e.listeners.length;
    return n;
  }

  private entry(event: string): EventEntry {
    let e = this.entries.get(event);
    if (!e) {
      e = {
        policy: policyOf(event),
        listeners: [],
        snapshot: null,
        inFlight: new Map(),
      };
      this.entries.set(event, e);
    }
    return e;
  }

  private entryPolicy(event: string): EventPolicy {
    return this.entries.get(event)?.policy ?? policyOf(event);
  }

  /** Fail-fast emit must never carry a notification event: publishing one
   *  through `emit` would give the event the opposite contract to its
   *  declared policy. Producers use `publish` / `SettledOperation`. */
  private assertPublishable(event: string): void {
    if (this.entryPolicy(event).kind === "notification") {
      throw new Error(
        log.msg(
          `notification event "${event}" must be published (publish / SettledOperation), not fail-fast emit`,
        ),
      );
    }
  }

  /** Subscribe to a known event (typed payload).
   *
   *  The payload type is our *contract* — every in-tree emit passes it, so the
   *  handler can rely on a defined value. Callers outside the type system (a
   *  third-party script firing a bare `emit(event)`) are not covered by the
   *  contract, and a handler may defensively null-check the payload for that
   *  case (see the LAYER_CHANGE guards in LayerControl/HeatmapControl).
   *
   *  `phase` defaults to "external" (observer). Pass "internal" for the owner
   *  that must process the event before anyone else observes it. */
  on<K extends keyof EventPayloadMap>(
    event: K,
    handler: (payload: EventPayloadMap[K]) => void,
    phase?: ListenerPhase,
  ): () => void;
  /** Subscribe to any event (generic fallback). */
  on(event: string, handler: EventHandler, phase?: ListenerPhase): () => void;
  on(
    event: string,
    handler: EventHandler,
    phase: ListenerPhase = "external",
  ): () => void {
    const e = this.entry(event);
    // Duplicate registrations collapse to one (the previous Set semantics). A
    // repeat `on` with a different phase upgrades the existing registration,
    // so an owner handler re-registered as "internal" is never left behind an
    // observer.
    const existing = e.listeners.findIndex(l => l.fn === handler);
    if (existing >= 0) {
      if (e.listeners[existing].phase !== phase) {
        e.listeners.splice(existing, 1);
        this.insertListener(e, { fn: handler, phase });
      }
      e.snapshot = null;
      return () => this.off(event, handler);
    }
    this.insertListener(e, { fn: handler, phase });
    e.snapshot = null;
    return () => this.off(event, handler);
  }

  /** Insert a listener keeping the internal-prefix invariant: internal
   *  listeners stay ahead of external ones, stable within phase. */
  private insertListener(e: EventEntry, listener: Listener): void {
    if (listener.phase === "internal") {
      let idx = 0;
      while (idx < e.listeners.length && e.listeners[idx].phase === "internal") idx++;
      e.listeners.splice(idx, 0, listener);
    } else {
      e.listeners.push(listener);
    }
  }

  /** Remove a specific handler for a known event (typed payload). */
  off<K extends keyof EventPayloadMap>(
    event: K,
    handler: (payload: EventPayloadMap[K]) => void,
  ): void;
  /** Remove a specific handler for any event (generic fallback). */
  off(event: string, handler: EventHandler): void;
  off(event: string, handler: EventHandler): void {
    const e = this.entries.get(event);
    if (!e) return;
    const idx = e.listeners.findIndex(l => l.fn === handler);
    if (idx >= 0) e.listeners.splice(idx, 1);
    e.snapshot = null;
    if (e.listeners.length === 0) this.entries.delete(event);
  }

  /** Low-level delivery. `mode` decides whether a throwing handler stops the
   *  round (failfast) or is collected (collect). Policy is NOT consulted here:
   *  `publish` and `SettledOperation` resolve collected failures by the
   *  event's declared policy, so a caller cannot pick a different contract at
   *  a call site. Superseding: a newer round takes the in-flight token and the
   *  older round stops at the reentry point; the token is released in a
   *  finally so a throw cannot strand it. */
  private dispatch(
    event: string,
    payload: unknown[],
    mode: "failfast" | "collect",
    supersedeKey?: string,
  ): DispatchFailure | undefined {
    const e = this.entries.get(event);
    if (!e) return undefined;
    e.snapshot ??= [...e.listeners];
    const snapshot = e.snapshot;
    const generation = this.generation;
    const token = supersedeKey === undefined ? undefined : {};
    // Only read when the token is set (which implies the key is present).
    const key = supersedeKey as string;
    if (token !== undefined) e.inFlight.set(key, token);
    let failure: DispatchFailure | undefined;
    try {
      for (const listener of snapshot) {
        if (this.generation !== generation) break;
        if (token !== undefined && e.inFlight.get(key) !== token) break;
        try {
          listener.fn(...payload);
        } catch (error) {
          if (mode === "failfast") throw error;
          failure ??= { error };
        }
      }
    } finally {
      if (token !== undefined && e.inFlight.get(key) === token) {
        e.inFlight.delete(key);
      }
    }
    return failure;
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
   *  catching the error converges. State broadcasts to independent consumers
   *  use {@link publish} (one event) or {@link SettledOperation} (a lifecycle
   *  operation); the projection channel uses {@link emitSupersedingSettled}.
   *  Plain `emit` stays for commands with a single interested party, where
   *  stopping on the first error is useful. Notification events (MODE_CHANGE,
   *  BEFORE_EXPORT, OVERLAY_CLEAR, CONTROL_ATTACHED) must be published, not
   *  emitted — `emit` rejects them so a producer cannot give an event the
   *  opposite contract to its declared policy. */
  emit<K extends string>(
    event: K,
    ...args: K extends keyof EventPayloadMap
      ? EventPayloadMap[K] extends void
        ? []
        : [NonNullable<EventPayloadMap[K]>]
      : unknown[]
  ): void;
  emit(event: string, ...payload: unknown[]): void {
    this.assertPublishable(event);
    this.dispatch(event, payload, "failfast");
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
   *  `supersedeKey` is the layer id; tokens are keyed per event entry, so a
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
    this.assertPublishable(event);
    this.dispatch(event, payload, "failfast", supersedeKey);
  }

  /** Emit without letting a throwing handler cut the delivery short.
   *
   *  The settled-dispatch variant for a *lifecycle or command signal*: every
   *  still-current handler is attempted in subscription order, the first
   *  failure is returned, and the call never throws. Callers that own a wider
   *  operation (a register that also changes LAYER_CHANGE, a delete that also
   *  emits LAYER_REMOVED) collect these through {@link SettledOperation} and
   *  raise once after the whole fan-out. A `clear()` during delivery stops the
   *  remaining handlers. The failure is a wrapper, not the thrown value, for
   *  the same reason as {@link emitSupersedingSettled}: `throw undefined` is
   *  legal and must not read as "nothing failed". */
  emitSettled<K extends string>(
    event: K,
    ...payload: K extends keyof EventPayloadMap
      ? EventPayloadMap[K] extends void
        ? []
        : [NonNullable<EventPayloadMap[K]>]
      : unknown[]
  ): DispatchFailure | undefined;
  emitSettled(event: string, ...payload: unknown[]): DispatchFailure | undefined {
    return this.dispatch(event, payload, "collect");
  }

  /** Emit without letting a throwing handler cut the delivery short.
   *
   *  The settled-dispatch variant for *state broadcasts*: one layer's
   *  visibility is announced to any number of independent consumers, and none
   *  of them owns the others. Every still-current handler is attempted; the
   *  first failure is kept and returned. Superseding works exactly as in
   *  {@link emitSuperseding}; a failure this round already observed is still
   *  returned. `clear()` during delivery takes the token with it, so the
   *  remaining handlers are not attempted either. */
  emitSupersedingSettled<K extends string>(
    event: K,
    supersedeKey: string,
    ...payload: K extends keyof EventPayloadMap
      ? EventPayloadMap[K] extends void
        ? []
        : [NonNullable<EventPayloadMap[K]>]
      : unknown[]
  ): DispatchFailure | undefined;
  emitSupersedingSettled(
    event: string,
    supersedeKey: string,
    ...payload: unknown[]
  ): DispatchFailure | undefined {
    return this.dispatch(event, payload, "collect", supersedeKey);
  }

  /** Publish one broadcast and resolve the first failure by the event's
   *  declared policy: notification failures are logged and reported to the
   *  per-map `onError` hook; terminal failures are raised once the fan-out
   *  is done. */
  publish<K extends string>(
    event: K,
    ...payload: K extends keyof EventPayloadMap
      ? EventPayloadMap[K] extends void
        ? []
        : [NonNullable<EventPayloadMap[K]>]
      : unknown[]
  ): void;
  publish(event: string, ...payload: unknown[]): void {
    const failure = this.dispatch(event, payload, "collect");
    if (failure) this.resolveByPolicy(event, failure);
  }

  /** Resolve a collected failure by the event's policy and return the failure
   *  a terminal event keeps (a SettledOperation raises it after its own
   *  fan-out). Notification failures are consumed here: logged, reported to
   *  the per-map hook, and not raised. */
  consumeByPolicy(
    event: string,
    failure: DispatchFailure | undefined,
  ): DispatchFailure | undefined {
    if (!failure) return undefined;
    if (this.entryPolicy(event).kind === "notification") {
      this.reportConsumerFailure(event, failure.error);
      return undefined;
    }
    return failure;
  }

  private resolveByPolicy(event: string, failure: DispatchFailure): void {
    const kept = this.consumeByPolicy(event, failure);
    if (kept) throw kept.error;
  }

  /** Record a notification consumer failure: diagnostic log plus the optional
   *  per-map `onError` hook, so a host can observe a broken subscriber
   *  instead of grepping the console. The hook itself must never take the bus
   *  down. */
  private reportConsumerFailure(event: string, error: unknown): void {
    log.warn(`consumer failure on ${event} — recorded, not raised:`, error);
    try {
      this.map?.foliplus?.onError?.(event, error);
    } catch {
      // A broken diagnostic hook is worse than none.
    }
  }

  /** Bumped by `clear()`: settled deliveries snapshot it and stop when it
   *  changes, so a torn-down bus cannot keep feeding a delivery that was
   *  already in flight. */
  private generation = 0;

  /** Drop every listener and in-flight token. Called by ensureEvents on map
   *  unload — a removed map cannot keep feeding deliveries, and the destroyed
   *  controls' closures are released with it. Also stops an in-flight settled
   *  round via the generation bump. */
  clear(): void {
    this.entries.clear();
    this.generation++;
  }
}

/** One operation's settled fan-out. Queue every event the operation owes, do
 *  the local mutation in between, then `throwIfFailed()` once at the end — so
 *  a throwing consumer cannot cut off the later events or the local commit.
 *
 *  This is the event-bus counterpart of `#common/finalize`: a teardown runs
 *  `finalize` (no policy — every step must run), an event fan-out uses this
 *  class (each failure resolved by the event's declared policy). Both keep the
 *  first failure and raise it once at the boundary; do not re-derive a third
 *  variant.
 *
 *  Every queued event resolves its failure by the event's declared policy:
 *  notification events (MODE_CHANGE, BEFORE_EXPORT, OVERLAY_CLEAR,
 *  CONTROL_ATTACHED) are logged and reported, never raised, even when this
 *  operation is what publishes them — the operation cannot choose a stricter
 *  contract than the event declared. Terminal events keep the first failure
 *  and `throwIfFailed` raises it once the whole fan-out is done. */
class SettledOperation {
  private failure: DispatchFailure | undefined;

  constructor(private readonly bus: EventBus) {}

  emit<K extends string>(
    event: K,
    ...payload: K extends keyof EventPayloadMap
      ? EventPayloadMap[K] extends void
        ? []
        : [NonNullable<EventPayloadMap[K]>]
      : unknown[]
  ): this;
  emit(event: string, ...payload: unknown[]): this {
    // Dispatch first, then keep the first failure: `??=` on the call would
    // skip every event queued after the first failure, which is the very
    // truncation this operation exists to prevent.
    const observed = this.bus.emitSettled(event, ...payload);
    this.failure ??= this.bus.consumeByPolicy(event, observed);
    return this;
  }

  emitSuperseding<K extends string>(
    event: K,
    supersedeKey: string,
    ...payload: K extends keyof EventPayloadMap
      ? EventPayloadMap[K] extends void
        ? []
        : [NonNullable<EventPayloadMap[K]>]
      : unknown[]
  ): this;
  emitSuperseding(event: string, supersedeKey: string, ...payload: unknown[]): this {
    const observed = this.bus.emitSupersedingSettled(event, supersedeKey, ...payload);
    this.failure ??= this.bus.consumeByPolicy(event, observed);
    return this;
  }

  /** Fold in a failure a different dispatcher already observed (a projection
   *  batch, for example) so the operation owns the whole error boundary.
   *  Without an event the failure is kept unconditionally — the projection
   *  CHANGE/INTENT this absorbs are terminal. Pass the event to resolve it by
   *  the event's declared policy instead (a notification failure is consumed). */
  absorb(failure: DispatchFailure | undefined, event?: string): this {
    this.failure ??=
      event === undefined ? failure : this.bus.consumeByPolicy(event, failure);
    return this;
  }

  /** Whether a terminal failure is already recorded. A caller that owes a
   *  commit or an announcement gated on the operation's success asks this
   *  before it publishes again: once a failure is recorded the operation is
   *  heading for its rollback, and a further broadcast would announce a state
   *  that is about to be undone (the ghost-change shape). */
  hasFailure(): boolean {
    return this.failure !== undefined;
  }

  /** Raise the first terminal failure the operation observed, if any. */
  throwIfFailed(): void {
    if (this.failure) throw this.failure.error;
  }
}

/** Publish one settled broadcast, then resolve the first consumer failure by
 *  the event's declared policy (see EVENT_POLICY in ./const.js). This is the
 *  one-event counterpart of {@link SettledOperation}. Equivalent to
 *  `bus.publish`; the facade exists so callers that only hold the bus import
 *  one symbol instead of the method. */
const publish = <K extends string>(
  bus: EventBus,
  event: K,
  ...payload: K extends keyof EventPayloadMap
    ? EventPayloadMap[K] extends void
      ? []
      : [NonNullable<EventPayloadMap[K]>]
    : unknown[]
): void => {
  bus.publish(event, ...payload);
};

export { EventBus, SettledOperation, publish };
export type { DispatchFailure, EventHandler };
