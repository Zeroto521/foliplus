import { beforeEach, describe, expect, it, vi } from "vitest";
import { LayerSurface } from "#foliplus/core/layer/LayerSurface.js";
import { PaneManager } from "#foliplus/core/layer/PaneManager.js";
import { hasRadiusLeaf } from "#foliplus/core/layer/capability.js";

// Minimal Leaflet shapes: the size probe reads only `getRadius`, `_radius`
// and `_mRadius`, so each shape carries just those. The Circle pair is the
// interesting one — Leaflet's `Circle` *extends* `CircleMarker`, inherits
// `getRadius`, and picks up a numeric `_radius` from `_project` the moment it
// is attached to a map, which is exactly when it shows up in the layer list.
// `_mRadius` is the field that keeps it out, whether attached or not.
class CircleMarkerShape {
  options: Record<string, unknown> = {};
  _radius: number;

  constructor(radius = 10) {
    this._radius = radius;
  }

  setRadius(radius: number) {
    this._radius = radius;
    return this;
  }

  getRadius() {
    return this._radius;
  }
}

class CircleShape {
  options: Record<string, unknown> = {};
  _mRadius: number;
  _radius: number | undefined = undefined;

  constructor(mRadius = 1000) {
    this._mRadius = mRadius;
  }

  setRadius(mRadius: number) {
    this._mRadius = mRadius;
    return this;
  }

  getRadius() {
    return this._mRadius;
  }

  /** `_project`, on attach: the pixel value `_radius` holds afterwards. */
  attachToMap() {
    this._radius = Math.round(this._mRadius / 25);
    return this;
  }
}

class PolyShape {
  options: Record<string, unknown> = {};
}

class MarkerShape {
  options: Record<string, unknown> = {};
  _icon: HTMLElement | null = null;
  getElement() {
    return this._icon;
  }
}

// `foliplus` declaration with no radius carrier of its own — the branch that
// reads the node before descending.
class DeclaredShape {
  options: Record<string, unknown> = {};
  foliplus: Record<string, unknown> = {};
  _layers: Record<string, unknown> = {};
}

class GridShape {
  options: Record<string, unknown> = {};
}

class GroupShape {
  options: Record<string, unknown> = {};
  /** Set by one test to exercise the foliplus-declaration branch. */
  foliplus?: Record<string, unknown>;

  constructor(private readonly kids: unknown[] = []) {}

  eachLayer(fn: (layer: L.Layer) => void) {
    for (const kid of this.kids) fn(kid as L.Layer);
  }
}

let stampId = 0;

beforeEach(() => {
  stampId = 0;
  window.L.svg = vi.fn(() => ({
    addTo: vi.fn(),
    _container: document.createElement("div"),
  }));
  window.L.stamp = vi.fn((obj: { __id?: number }) => (obj.__id ??= ++stampId));
});

const makeSurface = (layer: unknown) => {
  const map = {
    getPane: () => null,
    createPane: () => {
      const el = document.createElement("div");
      el.classList.add("foliplus-layer-pane");
      return el;
    },
    hasLayer: () => true,
    removeLayer: vi.fn(),
    _panes: {} as Record<string, HTMLElement>,
    _paneRenderers: {} as Record<string, unknown>,
  };
  const host = new PaneManager(map as unknown as L.Map);
  return new LayerSurface(host, {
    id: "size",
    layer: layer as L.Layer | null,
  });
};

