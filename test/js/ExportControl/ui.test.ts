import { beforeEach, describe, expect, it, vi } from "vitest";
import { HINT_DURATION } from "#core/hint.js";
import { ensureModes } from "#core/mode.js";
import * as CONST from "#foliplus/ExportControl/const.js";
import { type CropState, ExportManager } from "#foliplus/ExportControl/manager.js";
import {
  removeCropBox,
  showCropBox,
  showGlobalHint,
} from "#foliplus/ExportControl/ui.js";
import { createScopedTranslator } from "#common/locale.js";

// Minimal map mock satisfying ExportManager constructor + ui fn requirements.
function makeMapMock() {
  const container = document.createElement("div");
  // getBoundingClientRect is used by showCropBox to size the default crop box.
  container.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 500,
      height: 400,
      right: 500,
      bottom: 400,
    }) as DOMRect;
  return {
    getContainer: () => container,
    getBounds: () => ({
      getSouth: () => -90,
      getNorth: () => 90,
      getEast: () => 180,
      getWest: () => -180,
    }),
    latLngToContainerPoint: vi.fn(({ lat, lng }) => ({ x: lng, y: lat })),
    containerPointToLatLng: vi.fn(({ x, y }) => ({ lat: y, lng: x })),
    keyboard: { disable: vi.fn(), enable: vi.fn() },
    on: vi.fn(),
    off: vi.fn(),
    eachLayer: vi.fn(),
    // The UI functions now reach the map via mgr.map — the mock must carry the
    // foliplus runtime like the real Leaflet map (hints, per-map events/modes).
    foliplus: {
      showHint: vi.fn(),
      hideHint: vi.fn(),
    },
  };
}

// Build an ExportManager with a real toolbar, ready for showCropBox/removeCropBox.
function makeManager() {
  window.CONFIG = {
    ...window.CONFIG,
    name: "ExportControl",
    timeout: 7500,
    max_pixels: null,
    scale: 2,
    format: "png",
    filename: "map",
    quality: 0.9,
  };
  const manager = new ExportManager(makeMapMock());
  const toolBar = document.createElement("div");
  manager.attachUI(null as unknown as HTMLElement, toolBar);
  return manager;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ExportControl ui — extra hint and toolbar paths", () => {
  it("unlock toolbar buttons re-arm, and removeCropBox collapses the control", () => {
    const manager = makeManager();
    const ctrl = document.createElement("div");
    manager.attachUI(ctrl, manager.exportToolBar!);
    showCropBox(manager);
    manager.lockCropBox();
    manager.unlockCropBox();

    const buttons = () => Array.from(manager.exportToolBar!.querySelectorAll("button"));
    // Confirm re-locks from the unlocked state…
    const confirm = buttons().find(b => b.title === manager.T("btn_confirm"));
    confirm!.click();
    expect(manager.cropState!.locked).toBe(true);
    // Cancel from the locked state unlocks again…
    const cancelLocked = buttons().find(b => b.title === manager.T("btn_cancel"));
    cancelLocked!.click();
    expect(manager.cropState!.locked).toBe(false);
    // …and cancel from the unlocked state removes the crop box.
    const cancelUnlocked = buttons().find(b => b.title === manager.T("btn_cancel"));
    cancelUnlocked!.click();
    expect(manager.cropState).toBeNull();
    expect(ctrl.classList.contains(CONST.CLASSES.COLLAPSED)).toBe(true);
    expect(manager.map.foliplus.hideHint).toHaveBeenCalled();
  });
});

