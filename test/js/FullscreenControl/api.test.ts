import { beforeEach, describe, expect, it } from "vitest";
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
  // jsdom implements no Fullscreen API at all: neither property exists on
  // Document.prototype, so "the browser lacks the API" *is* the ambient state.
  // A test that installs one must not leak it, or the next test's
  // `"fullscreenEnabled" in document` guard would see its predecessor's mock.
  // The cast exists because tsc rejects `delete document.x` on a non-optional
  // member; keeping it here means no test needs it.
  beforeEach(() => {
    const doc = document as unknown as Record<string, unknown>;
    delete doc.fullscreenEnabled;
    delete doc.fullscreenElement;
  });

  it("FULLSCREEN_CHANGE is the standard event name", () => {
    expect(FULLSCREEN_CHANGE).toBe("fullscreenchange");
  });

  it("isEnabled is false when fullscreenEnabled is unavailable", () => {
    expect(isEnabled()).toBe(false);
  });

  it("isEnabled is true when the browser reports fullscreenEnabled", () => {
    Object.defineProperty(document, "fullscreenEnabled", {
      value: true,
      configurable: true,
    });
    expect(isEnabled()).toBe(true);
  });

  it("isEnabled is false when the flag exists but is false (late downgrade)", () => {
    Object.defineProperty(document, "fullscreenEnabled", {
      value: false,
      configurable: true,
    });
    expect(isEnabled()).toBe(false);
  });

  it("isEnabled re-reads the flag on every call, not once at module load", () => {
    // The bug this PR fixes: `Boolean(document.fullscreenEnabled)` captured
    // the answer at import time, so a flag that flipped later (iframe policy,
    // embedder restrictions) pinned the pseudo path for every later toggle.
    expect(isEnabled()).toBe(false);
    Object.defineProperty(document, "fullscreenEnabled", {
      value: true,
      configurable: true,
    });
    expect(isEnabled()).toBe(true);
  });

  it("getFullscreenEl returns null when fullscreenElement is unavailable", () => {
    expect(getFullscreenEl()).toBe(null);
  });

  it("getFullscreenEl returns the element the browser reports", () => {
    const el = document.createElement("div");
    Object.defineProperty(document, "fullscreenElement", {
      value: el,
      configurable: true,
    });
    expect(getFullscreenEl()).toBe(el);
  });
});
