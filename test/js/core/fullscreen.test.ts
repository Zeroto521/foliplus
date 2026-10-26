import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PSEUDO_FULLSCREEN_CLASS,
  announceFullscreenSurface,
  fullscreenSurface,
  onFullscreenSurfaceChange,
  setPseudoFullscreen,
} from "#core/fullscreen.js";

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

  it("scopes the pseudo lookup to the caller's map container", () => {
    // Two maps in pseudo mode: an overlay for map B must not be written into
    // map A's container, even though A comes first in document order.
    const mapA = document.createElement("div");
    mapA.className = `leaflet-container ${PSEUDO_FULLSCREEN_CLASS}`;
    const mapB = document.createElement("div");
    mapB.className = `leaflet-container ${PSEUDO_FULLSCREEN_CLASS}`;
    document.body.append(mapA, mapB);

    expect(fullscreenSurface(mapB)).toBe(mapB);
  });

  it("does not borrow a sibling map's pseudo surface for a scoped caller", () => {
    const mapA = document.createElement("div");
    mapA.className = `leaflet-container ${PSEUDO_FULLSCREEN_CLASS}`;
    const mapB = document.createElement("div");
    mapB.className = "leaflet-container";
    document.body.append(mapA, mapB);

    // B is not fullscreen: its overlays belong to <body>, not to A.
    expect(fullscreenSurface(mapB)).toBe(document.body);
  });

  it("ignores a native fullscreen element unrelated to the scope", () => {
    const other = document.createElement("div");
    const map = document.createElement("div");
    document.body.append(other, map);
    stubFullscreenElement(other);

    expect(fullscreenSurface(map)).toBe(document.body);
    expect(fullscreenSurface(other)).toBe(other);
  });

  it("resolves a pseudo ancestor of the scope (nested control container)", () => {
    const map = document.createElement("div");
    map.className = `leaflet-container ${PSEUDO_FULLSCREEN_CLASS}`;
    const panel = document.createElement("div");
    map.appendChild(panel);
    document.body.appendChild(map);

    expect(fullscreenSurface(panel)).toBe(map);
  });
});

describe("surface notifications", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    stubFullscreenElement(null);
  });

  afterEach(() => {
    stubFullscreenElement(null);
    document.body.innerHTML = "";
  });

  it("notifies subscribers on native fullscreenchange", () => {
    const listener = vi.fn();
    const detach = onFullscreenSurfaceChange(listener);
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(listener).toHaveBeenCalledTimes(1);
    detach();
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const detach = onFullscreenSurfaceChange(listener);
    detach();
    document.dispatchEvent(new Event("fullscreenchange"));
    announceFullscreenSurface();
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps a throwing subscriber from blocking the others", () => {
    const healthy = vi.fn();
    const detachBad = onFullscreenSurfaceChange(() => {
      throw new Error("broken overlay");
    });
    const detachGood = onFullscreenSurfaceChange(healthy);

    expect(() => announceFullscreenSurface()).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(1);

    detachBad();
    detachGood();
  });
});

describe("setPseudoFullscreen", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("toggles the class and announces the new surface", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const listener = vi.fn();
    const detach = onFullscreenSurfaceChange(listener);

    setPseudoFullscreen(container, true);
    expect(container.classList.contains(PSEUDO_FULLSCREEN_CLASS)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    setPseudoFullscreen(container, true); // already active — no announcement
    expect(listener).toHaveBeenCalledTimes(1);

    setPseudoFullscreen(container, false);
    expect(container.classList.contains(PSEUDO_FULLSCREEN_CLASS)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);

    detach();
  });

  it("leaves other containers' classes untouched", () => {
    const a = document.createElement("div");
    const b = document.createElement("div");
    document.body.append(a, b);

    setPseudoFullscreen(a, true);
    setPseudoFullscreen(b, true);
    setPseudoFullscreen(a, false);

    expect(a.classList.contains(PSEUDO_FULLSCREEN_CLASS)).toBe(false);
    expect(b.classList.contains(PSEUDO_FULLSCREEN_CLASS)).toBe(true);
  });
});

describe("PSEUDO_FULLSCREEN_CLASS", () => {
  it("is the class FullscreenControl.css styles as the pseudo surface", () => {
    expect(PSEUDO_FULLSCREEN_CLASS).toBe("leaflet-pseudo-fullscreen");
  });
});
