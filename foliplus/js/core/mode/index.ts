// core/mode — cross-component active-mode registry (per-map).
import { ensureEvents } from "../event/index.js";
import { ModeManager } from "./ModeManager.js";

// Per-map instance storage (WeakMap so destroyed maps are GC'd).
const instances = new WeakMap<L.Map, ModeManager>();

/** Ensure `map.foliplus.modes` has a per-map ModeManager. Idempotent. */
export const ensureModes = (map: L.Map): ModeManager => {
  const existing = instances.get(map);
  if (existing) return existing;
  const manager = new ModeManager(ensureEvents(map));
  instances.set(map, manager);
  if (!map.foliplus) (map.foliplus as any) = { LayerAPI: null as any };
  map.foliplus!.modes = manager;
  return manager;
};

export { ModeManager, type ModeChangePayload } from "./ModeManager.js";
export { MODE_CHANGE } from "../event/index.js";
