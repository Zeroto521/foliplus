// core/mode — cross-component active-mode registry (per-map).
// Tracks the active mode of each participating component and emits
// MODE_CHANGE on the per-map EventBus whenever a mode changes.
// No DOM / CONF dependency.
import { MODE_CHANGE, ensureEvents, type EventBus } from "#core/event/index.js";

interface ModeChangePayload {
  component: string;
  mode: string | null;
}

class ModeManager {
  private modes = new Map<string, string | null>();

  constructor(private readonly bus: EventBus) {}

  getMode(component: string): string | null {
    return this.modes.get(component) ?? null;
  }

  setMode(component: string, mode: string | null): void {
    if (this.modes.get(component) === mode) return;
    this.modes.set(component, mode);
    this.bus.emit(MODE_CHANGE, { component, mode } satisfies ModeChangePayload);
  }

  keys(): string[] {
    return [...this.modes.keys()];
  }

  clear(): void {
    this.modes.clear();
  }
}

// Per-map instance storage (WeakMap so destroyed maps are GC'd).
const instances = new WeakMap<L.Map, ModeManager>();

/** Ensure `map.foliplus.modes` has a per-map ModeManager. Idempotent. */
const ensureModes = (map: L.Map): ModeManager => {
  const existing = instances.get(map);
  if (existing) return existing;
  const manager = new ModeManager(ensureEvents(map));
  instances.set(map, manager);
  if (!map.foliplus) (map.foliplus as any) = { LayerAPI: null as any };
  map.foliplus!.modes = manager;
  return manager;
};

export type { ModeChangePayload };
export { ModeManager, ensureModes };
