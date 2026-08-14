import {
  getFullscreenEl,
  isEnabled,
  nativeAPI,
} from "#foliplus/FullscreenControl/api.js";
import {
  CLASSES,
  containerId,
} from "#foliplus/FullscreenControl/const.js";
import { describe, expect, it } from "vitest";

describe("const.js", () => {
  it("CLASSES has expected keys", () => {
    expect(CLASSES.PSEUDO_FULLSCREEN).toBe("leaflet-pseudo-fullscreen");
    expect(CLASSES.TOOL_BTN).toBe("foliplus-tool-btn");
    expect(CLASSES.ZOOM_IN).toBe("foliplus-zoom-in");
    expect(CLASSES.ZOOM_OUT).toBe("foliplus-zoom-out");
    expect(CLASSES.TOGGLE).toBe("foliplus-fullscreen-toggle");
    expect(CLASSES.HIDDEN).toBe("foliplus-hidden");
  });

  it("containerId formats correctly", () => {
    expect(containerId("FullscreenControl", "topleft")).toBe(
      "FullscreenControl_topleft_container",
    );
    expect(containerId("Test", "bottomright")).toBe("Test_bottomright_container");
  });
});

describe("api.js (jsdom — no native Fullscreen API)", () => {
  it("nativeAPI is null when no fullscreen support", () => {
    expect(nativeAPI).toBeNull();
  });

  it("isEnabled is false", () => {
    // nativeAPI is null, so null && ... evaluates to null
    expect(isEnabled).toBeNull();
  });

  it("getFullscreenEl returns null", () => {
    expect(getFullscreenEl()).toBe(null);
  });
});
