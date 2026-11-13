import { describe, expect, it } from "vitest";
import { PANEL_CLASS } from "#ui/panelClassName.js";
import { CLASSES, containerId } from "#control/FullscreenControl/const.js";

describe("CLASSES", () => {
  it("defines CSS class constants", () => {
    expect(CLASSES.PSEUDO_FULLSCREEN).toBe("leaflet-pseudo-fullscreen");
    expect(CLASSES.TOOL_BTN).toBe("foliplus-tool-btn");
    expect(CLASSES.TOGGLE).toBe("foliplus-fullscreen-toggle");
    // foliplus-hidden is the shared panel vocabulary's, not a component key.
    expect((CLASSES as Record<string, unknown>).HIDDEN).toBeUndefined();
    expect(PANEL_CLASS.HIDDEN).toBe("foliplus-hidden");
  });
});

describe("containerId", () => {
  it("builds a container id from name and position", () => {
    expect(containerId("FullscreenControl", "topleft")).toBe(
      "FullscreenControl_topleft_container",
    );
  });
});
