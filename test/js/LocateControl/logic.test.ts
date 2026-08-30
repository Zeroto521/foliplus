import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { locateMe, setLocating } from "#foliplus/LocateControl/logic.js";
import { ensureModes } from "#foliplus/core/mode.js";

vi.mock("#common/locale.js", () => ({
  createTranslator: () => (k: string) => k,
  createScopedTranslator: () => (k: string) => k,
}));

/** Fake control — a real button so classList behaves like the DOM. */
const makeCtrl = () => {
  const btn = document.createElement("button");
  return {
    btn,
    marker: null,
    delIcon: null,
    hasLoading: () => btn.classList.contains("loading"),
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  window.CONF = { ...window.CONF, name: "LocateControl", zoom: 16 };
  // placeMarker attaches popup/del-icon handlers via `.on` on both markers.
  window.L.marker = vi.fn(() => ({
    bindPopup: vi.fn(),
    openPopup: vi.fn(),
    addTo: vi.fn(),
    getPopup: () => null,
    on: vi.fn(),
  }));
});

describe("setLocating", () => {
  it("toggles the loading class on the button container", () => {
    const ctrl = makeCtrl();
    expect(ctrl.hasLoading()).toBe(false);
    setLocating(ctrl, true);
    expect(ctrl.hasLoading()).toBe(true);
    setLocating(ctrl, false);
    expect(ctrl.hasLoading()).toBe(false);
  });

  it("is idempotent when the same state is set twice", () => {
    const ctrl = makeCtrl();
    setLocating(ctrl, true);
    setLocating(ctrl, true);
    expect(ctrl.hasLoading()).toBe(true);
  });
});

describe("locateMe", () => {
  const originalGeo = navigator.geolocation;

  afterEach(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: originalGeo,
      configurable: true,
    });
  });

  const geoStub = () => {
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition },
      configurable: true,
    });
    return getCurrentPosition;
  };

  it("is blocked by MeasureControl active mode without entering loading", () => {
    ensureModes(window.map).setMode("MeasureControl", "distance");
    const getCurrentPosition = geoStub();
    const ctrl = makeCtrl();
    locateMe(ctrl);
    ensureModes(window.map).setMode("MeasureControl", null);
    expect(ctrl.hasLoading()).toBe(false);
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("shows an error hint without entering loading when geolocation is unsupported", () => {
    Object.defineProperty(navigator, "geolocation", {
      value: undefined,
      configurable: true,
    });
    const ctrl = makeCtrl();
    locateMe(ctrl);
    expect(window.map.foliplus.showHint).toHaveBeenCalledWith(
      "LocateControl",
      "geo_error",
      4000,
    );
    expect(ctrl.hasLoading()).toBe(false);
  });

  it("flies to the browser position on success and clears loading", () => {
    const getCurrentPosition = geoStub();
    const ctrl = makeCtrl();

    locateMe(ctrl);
    expect(ctrl.hasLoading()).toBe(true);
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    const [success] = getCurrentPosition.mock.calls[0];

    success({ coords: { longitude: 119.3, latitude: 26.08 } });
    expect(ctrl.hasLoading()).toBe(false);
    expect(window.map.foliplus.hideHint).toHaveBeenCalledWith("LocateControl");
    expect(map.flyTo).toHaveBeenCalledWith([26.08, 119.3], 16);
    expect(ctrl.marker).not.toBeNull();
  });

  it("shows an error hint when geolocation fails and clears loading", () => {
    const getCurrentPosition = geoStub();
    const ctrl = makeCtrl();

    locateMe(ctrl);
    const [, error] = getCurrentPosition.mock.calls[0];
    error({ code: 1, message: "Permission denied" });
    expect(ctrl.hasLoading()).toBe(false);
    expect(window.map.foliplus.hideHint).toHaveBeenCalledWith("LocateControl");
    expect(window.map.foliplus.showHint).toHaveBeenCalledWith(
      "LocateControl",
      "geo_error",
      4000,
    );
  });

  it("keeps loading while geolocation is still pending", () => {
    const getCurrentPosition = geoStub();
    const ctrl = makeCtrl();
    locateMe(ctrl);
    expect(ctrl.hasLoading()).toBe(true);
    expect(getCurrentPosition.mock.calls[0]).toHaveLength(2);
  });

  it("does not place a marker when geolocation fails", () => {
    const getCurrentPosition = geoStub();
    const ctrl = makeCtrl();

    locateMe(ctrl);
    const [, error] = getCurrentPosition.mock.calls[0];
    error({ code: 1, message: "Permission denied" });
    expect(ctrl.marker).toBeNull();
    expect(ctrl.delIcon).toBeNull();
  });
});
