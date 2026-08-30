// core/mode — cross-component active-mode registry (per-map).
// Tracks the active mode of each participating component and emits
// EVENTS.MODE_CHANGE on the per-map EventBus whenever a mode changes.
// No DOM / CONF dependency.
import { COMPONENTS, assertComponentName } from "#core/component.js";
import { EVENTS, type EventBus, ensureEvents } from "#core/event/index.js";
import { HINT_DURATION } from "#core/hint.js";
import { suspendMapInteractions } from "#core/layer/util.js";

interface ModeChangePayload {
  component: string;
  mode: string | null;
}

// Conflict matrix: when a component is in a non-null mode, which components
// are blocked from performing their primary actions?
const BLOCKED_BY: Record<string, string[]> = {
  [COMPONENTS.MeasureControl]: [COMPONENTS.SearchControl, COMPONENTS.LocateControl],
  [COMPONENTS.ExportControl]: [COMPONENTS.SearchControl, COMPONENTS.LocateControl],
};

class ModeManager {
  private modes = new Map<string, string | null>();
  /** Per-component suspend-skip predicates (layers left interactive). */
  private modeSkips = new Map<string, (leaf: L.Layer) => boolean>();
  /** Restore closure for map layers disabled while a mode is active. */
  private interactionLock: (() => void) | null = null;
  /** Signature of the skip set that produced the current lock (see syncInteractionLock). */
  private interactionSkipSignature = "";

  constructor(
    private readonly bus: EventBus,
    private readonly map: L.Map,
  ) {}

  getMode(component: string): string | null {
    return this.modes.get(component) ?? null;
  }

  setMode(
    component: string,
    mode: string | null,
    suspendSkip?: (leaf: L.Layer) => boolean,
  ): void {
    assertComponentName(component);
    if (this.modes.get(component) === mode) return;
    this.modes.set(component, mode);
    if (mode !== null && suspendSkip) this.modeSkips.set(component, suspendSkip);
    else this.modeSkips.delete(component);
    this.bus.emit(EVENTS.MODE_CHANGE, { component, mode } satisfies ModeChangePayload);
    this.syncInteractionLock();
  }

  /**
   * Suppress map-layer interaction while any component owns the map, and
   * restore it once the last mode clears. The policy is "any non-null mode
   * needs exclusive map interaction" — today only measure modes and export
   * crop/export register modes, and both require it.
   *
   * A component may opt to keep some of its own layers interactive while its
   * mode is active (MeasureControl's edit mode keeps measurement layers live)
   * by passing a `suspendSkip` predicate to setMode. A leaf then stays
   * interactive only when EVERY active component opts to skip it, so a mode
   * that suspends everything (drawing / export) always wins over edit mode.
   */
  private syncInteractionLock() {
    const active = [...this.modes.entries()].filter(([, m]) => m !== null);
    if (active.length === 0) {
      if (this.interactionLock) {
        this.interactionLock();
        this.interactionLock = null;
      }
      this.interactionSkipSignature = "";
      return;
    }
    // A component without a skip predicate suspends everything, which makes
    // the intersection skip irrelevant. Encode that regime (and otherwise the
    // sorted set of skip-carrying components) so we only re-walk when the
    // effective suspension policy actually changes — a switch between two
    // all-suspending modes reuses the existing lock.
    const hasSuspender = active.some(([component]) => !this.modeSkips.has(component));
    const signature = hasSuspender
      ? "suspend-all"
      : active
          .map(([component]) => component)
          .sort()
          .join(",");
    if (this.interactionLock && this.interactionSkipSignature === signature) return;
    if (this.interactionLock) this.interactionLock();
    const skip = (leaf: L.Layer) =>
      !hasSuspender &&
      active.every(([component]) => this.modeSkips.get(component)?.(leaf) ?? false);
    this.interactionLock = suspendMapInteractions(this.map, skip);
    this.interactionSkipSignature = signature;
  }

  /** Check whether a component is blocked by any active mode. */
  isBlocked(component: string): boolean {
    for (const [otherComp, otherMode] of this.modes) {
      if (otherMode === null) continue;
      const blocked = BLOCKED_BY[otherComp];
      if (blocked?.includes(component)) return true;
    }
    return false;
  }

  keys(): string[] {
    return [...this.modes.keys()];
  }

  clear(): void {
    this.modes.clear();
    this.modeSkips.clear();
    this.syncInteractionLock();
  }
}

// Per-map instance storage (WeakMap so destroyed maps are GC'd).
const instances = new WeakMap<L.Map, ModeManager>();

/** Ensure `map.foliplus.modes` has a per-map ModeManager. Idempotent. */
const ensureModes = (map: L.Map): ModeManager => {
  const existing = instances.get(map);
  if (existing) return existing;
  const manager = new ModeManager(ensureEvents(map), map);
  instances.set(map, manager);
  if (!map.foliplus) map.foliplus = { LayerAPI: null! } as unknown as MapFoliplus;
  map.foliplus!.modes = manager;
  // On map unload, clear modes and release the interaction lock so manager
  // state and the disabled-layers closure do not outlive the map (mirrors the
  // per-map cleanup pattern used by core/interaction).
  map.on("unload" as any, () => manager.clear());
  return manager;
};

/** Check whether a component is blocked by an active mode and show a hint.
 *  Caller provides the translated hint text (e.g. `T("blocked")`).
 *  Returns `true` when blocked (caller should return early). */
export const guardBlocked = (map: L.Map, name: string, hintText: string): boolean => {
  if (map.foliplus?.modes?.isBlocked(name)) {
    map.foliplus?.showHint?.(name, hintText, HINT_DURATION.SHORT);
    return true;
  }
  return false;
};

export type { ModeChangePayload };
export { ModeManager, ensureModes };
