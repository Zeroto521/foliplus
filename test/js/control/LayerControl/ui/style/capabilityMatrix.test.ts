// Style capability matrix — parity against the per-dimension gates.
//
// A pure add: the matrix must return EXACTLY the bits the existing
// `layerCan*` gates return for every dimension, on every real surface. This
// test locks that parity by enumerating a representative layer set and
// comparing `styleCapability(ui, id).dims` to the registered dimension's own
// `gate` — the same function `gatedRows` consults. If a gate's required tier
// ever changes (native vs non-none) without the matrix changing with it, this
// test goes red, so the two cannot drift.
import { initFixture, installLeafletGlobals } from "../fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CAP_TIER, DIM } from "#core/layer/index.js";
import type { LayerController } from "#control/LayerControl/controller.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";
import { styleCapability } from "#control/LayerControl/ui/style/capabilityMatrix.js";
import { layerHasStyleDelegation } from "#control/LayerControl/ui/style/delegated.js";
import { layerCanLabel } from "#control/LayerControl/ui/style/labelDimension.js";
import { getDimension } from "#control/LayerControl/ui/style/registry.js";

/** One dimension key to the matrix dim name it mirrors. `border` maps to
 *  the `stroke` capability slot (the descriptor's key is the UI name, the
 *  slot is the surface name) — everything else is identity. */
const DIM_TO_MATRIX: Record<string, string> = {
  [DIM.FILL]: "fill",
  [DIM.BORDER]: "border",
  [DIM.OPACITY]: "opacity",
  [DIM.SIZE]: "size",
  [DIM.LABEL]: "label",
  [DIM.ICON]: "icon",
  [DIM.ICON_COLOR]: "iconColor",
  [DIM.MARKER_COLOR]: "markerColor",
  [DIM.ZOOM_RANGE]: "zoomRange",
};

/** Every registered built-in dimension must be mirrored by the matrix — the
 *  matrix adds nothing outside `DIM_ORDER` + `LABEL_DIM_ORDER`. */
it("mirrors every registered built-in dimension", () => {
  const keys = Object.keys(DIM_TO_MATRIX);
  expect(keys).toEqual([
    "fill",
    "border",
    "opacity",
    "size",
    "label",
    "icon",
    "iconColor",
    "markerColor",
    "zoomRange",
  ]);
  for (const key of keys) {
    expect(getDimension(key), `missing dimension ${key}`).toBeDefined();
  }
});

