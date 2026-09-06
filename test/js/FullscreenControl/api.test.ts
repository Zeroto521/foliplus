import { describe, expect, it } from "vitest";
import {
  FULLSCREEN_CHANGE,
  getFullscreenEl,
  isEnabled,
} from "#foliplus/FullscreenControl/api.js";
import { CLASSES, containerId } from "#foliplus/FullscreenControl/const.js";

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
  it("FULLSCREEN_CHANGE is the standard event name", () => {
    expect(FULLSCREEN_CHANGE).toBe("fullscreenchange");
  });

  it("isEnabled is false when fullscreenEnabled is unavailable", () => {
    expect(isEnabled).toBe(false);
  });

  it("getFullscreenEl returns null when fullscreenElement is unavailable", () => {
    expect(getFullscreenEl()).toBe(null);
  });
});
