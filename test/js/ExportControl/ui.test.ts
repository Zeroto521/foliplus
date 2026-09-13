import { beforeEach, describe, expect, it, vi } from "vitest";
import { HINT_DURATION } from "#core/hint.js";
import * as CONST from "#foliplus/ExportControl/const.js";
import { ExportManager } from "#foliplus/ExportControl/manager.js";
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
  container.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 500,
    height: 400,
    right: 500,
    bottom: 400,
  });
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
  window.CONF = {
    ...window.CONF,
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
  manager.attachUI(null, toolBar);
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
  let manager;

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

describe("ExportControl ui — hints and toolbar via the injected conf", () => {
  /** Swap the manager's conf/T so hint text provably comes from the injection. */
  const inject = (manager: ExportManager, overrides: Partial<ComponentConfig> = {}) => {
    manager.conf = {
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
    manager.T = createScopedTranslator(manager.conf);
    return manager;
  };

  it("showGlobalHint uses the injected conf name", () => {
    const manager = inject(makeManager());
    manager.showGlobalHint("working");
    expect(manager.map.foliplus.showHint).toHaveBeenCalledWith(
      "ExportControl",
      "working",
      HINT_DURATION.PERSIST,
      undefined,
      undefined,
      false,
    );
  });

  it("size hint text comes from the injected conf, not from window.CONF", () => {
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

  it("pixel-limit hint formats the conf max_pixels when the crop overflows", () => {
    const manager = inject(makeManager());
    // checkPixelLimit reads the ambient manager CONF — the hint text itself
    // still comes from the injected table above.
    window.CONF = { ...window.CONF, max_pixels: 100 };
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
    expect(texts.some(t => t.includes("hint_locked"))).toBe(false);
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