describe("styleCapability parity with the per-dimension gates", () => {
  let manager: LayerController;
  let ui: LayerUI;

  const makePolygonLeaf = (opts: Record<string, unknown> = {}) => {
    const leaf = Object.create((window.L as any).Polygon.prototype) as any;
    leaf.options = { fillColor: "#aabbcc", fillOpacity: 0.5, fill: true, ...opts };
    leaf.setStyle = vi.fn();
    leaf.getLatLngs = () => [
      [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 0 },
        { lat: 0, lng: 1 },
      ],
    ];
    return leaf;
  };

  const makeFillableLayer = (leaves: any[] = [makePolygonLeaf()]) => ({
    options: {},
    eachLayer: vi.fn((fn: (child: unknown) => void) => leaves.forEach(fn)),
    getBounds: vi.fn(() => ({
      isValid: vi.fn(() => true),
      getSouthWest: vi.fn(() => ({ lat: 0, lng: 0 })),
      getNorthEast: vi.fn(() => ({ lat: 1, lng: 1 })),
    })),
  });

  const makeLineLayer = () => {
    const line = Object.create((window.L as any).Polyline.prototype) as any;
    line.options = { color: "#000000", weight: 2 };
    line.setStyle = vi.fn();
    line.getLatLngs = () => [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 1 },
    ];
    return { options: {}, eachLayer: vi.fn((fn: (c: unknown) => void) => fn(line)) };
  };

  const makeCircleLayer = () => {
    const circle = Object.create((window.L as any).Circle.prototype) as any;
    circle.options = { fillColor: "#ff0000" };
    circle.setStyle = vi.fn();
    circle.getRadius = () => 5;
    return { options: {}, eachLayer: vi.fn((fn: (c: unknown) => void) => fn(circle)) };
  };

  const makeMarker = (icon?: unknown) => {
    const leaf: any = {
      feature: { properties: {} },
      options: { icon },
      setIcon: vi.fn((next: unknown) => {
        leaf.options.icon = next;
        return leaf;
      }),
    };
    return leaf;
  };

  const makeMarkerLayer = (...markers: any[]) => ({
    options: {},
    eachLayer: vi.fn((fn: (child: unknown) => void) => markers.forEach(fn)),
  });

  const makeGridLayer = () => new (window.L as any).TileLayer();

  beforeEach(() => {
    installLeafletGlobals();
    ({ manager, ui } = initFixture());
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  /** Register a set of representative layers and return their ids. */
  const registerSet = () => {
    manager.registerLayer({
      id: "poly",
      name: "Poly",
      role: "overlay",
      layer: makeFillableLayer(),
    });
    manager.registerLayer({
      id: "line",
      name: "Line",
      role: "overlay",
      layer: makeLineLayer(),
    });
    manager.registerLayer({
      id: "circle",
      name: "Circle",
      role: "overlay",
      layer: makeCircleLayer(),
    });
    manager.registerLayer({
      id: "markers",
      name: "Markers",
      role: "overlay",
      layer: makeMarkerLayer(makeMarker(), makeMarker()),
    });
    manager.registerLayer({
      id: "awesome",
      name: "Awesome",
      role: "overlay",
      layer: makeMarkerLayer(
        makeMarker({ options: { markerColor: "blue" } }),
        makeMarker(),
      ),
    });
    manager.registerLayer({
      id: "tile",
      name: "Tile",
      role: "base",
      layer: makeGridLayer(),
      paneName: "tilePane",
    });
    manager.registerLayer({
      id: "color",
      name: "Color",
      role: "base",
      color: "#3366cc",
    });
    manager.registerLayer({
      id: "cluster",
      name: "Cluster",
      layer: { options: {}, eachLayer: vi.fn(), _topClusterLevel: {} } as never,
    });
    return [
      "poly",
      "line",
      "circle",
      "markers",
      "awesome",
      "tile",
      "color",
      "cluster",
    ] as const;
  };

  it("matrix dims equal the registered gates on every representative surface", () => {
    for (const id of registerSet()) {
      const matrix = styleCapability(ui, id);
      for (const [key, dim] of Object.entries(DIM_TO_MATRIX)) {
        const gate = getDimension(key)!.gate(ui, id);
        expect(
          matrix.dims[dim as keyof typeof matrix.dims],
          `${id}.${dim}: matrix bit != ${key} gate`,
        ).toBe(gate);
      }
    }
  });

  it("returns all-false for a layer outside the registry", () => {
    const matrix = styleCapability(ui, "not-a-real-layer");
    expect(Object.values(matrix.dims)).toEqual(Array(9).fill(false));
    expect(matrix.perFeatureFill).toBe(false);
    expect(matrix.hasValueField).toBe(false);
    expect(matrix.borderCarriesValue).toBe(false);
    expect(matrix.isColorBasemap).toBe(false);
    expect(matrix.canFollowFill).toBe(false);
    expect(matrix.styleDelegation).toBe(false);
  });

  it("a polygon surface exposes fill + border and can follow fill", () => {
    const id = registerSet()[0];
    const matrix = styleCapability(ui, id);
    expect(matrix.dims.fill).toBe(true);
    expect(matrix.dims.border).toBe(true);
    expect(matrix.dims.opacity).toBe(true);
    expect(matrix.dims.zoomRange).toBe(true);
    expect(matrix.dims.size).toBe(false);
    expect(matrix.borderCarriesValue).toBe(false);
    expect(matrix.canFollowFill).toBe(true);
    expect(matrix.isColorBasemap).toBe(false);
  });

  it("a line surface carries the border value but cannot follow fill", () => {
    const matrix = styleCapability(ui, registerSet()[1]);
    expect(matrix.dims.border).toBe(true);
    expect(matrix.borderCarriesValue).toBe(true);
    expect(matrix.canFollowFill).toBe(false);
  });

  it("a marker surface exposes icon but neither fill nor border", () => {
    const matrix = styleCapability(ui, registerSet()[3]);
    expect(matrix.dims.icon).toBe(true);
    expect(matrix.dims.fill).toBe(false);
    expect(matrix.dims.border).toBe(false);
    expect(matrix.dims.size).toBe(false);
  });

  it("a color basemap is a color basemap and can fill", () => {
    const matrix = styleCapability(ui, registerSet()[6]);
    expect(matrix.isColorBasemap).toBe(true);
    expect(matrix.dims.fill).toBe(true);
  });

  it("a cluster surface exposes nothing configurable", () => {
    const matrix = styleCapability(ui, registerSet()[7]);
    expect(Object.values(matrix.dims).every(v => v === false)).toBe(true);
    expect(matrix.isColorBasemap).toBe(false);
  });

  it("styleDelegation parity with layerHasStyleDelegation", () => {
    const li = manager.layerRegistry.get("overlay1");
    li!.styleSetters = undefined;
    expect(styleCapability(ui, "overlay1").styleDelegation).toBe(false);
    li!.styleSetters = { color: vi.fn() };
    expect(styleCapability(ui, "overlay1").styleDelegation).toBe(true);
    li!.styleSetters = {};
    expect(styleCapability(ui, "overlay1").styleDelegation).toBe(false);
  });
});

