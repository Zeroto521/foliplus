// core/event/subscribeLayers — layer-scoped semantic events, merged per frame.
import { throttleRaf } from "#platform/throttle.js";
import { EVENTS } from "./const.js";
import type { ListenerPhase } from "./EventBus.js";
import { ensureEvents } from "./ensureEvents.js";
import type { EventMeta, EventPayloadMap } from "./type.js";

/** One coalesced delivery: the event name, its payload, the emitter's origin. */
interface LayerEventDelivery<K extends keyof EventPayloadMap> {
  readonly event: K;
  readonly payload: EventPayloadMap[K];
  readonly meta?: EventMeta;
}

/** Which layers a subscription follows: a fixed id set, or a payload predicate. */
type LayerSelector<K extends keyof EventPayloadMap> =
  | readonly string[]
  | ((payload: EventPayloadMap[K]) => boolean);

interface SubscribeLayersOptions<K extends keyof EventPayloadMap> {
  /** Events to follow. Defaults to LAYER_CHANGE (the layer-membership channel). */
  readonly events?: readonly K[];
  /** Bus phase; "external" (the default) is the observer slot. */
  readonly phase?: ListenerPhase;
}

const idOf = (payload: unknown): string | undefined => {
  const id = (payload as { id?: unknown } | undefined)?.id;
  return typeof id === "string" ? id : undefined;
};

/**
 * Subscribe to semantic events for a layer set, one delivery per animation frame.
 *
 * - `selector` is an id set or a payload predicate; payloads without a string
 *   `id` only match a predicate.
 * - Everything that matches within one frame is merged per (event, layer) and
 *   handed to `handler` once, as a batch of the latest payloads — a burst of
 *   registry changes repaints once instead of per emit.
 * - The returned unsubscribe is idempotent: it removes the bus listeners,
 *   cancels a scheduled frame and unhooks the map's unload handler. The map's
 *   unload does the same, so a destroyed map never delivers.
 *
 * The helper is a view over the per-map EventBus (`ensureEvents`); it does not
 * introduce a second subscription mechanism.
 */
const subscribeLayers = <K extends keyof EventPayloadMap = typeof EVENTS.LAYER_CHANGE>(
  map: L.Map,
  selector: LayerSelector<K>,
  handler: (batch: readonly LayerEventDelivery<K>[]) => void,
  opts: SubscribeLayersOptions<K> = {},
): (() => void) => {
  const bus = ensureEvents(map);
  const events: readonly (keyof EventPayloadMap)[] = opts.events ?? [
    EVENTS.LAYER_CHANGE,
  ];
  const pending = new Map<string, LayerEventDelivery<K>>();
  let stopped = false;

  const accepts = (payload: EventPayloadMap[K]): boolean => {
    if (typeof selector === "function") return selector(payload);
    const id = idOf(payload);
    return id !== undefined && selector.includes(id);
  };

  const flush = (): void => {
    if (stopped || pending.size === 0) return;
    const batch = [...pending.values()];
    pending.clear();
    handler(batch);
  };
  const schedule = throttleRaf(flush);

  const teardown = (): void => {
    if (stopped) return;
    stopped = true;
    for (const off of offs) off();
    offs.length = 0;
    schedule.cancel();
    pending.clear();
    if (typeof map.off === "function") map.off("unload", teardown);
  };

  const offs: Array<() => void> = [];
  for (const event of events) {
    offs.push(
      bus.on(event as string, (payload?: unknown, meta?: EventMeta) => {
        if (stopped) return;
        if (!accepts(payload as EventPayloadMap[K])) return;
        const key = `${event as string}:${idOf(payload) ?? ""}`;
        pending.set(key, {
          event: event as K,
          payload: payload as EventPayloadMap[K],
          meta,
        });
        schedule();
      }, opts.phase),
    );
  }
  if (typeof map.on === "function") {
    // listener-exempt: the subscription teardown rides the map's unload; the
    // returned unsubscribe removes it, and the map is gone when it fires.
    map.on("unload", teardown);
  }

  return teardown;
};

export { subscribeLayers };
export type { LayerEventDelivery, LayerSelector, SubscribeLayersOptions };
