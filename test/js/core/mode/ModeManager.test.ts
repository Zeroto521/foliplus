import { ModeManager, ensureModes } from "#foliplus/core/mode.js";
import { describe, expect, it, vi } from "vitest";

describe("ModeManager", () => {
  it("setMode/getMode round-trips", () => {
    const bus = {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      clear: vi.fn(),
      eventCount: 0,
    } as any;
    const mm = new ModeManager(bus);
    mm.setMode("MeasureControl", "distance");
    expect(mm.getMode("MeasureControl")).toBe("distance");
  });

  it("returns null for unknown components", () => {
    const bus = {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      clear: vi.fn(),
      eventCount: 0,
    } as any;
    const mm = new ModeManager(bus);
    expect(mm.getMode("Nope")).toBeNull();
  });

  it("setMode emits MODE_CHANGE when mode changes", () => {
    const bus = {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      clear: vi.fn(),
      eventCount: 0,
    } as any;
    const mm = new ModeManager(bus);
    mm.setMode("SearchControl", "addr");
    expect(bus.emit).toHaveBeenCalledWith("foliplus:modechange", {
      component: "SearchControl",
      mode: "addr",
    });
  });

  it("setMode does NOT emit when mode is unchanged (idempotent)", () => {
    const bus = {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      clear: vi.fn(),
      eventCount: 0,
    } as any;
    const mm = new ModeManager(bus);
    mm.setMode("X", "a");
    bus.emit.mockClear();
    mm.setMode("X", "a");
    expect(bus.emit).not.toHaveBeenCalled();
  });

  it("keys returns all registered components", () => {
    const bus = {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      clear: vi.fn(),
      eventCount: 0,
    } as any;
    const mm = new ModeManager(bus);
    mm.setMode("A", "a");
    mm.setMode("B", "b");
    expect(mm.keys().sort()).toEqual(["A", "B"]);
  });

  it("clear resets all modes", () => {
    const bus = {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      clear: vi.fn(),
      eventCount: 0,
    } as any;
    const mm = new ModeManager(bus);
    mm.setMode("A", "a");
    mm.clear();
    expect(mm.keys()).toHaveLength(0);
    expect(mm.getMode("A")).toBeNull();
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
  function makeBus() {
    return {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      clear: vi.fn(),
      eventCount: 0,
    } as any;
  }

  it("returns false when no modes are active", () => {
    const mm = new ModeManager(makeBus());
    expect(mm.isBlocked("SearchControl")).toBe(false);
    expect(mm.isBlocked("LocateControl")).toBe(false);
  });

  it("MeasureControl active blocks SearchControl and LocateControl", () => {
    const mm = new ModeManager(makeBus());
    mm.setMode("MeasureControl", "distance");
    expect(mm.isBlocked("SearchControl")).toBe(true);
    expect(mm.isBlocked("LocateControl")).toBe(true);
  });

  it("ExportControl exporting blocks SearchControl and LocateControl", () => {
    const mm = new ModeManager(makeBus());
    mm.setMode("ExportControl", "exporting");
    expect(mm.isBlocked("SearchControl")).toBe(true);
    expect(mm.isBlocked("LocateControl")).toBe(true);
  });

  it("does not block unrelated components", () => {
    const mm = new ModeManager(makeBus());
    mm.setMode("MeasureControl", "distance");
    expect(mm.isBlocked("ExportControl")).toBe(false);
    expect(mm.isBlocked("FullscreenControl")).toBe(false);
  });

  it("cleared mode no longer blocks", () => {
    const mm = new ModeManager(makeBus());
    mm.setMode("MeasureControl", "distance");
    mm.setMode("MeasureControl", null);
    expect(mm.isBlocked("SearchControl")).toBe(false);
  });
});
