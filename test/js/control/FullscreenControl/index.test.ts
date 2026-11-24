// Verifies the control-level teardown F-1 calls out: while a pseudo-fullscreen
// session is active, map.removeControl() must strip the pseudo class from the
// map container. Without it only a toggle click exits pseudo mode
// (logic.ts exitPseudo), so removing the control mid-session leaves
// leaflet-pseudo-fullscreen on the container for the page's whole life — and
// platform/fullscreen.ts's no-scope branch then resolves every body-level
// overlay's host to that dead container instead of <body>.
//
// The entry IIFE mounts at import time, so this follows the ScaleControl and
// HeatmapControl index tests: install a minimal L.Control plus a map whose
// addControl / removeControl run the real BaseControl onAdd / onRemove, then
// reach the instance through the map. buildDOM is exercised for real here,
// which is why the test lives at the entry rather than in logic.test.ts.
import { makeConfig } from "../config-fixture.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fullscreenSurface } from "#platform/fullscreen.js";
import { CLASSES } from "#control/FullscreenControl/const.js";

const container = document.createElement("div");

/** Leaflet's own zoom control, mounted the way L.Map mounts it by default:
 *  a .leaflet-control-zoom node inside the map container's topleft corner.
 *  The entry must leave this node and the map reference alone. */
const zoomControlEl = document.createElement("div");
zoomControlEl.className = "leaflet-control leaflet-control-zoom";
container.appendChild(zoomControlEl);

/** The control instance the entry IIFE mounts onto the map. */
type MountedControl = {
  _map: unknown;
  onAdd: () => HTMLElement;
  onRemove: () => void;
};

class ControlBase {
  _map!: unknown;
  options!: Record<string, unknown>;

  constructor(options: Record<string, unknown> = {}) {
    this.options = options;
  }

  addTo(map: MockMap): this {
    map.addControl(this as unknown as MountedControl);
    return this;
  }
}

class MockMap {
  _control!: MountedControl | null;
  _container!: HTMLElement;
  zoomControl!: { remove: () => void };
  /** Every control removeControl() was handed, in call order. */
  removedControls: unknown[] = [];

  constructor() {
    this._container = container;
    this.zoomControl = { remove: vi.fn() };
  }

  getContainer(): HTMLElement {
    return this._container;
  }

  invalidateSize: () => void = vi.fn();
  on: () => this = vi.fn(() => this);
  off: () => this = vi.fn(() => this);
  whenReady: () => this = vi.fn(() => this);
  foliplus!: Record<string, unknown>;

  addControl(ctrl: MountedControl): this {
    this._control = ctrl;
    ctrl._map = this;
    // Leaflet appends the built control element into the map container — the
    // toggle the test clicks for lives there.
    this._container.appendChild(ctrl.onAdd());
    return this;
  }

  removeControl(ctrl: MountedControl): this {
    this.removedControls.push(ctrl);
    if (this._control === ctrl) {
      ctrl.onRemove();
      this._control = null;
    }
    return this;
  }
}

let mockMap: MockMap;
let ctrl: MountedControl;

beforeAll(async () => {
  // jsdom ships a working Fullscreen API, which would take the native branch
  // instead of the pseudo path this test is about. Pseudo mode is the
  // permissionless fallback the defect lives in.
  Object.defineProperty(document, "fullscreenEnabled", {
    value: false,
    configurable: true,
  });
  // The IIFE free variables the entry reads at import time.
  window.CONFIG = makeConfig("FullscreenControl");
  (window as any).L.Control = ControlBase as any;
  mockMap = new MockMap();
  (window as any).map = mockMap;
  vi.resetModules();
  await import("#control/FullscreenControl/index.js");
  ctrl = mockMap._control!;
  expect(ctrl, "the IIFE should have mounted the control").not.toBeNull();
});

afterAll(() => {
  container.remove();
});

describe("FullscreenControl entry — the map zoom control is untouched", () => {
  // F-4: the control must not replace, copy or remove Leaflet's zoom control.
  // Mounting it is the moment the old code removed the control, so the entry
  // is where the contract is pinned: the map reference and the rendered node
  // both survive the mount.
  it("leaves the map's own zoom control in place at mount", () => {
    expect(mockMap.removedControls).not.toContain(mockMap.zoomControl);
    expect(mockMap.zoomControl.remove).not.toHaveBeenCalled();
    const rendered = container.querySelector(".leaflet-control-zoom");
    expect(rendered).toBe(zoomControlEl);
    expect(rendered?.parentElement).toBe(container);
  });
});

describe("FullscreenControl entry — pseudo session teardown", () => {
  it("releases the pseudo session when the control is removed mid-session", () => {
    // Native fullscreen is unavailable (the setup stub exposes no
    // fullscreenEnabled), so the first toggle click takes the pseudo branch.
    const fsBtn = container.querySelector(`.${CLASSES.TOGGLE}`) as HTMLButtonElement;
    fsBtn.click();
    expect(
      container.classList.contains(CLASSES.PSEUDO_FULLSCREEN),
      "the toggle must enter pseudo mode",
    ).toBe(true);

    // The fourth pseudo exit: the control goes away. The native and
    // fullscreenchange paths both key on a user gesture, so nothing else
    // releases the class.
    mockMap.removeControl(ctrl);

    expect(
      container.classList.contains(CLASSES.PSEUDO_FULLSCREEN),
      "removing the control must release the pseudo session",
    ).toBe(false);
    expect(fullscreenSurface(), "overlays must resolve to <body> again").toBe(
      document.body,
    );
  });
});
