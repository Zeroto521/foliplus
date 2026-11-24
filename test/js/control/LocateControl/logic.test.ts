import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureModes } from "#core/lifecycle/index.js";
import { CLASSES } from "#control/LocateControl/const.js";
import { locateMe } from "#control/LocateControl/logic.js";

vi.mock("#platform/locale.js", () => ({
  createTranslator: () => (k: string) => k,
  createScopedTranslator: () => (k: string) => k,
}));

/** Fake control — a real button so classList behaves like the DOM. `T`, `_`
 *  and `config` mirror what defineControl hands off to the control instance;
 *  `signal` is the mounting's AbortSignal, absent on the plain logic path. */
const makeCtrl = (signal?: AbortSignal) => {
  const btn = document.createElement("button");
  const T = (k: string) => k;
  const config = {
    name: "LocateControl",
    zoom: 16,
  } as ComponentConfig;
  return {
    btn,
    marker: null,
    delIcon: null,
    T,
    _: T,
    config,
    ...(signal ? { signal } : {}),
    hasLoading: () => btn.classList.contains("loading"),
  };
};

beforeEach(() => {
  window.CONFIG = { ...window.CONFIG, name: "LocateControl", zoom: 16 };
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

  it("falls back to the default zoom of 15 when config.zoom is not set", () => {
    const getCurrentPosition = geoStub();
    const ctrl = makeCtrl();
    ctrl.config = { ...ctrl.config, zoom: undefined } as ComponentConfig;

    locateMe(ctrl);
    getCurrentPosition.mock.calls[0][0]({
      coords: { longitude: 119.3, latitude: 26.08 },
    });

    expect(map.flyTo).toHaveBeenCalledWith([26.08, 119.3], 15);
  });

  it("drops a success that arrives after the mounting was torn down", () => {
    const getCurrentPosition = geoStub();
    const ac = new AbortController();
    const ctrl = makeCtrl(ac.signal);

    locateMe(ctrl);
    ac.abort();
    const [success] = getCurrentPosition.mock.calls[0];

    success({ coords: { longitude: 119.3, latitude: 26.08 } });
    expect(map.flyTo, "a removed control must not move its map").not.toHaveBeenCalled();
    expect(ctrl.marker, "a late callback must not pin an ownerless marker").toBeNull();
  });

  it("does not report a geolocation error for a mounting that is gone", () => {
    const getCurrentPosition = geoStub();
    const ac = new AbortController();
    const ctrl = makeCtrl(ac.signal);

    locateMe(ctrl);
    ac.abort();
    getCurrentPosition.mock.calls[0][1](new Error("permission denied"));

    expect(window.map.foliplus.showHint).not.toHaveBeenCalledWith(
      "LocateControl",
      "geo_error",
      expect.anything(),
    );
  });

  it("clicking the ✕ removes the pin and its delete icon", () => {
    const getCurrentPosition = geoStub();
    const ctrl: any = makeCtrl();

    locateMe(ctrl);
    getCurrentPosition.mock.calls[0][0]({
      coords: { longitude: 119.3, latitude: 26.08 },
    });

    const marker = ctrl.marker;
    const delIcon = ctrl.delIcon;
    expect(delIcon).not.toBeNull();

    const delClick = delIcon.on.mock.calls.find((c: any) => c[0] === "click")?.[1];
    expect(delClick).toBeDefined();
    const x = document.createElement("span");
    x.setAttribute("data-del-icon", "");
    delClick({ originalEvent: { target: x } });

    expect(map.removeLayer).toHaveBeenCalledWith(marker);
    expect(map.removeLayer).toHaveBeenCalledWith(delIcon);
    expect(ctrl.marker).toBeNull();
    expect(ctrl.delIcon).toBeNull();
  });

  it("locating hint is plain text, not an inline SVG string", () => {
    geoStub();
    const ctrl = makeCtrl();
    locateMe(ctrl);
    expect(window.map.foliplus.showHint).toHaveBeenCalledWith(
      "LocateControl",
      "locating",
      0, // HINT_DURATION.PERSIST
      undefined,
      undefined,
      true,
    );
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

describe("LocateControl shell class vocabulary", () => {
  it("declares the locate button token with its exact value", () => {
    expect(CLASSES.LOCATE_BTN).toBe("foliplus-locate-btn");
  });
});
