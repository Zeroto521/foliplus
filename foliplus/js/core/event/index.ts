// core/event — cross-component event bus (per-map, singular dir).
import { ensureMapFoliplus } from "#core/mapApi.js";
import { EventBus } from "./EventBus.js";

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

export { ensureEvents };
export { EVENTS, EVENT_POLICY } from "./const.js";
export type { EventPayloadMap } from "./type.js";
export { EventBus, SettledOperation, publish } from "./EventBus.js";
export type { DispatchFailure, EventHandler } from "./EventBus.js";