describe("ExportControl ui — crop mode via ModeManager", () => {
  let manager: any;

  beforeEach(() => {
    manager = makeManager();
  });

  it("showCropBox sets ModeManager mode to 'selecting'", () => {
    showCropBox(manager);
    expect(manager.map.foliplus.modes.getMode("ExportControl")).toBe("selecting");
  });

  it("removeCropBox resets ModeManager mode to null", () => {
    showCropBox(manager);
    expect(manager.map.foliplus.modes.getMode("ExportControl")).toBe("selecting");
    removeCropBox(manager);
    expect(manager.map.foliplus.modes.getMode("ExportControl")).toBeNull();
  });

  it("syncCropKeyboard tracks every crop-box transition", () => {
    // Leaflet's built-in handler pans/zooms on arrow keys and +/-; it must be
    // off while the crop box is being edited (arrow keys nudge instead of
    // panning), re-enabled when locked (the "+/- zoom" hint applies there) or
    // removed. Missing any of these four transitions would either let the
    // map fight the nudging or leave the map permanently without keyboard panning.
    showCropBox(manager);
    expect(manager.map.keyboard.disable).toHaveBeenCalledTimes(1);
    expect(manager.map.keyboard.enable).not.toHaveBeenCalled();

    manager.lockCropBox();
    expect(manager.map.keyboard.enable).toHaveBeenCalledTimes(1);

    manager.unlockCropBox();
    expect(manager.map.keyboard.disable).toHaveBeenCalledTimes(2);

    manager.removeCropBox();
    expect(manager.map.keyboard.enable).toHaveBeenCalledTimes(2);
  });

  it("crop 'selecting' mode suspends layer interaction, removeCropBox restores it", () => {
    const el = document.createElement("path");
    el.classList.add("leaflet-interactive");
    const leaf = {
      options: { interactive: true },
      _map: manager.map,
      _path: el,
      _icon: undefined,
      _container: undefined,
      addInteractiveTarget: vi.fn(),
      removeInteractiveTarget: vi.fn(),
    };
    manager.map.eachLayer.mockImplementation((fn: (l: unknown) => void) =>
      fn({ eachLayer: (c: (l: unknown) => void) => c(leaf) }),
    );

    // Entering crop selection registers "selecting" → the centralized
    // ModeManager lock disables the feature layer so the crop drag isn't
    // interrupted by popups / feature handlers.
    showCropBox(manager);
    expect(leaf.options.interactive).toBe(false);
    expect(el.classList.contains("leaflet-interactive")).toBe(false);
    expect(leaf.removeInteractiveTarget).toHaveBeenCalledWith(el);

    // Cancelling / finishing the crop restores interaction.
    removeCropBox(manager);
    expect(leaf.options.interactive).toBe(true);
    expect(el.classList.contains("leaflet-interactive")).toBe(true);
    expect(leaf.addInteractiveTarget).toHaveBeenCalledWith(el);
  });
});

describe("ExportControl ui — hints and toolbar via the injected config", () => {
  /** Swap the manager's config/T so hint text provably comes from the injection. */
  const inject = (manager: ExportManager, overrides: Partial<ComponentConfig> = {}) => {
    manager.config = {
      name: "ExportControl",
      locale_code: "en",
      max_pixels: 100,
      locale_tables: {
        en: {
          "ExportControl.label_size_prefix": "SZ ",
          "ExportControl.label_size_suffix": " px",
          "ExportControl.err_too_large": "over the {limit} cap",
          "ExportControl.btn_export": "EXPORT",
          "ExportControl.btn_cancel": "CANCEL",
        },
      },
      ...overrides,
    } as ComponentConfig;
    manager.T = createScopedTranslator(manager.config);
    return manager;
  };

  it("showGlobalHint uses the injected config name", () => {
    const manager = inject(makeManager());
    (manager.showGlobalHint as (text: string) => void)("working");
    expect(manager.map.foliplus.showHint).toHaveBeenCalledWith(
      "ExportControl",
      "working",
      HINT_DURATION.PERSIST,
      undefined,
      undefined,
      false,
    );
  });

  it("size hint text comes from the injected config, not from window.CONFIG", () => {
    const manager = inject(makeManager());
    showCropBox(manager);
    const size = manager.map.foliplus.showHint.mock.calls.find(
      (c: unknown[]) => c[4] === "size",
    );
    expect(size).toBeDefined();
    expect(size![0]).toBe("ExportControl");
    expect(size![1]).toContain("SZ ");
    expect(size![1]).toContain("px");
  });

  it("pixel-limit hint formats the config max_pixels when the crop overflows", () => {
    const manager = inject(makeManager());
    // checkPixelLimit reads the ambient manager CONFIG — the hint text itself
    // still comes from the injected table above.
    window.CONFIG = { ...window.CONFIG, max_pixels: 100 };
    showCropBox(manager);
    manager.cropState!.rect = { left: 0, top: 0, width: 50, height: 50 };
    manager.showHintWithInfo(manager.cropState!.rect);

    const limit = manager.map.foliplus.showHint.mock.calls.find(
      (c: unknown[]) => c[4] === "limit",
    );
    expect(limit).toBeDefined();
    expect(limit![1]).toContain("over the 100 cap");
  });

  it("lockCropBox re-renders the toolbar with the injected titles", () => {
    const manager = inject(makeManager());
    showCropBox(manager);
    manager.lockCropBox();
    const titles = Array.from(manager.exportToolBar!.querySelectorAll("button")).map(
      b => (b as HTMLButtonElement).title,
    );
    expect(titles).toContain("EXPORT");
    expect(titles).toContain("CANCEL");
  });

  it("lockCropBox(true) skips the size hint", () => {
    const manager = inject(makeManager());
    showCropBox(manager);
    manager.lockCropBox(true);
    const texts = manager.map.foliplus.showHint.mock.calls.map((c: unknown[]) =>
      String(c[1]),
    );
    // onMapChange may refresh the size hint, but the locked-instruction hint
    // is what skipHint suppresses.
    expect(texts.some((t: string) => t.includes("hint_locked"))).toBe(false);
  });

  it("showGlobalHint with loading passes the spinner flag through", () => {
    const manager = makeManager();
    showGlobalHint(manager, "Exporting map... (42%)", 0, true);
    expect(manager.map.foliplus.showHint).toHaveBeenCalledWith(
      "ExportControl",
      "Exporting map... (42%)",
      0,
      undefined,
      undefined,
      true,
    );
  });

  it("showGlobalHint defaults to the control icon for status messages", () => {
    const manager = makeManager();
    showGlobalHint(manager, "Export successful", 4000);
    expect(manager.map.foliplus.showHint).toHaveBeenCalledWith(
      "ExportControl",
      "Export successful",
      4000,
      undefined,
      undefined,
      false,
    );
  });
});

