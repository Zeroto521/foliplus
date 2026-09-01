import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureScrim, removeScrim, setDim, startDim } from "#foliplus/FullscreenControl/anim.js";
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

describe("ensureScrim", () => {
  let container: HTMLElement;

  beforeEach(() => {
    clean();
    container = attach(makeContainer());
  });

  it("creates the scrim once as a child of the map container", () => {
    expect(ensureScrim(container)).not.toBeNull();
    const scrim = dimEl(container);
    expect(scrim).not.toBeNull();
    expect(scrim.parentElement).toBe(container);
    // Mounted inside the container rather than directly on body: in native
    // fullscreen the user agent paints only the fullscreen element and its
    // descendants, so a body-mounted scrim would never paint at all.
    expect(Array.from(document.body.children)).not.toContain(scrim);
    expect(container.lastElementChild).toBe(scrim);
  });

  it("returns null on subsequent calls and creates no duplicate", () => {
    expect(ensureScrim(container)).not.toBeNull();
    expect(ensureScrim(container)).toBeNull();
    expect(ensureScrim(container)).toBeNull();
    expect(container.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(1);
  });

  it("does not reuse an element from a different map's container", () => {
    const other = attach(makeContainer());
    const foreign = document.createElement("div");
    foreign.className = CLASSES.DIM;
    other.appendChild(foreign);
    expect(ensureScrim(container)).not.toBeNull();
    expect(container.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(1);
    expect(dimEl(container)).not.toBe(foreign);
  });

  it("does not reuse a scrim mounted outside the container", () => {
    const foreign = document.createElement("div");
    foreign.className = CLASSES.DIM;
    document.body.appendChild(foreign);
    expect(ensureScrim(container)).not.toBeNull();
    expect(dimEl(container)).not.toBe(foreign);
  });
});

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
});