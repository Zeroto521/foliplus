import { describe, expect, it, vi } from "vitest";
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

  it("dims the basemap on activate", () => {
    setDim(container, true);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
    expect(dimEl(container)).not.toBeNull();
  });

  it("undims the basemap on deactivate", () => {
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
    container = attach(makeContainer());
  });

  it("dims the basemap and keeps it dimmed (no auto-clear)", () => {
    startDim(container);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
    expect(dimEl(container)).not.toBeNull();
    // Scrim stays dimmed — there is no timer that auto-clears it.
    // State is only cleared by startDimExit or setDim(false).
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
  });

  it("idempotent: repeating startDim does not add another scrim", () => {
    startDim(container);
    startDim(container);
    startDim(container);
    expect(container.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(1);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
  });

  it("keeps each map's state on its own container", () => {
    const other = attach(makeContainer());
    startDim(container);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
    expect(other.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
    startDim(other);
    startDimExit(container);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
    expect(other.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
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

describe("startDimExit", () => {
  let container: HTMLElement;

  beforeEach(() => {
    clean();
    container = attach(makeContainer());
  });

  it("removes the active class so CSS fades the scrim out", () => {
    startDim(container);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
    startDimExit(container);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
    expect(dimEl(container)).not.toBeNull();
  });

  it("is safe when the scrim was never activated", () => {
    // Simulate the scrim existing but the active class absent.
    setDim(container, true);
    setDim(container, false);
    startDimExit(container);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
    expect(dimEl(container)).not.toBeNull();
  });

  it("creates the scrim lazily if it was never built", () => {
    startDimExit(container);
    expect(dimEl(container)).not.toBeNull();
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
  });
});
