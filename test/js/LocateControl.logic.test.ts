import { locateMe } from "#foliplus/LocateControl/LocateControl.logic.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The module captures window.foliplus / window.map / window.CONF from setup.js.
// Reassigning window.CONF in beforeEach works because CONF resolves to the live
// global at call time.
beforeEach(() => {
  vi.clearAllMocks();
  window.CONF = { ...window.CONF, name: "LocateControl", zoom: 16 };
});

describe("locateMe", () => {
  const originalGeo = navigator.geolocation;

  afterEach(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: originalGeo,
      configurable: true,
    });
  });

  it("shows an error hint when geolocation is unsupported", () => {
    Object.defineProperty(navigator, "geolocation", {
      value: undefined,
      configurable: true,
    });
    const ctrl = { marker: null };
    locateMe(ctrl);
    expect(foliplus.showHint).toHaveBeenCalledWith(
      "LocateControl",
      "LocateControl.geo_error",
      4000,
    );
  });

  it("flies to the browser position on success", () => {
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition },
      configurable: true,
    });
    const ctrl = { marker: null };

    locateMe(ctrl);
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    const [success, , options] = getCurrentPosition.mock.calls[0];
    expect(options.timeout).toBe(10000);

    success({ coords: { longitude: 119.3, latitude: 26.08 } });
    expect(foliplus.hideHint).toHaveBeenCalledWith("LocateControl");
    expect(map.flyTo).toHaveBeenCalledWith([26.08, 119.3], 16);
    expect(ctrl.marker).not.toBeNull();
  });

  it("shows an error hint when geolocation fails", () => {
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition },
      configurable: true,
    });
    const ctrl = { marker: null };

    locateMe(ctrl);
    const [, error] = getCurrentPosition.mock.calls[0];
    error({ code: 1, message: "Permission denied" });
    expect(foliplus.hideHint).toHaveBeenCalledWith("LocateControl");
    expect(foliplus.showHint).toHaveBeenCalledWith(
      "LocateControl",
      "LocateControl.geo_error",
      4000,
    );
  });
});
