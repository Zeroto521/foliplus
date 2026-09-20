// Verifies ScaleControl.destroy() tears down the inner Leaflet L.Control.Scale
// listener. Without the fix, foliplus/js/ScaleControl/index.ts:buildDOM() calls
// `scaleCtrl.onAdd(map)` by hand, which internally registers a `move` listener
// on the map via `map.on("move", this._update, this)` — but nothing on teardown
// ever calls `scaleCtrl.onRemove(map)`, so the listener stays bound to the map
// for its lifetime and keeps mutating the detached scale DOM on every map move.
//
// The IIFE at the bottom of ScaleControl/index.ts runs at import time and needs
// a working L.Control + L.control.scale + map. setup.ts's L.Control is
// `class {}` (no addTo method), so we replace window.L and window.map with a
// minimal but faithful mock before importing. The mock reproduces both halves
// of the leaky pattern: L.Control.Scale.onAdd registers `move` on the map keyed
// to the scale instance, and setZoom fires that listener synchronously.

import { beforeAll, describe, expect, it, vi } from "vitest";

type EventEntry = { fn: (...args: unknown[]) => unknown; ctx: unknown };
type EventRegistry = Record<string, EventEntry[]>;

// ── Mock map: enough of L.Map for our control to work ───────────────────────
class MockMap {
  _events: EventRegistry = {};
  _control!: {
    _bottomleft: HTMLElement;
    _bottomright: HTMLElement;
    _topleft: HTMLElement;
    _topright: HTMLElement;
    _controls: Record<string, { instance: MockControl }>;
  };
  foliplus?: Record<string, unknown>;
  _zoom = 4;

  constructor() {
    const container = document.createElement("div");
    container.id = "test-map-container";
    document.body.appendChild(container);
    this._container = container;
    const mk = (cls: string) => {
      const el = document.createElement("div");
      el.className = `leaflet-control-container leaflet-bottom-${cls}`;
      container.appendChild(el);
      return el;
    };
    this._control = {
      _bottomleft: mk("left"),
      _bottomright: mk("right"),
      _topleft: mk("left"),
      _topright: mk("right"),
      _controls: {},
    };
    this.foliplus = {};
  }

  on(type: string, fn: (...args: unknown[]) => unknown, ctx?: unknown): this {
    (this._events[type] ??= []).push({ fn, ctx });
    return this;
  }
  off(type: string, fn: (...args: unknown[]) => unknown, ctx?: unknown): this {
    if (!this._events[type]) return this;
    this._events[type] = this._events[type].filter(e => e.fn !== fn || e.ctx !== ctx);
    return this;
  }
  fire(type: string): this {
    this._events[type]?.forEach(e => e.fn.call(e.ctx, {}));
    return this;
  }
  whenReady(_cb: () => unknown, _ctx?: unknown): this {
    return this;
  }
  setZoom(zoom: number): this {
    this._zoom = zoom;
    this.fire("move");
    return this;
  }
  getZoom(): number {
    return this._zoom;
  }
  getCenter(): { lat: number; lng: number } {
    return { lat: 26, lng: 119 };
  }
  _container!: HTMLElement;
}

// ── Mock L.Control: minimal Leaflet control lifecycle ────────────────────────
class MockControl {
  _map!: MockMap | null;
  _container!: HTMLElement;
  _id!: string;
  options!: Record<string, unknown>;

  constructor(options?: Record<string, unknown>) {
    this.options = options ?? {};
  }
  addTo(map: MockMap): this {
    this._map = map;
    this._id = `mock-ctrl-${Math.random().toString(36).slice(2)}`;
    const container = this.onAdd(map);
    this._container = container;
    container.id = this._id;
    (container as any)._leaflet_id = this._id;
    map._control._controls[this._id] = { instance: this };
    const posEl =
      map._control[
        (this.options.position as
          | "bottomleft"
          | "bottomright"
          | "topleft"
          | "topright"
          | undefined) ?? "bottomleft"
      ] ?? map._control._bottomleft;
    posEl.appendChild(container);
    return this;
  }
  onAdd(_map: MockMap): HTMLElement {
    return document.createElement("div");
  }
  onRemove(): void {}
  getContainer(): HTMLElement {
    return this._container;
  }
}