describe("hasRadiusLeaf", () => {
  it("accepts a CircleMarker-shaped leaf (getRadius + numeric _radius)", () => {
    expect(hasRadiusLeaf(new CircleMarkerShape(8))).toBe(true);
    expect(hasRadiusLeaf(new CircleMarkerShape(1))).toBe(true);
  });

  it("rejects a Circle before it is on the map: getRadius but no _radius", () => {
    expect(hasRadiusLeaf(new CircleShape(2000))).toBe(false);
  });

  it("still rejects a Circle after it is on the map: _project writes _radius", () => {
    // The regression the metre field guards. Once attached, Circle has every
    // CircleMarker feature except the unit, so `getRadius` + `_radius` alone
    // would hand it a pixel-size row that writes metres as pixels.
    expect(hasRadiusLeaf(new CircleShape(2000).attachToMap())).toBe(false);
  });

  it("rejects the rest of the vector family: polygon, polyline, marker, grid", () => {
    for (const leaf of [
      new PolyShape(),
      new PolyShape(),
      new MarkerShape(),
      new GridShape(),
    ]) {
      expect(hasRadiusLeaf(leaf)).toBe(false);
    }
  });

  it("rejects a leaf with a radius getter but no pixel field", () => {
    expect(hasRadiusLeaf({ getRadius: () => 4 })).toBe(false);
  });

  it("rejects a leaf whose _radius is not a finite number", () => {
    expect(hasRadiusLeaf({ getRadius: () => 4, _radius: null })).toBe(false);
  });

  it("rejects an empty tree and a null root", () => {
    expect(hasRadiusLeaf(new GroupShape())).toBe(false);
    expect(hasRadiusLeaf(null)).toBe(false);
  });

  it("finds a CircleMarker nested inside a LayerGroup", () => {
    expect(hasRadiusLeaf(new GroupShape([new CircleMarkerShape(12)]))).toBe(true);
  });

  it("descends past a group that itself has no radius", () => {
    expect(
      hasRadiusLeaf(new GroupShape([new GroupShape([new CircleMarkerShape(3)])])),
    ).toBe(true);
  });

  it("short-circuits: a metre Circle next to a CircleMarker still counts", () => {
    expect(
      hasRadiusLeaf(
        new GroupShape([new CircleShape(500).attachToMap(), new CircleMarkerShape(6)]),
      ),
    ).toBe(true);
  });
});

describe("LayerSurface capabilities.size", () => {
  it("is native for a CircleMarker", () => {
    expect(makeSurface(new CircleMarkerShape(10)).capabilities.size).toBe("native");
  });

  it("is none for a Circle, before and after it is attached", () => {
    expect(makeSurface(new CircleShape(1000)).capabilities.size).toBe("none");
    expect(makeSurface(new CircleShape(1000).attachToMap()).capabilities.size).toBe(
      "none",
    );
  });

  it("is none for a polygon, a polyline, a marker and a tile layer", () => {
    for (const layer of [
      new PolyShape(),
      new PolyShape(),
      new MarkerShape(),
      new GridShape(),
    ]) {
      expect(makeSurface(layer).capabilities.size).toBe("none");
    }
  });

  it("is native for a group containing a CircleMarker", () => {
    expect(
      makeSurface(new GroupShape([new CircleMarkerShape(5)])).capabilities.size,
    ).toBe("native");
  });

  it("is none for a group that holds only metre-radius circles", () => {
    expect(
      makeSurface(new GroupShape([new CircleShape(400).attachToMap()])).capabilities
        .size,
    ).toBe("none");
  });

  it("is none with no layer at all", () => {
    expect(makeSurface(null).capabilities.size).toBe("none");
  });

  it("is native for the foliplus-declaration branch (a node with _layers)", () => {
    const declared = new DeclaredShape();
    declared._layers.o = new CircleMarkerShape(7);
    expect(makeSurface(declared).capabilities.size).toBe("native");
  });

  it("is none for the declaration branch with no radius child", () => {
    expect(makeSurface(new DeclaredShape()).capabilities.size).toBe("none");
  });

  it("is native for a group with a foliplus declaration and a radius child", () => {
    const g = new GroupShape([new CircleMarkerShape(20)]);
    g.foliplus = {};
    expect(makeSurface(g).capabilities.size).toBe("native");
  });

  it("stays independent of fill and stroke", () => {
    // A CircleMarker without a setStyle carrier: fill and stroke are both
    // "none", size is still "native". The three axes are separate probes.
    const caps = makeSurface(new CircleMarkerShape(10)).capabilities;
    expect(caps.size).toBe("native");
    expect(caps.fill).toBe("none");
    expect(caps.stroke).toBe("none");
  });
});
