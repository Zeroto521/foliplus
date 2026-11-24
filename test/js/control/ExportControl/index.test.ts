// Verifies ExportControl.destroy() tears down an export that is still running.
//
// The entry was the component's only teardown and it cleared exactly two things:
// the crop box and the registered shortcuts.  An export commits far more -- a
// blocker overlay on document.body, a map locked against pan/zoom, a mode held
// on the shared ModeManager, and a render promise that can still be awaiting
// tile loads.  None of it was released, so map.removeControl() left the page
// blocked and the map undraggable until the render happened to finish (tile
// timeouts run to CONFIG.timeout = 7.5s) and a rebuilt manager could run beside
// the abandoned one.
//
// index.ts is coverage-excluded (it mounts through the IIFE and needs the full
// Leaflet runtime), so this file follows
// test/js/control/HeatmapControl/index.test.ts: install a minimal L.Control and
// map before importing the entry, then reach the instance through the map.
// addTo records the control without running onAdd -- buildDOM needs the full
// Leaflet runtime and is covered by the browser suite; the lazy getter and
// destroy() do not.
import { beforeAll, describe, expect, it, vi } from "vitest";

type CapturedControl = {
  log: { warn: (...args: unknown[]) => void };
  manager: unknown;
  mgr: unknown;
  destroy: () => void;
};

/** The LayerAPI surface requireLayerAPI() requires to accept the entry. */
const realLayerAPI = (): Record<string, unknown> => ({
  isLayerControl: true,
  get layers() {
    return [];
  },
  createCanvas: vi.fn(),
  createLayers: vi.fn(),
  extractPoints: vi.fn(() => []),
  getLayersByType: vi.fn(() => []),
  getLayerPanes: vi.fn(() => []),
  registerLayer: vi.fn(() => null),
  unregisterLayer: vi.fn(() => true),
  deleteLayer: vi.fn(() => false),
  bringLayerToFront: vi.fn(),
  setVisible: vi.fn(() => false),
  touchLayer: vi.fn(() => false),
});

const container = document.createElement("div");
const lock = { disable: vi.fn(), enable: vi.fn() };

class MockMap {
  foliplus: Record<string, unknown>;
  handlers: Record<string, Array<(...args: unknown[]) => void>> = {};

  /** The handles lockMap() reaches for, all recording into one stub so the test
   *  measures the same thing unlockMap() releases. */
  dragging = lock;
  scrollWheelZoom = lock;
  doubleClickZoom = lock;
  boxZoom = lock;
  keyboard = lock;
  touchZoom = lock;

  constructor() {
    this.foliplus = { LayerAPI: realLayerAPI() };
  }

  on(type: string, fn: (...args: unknown[]) => void): this {
    (this.handlers[type] ??= []).push(fn);
    return this;
  }

  off(type: string, fn: (...args: unknown[]) => void): this {
    this.handlers[type] = (this.handlers[type] ?? []).filter(f => f !== fn);
    return this;
  }

  getContainer(): HTMLElement {
    return container;
  }

  getBounds(): { contains: () => boolean } {
    return { contains: () => true };
  }

  getZoom(): number {
    return 8;
  }

  getCenter(): { lat: number; lng: number } {
    return { lat: 0, lng: 0 };
  }

  eachLayer(_fn: (layer: unknown) => void): this {
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

let captured: CapturedControl | null = null;
let mockMap: MockMap;

describe("ExportControl entry -- destroying mid-export", () => {
  let ctrl: CapturedControl;

  beforeAll(async () => {
    (window as unknown as { CONFIG: unknown }).CONFIG = {
      name: "ExportControl",
      position: "topleft",
      locale_code: "en",
      timeout: 7500,
      max_pixels: null,
      scale: 2,
      format: "png",
      filename: "map",
      quality: 0.9,
    };
    (window as unknown as { L: unknown }).L = { Control: MockControl };
    mockMap = new MockMap();
    (window as unknown as { map: unknown }).map = mockMap;
    vi.resetModules();
    await import("#control/ExportControl/index.js");
    expect(captured, "the IIFE should have mounted the control").not.toBeNull();
    ctrl = captured as CapturedControl;
  });

  it("removes the blocker, unlocks the map and releases the mode", () => {
    const manager = ctrl.mgr as {
      exportOverlay: HTMLElement | null;
      isExporting: boolean;
      lockMap: () => void;
      unlockMap: () => void;
      modes: {
        getMode: (c: string) => string | null;
        setMode: (c: string, m: string | null) => void;
      };
    };

    // Arm the state an in-flight export owns.  Nothing here stands in for the
    // pipeline: the overlay and the map lock are created exactly as doExport
    // creates them, so destroy() is measured against what the export actually
    // leaves behind.
    manager.modes.setMode("ExportControl", "exporting");
    manager.lockMap();
    manager.exportOverlay = document.createElement("div");
    manager.exportOverlay.className = "foliplus-export-blocker";
    document.body.appendChild(manager.exportOverlay);
    manager.isExporting = true;

    expect(manager.modes.getMode("ExportControl")).toBe("exporting");
    expect(document.querySelector(".foliplus-export-blocker")).not.toBeNull();
    // The map is locked: panning is off for the duration of the export.
    expect(lock.disable).toHaveBeenCalled();

    // destroy() reports isolated step failures instead of throwing; keep the
    // expected report out of the test output.
    vi.spyOn(ctrl.log, "warn").mockImplementation(() => {});
    expect(() => ctrl.destroy()).not.toThrow();

    expect(manager.isExporting, "the export flag must not outlive the control").toBe(
      false,
    );
    expect(
      manager.modes.getMode("ExportControl"),
      "the mode must be released or the map stays blocked for every component",
    ).toBeNull();
    expect(
      manager.exportOverlay,
      "the blocker overlay must come off document.body",
    ).toBeNull();
    expect(document.querySelector(".foliplus-export-blocker")).toBeNull();
    expect(
      lock.enable,
      "map interaction must be restored to the user",
    ).toHaveBeenCalled();
    // defineControl() nulls the manager after the component's own destroy hook,
    // so a rebuilt control cannot talk to the abandoned one.
    expect(ctrl.manager).toBeNull();
  });

  it("is a no-op when nothing is in flight", () => {
    vi.spyOn(ctrl.log, "warn").mockImplementation(() => {});
    expect(() => ctrl.destroy()).not.toThrow();
    expect(ctrl.manager).toBeNull();
    expect(document.querySelector(".foliplus-export-blocker")).toBeNull();
  });
});