// ── Mock L.Control.Scale: reproduces the leaky listener pattern ──────────────
class MockScaleControl extends MockControl {
  _update = (): void => {
    // Write the "25 km" style label, exactly like real L.Control.Scale does.
    const line = this._container?.querySelector(".leaflet-control-scale-line");
    if (line) line.textContent = `${Math.round(250 / this._map.getZoom())} m`;
  };

  onAdd(map: MockMap): HTMLElement {
    const el = document.createElement("div");
    el.className = "leaflet-control-scale";
    this._container = el;
    const line = document.createElement("b");
    line.className = "leaflet-control-scale-line";
    line.textContent = "25 km";
    el.appendChild(line);
    // Exactly the leak: register 'move' on the map keyed to this instance.
    map.on("move", this._update, this);
    return el;
  }
  onRemove(map: MockMap): void {
    map.off("move", this._update, this);
  }
}

// ── Mock L ───────────────────────────────────────────────────────────────────
const mockL = {
  DomEvent: {
    disableClickPropagation: vi.fn(),
    disableScrollPropagation: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    stopPropagation: vi.fn(),
  },
  Control: MockControl,
  ControlScale: MockScaleControl,
  control: {
    scale: (options?: Record<string, unknown>) => new MockScaleControl(options ?? {}),
  },
};

// ── Install mocks before importing ScaleControl ──────────────────────────────
beforeAll(() => {
  (window as any).L = mockL;
  (window as any).map = new MockMap();
});

describe("ScaleControl inner-Leaflet-Scale teardown", () => {
  let mockMap: MockMap;
  let scaleWrap: HTMLElement;
  let outerCtrl: MockControl & { destroy: () => void };

  const scaleLineText = () => scaleWrap.querySelector(".leaflet-control-scale-line")?.textContent;

  beforeAll(async () => {
    vi.resetModules();
    await import("#foliplus/ScaleControl/index.js");

    mockMap = (window as any).map as MockMap;
    scaleWrap = document.querySelector<HTMLElement>(".foliplus-scale-wrap");
    expect(scaleWrap, "IIFE should have mounted the scale wrap").not.toBeNull();

    outerCtrl = Object.values(mockMap._control._controls)
      .map(entry => entry.instance)
      .find(c => c.getContainer() === scaleWrap) as MockControl & { destroy: () => void };
    expect(outerCtrl, "outer ScaleControl should be on the map").toBeDefined();
    expect(
      typeof outerCtrl.destroy,
      "outer control should expose destroy() (BaseControl hook)",
    ).toBe("function");
  });

  it("binds the inner scale's move listener on the map", () => {
    const moveEntries = mockMap._events.move ?? [];
    expect(moveEntries.length).toBe(1);
    const entry = moveEntries[0];
    expect(entry.ctx, "move listener should be owned by the inner Control.Scale").toBeInstanceOf(
      MockScaleControl,
    );
    expect(entry.fn, "move listener should be scaleCtrl._update").toBe(
      (entry.ctx as MockScaleControl)._update,
    );
  });

  it("the scale label updates on setZoom while live", () => {
    const before = scaleLineText();
    mockMap.setZoom(6);
    const after = scaleLineText();
    expect(before, "scale line should render").not.toBeNull();
    expect(after, "scale label should change after setZoom").not.toBe(before);
  });

  it("unregisters the inner scale's move listener on destroy()", () => {
    outerCtrl.onRemove();
    const moveEntries = mockMap._events.move ?? [];
    expect(
      moveEntries.some(e => e.ctx instanceof MockScaleControl),
      "no move listener should remain bound to the inner Control.Scale",
    ).toBe(false);
  });

  it("the inner scale's DOM is frozen after destroy()", () => {
    // Outer is already torn down by the previous test. The scale element is
    // still in the DOM but no longer receives move events, so its label must
    // not change even though the map's own zoom is mutating.
    const frozen = scaleLineText();
    mockMap.setZoom(9);
    expect(
      scaleLineText(),
      `scale text should be frozen after teardown (frozen=${JSON.stringify(frozen)})`,
    ).toBe(frozen);
  });

  it("destroy() runs twice safely — a second onRemove() is a no-op", () => {
    expect(() => outerCtrl.onRemove()).not.toThrow();
  });
});
