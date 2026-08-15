// core/event — cross-component event bus (per-map, singular dir).
import { EventBus } from "./EventBus.js";

// Per-map instance storage (WeakMap so destroyed maps are GC'd) — mirrors the
// per-map hint-management pattern.
const instances = new WeakMap<L.Map, EventBus>();

/** Ensure `map.foliplus.events` has a per-map EventBus. Idempotent. */
export const ensureEvents = (map: L.Map): EventBus => {
  const existing = instances.get(map);
  if (existing) return existing;
  const bus = new EventBus();
  instances.set(map, bus);
  if (!map.foliplus) map.foliplus = { LayerAPI: null! } as unknown as MapFoliplus;
  map.foliplus!.events = bus;
  return bus;
};

export { EventBus, type EventHandler } from "./EventBus.js";
export { LAYER_CHANGE, MODE_CHANGE } from "./const.js";
