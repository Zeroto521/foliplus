import { beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/ExportControl/const.js";
import { ExportManager } from "#foliplus/ExportControl/manager.js";
import { removeCropBox, showCropBox } from "#foliplus/ExportControl/ui.js";

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
