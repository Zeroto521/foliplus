import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PSEUDO_FULLSCREEN_CLASS, fullscreenSurface } from "#core/fullscreen.js";

// jsdom ships no real Fullscreen API — stub the document property per test.
// configurable: true lets each stub replace the previous one.
const stubFullscreenElement = (el: Element | null) => {
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => el,
  });
};

describe("fullscreenSurface", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    stubFullscreenElement(null);
  });

  afterEach(() => {
    stubFullscreenElement(null);
    document.body.innerHTML = "";
  });

  it("returns <body> when no surface is active", () => {
    expect(fullscreenSurface()).toBe(document.body);
  });

  it("returns the native fullscreen element", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    stubFullscreenElement(el);
    expect(fullscreenSurface()).toBe(el);
  });

  it("normalizes a documentElement fullscreen to <body>", () => {
    // Appending to <html> is equivalent to <body> (its parent), and overlays
    // position against the body — so the root element is normalized away.
    stubFullscreenElement(document.documentElement);
    expect(fullscreenSurface()).toBe(document.body);
  });

  it("falls back to the pseudo-fullscreen container when native is off", () => {
    const pseudo = document.createElement("div");
    pseudo.className = `leaflet-container ${PSEUDO_FULLSCREEN_CLASS}`;
    document.body.appendChild(pseudo);
    expect(fullscreenSurface()).toBe(pseudo);
  });

  it("prefers the native fullscreen element over a pseudo container", () => {
    const pseudo = document.createElement("div");
    pseudo.className = PSEUDO_FULLSCREEN_CLASS;
    document.body.appendChild(pseudo);
    const native = document.createElement("div");
    document.body.appendChild(native);
    stubFullscreenElement(native);
    expect(fullscreenSurface()).toBe(native);
  });
});

describe("PSEUDO_FULLSCREEN_CLASS", () => {
  it("is the class FullscreenControl.css styles as the pseudo surface", () => {
    expect(PSEUDO_FULLSCREEN_CLASS).toBe("leaflet-pseudo-fullscreen");
  });
});
