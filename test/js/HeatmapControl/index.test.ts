// Verifies the entry's lazy manager contract: a throw inside
// HeatmapManager.init() must leave the half-initialised manager reachable, so
// destroy() can release the subscriptions init() already made (review R1).
//
// The IIFE at the bottom of index.ts mounts the control at import time, which
// is why every other HeatmapControl test stops at the manager. This file
// follows test/js/ScaleControl/index.test.ts: install a minimal L.Control and
// map before importing the entry, then reach the instance through the map.
// `addTo` records the control without running onAdd — buildDOM needs the full
// Leaflet runtime and is covered by the browser suite; the lazy getter and
// destroy() do not.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { makeConfig } from "../config-fixture.js";
import { saveWindowGlobals } from "../fixture.js";

/** Restore the setup.ts globals this file swaps; hooks are file-scoped. */
const restoreGlobals = saveWindowGlobals("L", "map", "CONFIG");
afterAll(restoreGlobals);

type CapturedControl = {
  log: { warn: (...args: unknown[]) => void };
  manager: unknown;
  mgr: unknown;
  destroy: () => void;
};

type CanvasStub = {
  unregister: () => void;
  destroy: () => void;
};

let captured: CapturedControl | null = null;
/** Arm a failing `map.on` for the next manager init; null during import. */
let failOnEvent: string | null = null;

class MockMap {
  foliplus: Record<string, unknown>;
  handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  readonly canvases: CanvasStub[] = [];

  constructor() {
    this.foliplus = {
      LayerAPI: {
        isLayerControl: false,
        layers: [],
        createCanvas: vi.fn(() => {
          const stub: CanvasStub = {
            id: "heatmap-canvas",
            canvas: document.createElement("canvas"),
            ctx: null,
            register: vi.fn(),
            unregister: vi.fn(),
            setVisible: vi.fn(),
            destroy: vi.fn(),
            hooks: { before: [], after: [] },
          } as unknown as CanvasStub;
          this.canvases.push(stub);
          return stub;
        }),
        createLayers: vi.fn(),
        extractPoints: vi.fn(() => []),
        getLayersByType: vi.fn(() => []),
        getLayerPanes: vi.fn(() => []),
        registerLayer: vi.fn(() => null),
        unregisterLayer: vi.fn(() => true),
        deleteLayer: vi.fn(() => false),
        forgetSavedOrder: vi.fn(() => false),
        dropPersistedLayerState: vi.fn(() => false),
        bringLayerToFront: vi.fn(),
        setVisible: vi.fn(() => false),
        touchLayer: vi.fn(() => false),
      },
    };
  }

  on(type: string, fn: (...args: unknown[]) => void): this {
    if (type === failOnEvent) throw new Error(`map.on("${type}") failed`);
    (this.handlers[type] ??= []).push(fn);
    return this;
  }
  off(type: string, fn: (...args: unknown[]) => void): this {
    this.handlers[type] = (this.handlers[type] ?? []).filter(f => f !== fn);
    return this;
  }
  getContainer(): HTMLElement {
    return document.createElement("div");
  }
  getBounds(): { contains: () => boolean } {
    return { contains: () => true };
  }
  getZoom(): number {
    return 8;
  }
  hasLayer(): boolean {
    return false;
  }
  addLayer(): this {
    return this;
  }
  removeLayer(): this {
    return this;
  }
}

class MockControl {
  options: Record<string, unknown>;

  constructor(options: Record<string, unknown> = {}) {
    this.options = options;
  }
  addTo(_map: unknown): this {
    captured = this as unknown as CapturedControl;
    return this;
  }
}

describe("HeatmapControl entry — half-initialised manager", () => {
  let ctrl: CapturedControl;
  let mockMap: MockMap;

  beforeAll(async () => {
    (window as any).CONFIG = makeConfig("HeatmapControl");
    (window as any).L = { Control: MockControl };
    mockMap = new MockMap();
    (window as any).map = mockMap;
    vi.resetModules();
    await import("#foliplus/HeatmapControl/index.js");
    expect(captured, "the IIFE should have mounted the control").not.toBeNull();
    ctrl = captured!;
  });

  it("keeps the manager reachable when init() throws, so destroy() releases it", () => {
    failOnEvent = "zoomstart";
    // destroy() reports isolated step failures instead of throwing; keep the
    // expected report out of the test output.
    vi.spyOn(ctrl.log, "warn").mockImplementation(() => {});

    expect(() => ctrl.mgr).toThrow('map.on("zoomstart") failed');

    const mgr = ctrl.manager as { removeExportListener: () => void } | null;
    expect(mgr, "a throwing init() must not drop the manager").not.toBeNull();
    // A later read reuses the stored manager instead of retrying init().
    expect(ctrl.mgr).toBe(mgr);

    const release = vi.spyOn(mgr!, "removeExportListener");
    expect(() => ctrl.destroy()).not.toThrow();
    expect(
      release,
      "the export subscription init() made must be released",
    ).toHaveBeenCalledTimes(1);
    // Teardown ran to the tail: the overlay created before the throw is gone.
    expect(mockMap.canvases.at(-1)!.destroy).toHaveBeenCalledTimes(1);
    expect(ctrl.manager).toBeNull();

    failOnEvent = null;
  });
});