describe("ExportControl ui — crop-state guards and locked map sync", () => {
  // bindMapSync routes the map move handler through throttleRaf, so a fired
  // "move" only lands on the next animation frame.  Queue the frames and flush
  // them explicitly instead of fighting the jsdom rAF loop.
  const rafQueue: Array<(t: number) => void> = [];
  const realRaf = globalThis.requestAnimationFrame;

  beforeEach(() => {
    rafQueue.length = 0;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      rafQueue.push(cb as (t: number) => void);
      return rafQueue.length;
    };
    globalThis.cancelAnimationFrame = () => undefined;
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = realRaf;
    document.body.innerHTML = "";
  });

  const flushRaf = () => {
    for (const cb of rafQueue.splice(0)) cb(0);
  };

  /** A map mock that records bound handlers so events can be fired on demand. */
  const eventsMap = () => {
    const handlers = new Map<string, Array<() => void>>();
    return {
      ...makeMapMock(),
      on: vi.fn((event: string, fn: unknown) => {
        const list = handlers.get(event) ?? [];
        list.push(fn as () => void);
        handlers.set(event, list);
      }),
      off: vi.fn((event: string, fn: unknown) => {
        handlers.set(
          event,
          (handlers.get(event) ?? []).filter(h => h !== fn),
        );
      }),
      fire: (event: string) => {
        for (const fn of handlers.get(event) ?? []) fn();
      },
    };
  };

  const makeEventManager = () => {
    window.CONFIG = {
      ...window.CONFIG,
      name: "ExportControl",
      timeout: 7500,
      max_pixels: null,
      scale: 2,
      format: "png",
      filename: "map",
      quality: 0.9,
    };
    const map = eventsMap();
    const manager = new ExportManager(map);
    manager.attachUI(null as unknown as HTMLElement, document.createElement("div"));
    return { manager, map };
  };

  it("showCropBox is a no-op while a crop box is already open", () => {
    const manager = makeManager();
    showCropBox(manager);
    const first = manager.cropState;

    showCropBox(manager);

    expect(manager.cropState).toBe(first);
    expect(manager.mapContainer.querySelectorAll(".foliplus-export-box")).toHaveLength(
      1,
    );
    expect(manager.map.keyboard.disable).toHaveBeenCalledTimes(1);
  });

  it("showCropBox refuses to open while another component holds the map", () => {
    const manager = makeManager();
    ensureModes(manager.map).setMode("MeasureControl", "distance");

    showCropBox(manager);

    expect(manager.cropState).toBeNull();
    expect(manager.mapContainer.querySelectorAll(".foliplus-export-box")).toHaveLength(
      0,
    );
    expect(manager.map.foliplus.showHint).toHaveBeenCalledWith(
      manager.config.name,
      manager.T("blocked_measure"),
      HINT_DURATION.SHORT,
    );
  });

  it("showCropBox re-opens the previous geo bounds from savedBounds", () => {
    const manager = makeManager();
    manager.savedBounds = { nw: { lat: 10, lng: 20 }, se: { lat: 100, lng: 200 } };

    showCropBox(manager);

    expect(manager.cropState!.rect).toEqual({
      left: 20,
      top: 10,
      width: 180,
      height: 90,
    });
    expect(manager.map.latLngToContainerPoint).toHaveBeenCalledWith({
      lat: 10,
      lng: 20,
    });
    expect(manager.map.latLngToContainerPoint).toHaveBeenCalledWith({
      lat: 100,
      lng: 200,
    });
  });

  it("showCropBox clamps a remembered screen rect back inside the map", () => {
    // Container is 500x400, so a rect remembered near the far corner has to be
    // pulled back to CROP.MIN_SIZE from the edge.
    const manager = makeManager();
    manager.lastScreenRect = { left: 480, top: 380, width: 300, height: 300 };

    showCropBox(manager);

    expect(manager.cropState!.rect).toEqual({
      left: 500 - CONST.CROP.MIN_SIZE,
      top: 400 - CONST.CROP.MIN_SIZE,
      width: CONST.CROP.MIN_SIZE,
      height: CONST.CROP.MIN_SIZE,
    });
  });

  it("showCropBox still opens when the control never got a toolbar", () => {
    const manager = new ExportManager(makeMapMock());

    showCropBox(manager);

    expect(manager.cropState).not.toBeNull();
    expect(manager.cropState!.actions).toBeNull();
    expect(manager.map.keyboard.disable).toHaveBeenCalledTimes(1);
  });

  it("lockCropBox no-ops without a crop box and when it is already locked", () => {
    const manager = makeManager();
    manager.lockCropBox();
    expect(manager.cropState).toBeNull();

    showCropBox(manager);
    manager.lockCropBox();
    expect(manager.map.keyboard.enable).toHaveBeenCalledTimes(1);
    const first = manager.cropState;

    manager.lockCropBox();

    expect(manager.cropState).toBe(first);
    expect(manager.map.keyboard.enable).toHaveBeenCalledTimes(1);
  });

  it("unlockCropBox no-ops while the box is still unlocked", () => {
    const manager = makeManager();
    showCropBox(manager);
    const first = manager.cropState;

    manager.unlockCropBox();

    expect(manager.cropState).toBe(first);
    expect(manager.cropState!.locked).toBe(false);
    expect(manager.map.keyboard.disable).toHaveBeenCalledTimes(1);
  });

  it("map move and zoom only re-anchor a locked crop box", () => {
    const { manager, map } = makeEventManager();
    manager.onMapChange = vi.fn();
    showCropBox(manager);
    manager.lockCropBox();
    (manager.onMapChange as any).mockClear();

    // Locked (geo-anchored): a map move re-projects the box, zoomend refreshes it.
    map.fire("move");
    flushRaf();
    expect(manager.onMapChange).toHaveBeenCalledWith(true);
    map.fire("zoomend");
    expect(manager.onMapChange).toHaveBeenLastCalledWith();

    // Unlocked: a stray map event must not move the box the user is still editing.
    manager.cropState!.locked = false;
    (manager.onMapChange as any).mockClear();
    map.fire("move");
    flushRaf();
    map.fire("zoomend");
    expect(manager.onMapChange).not.toHaveBeenCalled();

    // unlockCropBox drops the bindings, so late events stay inert.
    manager.unlockCropBox();
    map.fire("move");
    flushRaf();
    expect(manager.onMapChange).not.toHaveBeenCalled();
  });

  it("removeCropBox is idempotent and tolerates a partially torn-down state", () => {
    const manager = makeManager();
    removeCropBox(manager);
    expect(manager.cropState).toBeNull();

    manager.cropState = {
      overlay: document.createElement("div"),
      box: null as unknown as HTMLElement,
      rect: { left: 1, top: 2, width: 3, height: 4 },
      locked: false,
      actions: null as unknown as HTMLElement,
    } as CropState;
    manager.cropMousedownCleanup = vi.fn();

    expect(() => removeCropBox(manager)).not.toThrow();

    expect(manager.cropState).toBeNull();
    expect(manager.cropMousedownCleanup).not.toHaveBeenCalled();
    expect(manager.lastScreenRect).toEqual({ left: 1, top: 2, width: 3, height: 4 });
  });
});
