import * as CONST from "#foliplus/ExportControl/const.js";
import { ExportManager } from "#foliplus/ExportControl/manager.js";
import { removeCropBox, showCropBox } from "#foliplus/ExportControl/ui.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    on: vi.fn(),
    off: vi.fn(),
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
});
