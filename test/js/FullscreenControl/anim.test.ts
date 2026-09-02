import { describe, expect, it, vi } from "vitest";
import { flashScrim, removeScrim } from "#foliplus/FullscreenControl/anim.js";
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

describe("flashScrim", () => {
  let container: HTMLElement;

  beforeEach(() => {
    clean();
    container = attach(makeContainer());
  });

  it("dims the basemap immediately and keeps it dimmed during the fade-in window", () => {
    flashScrim(container);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
    expect(dimEl(container)).not.toBeNull();
  });

  it("auto-fades out after the fade-in window and detaches after fade-out", async () => {
    vi.useFakeTimers();
    flashScrim(container);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);

    // Fade-in window (180ms) elapses — the active class is removed so CSS
    // carries opacity 1 → 0.
    await vi.advanceTimersByTimeAsync(180);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
    expect(dimEl(container)).not.toBeNull(); // still present during fade-out

    // Fade-out window (180ms) elapses — the scrim is detached.
    await vi.advanceTimersByTimeAsync(180);
    expect(dimEl(container)).toBeNull();
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);

    vi.useRealTimers();
  });

  it("creates the scrim lazily when it was never built", () => {
    flashScrim(container);
    expect(container.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(1);
  });

  it("does not add a second scrim element on a rapid second flash", () => {
    flashScrim(container);
    flashScrim(container);
    expect(container.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(1);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
  });

  it("re-schedules the auto-clear so a rapid second flash is not cut short", async () => {
    vi.useFakeTimers();

    flashScrim(container);
    await vi.advanceTimersByTimeAsync(170); // 10ms before first clear

    // A second flash at 170ms: its clear should fire at 170 + 180 = 350,
    // not at the original 180.
    flashScrim(container);
    await vi.advanceTimersByTimeAsync(20); // now at 190 — old clear would have fired

    // Still dimmed — the re-scheduled clear pushed the fade-out to 350ms.
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
    expect(dimEl(container)).not.toBeNull();

    vi.useRealTimers();
  });

  it("keeps each map's state on its own container", () => {
    const other = attach(makeContainer());
    flashScrim(container);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
    expect(other.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
    flashScrim(other);
    expect(other.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
    expect(other.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(1);
    expect(container.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(1);
  });

  it("creates the scrim but returns nothing", () => {
    expect(flashScrim(container)).toBeUndefined();
    expect(dimEl(container)).not.toBeNull();
  });
});

describe("removeScrim", () => {
  let container: HTMLElement;

  beforeEach(() => {
    clean();
    container = attach(makeContainer());
  });

  it("detaches the scrim and drops the active class from its container", () => {
    flashScrim(container);
    removeScrim(container);
    expect(document.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(0);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
  });

  it("leaves a sibling map's scrim alone", () => {
    const other = attach(makeContainer());
    flashScrim(container);
    flashScrim(other);
    removeScrim(container);
    expect(container.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(0);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
    expect(other.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(1);
    expect(other.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
  });

  it("is a no-op when nothing was ever created", () => {
    expect(() => removeScrim(container)).not.toThrow();
    expect(container.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(0);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
  });
});
