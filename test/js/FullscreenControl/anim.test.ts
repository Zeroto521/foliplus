import { beforeEach, describe, expect, it } from "vitest";
import { ensureMask, removeMask, setDim } from "#foliplus/FullscreenControl/anim.js";
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

describe("ensureMask", () => {
  let container: HTMLElement;

  beforeEach(() => {
    clean();
    container = attach(makeContainer());
  });

  it("creates the scrim once as a child of the map container", () => {
    expect(ensureMask(container)).not.toBeNull();
    const mask = dimEl(container);
    expect(mask).not.toBeNull();
    expect(mask.parentElement).toBe(container);
    // Mounted inside the container rather than directly on body: in native
    // fullscreen the user agent paints only the fullscreen element and its
    // descendants, so a body-mounted scrim would never paint at all.
    expect(Array.from(document.body.children)).not.toContain(mask);
    expect(container.lastElementChild).toBe(mask);
  });

  it("returns null on subsequent calls and creates no duplicate", () => {
    expect(ensureMask(container)).not.toBeNull();
    expect(ensureMask(container)).toBeNull();
    expect(ensureMask(container)).toBeNull();
    expect(container.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(1);
  });

  it("does not reuse an element from a different map's container", () => {
    const other = attach(makeContainer());
    const foreign = document.createElement("div");
    foreign.className = CLASSES.DIM;
    other.appendChild(foreign);
    expect(ensureMask(container)).not.toBeNull();
    expect(container.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(1);
    expect(dimEl(container)).not.toBe(foreign);
  });

  it("does not reuse a scrim mounted outside the container", () => {
    const foreign = document.createElement("div");
    foreign.className = CLASSES.DIM;
    document.body.appendChild(foreign);
    expect(ensureMask(container)).not.toBeNull();
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

  it("returns the mask it created, null when it already exists", () => {
    const created = setDim(container, true);
    expect(created).toBe(dimEl(container));
    expect(setDim(container, false)).toBeNull();
    expect(dimEl(container)).toBe(created);
  });
});

describe("removeMask", () => {
  let container: HTMLElement;

  beforeEach(() => {
    clean();
    container = attach(makeContainer());
  });

  it("detaches the scrim and drops the active class from its container", () => {
    setDim(container, true);
    removeMask(container);
    expect(document.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(0);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
  });

  it("leaves a sibling map's scrim alone", () => {
    const other = attach(makeContainer());
    setDim(container, true);
    setDim(other, true);
    removeMask(container);
    expect(container.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(0);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
    // Destroying one control must not strip another map's scrim from under it.
    expect(other.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(1);
    expect(other.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
  });

  it("is a no-op when nothing was ever created", () => {
    expect(() => removeMask(container)).not.toThrow();
    expect(container.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(0);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
  });
});
