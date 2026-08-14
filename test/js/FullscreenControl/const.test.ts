import { CLASSES, containerId } from "#foliplus/FullscreenControl/const.js";
import { describe, expect, it } from "vitest";

describe("CLASSES", () => {
  it("defines CSS class constants", () => {
    expect(CLASSES.PSEUDO_FULLSCREEN).toBe("leaflet-pseudo-fullscreen");
    expect(CLASSES.TOOL_BTN).toBe("foliplus-tool-btn");
    expect(CLASSES.TOGGLE).toBe("foliplus-fullscreen-toggle");
    expect(CLASSES.HIDDEN).toBe("foliplus-hidden");
  });
});

describe("containerId", () => {
  it("builds a container id from name and position", () => {
    expect(containerId("FullscreenControl", "topleft")).toBe(
      "FullscreenControl_topleft_container",
    );
  });
});
