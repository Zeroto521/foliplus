// core/event/subscription — semantic-event subscriptions, merged per frame.
import { type ListenerPhase, ensureEvents } from "./EventBus.js";
import { EVENTS } from "./const.js";
import type { EventMeta, EventPayloadMap } from "./type.js";
import { throttleRaf } from "#platform/throttle.js";

/** One coalesced delivery: the event name, its payload, the emitter's origin. */
interface Delivery<K extends keyof EventPayloadMap> {
  readonly event: K;
  readonly payload: EventPayloadMap[K];
  readonly meta?: EventMeta;
}

/** Which events a subscription follows, plus an optional per-delivery filter. */
interface Selector<K extends keyof EventPayloadMap> {
  readonly events: readonly K[];
  /** Receives the payload and the event it arrived on; true keeps it. */
  readonly match?: (payload: EventPayloadMap[K], event: K) => boolean;
}

interface SubscribeOptions {
  /** Bus phase; "external" (the default) is the observer slot. */
  readonly phase?: ListenerPhase;
}

/** The coalescing key's id half: a payload with a string `id` merges per
 *  (event, id); anything else has none and merges per event. */
const idOf = (payload: unknown): string | undefined => {
  const id = (payload as { id?: unknown } | undefined)?.id;
  return typeof id === "string" ? id : undefined;
};

/**
 * Subscribe to semantic events, one delivery per animation frame.
 *
 * Merge rule (the only one): a payload carrying a string `id` is keyed by
 * (event, id), so repeated changes to one layer/entity collapse to the latest
 * payload; a payload without an `id` is keyed by (event), so a burst on a
 * broadcast channel collapses to its latest payload too. Everything that
 * survives the keying within one frame is handed to `handler` once, as a batch
 * of the latest payloads.
 *
 * - `selector.events` is the event set; `selector.match` narrows per delivery.
 * - The returned unsubscribe is idempotent: it removes the bus listeners,
 *   cancels a scheduled frame and unhooks the map's unload handler. The map's
 *   unload does the same, so a destroyed map never delivers.
 *
 * The helper is a view over the per-map EventBus (`ensureEvents`); it does not
 * introduce a second subscription mechanism.
 */
const subscribe = <K extends keyof EventPayloadMap>(
  map: L.Map,
  selector: Selector<K>,
  handler: (batch: readonly Delivery<K>[]) => void,
  opts: SubscribeOptions = {},
): (() => void) => {
  const bus = ensureEvents(map);
  const pending = new Map<string, Delivery<K>>();
  let stopped = false;

  const accepts = (payload: EventPayloadMap[K], event: K): boolean =>
    selector.match === undefined || selector.match(payload, event);

  // Only the frame scheduled by a matching emit calls this, so the map always
  // holds at least one delivery; teardown cancels the pending frame.
  const flush = (): void => {
    const batch = [...pending.values()];
    pending.clear();
    handler(batch);
  };
  const schedule = throttleRaf(flush);

  const offs: Array<() => void> = [];
  const teardown = (): void => {
    if (stopped) return;
    stopped = true;
    for (const off of offs) off();
    offs.length = 0;
    schedule.cancel();
    pending.clear();
    if (typeof map.off === "function") map.off("unload", teardown);
  };

  for (const event of selector.events) {
    offs.push(
      bus.on(
        event as string,
        (payload?: unknown, meta?: EventMeta) => {
          if (stopped) return;
          if (!accepts(payload as EventPayloadMap[K], event)) return;
          const id = idOf(payload);
          const key =
            id === undefined ? `${event as string}` : `${event as string}:${id}`;
          pending.set(key, {
            event,
            payload: payload as EventPayloadMap[K],
            meta,
          });
          schedule();
        },
        opts.phase,
      ),
    );
  }
  if (typeof map.on === "function") {
    // listener-exempt: the subscription teardown rides the map's unload; the
    // returned unsubscribe removes it, and the map is gone when it fires.
    map.on("unload", teardown);
  }

  return teardown;
};

/** Which layers a subscription follows: a fixed id set, or a payload predicate. */
type LayerPayload = EventPayloadMap[typeof EVENTS.LAYER_CHANGE];
type LayerSelector = readonly string[] | ((payload: LayerPayload) => boolean);

/** The layer preset over {@link subscribe}: LAYER_CHANGE, ids or predicate.
 *
 * This is a preset, not a second mechanism: it forwards to `subscribe` with
 * the layer channel and the id/predicate matcher. Following a different
 * channel means calling `subscribe` directly.
 */
const subscribeLayers = (
  map: L.Map,
  selector: LayerSelector,
  handler: (batch: readonly Delivery<typeof EVENTS.LAYER_CHANGE>[]) => void,
  opts: SubscribeOptions = {},
): (() => void) =>
  subscribe(
    map,
    {
      events: [EVENTS.LAYER_CHANGE],
      match: payload => {
        if (typeof selector === "function") return selector(payload);
        const id = idOf(payload);
        return id !== undefined && selector.includes(id);
      },
    },
    handler,
    opts,
  );

export { subscribe, subscribeLayers };
