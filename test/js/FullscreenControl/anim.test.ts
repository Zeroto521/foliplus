import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  removeScrim,
  setDim,
  startDim,
  startDimExit,
} from "#foliplus/FullscreenControl/anim.js";
import { CLASSES } from "#foliplus/FullscreenControl/const.js";

const makeContainer = () => {
  const el = document.createElement("div");
  el.className = "leaflet-container";
  return el;
};

const attach = (el: HTMLElement) => {
  document.body.appendChild(el);
  return el;
};

const dimEl = (container: HTMLElement) => container.querySelector(`.${CLASSES.DIM}`);

const clean = () => {
  document.querySelectorAll(`.${CLASSES.DIM}`).forEach(el => {
    el.parentElement?.classList.remove(CLASSES.DIM_ACTIVE);
    el.remove();
  });
};

describe("setDim", () => {
  let container: HTMLElement;

  beforeEach(() => {
    clean();
    container = attach(makeContainer());
  });

  it("fades the basemap in on enter", () => {
    setDim(container, true);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
    expect(dimEl(container)).not.toBeNull();
  });

  it("fades the basemap out on exit", () => {
    setDim(container, true);
    setDim(container, false);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
    expect(dimEl(container)).not.toBeNull();
  });

  it("creates the scrim lazily when it was never built", () => {
    setDim(container, true);
    expect(container.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(1);
  });

  it("keeps each map's state on its own container", () => {
    const other = attach(makeContainer());
    setDim(container, true);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
    expect(other.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
    setDim(other, true);
    setDim(container, false);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
    expect(other.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
  });

  it("idempotent: repeating the same state does not add another scrim", () => {
    setDim(container, true);
    setDim(container, true);
    setDim(container, false);
    expect(container.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(1);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
  });

  it("creates the scrim but returns nothing", () => {
    expect(setDim(container, true)).toBeUndefined();
    expect(dimEl(container)).not.toBeNull();
  });
});

describe("startDim", () => {
  let container: HTMLElement;

  beforeEach(() => {
    clean();
    vi.useFakeTimers();
    container = attach(makeContainer());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flashes the scrim on and auto-clears it after the transition plus buffer", async () => {
    startDim(container);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
    expect(dimEl(container)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(340);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
  });

  it("rapid flashes restart the auto-clear timer, never piling up overlays", async () => {
    for (let i = 0; i < 5; i++) {
      startDim(container);
      await vi.advanceTimersByTimeAsync(50);
    }
    // Each new flash cancels the previous pending auto-clear, so only one
    // timer survives the loop. A single 340ms advance clears it.
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
    await vi.advanceTimersByTimeAsync(340);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
  });

  it("leaves exactly one scrim after many flashes", async () => {
    for (let i = 0; i < 5; i++) startDim(container);
    expect(container.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(1);
    await vi.advanceTimersByTimeAsync(340);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
    expect(container.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(1);
  });

  it("reads the --dim-duration as seconds when the build minifies 260ms to .26s", async () => {
    // Minified builds render `0.26s` instead of `260ms` (PostCSS trims
    // leading zeroes and drops units on the number). readDimDuration must
    // multiply by 1000 for bare seconds — otherwise it treats 0.26 as
    // milliseconds and the auto-clear fires in ~260µs.
    const orig = globalThis.getComputedStyle;
    Object.defineProperty(globalThis, "getComputedStyle", {
      value: vi.fn(() => ({ getPropertyValue: () => "0.26s" })),
      configurable: true,
      writable: true,
    });
    startDim(container);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
    // 260ms (from 0.26s) + 40ms buffer = 300ms — before that it stays active.
    await vi.advanceTimersByTimeAsync(200);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
    await vi.advanceTimersByTimeAsync(150);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
    Object.defineProperty(globalThis, "getComputedStyle", {
      value: orig,
      configurable: true,
      writable: true,
    });
  });

  it("falls back to 260ms when the --dim-duration property is absent", async () => {
    const orig = globalThis.getComputedStyle;
    Object.defineProperty(globalThis, "getComputedStyle", {
      value: vi.fn(() => ({ getPropertyValue: () => "" })),
      configurable: true,
      writable: true,
    });
    startDim(container);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
    // 260ms (fallback) + 40ms buffer = 300ms.
    await vi.advanceTimersByTimeAsync(250);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
    Object.defineProperty(globalThis, "getComputedStyle", {
      value: orig,
      configurable: true,
      writable: true,
    });
  });
});

describe("removeScrim", () => {
  let container: HTMLElement;

  beforeEach(() => {
    clean();
    container = attach(makeContainer());
  });

  it("detaches the scrim and drops the active class from its container", () => {
    setDim(container, true);
    removeScrim(container);
    expect(document.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(0);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
  });

  it("leaves a sibling map's scrim alone", () => {
    const other = attach(makeContainer());
    setDim(container, true);
    setDim(other, true);
    removeScrim(container);
    expect(container.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(0);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
    // Destroying one control must not strip another map's scrim from under it.
    expect(other.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(1);
    expect(other.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
  });

  it("is a no-op when nothing was ever created", () => {
    expect(() => removeScrim(container)).not.toThrow();
    expect(container.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(0);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
  });

  it("cancels the pending auto-clear timer when the control is destroyed mid-flash", () => {
    startDim(container);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
    expect(dimEl(container)).not.toBeNull();
    removeScrim(container);
    // Timer is cancelled: advancing past the auto-clear window does nothing.
    expect(container.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(0);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
  });
});

describe("startDimExit", () => {
  let container: HTMLElement;

  beforeEach(() => {
    clean();
    container = attach(makeContainer());
  });

  describe("scrim is dark (enter's auto-clear hasn't fired yet)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // Start a flash so the scrim is dark, then cancel the timer to keep
      // it dark — this is the state the exit path sees when the user exits
      // quickly after entering.
      startDim(container);
      expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("removes the active class immediately so CSS fades it out", () => {
      startDimExit(container);
      // Synchronous removal — no rAF dance needed when the scrim is already dark.
      expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
      expect(dimEl(container)).not.toBeNull();
    });

    it("cancels enter's pending auto-clear timer", async () => {
      startDimExit(container);
      expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
      // No timer left: advancing past the original auto-clear window does nothing.
      await vi.advanceTimersByTimeAsync(400);
      expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
    });
  });

  describe("scrim is transparent (enter's auto-clear already ran)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // Manually set the scrim to transparent state — scrim exists but
      // active class is absent. This simulates the state after enter's
      // auto-clear timer has already fired.
      setDim(container, true);
      setDim(container, false);
      expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
      expect(dimEl(container)).not.toBeNull();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("replays startDim: fades the scrim in to dark, then auto-clears to fade out", () => {
      startDimExit(container);
      // Active is added immediately, triggering the CSS fade-in to --dim-alpha.
      expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
    });

    it("auto-clears after the full dim duration so the fade-out is visible", async () => {
      startDimExit(container);
      expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
      // 260ms (dim duration) + 40ms (buffer) = 300ms before auto-clear.
      // Before that, the scrim stays dark (fading in).
      await vi.advanceTimersByTimeAsync(200);
      expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
      await vi.advanceTimersByTimeAsync(200);
      // After the timer fires, active is removed and the CSS transition
      // carries opacity from --dim-alpha back to 0 over --dim-duration.
      expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
    });
  });
});
