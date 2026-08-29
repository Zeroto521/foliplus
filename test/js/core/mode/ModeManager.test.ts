import { describe, expect, it, vi } from "vitest";
import { ModeManager, ensureModes } from "#foliplus/core/mode.js";

// Shared mocks for the ModeManager constructor (bus + map).
const makeBus = (): any => ({
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  clear: vi.fn(),
  eventCount: 0,
});

const makeMap = (): any => ({
  eachLayer: vi.fn(),
});

/** Build a map whose eachLayer yields a single interactive leaf (SVG path). */
const makeMapWithLeaf = (interactive = true) => {
  const el = document.createElement("path");
  if (interactive) el.classList.add("leaflet-interactive");
  const leaf = {
    options: { interactive },
    _path: el,
    _icon: undefined as HTMLElement | undefined,
    _container: undefined as HTMLElement | undefined,
    addInteractiveTarget: vi.fn(),
    removeInteractiveTarget: vi.fn(),
  };
  const map = {
    eachLayer: vi.fn((fn: (l: unknown) => void) =>
      fn({ eachLayer: (c: (l: unknown) => void) => c(leaf) }),
    ),
  };
  (leaf as unknown as { _map: unknown })._map = map;
  return { map, leaf, el };
};

describe("ModeManager", () => {
  it("setMode/getMode round-trips", () => {
    const mm = new ModeManager(makeBus(), makeMap());
    mm.setMode("MeasureControl", "distance");
    expect(mm.getMode("MeasureControl")).toBe("distance");
  });

  it("returns null for unknown components", () => {
    const mm = new ModeManager(makeBus(), makeMap());
    expect(mm.getMode("Nope")).toBeNull();
  });

  it("setMode emits MODE_CHANGE when mode changes", () => {
    const bus = makeBus();
    const mm = new ModeManager(bus, makeMap());
    mm.setMode("SearchControl", "addr");
    expect(bus.emit).toHaveBeenCalledWith("foliplus:mode:change", {
      component: "SearchControl",
      mode: "addr",
    });
  });

  it("setMode does NOT emit when mode is unchanged (idempotent)", () => {
    const bus = makeBus();
    const mm = new ModeManager(bus, makeMap());
    mm.setMode("X", "a");
    bus.emit.mockClear();
    mm.setMode("X", "a");
    expect(bus.emit).not.toHaveBeenCalled();
  });

  it("keys returns all registered components", () => {
    const mm = new ModeManager(makeBus(), makeMap());
    mm.setMode("A", "a");
    mm.setMode("B", "b");
    expect(mm.keys().sort()).toEqual(["A", "B"]);
  });

  it("clear resets all modes", () => {
    const mm = new ModeManager(makeBus(), makeMap());
    mm.setMode("A", "a");
    mm.clear();
    expect(mm.keys()).toHaveLength(0);
    expect(mm.getMode("A")).toBeNull();
  });

  describe("interaction lock", () => {
    it("locks layer interaction on first non-null mode and restores on last null", () => {
      const { map, leaf, el } = makeMapWithLeaf();
      const mm = new ModeManager(makeBus(), map as any);

      mm.setMode("MeasureControl", "distance");
      expect(leaf.options.interactive).toBe(false);
      expect(el.classList.contains("leaflet-interactive")).toBe(false);
      expect(leaf.removeInteractiveTarget).toHaveBeenCalledWith(el);

      mm.setMode("MeasureControl", null);
      expect(leaf.options.interactive).toBe(true);
      expect(el.classList.contains("leaflet-interactive")).toBe(true);
      expect(leaf.addInteractiveTarget).toHaveBeenCalledWith(el);
    });

    it("keeps the lock while any component is active (no double walk, no early restore)", () => {
      const { map, leaf } = makeMapWithLeaf();
      const mm = new ModeManager(makeBus(), map as any);

      mm.setMode("MeasureControl", "distance");
      const walksAfterFirst = map.eachLayer.mock.calls.length;
      expect(walksAfterFirst).toBe(1);

      // Second component enters a mode — already locked, no re-walk.
      mm.setMode("ExportControl", "selecting");
      expect(map.eachLayer.mock.calls.length).toBe(walksAfterFirst);

      // One component clears but the other is still active — stays disabled.
      mm.setMode("MeasureControl", null);
      expect(leaf.options.interactive).toBe(false);

      // Last mode clears — interaction restored.
      mm.setMode("ExportControl", null);
      expect(leaf.options.interactive).toBe(true);
    });

    it("clear() releases the lock", () => {
      const { map, leaf } = makeMapWithLeaf();
      const mm = new ModeManager(makeBus(), map as any);
      mm.setMode("MeasureControl", "distance");
      expect(leaf.options.interactive).toBe(false);
      mm.clear();
      expect(leaf.options.interactive).toBe(true);
    });

    it("does not re-walk when a mode value is unchanged", () => {
      const { map, leaf } = makeMapWithLeaf();
      const mm = new ModeManager(makeBus(), map as any);
      mm.setMode("MeasureControl", "distance");
      map.eachLayer.mockClear();
      mm.setMode("MeasureControl", "distance"); // idempotent no-op
      expect(map.eachLayer).not.toHaveBeenCalled();
      expect(leaf.options.interactive).toBe(false);
    });
  });
});

describe("ensureModes", () => {
  it("attaches a ModeManager to map.foliplus.modes and is idempotent", () => {
    const map = {} as any;
    const m1 = ensureModes(map);
    const m2 = ensureModes(map);
    expect(m2).toBe(m1);
    expect(map.foliplus.modes).toBe(m1);
  });

  it("is per-map — separate maps get separate managers", () => {
    const mapA = {} as any;
    const mapB = {} as any;
    expect(ensureModes(mapA)).not.toBe(ensureModes(mapB));
  });
});

describe("isBlocked", () => {
  it("returns false when no modes are active", () => {
    const mm = new ModeManager(makeBus(), makeMap());
    expect(mm.isBlocked("SearchControl")).toBe(false);
    expect(mm.isBlocked("LocateControl")).toBe(false);
  });

  it("MeasureControl active blocks SearchControl and LocateControl", () => {
    const mm = new ModeManager(makeBus(), makeMap());
    mm.setMode("MeasureControl", "distance");
    expect(mm.isBlocked("SearchControl")).toBe(true);
    expect(mm.isBlocked("LocateControl")).toBe(true);
  });

  it("ExportControl exporting blocks SearchControl and LocateControl", () => {
    const mm = new ModeManager(makeBus(), makeMap());
    mm.setMode("ExportControl", "exporting");
    expect(mm.isBlocked("SearchControl")).toBe(true);
    expect(mm.isBlocked("LocateControl")).toBe(true);
  });

  it("does not block unrelated components", () => {
    const mm = new ModeManager(makeBus(), makeMap());
    mm.setMode("MeasureControl", "distance");
    expect(mm.isBlocked("ExportControl")).toBe(false);
    expect(mm.isBlocked("FullscreenControl")).toBe(false);
  });

  it("cleared mode no longer blocks", () => {
    const mm = new ModeManager(makeBus(), makeMap());
    mm.setMode("MeasureControl", "distance");
    mm.setMode("MeasureControl", null);
    expect(mm.isBlocked("SearchControl")).toBe(false);
  });
});
