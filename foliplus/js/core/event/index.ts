// core/event — cross-component event bus (per-map, singular dir).
import { EventBus, publish } from "./EventBus.js";
import { EVENTS } from "./const.js";
import type { EventPayloadMap } from "./type.js";
import { ensureMapFoliplus } from "#core/mapApi.js";

// Per-map instance storage (WeakMap so destroyed maps are GC'd) — mirrors the
// per-map hint-management pattern.
const instances = new WeakMap<L.Map, EventBus>();

/** Ensure `map.foliplus.events` has a per-map EventBus. Idempotent. */
const ensureEvents = (map: L.Map): EventBus => {
  const existing = instances.get(map);
  if (existing) return existing;
  const bus = new EventBus(map);
  instances.set(map, bus);
  const api = ensureMapFoliplus(map);
  api.events = bus;
  // A removed map cannot keep feeding deliveries: drop listeners and tokens on
  // unload, and release the closures the destroyed controls held. This is the
  // production path that makes the generation/clear teardown real instead of
  // test-only. Bare stub maps (tests, light embeds) may not expose `on`.
  if (typeof map.on === "function") {
    map.on("unload", () => bus.clear());
  }
  return bus;
};

/** The layer-scoped event names that carry an origin.
 *
 *  Deliberately absent: LAYER_ROLE_COUNT_CHANGED, LAYER_LIST_REBUILD and
 *  LAYER_NO_BASEMAP_CHANGED. Those three are global UI-rebuild signals with no
 *  `{ id, origin }` semantics — a subscriber is the whole list panel and does
 *  no self-echo filtering — so they stay on raw `publish` /
 *  `operation.emit` without an origin. Adding one of them here would force
 *  every emit site to invent an origin nobody reads. */
type LayerEventName =
  | "LAYER_CHANGE"
  | "LAYER_INTENT_CHANGE"
  | "LAYER_REMOVED"
  | "LAYER_DELETED"
  | "LAYER_STYLE_CHANGE"
  | "LAYER_FILTER_CHANGE"
  | "LAYER_CAPABILITY_CHANGED"
  | "LAYER_ITEM_COUNT_CHANGE"
  | "LAYER_ITEM_ADDED"
  | "LAYER_ITEM_UPDATED"
  | "LAYER_ITEM_REFRESHED"
  | "LAYER_ITEM_REMOVED"
  | "MODE_CHANGE"
  | "BEFORE_EXPORT"
  | "AFTER_EXPORT";

/** The payload one layer event carries, resolved from the bus's payload map.
 *  Resolved as a mapped type so each name resolves to a concrete literal
 *  rather than a deferred index — `EVENTS` is a value, so it cannot appear
 *  in a type position directly.
 *
 *  Every one of these payloads requires `origin`, so an emitter that forgets
 *  to say who moved the layer is a compile error. */
type LayerEventPayloadMap = {
  [E in LayerEventName]: EventPayloadMap[(typeof EVENTS)[E]];
};

type LayerEventPayload<E extends LayerEventName> = LayerEventPayloadMap[E];

/** Emit one layer event through the single source.
 *
 *  The `origin` is mandatory at the type level (it sits inside
 *  `LayerEventPayload`), so a builder cannot forget to say who moved the
 *  layer. This is the one place a layer event is published: routing it
 *  here is what lets the static guard forbid a bare `publish(EVENTS.LAYER_*)
 *  elsewhere. */
const emitLayerEvent = <E extends LayerEventName>(
  bus: EventBus,
  event: E,
  payload: LayerEventPayload<E>,
): void => {
  // `publish`'s rest parameter is a conditional on its generic event key, so
  // it cannot be satisfied here while `event` is still generic. The check
  // this helper exists to make happens at its signature, not at the hop: the
  // name is widened to a plain string, which resolves the bus's publish to
  // its untyped arm.
  // plain string, which resolves the bus's publish to its untyped arm.
  const name: string = EVENTS[event];
  publish(bus, name, payload);
};

export { ensureEvents, emitLayerEvent };
export { EVENTS, EVENT_POLICY, EVENT_POLICY_KIND } from "./const.js";
export type { EventPayloadMap, EventOrigin } from "./type.js";
export { EventBus, SettledOperation, publish } from "./EventBus.js";
export type { DispatchFailure, EventHandler } from "./EventBus.js";