describe("menu canConfigure equivalence", () => {
  let manager: LayerController;
  let ui: LayerUI;

  const makePolygonLeaf = () => {
    const leaf = Object.create((window.L as any).Polygon.prototype) as any;
    leaf.options = { fillColor: "#aabbcc", fillOpacity: 0.5, fill: true };
    leaf.setStyle = vi.fn();
    leaf.getLatLngs = () => [
      [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 0 },
        { lat: 0, lng: 1 },
      ],
    ];
    return leaf;
  };
  const makeFillableLayer = (leaves: any[] = [makePolygonLeaf()]) => ({
    options: {},
    eachLayer: vi.fn((fn: (child: unknown) => void) => leaves.forEach(fn)),
    getBounds: vi.fn(() => ({
      isValid: vi.fn(() => true),
      getSouthWest: vi.fn(() => ({ lat: 0, lng: 0 })),
      getNorthEast: vi.fn(() => ({ lat: 1, lng: 1 })),
    })),
  });
  const makeLineLayer = () => {
    const line = Object.create((window.L as any).Polyline.prototype) as any;
    line.options = { color: "#000000", weight: 2 };
    line.setStyle = vi.fn();
    line.getLatLngs = () => [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 1 },
    ];
    return { options: {}, eachLayer: vi.fn((fn: (c: unknown) => void) => fn(line)) };
  };
  const makeMarker = (icon?: unknown) => {
    const leaf: any = {
      feature: { properties: {} },
      options: { icon },
      setIcon: vi.fn((next: unknown) => {
        leaf.options.icon = next;
        return leaf;
      }),
    };
    return leaf;
  };
  const makeMarkerLayer = (...markers: any[]) => ({
    options: {},
    eachLayer: vi.fn((fn: (c: unknown) => void) => markers.forEach(fn)),
  });
  const makeGridLayer = () => new (window.L as any).TileLayer();

  beforeEach(() => {
    installLeafletGlobals();
    ({ manager, ui } = initFixture());
  });
  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  /** Reconstruct the OLD menu primitive verbatim — the surface caps plus the
   *  label gate plus the delegation probe — so the migration can be proven
   *  equivalent on the same representative set. If any term is dropped from
   *  the new gate, this test goes red. */
  const oldMenuCanConfigure = (id: string): boolean => {
    const layerInfo = ui.c.layerRegistry.get(id);
    const caps = layerInfo ? ui.c.surfaceFor(layerInfo).capabilities : null;
    return (
      (caps && (caps.opacity !== CAP_TIER.NONE || caps.zoomRange !== CAP_TIER.NONE)) ||
      layerCanLabel(ui, id) ||
      layerHasStyleDelegation(ui, id)
    );
  };

  const newMenuCanConfigure = (id: string): boolean => {
    const m = styleCapability(ui, id);
    return m.dims.opacity || m.dims.zoomRange || m.dims.label || m.styleDelegation;
  };

  it("menu gate equals the old primitive on every representative surface", () => {
    const ids = [
      "poly",
      "line",
      "circle",
      "markers",
      "awesome",
      "tile",
      "color",
      "cluster",
    ];
    manager.registerLayer({
      id: "poly",
      name: "Poly",
      role: "overlay",
      layer: makeFillableLayer(),
    });
    manager.registerLayer({
      id: "line",
      name: "Line",
      role: "overlay",
      layer: makeLineLayer(),
    });
    manager.registerLayer({
      id: "markers",
      name: "Markers",
      role: "overlay",
      layer: makeMarkerLayer(makeMarker(), makeMarker()),
    });
    manager.registerLayer({
      id: "tile",
      name: "Tile",
      role: "base",
      layer: makeGridLayer(),
      paneName: "tilePane",
    });
    manager.registerLayer({
      id: "color",
      name: "Color",
      role: "base",
      color: "#3366cc",
    });
    manager.registerLayer({
      id: "cluster",
      name: "Cluster",
      layer: { options: {}, eachLayer: vi.fn(), _topClusterLevel: {} } as never,
    });
    for (const id of ids) {
      expect(newMenuCanConfigure(id), `menu gate drifted for ${id}`).toBe(
        oldMenuCanConfigure(id),
      );
    }
  });

  it("turns red when the styleDelegation term is dropped", () => {
    // A layer with only styleSetters and no opacity/zoomRange/label must still
    // enable the menu — this is exactly what the old primitive's delegation
    // probe guarded, and what the matrix's styleDelegation bit now carries.
    const li = manager.layerRegistry.get("overlay1");
    li!.styleSetters = { color: vi.fn() };
    const surface = ui.c.surfaceFor(li!);
    (surface as unknown as { capabilities: Record<string, string> }).capabilities = {
      opacity: "none",
      zoomRange: "none",
      label: "none",
    };
    const m = styleCapability(ui, "overlay1");
    expect(m.dims.opacity).toBe(false);
    expect(m.dims.zoomRange).toBe(false);
    expect(m.dims.label).toBe(false);
    expect(m.styleDelegation).toBe(true);
    expect(newMenuCanConfigure("overlay1")).toBe(true);
  });
});
