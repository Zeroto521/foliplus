import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLASS_COUNT } from "#core/classify.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { LayerController } from "#foliplus/LayerControl/controller.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { clearIntent, getIntent, setIntent } from "#foliplus/LayerControl/ui/intent.js";
import {
  FILL_DIMENSION,
  applyFillToLayer,
  bindFillRow,
  buildFillRow,
  commitFillColor,
  commitFillOpacity,
  layerCanFill,
  replayFillState,
  resetLayerFill,
} from "#foliplus/LayerControl/ui/style/fill.js";
import { closeStylePanel } from "#foliplus/LayerControl/ui/style/index.js";
import {
  FACE,
  dropStyleDimApplies,
  flushStyleDimApply,
  hasStyleDimApply,
} from "#foliplus/LayerControl/ui/style/styleBag.js";
import { findItem, initFixture, installLeafletGlobals } from "../fixture.js";

/** A layer duck with a real setStyle spy and a set of polygon leaves each
 *  with their own setStyle. The leaves are `L.Polygon` instances so the areal
 *  gate in `layerCanFill` admits the layer. The parent's eachLayer callback
 *  dispatches to each child, matching how Leaflet LayerGroup.setStyle walks
 *  its tree. */
const makeFillableLayer = () => {
  const makeLeaf = (options: { fillColor?: string; fillOpacity?: number }) => {
    const leaf = new L.Polygon() as L.Polygon & {
      options: { fillColor?: string; fillOpacity?: number };
      setStyle: ReturnType<typeof vi.fn>;
    };
    leaf.options = options;
    leaf.setStyle = vi.fn();
    return leaf;
  };
  // One color across leaves: this fixture is the "author paints one fill"
  // layer, so the fill row keeps its normal solid/ramp arms. Per-feature
  // detection has its own fixture below.
  const leaves = [
    makeLeaf({ fillColor: "#aabbcc", fillOpacity: 0.5, fill: true } as any),
    makeLeaf({ fillColor: "#aabbcc", fillOpacity: 0.7, fill: true } as any),
  ];
  const parent = {
    options: {},
    eachLayer: vi.fn((fn: (child: unknown) => void) =>
      leaves.forEach(child => fn(child)),
    ),
    getBounds: vi.fn(() => ({
      isValid: vi.fn(() => true),
      getSouthWest: vi.fn(() => ({ lat: 0, lng: 0 })),
      getNorthEast: vi.fn(() => ({ lat: 1, lng: 1 })),
    })),
    leaves,
  };
  return parent as unknown as L.Layer & { leaves: typeof leaves };
};

/** One coordinate ring. A fillable stub has to advertise the areal
 *  duck-type `walkFillLeaves` matches through `isArealStyleLeaf` - a bare
 *  setter-only object would otherwise fall out of the walk entirely.
 */
const RING = () => [
  [
    { lat: 0, lng: 0 },
    { lat: 1, lng: 0 },
    { lat: 0, lng: 1 },
  ],
];

/** The style write a leaf spy records. */
type StyleWrite = { fillColor?: string; fillOpacity?: number; fill?: boolean };

/** Build a LayerController/UI fixture with a real fillable overlay layer
 *  registered under `overlay1`, replacing the fixture's bare polygon duck. */
const initWithFillLayer = () => {
  // Install the stub classes FIRST so `new L.Polygon()` below creates leaves
  // of the same class identity the manager's checks use (repeated installs
  // keep the module-level class, so initFixture does not invalidate them).
  installLeafletGlobals();
  const fillLayer = makeFillableLayer();
  const { manager, ui, map } = initFixture({
    data: [
      {
        id: "overlay1",
        name: "Polygons",
        role: "overlay",
        layer: fillLayer,
      },
      {
        id: "base1",
        name: "OSM",
        role: "base",
        layer: { options: {}, setZIndex: vi.fn() } as never,
        paneName: "tilePane",
      },
    ],
  });
  ui.runtimeStore.setFields("overlay1", [{ name: "count", numeric: true }]);
  return { manager, ui, map, fillLayer };
};

/** A fillable layer the author paints per feature: leaves carry distinct
 *  fill colors, so the fill row's detected state is "feature". */
const makePerFeatureLayer = (colors: readonly string[]) => {
  const makeLeaf = (color: string, value: number) => {
    const leaf = new L.Polygon() as L.Polygon & {
      options: { fillColor?: string; fillOpacity?: number; fill?: boolean };
      feature: { properties: { count: number } };
      setStyle: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
    };
    leaf.options = { fillColor: color, fillOpacity: 0.5, fill: true };
    // explore output: the color and the column value live on the feature.
    leaf.feature = {
      properties: { __folium_color: color, cat: "c" + value, count: value },
    };
    leaf.setStyle = vi.fn();
    leaf.on = vi.fn();
    return leaf;
  };
  const leaves = colors.map((color, i) => makeLeaf(color, i + 1));
  const parent = {
    options: {},
    eachLayer: vi.fn((fn: (child: unknown) => void) =>
      leaves.forEach(child => fn(child)),
    ),
    getBounds: vi.fn(() => ({
      isValid: vi.fn(() => true),
      getSouthWest: vi.fn(() => ({ lat: 0, lng: 0 })),
      getNorthEast: vi.fn(() => ({ lat: 1, lng: 1 })),
    })),
    leaves,
  };
  return parent as unknown as L.Layer & { leaves: typeof leaves };
};

const initWithPerFeatureLayer = ({
  colors = ["#0d0887", "#f0f921"] as readonly string[],
  perFeature = true,
  fillAuthor = perFeature
    ? { perFeature: true, distinct: colors.length, stops: [...colors] }
    : { perFeature: false, distinct: 1, stops: colors.slice(0, 1) },
  withProperties = true,
}: {
  colors?: readonly string[];
  perFeature?: boolean;
  fillAuthor?: {
    perFeature: boolean;
    distinct: number;
    stops: string[];
    scale?: unknown;
  } | null;
  withProperties?: boolean;
} = {}) => {
  installLeafletGlobals();
  const layer = makePerFeatureLayer(colors);
  if (!withProperties) {
    for (const leaf of layer.leaves) {
      delete (leaf.feature as { properties?: unknown }).properties;
    }
  }
  const { manager, ui } = initFixture({
    data: [
      {
        id: "feature1",
        name: "Per feature",
        role: "overlay",
        layer,
        fillAuthor,
      },
    ],
  });
  ui.runtimeStore.setFields("feature1", [{ name: "count", numeric: true }]);
  return { manager, ui, layer };
};

/** A layer the author paints from a colormap: the fill row must open on the
 *  read-only original-colors state over the author's own scale. */
const initWithAuthorScale = ({
  stops = ["#0d0887", "#6a00a8", "#b12a90"] as readonly string[],
  scale = {
    kind: "continuous" as const,
    column: "score",
    vmin: 10,
    vmax: 30,
  },
  distinct = stops.length,
  capped = false,
}: {
  stops?: readonly string[];
  scale?: {
    kind: "continuous" | "stepped";
    column?: string;
    vmin: number;
    vmax: number;
    levels?: number;
    breaks?: number[];
  } | null;
  distinct?: number;
  capped?: boolean;
} = {}) => {
  installLeafletGlobals();
  const layer = makePerFeatureLayer(stops);
  layer.leaves.forEach((leaf: { feature: unknown }, index: number) => {
    const feature = leaf.feature as { properties: Record<string, unknown> };
    feature.properties.score = (index + 1) * 10;
  });
  const { manager, ui } = initFixture({
    data: [
      {
        id: "overlay1",
        name: "Original",
        role: "overlay",
        layer,
        fillAuthor: {
          perFeature: true,
          distinct,
          stops: [...stops],
          ...(capped ? { capped: true } : {}),
          ...(scale ? { scale } : {}),
        },
      },
    ],
  });
  ui.runtimeStore.setFields("overlay1", [{ name: "score", numeric: true }]);
  return { manager, ui, layer };
};
/** A fillable layer whose leaves carry a numeric
 *  `feature.properties.count`, so the ramp arm has values to classify. */
const makeRampedLayer = (values: number[]) => {
  const makeLeaf = (value: number) => {
    const leaf = new L.Polygon() as {
      options: { fillColor?: string; fillOpacity?: number; fill?: boolean };
      feature: { properties: { count: number } };
      setStyle: ReturnType<typeof vi.fn<(style: StyleWrite) => void>>;
      on: ReturnType<typeof vi.fn>;
    };
    leaf.options = { fillColor: "#aabbcc", fillOpacity: 0.5, fill: true };
    leaf.feature = { properties: { count: value } };
    leaf.setStyle = vi.fn();
    leaf.on = vi.fn();
    return leaf;
  };
  const leaves = values.map(makeLeaf);
  const parent = {
    options: {},
    eachLayer: vi.fn((fn: (child: unknown) => void) =>
      leaves.forEach(child => fn(child)),
    ),
    getBounds: vi.fn(() => ({
      isValid: vi.fn(() => true),
      getSouthWest: vi.fn(() => ({ lat: 0, lng: 0 })),
      getNorthEast: vi.fn(() => ({ lat: 1, lng: 1 })),
    })),
    leaves,
  };
  // Deliberately not intersected with L.Layer: the test suite declares L as
  // any, so an L.Layer & {...} intersection collapses to any and the callback
  // parameter in a .map over leaves loses its type.
  return parent as { leaves: typeof leaves };
};

/** Fixture with a rampable overlay layer — leaves carry `count` so
 *  `applyRampToLayer` has values to classify. */
const initWithRampedLayer = (values: number[] = [1, 5, 9]) => {
  installLeafletGlobals();
  const rampLayer = makeRampedLayer(values);
  const { manager, ui } = initFixture({
    data: [
      { id: "overlay1", name: "Polygons", role: "overlay", layer: rampLayer },
      {
        id: "base1",
        name: "OSM",
        role: "base",
        layer: { options: {}, setZIndex: vi.fn() } as never,
        paneName: "tilePane",
      },
    ],
  });
  ui.runtimeStore.setFields("overlay1", [{ name: "count", numeric: true }]);
  return { manager, ui, rampLayer };
};

/** Install a chroma stub that hands back a fixed color list, whatever count
 *  was requested. */
const installChroma = (colors: string[]): void => {
  globalThis.chroma = {
    scale: () => ({
      mode: () => ({
        colors: () => colors,
      }),
    }),
  } as never;
};

/** Commit then force the deferred apply to land — the commit channel is
 *  rAF-coalesced, so a test that asserts the write must flush first. */
const commitNow = (
  ui: LayerUI,
  layerId: string,
  kind: "color" | "opacity",
  value: string | number,
): void => {
  if (kind === "color") commitFillColor(ui, layerId, value as string);
  else commitFillOpacity(ui, layerId, value as number);
  flushStyleDimApply(FACE.FILL, layerId);
};

describe("LayerUI style panel — fill color", () => {
  let manager: LayerController;
  let ui: LayerUI;

  let fillLayer: ReturnType<typeof makeFillableLayer>;

  beforeEach(() => {
    const fixture = initWithFillLayer();
    manager = fixture.manager;
    ui = fixture.ui;
    fillLayer = fixture.fillLayer;
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const fillRow = (item: HTMLElement): HTMLElement | null =>
    item.querySelector(`.${CONST.CLASSES.STYLE_FILL_ROW}`);

  const fillInput = (item: HTMLElement): HTMLInputElement | null =>
    item.querySelector(`.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`);

  // ─────────────────── row rendering ───────────────────

  it("renders the fill row for a fillable vector layer", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    expect(fillRow(item)).not.toBeNull();
    expect(fillInput(item)).not.toBeNull();
    expect(fillInput(item)!.type).toBe("color");
  });

  it("the fill row's aria-label comes from the scoped translator", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    expect(fillInput(item)!.getAttribute("aria-label")).toBe("LayerControl.style_fill");
  });

  it("the mode row's label matches the select's aria-label key", () => {
    // The row that owns the mode select reads "Fill"; the swatch's aria-label
    // stays the color key, so neither one lies about what it names.
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const row = fillRow(item)!;
    const labelText = row.querySelector(`.${CONST.CLASSES.FORM_LABEL}`)!.textContent;
    const select = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`,
    ) as HTMLSelectElement;
    expect(labelText).toBe("LayerControl.style_fill_mode");
    expect(select.getAttribute("aria-label")).toBe(labelText);
    expect(fillInput(item)!.getAttribute("aria-label")).toBe("LayerControl.style_fill");
  });

  it("the swatch defaults to the authored paint when no fill is committed", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    // No user fill yet — the swatch shows the layer's authored fill color
    // (the first polygon leaf's options.fillColor), not a constant.
    expect(fillInput(item)!.value).toBe("#aabbcc");
  });

  it("reopening the panel seeds the swatch from intents.fillColor", () => {
    setIntent(ui, "overlay1", "fillColor", "#ff8800");

    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    expect(fillInput(item)!.value).toBe("#ff8800");
  });

  // ─────────────────── capability gate ───────────────────

  it("layerCanFill returns true for a solid-color basemap", () => {
    // The color basemap carries BOTH `color` (its fill) and `canvas` (the
    // face element the export renderer draws). Gating on `canvas` — as this
    // once did — drops its fill row, which is the one dimension this layer
    // exists to expose. `color` is the discriminator.
    manager.registerLayer({
      id: "colormap",
      name: "Color",
      role: "base",
      color: "#3366cc",
      canvas: document.createElement("canvas"),
    });
    expect(layerCanFill(ui, "colormap")).toBe(true);
  });

  it("layerCanFill returns false for a canvas layer", () => {
    manager.registerLayer({
      id: "canvas1",
      name: "Heat",
      canvas: document.createElement("canvas"),
    });
    expect(layerCanFill(ui, "canvas1")).toBe(false);
  });

  it("layerCanFill returns false for a delegated (styleSetters) layer", () => {
    manager.registerLayer({
      id: "deleg1",
      name: "Delegated",
      layer: { options: {}, eachLayer: vi.fn() } as never,
      styleSetters: { labelShow: vi.fn() },
    });
    expect(layerCanFill(ui, "deleg1")).toBe(false);
  });

  it("layerCanFill returns false when the surface has no opacity carrier", () => {
    // MarkerCluster duck: `_topClusterLevel` triggers `opacity: "none"`.
    manager.registerLayer({
      id: "cluster1",
      name: "Cluster",
      layer: { options: {}, eachLayer: vi.fn(), _topClusterLevel: {} } as never,
    });
    expect(layerCanFill(ui, "cluster1")).toBe(false);
  });

  it("layerCanFill returns false when the surface has no zoom-range carrier", () => {
    // ImageOverlay duck: `opacity: "native"`, `zoomRange: "none"`. Even though
    // the surface can carry opacity, it is not a vector shape, so no fill.
    manager.registerLayer({
      id: "img1",
      name: "Img",
      layer: { options: {}, _url: "x" } as never,
    });
    const surface = manager.surfaceFor(manager.layerRegistry.get("img1")!);
    surface.capabilities.opacity = "native";
    surface.capabilities.zoomRange = "none";
    expect(layerCanFill(ui, "img1")).toBe(false);
  });

  it("layerCanFill returns false when the layer is not in the registry", () => {
    expect(layerCanFill(ui, "not-a-real-layer")).toBe(false);
  });

  it("layerCanFill is false for a line layer — no fill concept", () => {
    // A PolyLine passes the capability check (vector shape) but has no fill
    // concept: a fill row there would write a value with no visual effect.
    const line = new L.Polyline();
    line.options = { color: "#000000", weight: 2 };
    line.setStyle = vi.fn();
    manager.registerLayer({
      id: "line1",
      name: "Line",
      layer: line as never,
    });
    ui.runtimeStore.setFields("line1", [{ name: "count", numeric: true }]);
    expect(layerCanFill(ui, "line1")).toBe(false);

    const item = findItem(ui, "line1");
    ui.openStylePanel("line1");
    expect(fillRow(item)).toBeNull();
  });

  it("layerCanFill is true for a mixed polygon+line layer with a polygon leaf", () => {
    // A mixed GeoJSON keeps the row when at least one leaf can carry a fill;
    // the write reaches exactly the polygon leaves.
    const poly = new L.Polygon();
    poly.options = { fillColor: "#ff0000" };
    poly.setStyle = vi.fn();
    const line = new L.Polyline();
    line.options = { color: "#000000" };
    line.setStyle = vi.fn();
    const mixed = {
      options: {},
      eachLayer: vi.fn((fn: (child: unknown) => void) => {
        fn(poly);
        fn(line);
      }),
      getBounds: vi.fn(() => ({
        isValid: vi.fn(() => true),
        getSouthWest: vi.fn(() => ({ lat: 0, lng: 0 })),
        getNorthEast: vi.fn(() => ({ lat: 1, lng: 1 })),
      })),
    };
    manager.registerLayer({
      id: "mixed1",
      name: "Mixed",
      layer: mixed as never,
    });
    ui.runtimeStore.setFields("mixed1", [{ name: "count", numeric: true }]);
    expect(layerCanFill(ui, "mixed1")).toBe(true);

    const item = findItem(ui, "mixed1");
    ui.openStylePanel("mixed1");
    expect(fillRow(item)).not.toBeNull();
  });

  it("layerCanFill is false for a POINT geometry type — no fill axis", () => {
    // A surface that reports POINT (not POLYGON/LINE/UNKNOWN) has no fill
    // concept: the early-return guard at hasFillGeometry L85 rejects it
    // before the leaf walk. In reality Marker/Point layers report POINT and
    // never enter the walkStyleLeaves path.
    const marker = new L.Marker();
    marker.options = {};
    manager.registerLayer({
      id: "point1",
      name: "Points",
      layer: marker as never,
    });
    const fake = {
      capabilities: { opacity: "pane", zoomRange: "pane" },
      geometryType: () => "point",
    };
    vi.spyOn(ui.c, "surfaceFor").mockReturnValue(fake as never);
    expect(layerCanFill(ui, "point1")).toBe(false);
  });

  it("layerCanFill is false when the mixed layer resolves no Leaflet object", () => {
    // UNKNOWN geometry with no layer object to walk — the gate must not
    // assume leaves exist when it cannot reach them. In reality a missing
    // layer also flips the surface capabilities to "none", so this state is
    // only reachable through a surface that still reports UNKNOWN.
    manager.registerLayer({
      id: "mixed2",
      name: "Mixed2",
      layer: null as never,
    });
    manager.layerRegistry.get("mixed2")!.layer = null;
    const fake = {
      capabilities: { opacity: "pane", zoomRange: "pane" },
      geometryType: () => "unknown",
    };
    vi.spyOn(ui.c, "surfaceFor").mockReturnValue(fake as never);

    expect(layerCanFill(ui, "mixed2")).toBe(false);
  });

  it("layerCanFill is true for a circle layer (Circle extends Polyline)", () => {
    // Real Leaflet: Circle is a Polyline subclass, so the geometry type
    // reports LINE — but Circle/CircleMarker carry a fill, so the areal gate
    // must not classify them as stroke-only.
    const circle = new L.Circle();
    circle.options = { fillColor: "#ff0000" };
    circle.setStyle = vi.fn();
    const layer = {
      options: {},
      eachLayer: vi.fn((fn: (child: unknown) => void) => fn(circle)),
      getBounds: vi.fn(() => ({
        isValid: vi.fn(() => true),
        getSouthWest: vi.fn(() => ({ lat: 0, lng: 0 })),
        getNorthEast: vi.fn(() => ({ lat: 1, lng: 1 })),
      })),
    };
    manager.registerLayer({
      id: "circle1",
      name: "Circles",
      layer: layer as never,
    });
    ui.runtimeStore.setFields("circle1", [{ name: "count", numeric: true }]);

    expect(layerCanFill(ui, "circle1")).toBe(true);
    const item = findItem(ui, "circle1");
    ui.openStylePanel("circle1");
    expect(fillRow(item)).not.toBeNull();
  });

  // Gate unification: the third condition requires a real setStyle
  // leaf behind the layer. An empty group has eachLayer but yields no
  // children, so the carrier check finds no setStyle leaf to write to.

  it("layerCanFill is false for an empty group — eachLayer walks nothing", () => {
    manager.registerLayer({
      id: "empty1",
      name: "E",
      layer: {
        options: {},
        eachLayer: vi.fn(() => {
          // no children to dispatch
        }),
        getBounds: vi.fn(() => ({
          isValid: vi.fn(() => true),
          getSouthWest: vi.fn(() => ({ lat: 0, lng: 0 })),
          getNorthEast: vi.fn(() => ({ lat: 1, lng: 1 })),
        })),
      } as never,
    });
    expect(layerCanFill(ui, "empty1")).toBe(false);
  });

  it("the swatch resolves a named authored color through the browser probe", () => {
    // jsdom cannot parse named colors and degrades to the default; the real
    // picker resolves them (Chromium: "gray" → #808080). The important
    // contract is that a non-hex authored value never reaches the input raw.
    const fixture = initWithFillLayer();
    fixture.fillLayer.leaves[0].options.fillColor = "gray";
    fixture.ui.openStylePanel("overlay1");
    const item = findItem(fixture.ui, "overlay1");
    const value = fillInput(item)!.value;
    expect(value).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("the fill row is absent for a delegated drawer", () => {
    // Canvas + styleSetters → delegated drawer; even though the drawer has
    // its own Layer section, it excludes fill because LayerControl does not
    // own the write for a third-party layer.
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleSetters: { labelShow: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");
    expect(fillRow(item)).toBeNull();
  });

  it("the fill row is absent for a MarkerCluster surface", () => {
    manager.registerLayer({
      id: "cluster2",
      name: "Cluster2",
      layer: { options: {}, eachLayer: vi.fn(), _topClusterLevel: {} } as never,
    });
    ui.runtimeStore.setFields("cluster2", [{ name: "count", numeric: true }]);
    const item = findItem(ui, "cluster2");
    ui.openStylePanel("cluster2");
    expect(fillRow(item)).toBeNull();
  });

  // ─────────────────── commit + persistence ───────────────────

  it("commitFillColor writes to the map, persists, and marks the override", () => {
    const setLayer = vi.spyOn(manager.persistence, "schedule");

    commitNow(ui, "overlay1", "color", "#ff0000");

    expect(getIntent(ui, "overlay1", "fillColor")).toBe("#ff0000");
    expect(ui.intentStore.isUserSet("overlay1", "fillColor")).toBe(true);
    expect(setLayer).toHaveBeenCalled();
    const fields = setLayer.mock.calls.at(-1)![0] as {
      layers: () => Record<string, { fillColor?: string; overrides?: string[] }>;
    };
    expect(fields.layers().overlay1.fillColor).toBe("#ff0000");
    expect(fields.layers().overlay1.overrides).toContain("fillColor");
  });

  it("commitFillColor normalizes #rgb to #rrggbb before persisting", () => {
    commitNow(ui, "overlay1", "color", "#f00");

    expect(getIntent(ui, "overlay1", "fillColor")).toBe("#ff0000");
  });

  it("commitFillColor no-ops when the value did not change", () => {
    setIntent(ui, "overlay1", "fillColor", "#ff0000");
    const setLayer = vi.spyOn(manager.persistence, "schedule");

    commitNow(ui, "overlay1", "color", "#ff0000");

    expect(setLayer).not.toHaveBeenCalled();
  });

  it("applyFillToLayer calls setStyle on every leaf with one it exposes", () => {
    setIntent(ui, "overlay1", "fillColor", "#123456");
    applyFillToLayer(ui, "overlay1");

    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",
      fill: true,
    });
    expect(fillLayer.leaves[1].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",
      fill: true,
    });
  });

  it("coalesces same-frame commits into one walk", () => {
    // A color-picker drag revisits every step; each applyFillToLayer pass is
    // a sweep over every leaf. The commit channel must collapse a burst into
    // one walk per animation frame.
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    commitFillColor(ui, "overlay1", "#111111");
    commitFillColor(ui, "overlay1", "#222222");
    commitFillColor(ui, "overlay1", "#333333");

    // trailing rAF: no walk has run yet
    expect(fillLayer.leaves[0].setStyle).not.toHaveBeenCalled();

    // one frame delivers the latest intent in a single sweep
    for (const cb of frames.splice(0)) cb();
    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledTimes(1);
    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#333333",
      fill: true,
    });
    expect(fillLayer.leaves[1].setStyle).toHaveBeenCalledTimes(1);
  });

  it("flush delivers the terminal value when the drag ends", () => {
    // change / blur / panel close must flush the trailing frame: the last
    // commit is written to intent immediately but the walk is deferred, so
    // without a flush the map would keep the previous color.
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    commitFillColor(ui, "overlay1", "#333333");
    flushStyleDimApply(FACE.FILL, "overlay1");

    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#333333",
      fill: true,
    });
    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledTimes(1);
    // a second flush is a no-op — the terminal value already landed
    flushStyleDimApply(FACE.FILL, "overlay1");
    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledTimes(1);
  });

  it("flush after the terminal commit matches a direct applyFillToLayer write", () => {
    // Value-identity pin: the deferred path must land the same setStyle
    // payload a synchronous applyFillToLayer would have written.
    const leaf = fillLayer.leaves[0];
    setIntent(ui, "overlay1", "fillColor", "#654321");
    setIntent(ui, "overlay1", "fillOpacity", 0.4);
    applyFillToLayer(ui, "overlay1");
    const syncCall = leaf.setStyle.mock.calls.at(-1);

    leaf.setStyle.mockClear();
    fillLayer.leaves[1].setStyle.mockClear();
    commitFillColor(ui, "overlay1", "#111111");
    commitFillColor(ui, "overlay1", "#654321");
    commitFillOpacity(ui, "overlay1", 40);
    flushStyleDimApply(FACE.FILL, "overlay1");

    expect(leaf.setStyle.mock.calls.at(-1)).toEqual(syncCall);
    expect(leaf.setStyle).toHaveBeenCalledWith({
      fillColor: "#654321",
      fillOpacity: 0.4,
      fill: true,
    });
  });

  it("opacity input change flushes the deferred walk without waiting for rAF", () => {
    // bindLiveNumber owns onchange (clamp + commit); the flush is chained
    // after it so the terminal opacity lands on the map immediately.
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const row = item.querySelector(`.${CONST.CLASSES.STYLE_FILL_BLOCK}`) as HTMLElement;
    bindFillRow(ui, "overlay1", row);
    const opacity = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER}`,
    ) as HTMLInputElement;
    opacity.value = "40";
    opacity.dispatchEvent(new Event("change", { bubbles: true }));

    // An opacity-only commit pulls the author's color back in the same
    // payload, so nothing an earlier arm left can sit under the opacity.
    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#aabbcc",
      fillOpacity: 0.4,
      fill: true,
    });
  });

  it("color input change chains the previous handler and flushes", () => {
    // The color binder must never overwrite a future onchange: the new
    // handler runs the previous one first, then flushes the deferred walk.
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const row = item.querySelector(`.${CONST.CLASSES.STYLE_FILL_BLOCK}`) as HTMLElement;
    const color = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`,
    ) as HTMLInputElement;
    const prior = vi.fn();
    color.onchange = prior;
    bindFillRow(ui, "overlay1", row);
    color.value = "#445544";
    color.dispatchEvent(new Event("input", { bubbles: true }));
    color.dispatchEvent(new Event("change", { bubbles: true }));

    expect(prior).toHaveBeenCalledTimes(1);
    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#445544",
      fill: true,
    });
  });

  it("color input blur flushes the deferred walk", () => {
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const row = item.querySelector(`.${CONST.CLASSES.STYLE_FILL_BLOCK}`) as HTMLElement;
    bindFillRow(ui, "overlay1", row);
    const color = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`,
    ) as HTMLInputElement;
    color.value = "#222222";
    color.dispatchEvent(new Event("input", { bubbles: true }));
    expect(fillLayer.leaves[0].setStyle).not.toHaveBeenCalled();
    color.dispatchEvent(new Event("blur", { bubbles: true }));

    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#222222",
      fill: true,
    });
  });

  it("closing the style panel flushes a pending fill walk", () => {
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const row = item.querySelector(`.${CONST.CLASSES.STYLE_FILL_BLOCK}`) as HTMLElement;
    bindFillRow(ui, "overlay1", row);
    const color = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`,
    ) as HTMLInputElement;
    color.value = "#333333";
    color.dispatchEvent(new Event("input", { bubbles: true }));

    closeStylePanel(ui, false);

    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#333333",
      fill: true,
    });
  });

  it("FILL_DIMENSION.value reports the stored choice over the authored one", () => {
    expect(FILL_DIMENSION.value!(ui, "overlay1")).toEqual({
      color: "#aabbcc",
      opacity: 0.5,
      mode: "solid",
    });
    commitNow(ui, "overlay1", "color", "#445566");
    commitNow(ui, "overlay1", "opacity", 80);
    expect(FILL_DIMENSION.value!(ui, "overlay1")).toEqual({
      color: "#445566",
      opacity: 0.8,
      mode: "solid",
    });
    expect(FILL_DIMENSION.value!(ui, "ghost")).toBeUndefined();
  });

  it("FILL_DIMENSION.value reports the ramp arm when the map is painted by value", () => {
    // A ramp config without an explicit mode is the pre-fillMode record shape
    // and still paints the ramp, so the descriptor must say "ramp" rather than
    // the stored mode's solid fallback — or the panel would claim solid while
    // the map is painted by value.
    setIntent(ui, "overlay1", "fillRamp", {
      field: "count",
      method: "equal",
      classes: 3,
      scheme: "Reds",
    });

    expect(FILL_DIMENSION.value!(ui, "overlay1")).toMatchObject({
      mode: "ramp",
      ramp: { field: "count", method: "equal", classes: 3, scheme: "Reds" },
    });

    // An explicit solid mode wins over a stored ramp config — the config is
    // kept for the next switch but the arm is solid.
    setIntent(ui, "overlay1", "fillMode", "solid");
    expect(FILL_DIMENSION.value!(ui, "overlay1")).toMatchObject({ mode: "solid" });
  });

  it("unregister drops the fill scheduler entry — no Map residue for dead ids", () => {
    // The scheduler Map is keyed by layer id and would otherwise outlive
    // the layer: a churning map (Heatmap empty/reload, user delete) would
    // accumulate boxes. Unregister must cancel the pending frame and free
    // the entry.
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    commitFillColor(ui, "overlay1", "#333333");
    expect(hasStyleDimApply(FACE.FILL, "overlay1")).toBe(true);

    manager.unregisterLayer("overlay1");
    expect(hasStyleDimApply(FACE.FILL, "overlay1")).toBe(false);
    // the cancelled frame must not paint into the dead layer
    for (const cb of frames.splice(0)) cb();
    expect(fillLayer.leaves[0].setStyle).not.toHaveBeenCalled();
  });

  it("dropStyleDimApplies is a no-op for an id with no entry", () => {
    expect(() => dropStyleDimApplies("ghost")).not.toThrow();
    expect(hasStyleDimApply(FACE.FILL, "ghost")).toBe(false);
  });

  it("forces fill on when the user sets a fill color, so a fill:false path becomes visible", () => {
    // Mirror of the border stroke fix: an author `fill: false` (or Leaflet
    // Path painting none) must not swallow the user's fillColor write.
    fillLayer.leaves[0].options.fill = false;
    fillLayer.leaves[1].options.fill = false;
    setIntent(ui, "overlay1", "fillColor", "#123456");
    applyFillToLayer(ui, "overlay1");

    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",
      fill: true,
    });
    expect(fillLayer.leaves[1].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",
      fill: true,
    });
  });

  it("forces fill on when the user sets a fill opacity", () => {
    setIntent(ui, "overlay1", "fillOpacity", 0.8);
    applyFillToLayer(ui, "overlay1");

    // The author's color rides the same payload: the opacity does not hide
    // a color the leaf never claimed.
    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#aabbcc",
      fillOpacity: 0.8,
      fill: true,
    });
  });

  it("applyFillToLayer is a silent no-op for a layer with no leaves", () => {
    // No honest write → do not persist a broken state. The gate
    // already prevents commit from reaching here for a non-vector layer,
    // but the walker itself must not throw on a group whose eachLayer
    // dispatches nothing.
    manager.registerLayer({
      id: "empty1",
      name: "Empty",
      layer: { options: {}, eachLayer: vi.fn() } as never,
    });
    setIntent(ui, "empty1", "fillColor", "#123456");
    expect(() => applyFillToLayer(ui, "empty1")).not.toThrow();
  });

  it("applyFillToLayer is a no-op when the layer is not in the registry", () => {
    setIntent(ui, "ghost", "fillColor", "#123456");
    expect(() => applyFillToLayer(ui, "ghost")).not.toThrow();
  });

  it("commitFillColor walks past a node with no setStyle or eachLayer", () => {
    // The leaf walk in applyFillToLayer falls through a leaf that exposes
    // neither a setter nor children — it must not throw, and the color
    // still commits.
    const fixture = initWithFillLayer();
    fixture.fillLayer.leaves[1] = { options: {} } as never;

    expect(() => commitFillColor(fixture.ui, "overlay1", "#ff0000")).not.toThrow();
    expect(getIntent(fixture.ui, "overlay1", "fillColor")).toBe("#ff0000");
  });

  it("mouseout on a leaf re-applies the user's fill after folium resets it", () => {
    // folium's highlight_on_hover restores the ORIGINAL style on mouseout;
    // the fill row's listener must reapply the user's color and opacity so
    // a hover cannot undo them.
    const fixture = initWithFillLayer();
    let handler: (() => void) | null = null;
    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0.5, fill: true },
      feature: { geometry: { type: "Polygon" } },
      getLatLngs: RING,
      setStyle: vi.fn(),
      on: vi.fn((_type: string, fn: () => void) => {
        handler = fn;
      }),
    };
    fixture.fillLayer.leaves[0] = leaf;
    setIntent(fixture.ui, "overlay1", "fillColor", "#123456");
    setIntent(fixture.ui, "overlay1", "fillOpacity", 0.4);

    applyFillToLayer(fixture.ui, "overlay1");
    expect(leaf.setStyle).toHaveBeenLastCalledWith({
      fillColor: "#123456",
      fillOpacity: 0.4,
      fill: true,
    });

    // folium's mouseout handler sets the original style back…
    leaf.setStyle({ fillColor: "#aabbcc", fillOpacity: 0.5, fill: true });
    // …and our listener restores the user's fill.
    handler!();

    expect(leaf.setStyle).toHaveBeenLastCalledWith({
      fillColor: "#123456",
      fillOpacity: 0.4,
      fill: true,
    });
  });

  it("mouseout on a leaf with no stored fill does not touch the style", () => {
    const fixture = initWithFillLayer();
    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0.5, fill: true },
      feature: { geometry: { type: "Polygon" } },
      getLatLngs: RING,
      setStyle: vi.fn(),
      on: vi.fn(),
    };
    fixture.fillLayer.leaves[0] = leaf;
    applyFillToLayer(fixture.ui, "overlay1"); // nothing stored — early return

    // applyFillToLayer never reached the walk, so no listener is attached:
    // folium's own hover handling stays untouched for an uncommitted layer.
    expect(leaf.on).not.toHaveBeenCalled();
  });

  it("mouseout reapplies only the stored fill color", () => {
    const fixture = initWithFillLayer();
    let handler: (() => void) | null = null;
    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0.5, fill: true },
      feature: { geometry: { type: "Polygon" } },
      getLatLngs: RING,
      setStyle: vi.fn(),
      on: vi.fn((_type: string, fn: () => void) => {
        handler = fn;
      }),
    };
    fixture.fillLayer.leaves[0] = leaf;
    setIntent(fixture.ui, "overlay1", "fillColor", "#123456");

    applyFillToLayer(fixture.ui, "overlay1");
    handler!();

    // fillOpacity is absent from the maps, so the reapply omits it — the
    // author's opacity stays in force.
    expect(leaf.setStyle).toHaveBeenLastCalledWith({
      fillColor: "#123456",
      fill: true,
    });
  });

  it("mouseout reapplies only the stored fill opacity", () => {
    const fixture = initWithFillLayer();
    let handler: (() => void) | null = null;
    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0.5, fill: true },
      feature: { geometry: { type: "Polygon" } },
      getLatLngs: RING,
      setStyle: vi.fn(),
      on: vi.fn((_type: string, fn: () => void) => {
        handler = fn;
      }),
    };
    fixture.fillLayer.leaves[0] = leaf;
    setIntent(fixture.ui, "overlay1", "fillOpacity", 0.4);

    applyFillToLayer(fixture.ui, "overlay1");
    handler!();

    expect(leaf.setStyle).toHaveBeenLastCalledWith({ fillOpacity: 0.4, fill: true });
  });

  it("mouseout after the fill was reset does not rewrite the style", () => {
    const fixture = initWithFillLayer();
    let handler: (() => void) | null = null;
    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0.5, fill: true },
      feature: { geometry: { type: "Polygon" } },
      getLatLngs: RING,
      setStyle: vi.fn(),
      on: vi.fn((_type: string, fn: () => void) => {
        handler = fn;
      }),
    };
    fixture.fillLayer.leaves[0] = leaf;
    setIntent(fixture.ui, "overlay1", "fillColor", "#123456");

    applyFillToLayer(fixture.ui, "overlay1");
    // Reset clears the maps; the listener from the earlier commit is still
    // attached (reset does not unbind it), so the reapply must no-op.
    clearIntent(fixture.ui, "overlay1", "fillColor");
    clearIntent(fixture.ui, "overlay1", "fillOpacity");
    leaf.setStyle.mockClear();

    handler!();

    expect(leaf.setStyle).not.toHaveBeenCalled();
  });

  it("attaches the reapply listener to leaves, not to the group", () => {
    // A folium GeoJson is a LayerGroup that ALSO exposes setStyle. The
    // listener must live on each leaf — mouseout fires there, never on the
    // group — so a group with both methods must still recurse.
    const leaves = [
      {
        options: { fillColor: "#aabbcc", fillOpacity: 0.5, fill: true },
        feature: { geometry: { type: "Polygon" } },
        getLatLngs: RING,
        setStyle: vi.fn(),
        on: vi.fn(),
      },
      {
        options: { fillColor: "#ddeeff", fillOpacity: 0.7, fill: true },
        feature: { geometry: { type: "Polygon" } },
        getLatLngs: RING,
        setStyle: vi.fn(),
        on: vi.fn(),
      },
    ];
    const group = {
      options: {},
      setStyle: vi.fn(),
      eachLayer: vi.fn((fn: (child: unknown) => void) =>
        leaves.forEach(child => fn(child)),
      ),
      getBounds: vi.fn(() => ({
        isValid: vi.fn(() => true),
        getSouthWest: vi.fn(() => ({ lat: 0, lng: 0 })),
        getNorthEast: vi.fn(() => ({ lat: 1, lng: 1 })),
      })),
    };
    manager.registerLayer({
      id: "group1",
      name: "Group",
      layer: group as never,
    });
    ui.runtimeStore.setFields("group1", [{ name: "count", numeric: true }]);
    setIntent(ui, "group1", "fillColor", "#123456");

    applyFillToLayer(ui, "group1");

    expect(leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",
      fill: true,
    });
    expect(leaves[1].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",
      fill: true,
    });
    expect(leaves[0].on).toHaveBeenCalledWith("mouseout", expect.any(Function));
    expect(leaves[1].on).toHaveBeenCalledWith("mouseout", expect.any(Function));
    expect(group.setStyle).not.toHaveBeenCalled();
  });

  it("the reapply listener calls setStyle with the leaf as `this`", () => {
    // Leaflet's Path.setStyle reads `this.options`; the detached reference
    // captured by the listener must stay bound to its layer or the reapply
    // throws "Cannot convert undefined or null to object".
    const fixture = initWithFillLayer();
    let handler: (() => void) | null = null;
    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0.5, fill: true },
      feature: { geometry: { type: "Polygon" } },
      getLatLngs: RING,
      setStyle: vi.fn(function (
        this: { options: Record<string, unknown> },
        s: Record<string, unknown>,
      ) {
        Object.assign(this.options, s);
      }),
      on: vi.fn((_type: string, fn: () => void) => {
        handler = fn;
      }),
    };
    fixture.fillLayer.leaves[0] = leaf;
    setIntent(fixture.ui, "overlay1", "fillColor", "#123456");

    applyFillToLayer(fixture.ui, "overlay1");
    handler!();

    expect(leaf.options.fillColor).toBe("#123456");
  });

  // ─────────────────── color basemap ───────────────────

  const registerColorBasemap = () => {
    manager.registerLayer({
      id: CONST.SOLID_BASEMAP_ID,
      name: "Color",
      role: "base",
      color: CONST.COLOR.DEFAULT,
    });
    const li = manager.layerRegistry.get(CONST.SOLID_BASEMAP_ID)!;
    (manager.surfaceFor(li) as any).capabilities = {
      opacity: "pane",
      zoomRange: "none",
      relocatable: false,
      bounds: false,
      fill: "native",
      stroke: "none",
    };
    ui.runtimeStore.setFields(CONST.SOLID_BASEMAP_ID, []);
  };

  it("layerCanFill returns true for a color basemap", () => {
    registerColorBasemap();
    expect(layerCanFill(ui, CONST.SOLID_BASEMAP_ID)).toBe(true);
  });

  it("applyFillToLayer routes a color basemap to showSolidBasemap, not leaf walk", () => {
    registerColorBasemap();
    setIntent(ui, CONST.SOLID_BASEMAP_ID, "fillColor", "#ff0000");
    applyFillToLayer(ui, CONST.SOLID_BASEMAP_ID);
    expect(ui.currentColor).toBe("#ff0000");
  });

  it("resetLayerFill restores the color basemap to its default", () => {
    registerColorBasemap();
    setIntent(ui, CONST.SOLID_BASEMAP_ID, "fillColor", "#ff0000");
    resetLayerFill(ui, CONST.SOLID_BASEMAP_ID);
    expect(ui.currentColor).toBe(CONST.COLOR.DEFAULT);
    expect(getIntent(ui, CONST.SOLID_BASEMAP_ID, "fillColor")).toBeUndefined();
  });

  it("buildFillRow renders only the color swatch for a color basemap", () => {
    registerColorBasemap();
    const row = buildFillRow(ui, CONST.SOLID_BASEMAP_ID);
    expect(
      row.querySelector(`.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`),
    ).not.toBeNull();
    expect(row.querySelector(`.${CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER}`)).toBeNull();
  });

  it("applyFillToLayer on a color basemap with only opacity skips showSolidBasemap", () => {
    // L252: `color === undefined` branch — opacity-only on a color basemap
    // must not call showSolidBasemap (there is no color to show).
    registerColorBasemap();
    setIntent(ui, CONST.SOLID_BASEMAP_ID, "fillOpacity", 0.5);
    applyFillToLayer(ui, CONST.SOLID_BASEMAP_ID);
    // currentColor is untouched because only opacity was set
    expect(ui.currentColor).toBe(CONST.COLOR.DEFAULT);
  });

  it("commitFillColor on a color basemap never writes fillOpacity", () => {
    // A color basemap has no fillOpacity concept — the color routes to
    // showSolidBasemap and the fill-opacity map stays empty.
    registerColorBasemap();
    commitFillColor(ui, CONST.SOLID_BASEMAP_ID, "#ff0000");
    flushStyleDimApply(FACE.FILL, CONST.SOLID_BASEMAP_ID);
    expect(getIntent(ui, CONST.SOLID_BASEMAP_ID, "fillColor")).toBe("#ff0000");
    expect(getIntent(ui, CONST.SOLID_BASEMAP_ID, "fillOpacity")).toBeUndefined();
    expect(ui.currentColor).toBe("#ff0000");
  });

  it("commitFillColor handles a layer id that is not registered yet", () => {
    expect(() => commitFillColor(ui, "late-layer", "#ff0000")).not.toThrow();
    expect(getIntent(ui, "late-layer", "fillColor")).toBe("#ff0000");
    expect(ui.intentStore.isUserSet("late-layer", "fillColor")).toBe(true);
  });

  it("resetLayerFill is a no-op for a registered layer with no Leaflet object", () => {
    manager.registerLayer({
      id: "canvas1",
      name: "Canvas",
      canvas: document.createElement("canvas"),
    });
    setIntent(ui, "canvas1", "fillColor", "#ff0000");
    ui.intentStore.seedProvenance("canvas1", ["fillColor"]);

    resetLayerFill(ui, "canvas1");

    expect(getIntent(ui, "canvas1", "fillColor")).toBeUndefined();
    expect(ui.intentStore.dumpProvenance()["canvas1"]).toBeUndefined();
  });

  it("resetLayerFill walks past a leaf with no setStyle or eachLayer", () => {
    const fixture = initWithFillLayer();
    fixture.fillLayer.leaves[1] = { options: {} } as never;
    commitNow(fixture.ui, "overlay1", "color", "#ff0000");

    expect(() => resetLayerFill(fixture.ui, "overlay1")).not.toThrow();
  });

  it("captureBase falls back to Leaflet default when fillOpacity is unset too", () => {
    const fixture = initWithFillLayer();
    delete fixture.fillLayer.leaves[0].options.fillColor;
    delete fixture.fillLayer.leaves[0].options.fillOpacity;

    commitNow(fixture.ui, "overlay1", "color", "#ff0000");
    resetLayerFill(fixture.ui, "overlay1");

    // No authored color or opacity — reset restores the Leaflet color
    // fallback and the 0.2 fillOpacity default, both explicit so the user's
    // written values cannot linger (setStyle merges, it does not delete).
    expect(fixture.fillLayer.leaves[0].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#3388ff",
      fillOpacity: 0.2,
      fill: true,
    });
  });

  it("bindFillRow tolerates a row without either control", () => {
    // Defensive: the row builder always emits both inputs, but a foreign or
    // partial row must not throw when bound.
    const row = document.createElement("div");
    expect(() => bindFillRow(ui, "overlay1", row)).not.toThrow();
  });

  // ─────────────────── panel integration ───────────────────

  it("changing the swatch commits the color through the live binder", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const input = fillInput(item)!;

    input.value = "#3366cc";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "fillColor")).toBe("#3366cc");
    expect(ui.intentStore.isUserSet("overlay1", "fillColor")).toBe(true);
  });

  it("the fill opacity input commits through the live binder", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const input = item.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER}`,
    ) as HTMLInputElement;

    input.value = "50";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "fillOpacity")).toBe(0.5);
    expect(ui.intentStore.isUserSet("overlay1", "fillOpacity")).toBe(true);
  });

  it("the swatch keeps the value it was committed (no forced re-read)", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const input = fillInput(item)!;

    input.value = "#3366cc";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // The input is not rewritten by the commit pass — the value stays put
    // so the picker position is not reset while the user is holding it.
    expect(input.value).toBe("#3366cc");
  });

  // ─────────────────── reset ───────────────────

  it("resetLayerFill drops the persisted entry and the override marker", () => {
    setIntent(ui, "overlay1", "fillColor", "#ff0000");
    ui.intentStore.seedProvenance("overlay1", ["fillColor"]);
    const setLayer = vi.spyOn(manager.persistence, "schedule");

    resetLayerFill(ui, "overlay1");

    expect(getIntent(ui, "overlay1", "fillColor")).toBeUndefined();
    expect(ui.intentStore.isUserSet("overlay1", "fillColor")).toBe(false);
    expect(setLayer).toHaveBeenCalled();
  });

  it("resetLayerFill restores the authored fill color on each leaf", () => {
    // First commit captures each leaf's authored base.
    commitNow(ui, "overlay1", "color", "#ff0000");
    resetLayerFill(ui, "overlay1");

    expect(fillLayer.leaves[0].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#aabbcc",
      fillOpacity: 0.5,
      fill: true,
    });
    expect(fillLayer.leaves[1].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#aabbcc",
      fillOpacity: 0.7,
      fill: true,
    });
  });

  it("resetLayerFill restores the author's fill flag, including fill:false", () => {
    // Write forces fill:true so the user's color is visible; Reset must put
    // the author's original fill:false back — leaving fill:true would paint
    // a fill nobody authored (border fix's fill twin).
    fillLayer.leaves[0].options.fill = false;
    fillLayer.leaves[1].options.fill = false;
    commitNow(ui, "overlay1", "color", "#ff0000");
    expect(fillLayer.leaves[0].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#ff0000",
      fill: true,
    });
    fillLayer.leaves[0].setStyle.mockClear();
    fillLayer.leaves[1].setStyle.mockClear();

    resetLayerFill(ui, "overlay1");

    expect(fillLayer.leaves[0].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#aabbcc",
      fillOpacity: 0.5,
      fill: false,
    });
    expect(fillLayer.leaves[1].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#aabbcc",
      fillOpacity: 0.7,
      fill: false,
    });
  });

  it("resetLayerFill restores the Leaflet default when options.fillColor was unset", () => {
    delete fillLayer.leaves[0].options.fillColor;
    commitNow(ui, "overlay1", "color", "#ff0000");
    resetLayerFill(ui, "overlay1");

    // No authored color — the fallback is Leaflet's own default.
    expect(fillLayer.leaves[0].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#3388ff",
      fillOpacity: 0.5,
      fill: true,
    });
  });

  it("reset on a missing layer id is a no-op", () => {
    expect(() => resetLayerFill(ui, "ghost")).not.toThrow();
  });

  it("the panel's Reset button restores the fill color", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const input = fillInput(item)!;
    input.value = "#ff0000";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const reset = item.querySelector(".foliplus-style-reset-btn")!;
    reset.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "fillColor")).toBeUndefined();
    expect(ui.intentStore.isUserSet("overlay1", "fillColor")).toBe(false);
  });
});

describe("buildFillRow", () => {
  let ui: LayerUI;
  let manager: LayerController;

  beforeEach(() => {
    const fixture = initWithFillLayer();
    ui = fixture.ui;
    manager = fixture.manager;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("emits the fill block: mode row + detail slot with the swatch input", () => {
    const row = buildFillRow(ui, "overlay1");

    expect(row.classList.contains(CONST.CLASSES.STYLE_FILL_BLOCK)).toBe(true);
    const modeRow = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_ROW}`,
    ) as HTMLElement;
    expect(modeRow.classList.contains(CONST.CLASSES.FORM_ROW)).toBe(true);
    expect(
      row.querySelector(`.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`),
    ).not.toBeNull();
    expect(row.querySelector(`.${CONST.CLASSES.STYLE_FILL_DETAIL}`)).not.toBeNull();
    expect(
      row.querySelector(`.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`),
    ).not.toBeNull();
  });

  it("the mode row renders the locale key's translated value", () => {
    const row = buildFillRow(ui, "overlay1");
    const label = row.querySelector(`.${CONST.CLASSES.FORM_LABEL}`);

    expect(label?.textContent).toBe("LayerControl.style_fill_mode");
  });

  it("defaults to the solid arm with the by-value option available", () => {
    const row = buildFillRow(ui, "overlay1");
    const select = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`,
    ) as HTMLSelectElement;
    const rampOption = select.querySelector(
      'option[value="ramp"]',
    ) as HTMLOptionElement;

    expect(select.value).toBe("solid");
    expect(rampOption.disabled).toBe(false);
  });

  it("renders only the solid arm when the layer has no numeric field", () => {
    const fixture = initWithFillLayer();
    // Count is the only numeric property; make it a string-only layer.
    fixture.manager.registerLayer({
      id: "textonly",
      name: "Text",
      role: "overlay",
      layer: (() => {
        const leaf = new L.Polygon() as L.Polygon & {
          options: Record<string, unknown>;
          feature: { properties: Record<string, unknown> };
          setStyle: ReturnType<typeof vi.fn>;
        };
        leaf.options = { fillColor: "#aabbcc", fill: true };
        leaf.feature = { properties: { name: "a" } };
        leaf.setStyle = vi.fn();
        return {
          options: {},
          eachLayer: (fn: (child: unknown) => void) => fn(leaf),
          getBounds: () => ({
            isValid: () => true,
            getSouthWest: () => ({ lat: 0, lng: 0 }),
            getNorthEast: () => ({ lat: 1, lng: 1 }),
          }),
        };
      })(),
    });
    fixture.ui.runtimeStore.setFields("textonly", [{ name: "name", numeric: false }]);

    const row = buildFillRow(fixture.ui, "textonly");

    // No mode select at all: a layer with one honest arm does not get a
    // dropdown that can only ever show that arm. No hint text either.
    expect(row.querySelector(`.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`)).toBeNull();
    expect(
      row.querySelector(`.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`),
    ).not.toBeNull();
    expect(
      row.querySelector(`.${CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER}`),
    ).not.toBeNull();
  });

  it("puts the solid arm's color and opacity in one row", () => {
    const row = buildFillRow(ui, "overlay1");
    const fillRows = row.querySelectorAll(`.${CONST.CLASSES.STYLE_FILL_ROW}`);

    // One detail row (plus the mode row above it): color and opacity share it.
    expect(fillRows.length).toBe(2);
    const detailRow = fillRows[1];
    expect(
      detailRow.querySelector(`.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`),
    ).not.toBeNull();
    expect(
      detailRow.querySelector(`.${CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER}`),
    ).not.toBeNull();
  });

  it("renders the ramp detail when a stored config says ramp", () => {
    setIntent(ui, "overlay1", "fillMode", "ramp");
    setIntent(ui, "overlay1", "fillRamp", {
      field: "count",
      method: "equal",
      classes: 4,
      scheme: "Reds",
    } as never);

    const row = buildFillRow(ui, "overlay1");
    const select = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`,
    ) as HTMLSelectElement;
    const fieldSelect = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`,
    ) as HTMLSelectElement;
    const methodSelect = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_METHOD_SELECT}`,
    ) as HTMLSelectElement;
    const classes = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_CLASSES_SELECT}`,
    ) as HTMLSelectElement;
    const trigger = row.querySelector(`.${CONST.CLASSES.STYLE_FILL_SCHEME_TRIGGER}`);

    expect(select.value).toBe("ramp");
    expect(fieldSelect.value).toBe("count");
    expect(methodSelect.value).toBe("equal");
    expect(classes.value).toBe("4");
    expect(trigger).not.toBeNull();
    expect(trigger!.textContent?.trim()).toBe("");
    expect(row.querySelector(`.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`)).toBeNull();
  });

  it("labels the ramp row by method and names both selects distinctly", () => {
    // One visible label for two selects: it reads by the primary control —
    // the classification method — the same word the heatmap panel shows. The
    // class count is announced by the count select's own aria label, so the
    // pair stays distinguishable to a screen reader.
    setIntent(ui, "overlay1", "fillMode", "ramp");
    setIntent(ui, "overlay1", "fillRamp", {
      field: "count",
      method: "equal",
      classes: 4,
      scheme: "Reds",
    } as never);

    const row = buildFillRow(ui, "overlay1");
    const method = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_METHOD_SELECT}`,
    ) as HTMLSelectElement;
    const classes = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_CLASSES_SELECT}`,
    ) as HTMLSelectElement;
    const label = method
      .closest(`.${CONST.CLASSES.FORM_ROW}`)!
      .querySelector(`.${CONST.CLASSES.FORM_LABEL}`);

    expect(label?.textContent).toBe("LayerControl.style_method");
    expect(method.getAttribute("aria-label")).toBe("LayerControl.style_method");
    expect(classes.getAttribute("aria-label")).toBe("LayerControl.style_fill_classes");
    expect(method.getAttribute("aria-label")).not.toBe(
      classes.getAttribute("aria-label"),
    );
  });

  it("falls back to the Leaflet default for an unregistered layer", () => {
    // No registry entry, no authored color — the swatch shows Leaflet's own
    // fill default rather than inventing one.
    const row = buildFillRow(ui, "ghost");
    const input = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`,
    ) as HTMLInputElement;

    expect(input.value).toBe("#3388ff");
  });

  it("falls back to the Leaflet default when no leaf declares a fill color", () => {
    const fixture = initWithFillLayer();
    delete fixture.fillLayer.leaves[0].options.fillColor;
    delete fixture.fillLayer.leaves[1].options.fillColor;

    const row = buildFillRow(fixture.ui, "overlay1");
    const input = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`,
    ) as HTMLInputElement;

    expect(input.value).toBe("#3388ff");
  });

  it("the fill opacity input allows any integer 0–100 (step 1)", () => {
    // The number field is the precise input; a coarse step would keep the
    // spinner on multiples of 5 while every integer is a legal opacity.
    const row = buildFillRow(ui, "overlay1");
    const input = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER}`,
    ) as HTMLInputElement;

    expect(input.step).toBe("1");
    expect(input.min).toBe("0");
    expect(input.max).toBe("100");
  });

  it("the fill opacity input seeds from the authored fillOpacity", () => {
    // First leaf declares fillOpacity 0.5 — the field shows 50%, not the
    // Leaflet default constant, mirroring how the swatch shows the author's
    // color.
    const row = buildFillRow(ui, "overlay1");
    const input = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER}`,
    ) as HTMLInputElement;

    expect(input.value).toBe("50");
  });

  it("the fill opacity input falls back to 20 when no leaf declares an opacity", () => {
    const fixture = initWithFillLayer();
    delete fixture.fillLayer.leaves[0].options.fillOpacity;
    delete fixture.fillLayer.leaves[1].options.fillOpacity;

    const row = buildFillRow(fixture.ui, "overlay1");
    const input = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER}`,
    ) as HTMLInputElement;

    expect(input.value).toBe("20");
  });

  it("degrades to the default swatch when the browser probe returns a non-hex", () => {
    // The <input type=color> probe always yields hex in jsdom and Chromium;
    // if a UA ever returns garbage, the swatch must not receive it raw.
    const orig = document.createElement.bind(document) as any;
    vi.spyOn(document, "createElement").mockImplementationOnce(
      (tag: string, ...args: unknown[]) => {
        const el = orig(tag, ...args);
        if (tag === "input") {
          Object.defineProperty(el, "value", { get: () => "zzz", set: () => {} });
        }
        return el;
      },
    );
    setIntent(ui, "overlay1", "fillColor", "gray");

    const row = buildFillRow(ui, "overlay1");
    const input = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`,
    ) as HTMLInputElement;

    expect(input.value).toBe("#000000");
  });

  // ─────────────────── captureBase fallback ───────────────────

  it("captureBase falls back to Leaflet default #3388ff when options.fillColor is unset", () => {
    // A bare Leaflet GeoJSON layer with no style function has no
    // options.fillColor — the swatch shows what the browser would paint.
    const fixture = initWithFillLayer();
    delete fixture.fillLayer.leaves[0].options.fillColor;

    commitNow(fixture.ui, "overlay1", "color", "#ff0000");
    resetLayerFill(fixture.ui, "overlay1");

    expect(fixture.fillLayer.leaves[0].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#3388ff",
      fillOpacity: 0.5,
      fill: true,
    });
  });

  // ─────────────────── SVG repaint gate ───────────────────

  it("applyFillToLayer updates the SVG fill attribute (repaint gate)", () => {
    // User report: "改色后没生效". This gate asserts that a color change
    // actually reaches the rendered fill — not just options.fillColor, but
    // the attribute Leaflet paints into the SVG. If Leaflet's setStyle
    // stopped triggering _updateStyle for fillColor-only writes, this test
    // would go red before the fix.
    const fixture = initWithFillLayer();
    const svgFill = vi.fn();
    const path = {
      options: { fillColor: "#aabbcc", fillOpacity: 0.5, fill: true },
      feature: { geometry: { type: "Polygon" } },
      getLatLngs: RING,
      _path: { setAttribute: svgFill },
      _renderer: true as any,
      setStyle: vi.fn(function (this: any, style: Record<string, unknown>) {
        Object.assign(this.options, style);
        // Simulate Leaflet's _updateStyle: set the SVG fill attribute.
        this._path.setAttribute("fill", String(this.options.fillColor ?? ""));
      }),
      _updateStyle: vi.fn(),
      redraw: vi.fn(),
    };
    fixture.fillLayer.leaves[0] = path as never;
    setIntent(fixture.ui, "overlay1", "fillColor", "#ff0000");

    applyFillToLayer(fixture.ui, "overlay1");

    expect(svgFill).toHaveBeenCalledWith("fill", "#ff0000");
    expect(path.options.fillColor).toBe("#ff0000");
  });

  it("commitFillColor changes a hollow layer's color without touching fillOpacity", () => {
    // Honest rendering: a hollow polygon (fillOpacity=0) keeps its hole. The
    // color change is committed and reaches the fill attribute, but
    // fill-opacity stays 0, so the new color is not painted — the author's
    // value is respected rather than silently lifted.
    const fixture = initWithFillLayer();
    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0, fill: true },
      feature: { geometry: { type: "Polygon" } },
      getLatLngs: RING,
      setStyle: vi.fn(),
    };
    fixture.fillLayer.leaves[0] = leaf;

    commitNow(fixture.ui, "overlay1", "color", "#ff0000");

    expect(getIntent(fixture.ui, "overlay1", "fillColor")).toBe("#ff0000");
    expect(getIntent(fixture.ui, "overlay1", "fillOpacity")).toBeUndefined();
    expect(fixture.ui.intentStore.isUserSet("overlay1", "fillOpacity")).toBe(false);
    expect(leaf.setStyle).toHaveBeenCalledWith({ fillColor: "#ff0000", fill: true });
  });

  it("a hollow layer's opacity input still reads 0 after a color change", () => {
    // No fillOpacity override was written, so a reopened panel falls back to
    // the authored 0 — the panel and the map agree the layer is still hollow.
    const fixture = initWithFillLayer();
    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0, fill: true },
      feature: { geometry: { type: "Polygon" } },
      getLatLngs: RING,
      setStyle: vi.fn(),
    };
    fixture.fillLayer.leaves[0] = leaf;

    commitNow(fixture.ui, "overlay1", "color", "#ff0000");

    const row = buildFillRow(fixture.ui, "overlay1");
    const input = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER}`,
    ) as HTMLInputElement;
    expect(input.value).toBe("0");
  });

  it("commitFillColor keeps a user-set fillOpacity (even 0) untouched", () => {
    // An explicit fillOpacity is the user's own choice — the color commit
    // only reads it when building the setStyle payload, never rewrites it.
    const fixture = initWithFillLayer();
    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0, fill: true },
      feature: { geometry: { type: "Polygon" } },
      getLatLngs: RING,
      setStyle: vi.fn(),
    };
    fixture.fillLayer.leaves[0] = leaf;
    setIntent(fixture.ui, "overlay1", "fillOpacity", 0);

    commitNow(fixture.ui, "overlay1", "color", "#ff0000");

    expect(getIntent(fixture.ui, "overlay1", "fillOpacity")).toBe(0);
    expect(leaf.setStyle).toHaveBeenCalledWith({
      fillColor: "#ff0000",
      fillOpacity: 0,
      fill: true,
    });
  });

  it("commitFillOpacity writes to the map, persists, and marks the override", () => {
    const setLayer = vi.spyOn(manager.persistence, "schedule");

    commitNow(ui, "overlay1", "opacity", 50);

    expect(getIntent(ui, "overlay1", "fillOpacity")).toBe(0.5);
    expect(ui.intentStore.isUserSet("overlay1", "fillOpacity")).toBe(true);
    expect(setLayer).toHaveBeenCalled();
  });

  it("commitFillOpacity no-ops when the value did not change", () => {
    setIntent(ui, "overlay1", "fillOpacity", 0.5);
    const setLayer = vi.spyOn(manager.persistence, "schedule");

    commitNow(ui, "overlay1", "opacity", 50);

    expect(setLayer).not.toHaveBeenCalled();
  });

  it("commitFillOpacity clamps out-of-range values", () => {
    commitNow(ui, "overlay1", "opacity", 150);
    expect(getIntent(ui, "overlay1", "fillOpacity")).toBe(1);

    commitNow(ui, "overlay1", "opacity", -10);
    expect(getIntent(ui, "overlay1", "fillOpacity")).toBe(0);
  });

  it("resetLayerFill clears intents.fillOpacity and restores the author's opacity", () => {
    // A fillOpacity the user wrote is dropped by reset: the captured authored
    // base is replayed, so a hollow layer (0) comes back hollow rather than
    // keeping the user's 0.5.
    const fixture = initWithFillLayer();
    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0, fill: true },
      feature: { geometry: { type: "Polygon" } },
      getLatLngs: RING,
      setStyle: vi.fn(),
    };
    fixture.fillLayer.leaves[0] = leaf;

    commitNow(fixture.ui, "overlay1", "color", "#ff0000");
    commitNow(fixture.ui, "overlay1", "opacity", 50);
    expect(getIntent(fixture.ui, "overlay1", "fillOpacity")).toBe(0.5);

    resetLayerFill(fixture.ui, "overlay1");

    expect(getIntent(fixture.ui, "overlay1", "fillOpacity")).toBeUndefined();
    expect(fixture.ui.intentStore.isUserSet("overlay1", "fillOpacity")).toBe(false);
    expect(leaf.setStyle).toHaveBeenLastCalledWith({
      fillColor: "#aabbcc",
      fillOpacity: 0,
      fill: true,
    });
  });
});

describe("replayFillState", () => {
  let ui: LayerUI;
  let manager: LayerController;
  let fillLayer: ReturnType<typeof makeFillableLayer>;

  beforeEach(() => {
    const fixture = initWithFillLayer();
    ui = fixture.ui;
    manager = fixture.manager;
    fillLayer = fixture.fillLayer;
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("applies a stored fill color and opacity onto every leaf", () => {
    setIntent(ui, "overlay1", "fillColor", "#123456");
    setIntent(ui, "overlay1", "fillOpacity", 0.4);

    replayFillState(ui, "overlay1");

    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",
      fillOpacity: 0.4,
      fill: true,
    });
    expect(fillLayer.leaves[1].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",
      fillOpacity: 0.4,
      fill: true,
    });
  });

  it("is a no-op when only one fill dimension is stored", () => {
    setIntent(ui, "overlay1", "fillColor", "#123456");

    replayFillState(ui, "overlay1");

    // The absent dimension is omitted from the write so the author's
    // fillOpacity stays in force.
    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",
      fill: true,
    });
  });

  it("is a no-op for a layer outside the registry", () => {
    setIntent(ui, "ghost", "fillColor", "#123456");
    expect(() => replayFillState(ui, "ghost")).not.toThrow();
  });

  it("its content-change gate reads the same intent-key set the replay does", () => {
    // One array (FILL_INTENT_KEYS) feeds both the gate and the replay loop.
    // Pin the agreement at the boundary: no stored key gates the frame off,
    // a stored key gates it on — so a future intent cannot be replayed
    // without also passing the gate, or vice versa.
    const policy = FILL_DIMENSION.contentChange;
    expect(policy.kind).toBe("frame");
    const when = (policy as { when?: (u: LayerUI, id: string) => boolean }).when!;
    expect(when(ui, "overlay1")).toBe(false);

    setIntent(ui, "overlay1", "fillColor", "#123456");
    expect(when(ui, "overlay1")).toBe(true);
  });

  it("attachUI replays a stored fill onto a registered layer", () => {
    // Regression: the initial layers never go through registerLayer (where
    // the id-specified replay lives), so attach itself must replay fill —
    // otherwise a reload shows the author's default color.
    const fillLayer = makeFillableLayer();
    window.localStorage.setItem(
      CONST.STORAGE.KEY,
      JSON.stringify({
        layers: {
          overlay1: { fillColor: "#123456", overrides: ["fillColor"] },
        },
      }),
    );
    const fixture = initFixture({
      data: [
        { id: "overlay1", name: "Polygons", role: "overlay", layer: fillLayer },
        {
          id: "base1",
          name: "OSM",
          role: "base",
          layer: { options: {}, setZIndex: vi.fn() } as never,
          paneName: "tilePane",
        },
      ],
    });

    expect(getIntent(fixture.manager.ui!, "overlay1", "fillColor")).toBe("#123456");
    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",
      fill: true,
    });
  });

  it("attachUI replays a persisted ramp — a reload keeps the value colors", () => {
    // Regression: a persisted ramp with no solid color used to fall through
    // the empty-intent guard and paint nothing after a reload.
    const rampLayer = makeRampedLayer([1, 5, 9]);
    installChroma(["#111111", "#222222", "#333333"]);
    window.localStorage.setItem(
      CONST.STORAGE.KEY,
      JSON.stringify({
        layers: {
          overlay1: {
            fillMode: "ramp",
            fillRamp: {
              kind: "numeric",
              field: "count",
              method: "equal",
              classes: 3,
              scheme: "Reds",
            },
            overrides: ["fillMode", "fillRamp"],
          },
        },
      }),
    );
    const fixture = initFixture({
      data: [
        { id: "overlay1", name: "Polygons", role: "overlay", layer: rampLayer },
        {
          id: "base1",
          name: "OSM",
          role: "base",
          layer: { options: {}, setZIndex: vi.fn() } as never,
          paneName: "tilePane",
        },
      ],
    });
    fixture.manager.ui!.runtimeStore.setFields("overlay1", [
      { name: "count", numeric: true },
    ]);

    expect(getIntent(fixture.manager.ui!, "overlay1", "fillMode")).toBe("ramp");
    // The redundant default never reaches the apply path.
    expect(
      getIntent(fixture.manager.ui!, "overlay1", "fillRamp")?.kind,
    ).toBeUndefined();
    // Each leaf got the color of its own value class, not the author's.
    const colors = rampLayer.leaves.map(
      leaf => leaf.setStyle.mock.calls.at(-1)![0].fillColor as string,
    );
    expect(colors).toEqual(["#111111", "#222222", "#333333"]);
  });

  it("replays a persisted fillOpacity alongside the ramp color", () => {
    const fixture = initWithRampedLayer([1, 5, 9]);
    installChroma(["#111111", "#222222", "#333333"]);
    setIntent(fixture.ui, "overlay1", "fillMode", "ramp");
    setIntent(fixture.ui, "overlay1", "fillRamp", {
      field: "count",
      method: "equal",
      classes: 3,
      scheme: "Reds",
    });
    // The solid arm's opacity survives the mode switch — the ramp replaces
    // only the color.
    setIntent(fixture.ui, "overlay1", "fillOpacity", 0.25);

    replayFillState(fixture.ui, "overlay1");

    expect(fixture.rampLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#111111",
      fillOpacity: 0.25,
      fill: true,
    });
  });
});

describe("applyFillToLayer — fillMode dispatch", () => {
  const RAMP = {
    field: "count",
    method: "equal" as const,
    classes: 3,
    scheme: "Reds",
  };
  const COLORS = ["#111111", "#222222", "#333333"];

  let manager: LayerController;
  let ui: LayerUI;
  let rampLayer: ReturnType<typeof makeRampedLayer>;

  beforeEach(() => {
    installChroma(COLORS);
    const fixture = initWithRampedLayer([1, 5, 9]);
    manager = fixture.manager;
    ui = fixture.ui;
    rampLayer = fixture.rampLayer;
  });

  afterEach(() => {
    delete globalThis.chroma;
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  const paintedColors = (): string[] =>
    rampLayer.leaves.map(
      leaf => leaf.setStyle.mock.calls.at(-1)![0].fillColor as string,
    );

  it("fillMode=ramp paints by value and ignores the stored solid color", () => {
    setIntent(ui, "overlay1", "fillColor", "#ff0000");
    setIntent(ui, "overlay1", "fillMode", "ramp");
    setIntent(ui, "overlay1", "fillRamp", RAMP);

    applyFillToLayer(ui, "overlay1");

    expect(paintedColors()).toEqual(COLORS);
  });

  it("a ramp config with no explicit mode paints the ramp", () => {
    // The pre-fillMode record shape: the config's presence alone selects the
    // arm, so a persisted record written before fillMode existed still paints.
    setIntent(ui, "overlay1", "fillColor", "#ff0000");
    setIntent(ui, "overlay1", "fillRamp", RAMP);

    applyFillToLayer(ui, "overlay1");

    expect(paintedColors()).toEqual(COLORS);
  });

  it("resolves a stored field the data no longer offers, for display and paint", () => {
    // A stored ramp can outlive its column (a streamed layer replaced its
    // features). The row and the map must agree on the column in use: both
    // resolve the stale name to the first offered field. Before the shared
    // resolution the row showed that field while the map degraded to the
    // author's face.
    setIntent(ui, "overlay1", "fillMode", "ramp");
    setIntent(ui, "overlay1", "fillRamp", { ...RAMP, field: "gone" });

    expect(FILL_DIMENSION.value!(ui, "overlay1")).toMatchObject({
      mode: "ramp",
      ramp: { field: "count" },
    });

    applyFillToLayer(ui, "overlay1");

    expect(paintedColors()).toEqual(COLORS);
  });

  it("fillMode=solid never reads the ramp config", () => {
    setIntent(ui, "overlay1", "fillColor", "#ff0000");
    setIntent(ui, "overlay1", "fillMode", "solid");
    setIntent(ui, "overlay1", "fillRamp", RAMP);

    applyFillToLayer(ui, "overlay1");

    expect(rampLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#ff0000",
      fill: true,
    });
  });

  it("a mode=ramp record with no config falls back to the authored face", () => {
    setIntent(ui, "overlay1", "fillMode", "ramp");

    applyFillToLayer(ui, "overlay1");

    // Neither arm has a value, so nothing is written — the author's fill stays.
    expect(rampLayer.leaves[0].setStyle).not.toHaveBeenCalled();
  });

  it("the ramp arm carries the user's solid-mode opacity", () => {
    setIntent(ui, "overlay1", "fillMode", "ramp");
    setIntent(ui, "overlay1", "fillRamp", RAMP);
    setIntent(ui, "overlay1", "fillOpacity", 0.25);

    applyFillToLayer(ui, "overlay1");

    expect(rampLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#111111",
      fillOpacity: 0.25,
      fill: true,
    });
  });

  it("the ramp arm omits the opacity when the user never set one", () => {
    setIntent(ui, "overlay1", "fillMode", "ramp");
    setIntent(ui, "overlay1", "fillRamp", RAMP);

    applyFillToLayer(ui, "overlay1");

    // The author's declared opacity stays in force instead of being zeroed.
    expect(rampLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#111111",
      fill: true,
    });
  });

  it("switching back to solid with no solid override restores the author's face", () => {
    // A solid apply with nothing to own must clear the ramp's output, not
    // skip the walk: a skipped walk leaves the previous arm's color on the
    // map. The ramp config stays stored for the next switch.
    setIntent(ui, "overlay1", "fillMode", "ramp");
    setIntent(ui, "overlay1", "fillRamp", RAMP);
    applyFillToLayer(ui, "overlay1");
    expect(paintedColors()).toEqual(COLORS);

    setIntent(ui, "overlay1", "fillMode", "solid");
    applyFillToLayer(ui, "overlay1");

    for (const leaf of rampLayer.leaves) {
      expect(leaf.setStyle.mock.calls.at(-1)![0]).toEqual({
        fillColor: "#aabbcc",
        fillOpacity: 0.5,
        fill: true,
      });
    }
    expect(getIntent(ui, "overlay1", "fillRamp")).toEqual(RAMP);
  });

  it("an opacity-only solid apply after a ramp restores the author's color", () => {
    // Solid owns the whole fill face, so the color has to come back to the
    // author's too — otherwise the ramp's color would sit under the user's
    // opacity.
    setIntent(ui, "overlay1", "fillMode", "ramp");
    setIntent(ui, "overlay1", "fillRamp", RAMP);
    applyFillToLayer(ui, "overlay1");

    setIntent(ui, "overlay1", "fillMode", "solid");
    setIntent(ui, "overlay1", "fillOpacity", 0.4);
    applyFillToLayer(ui, "overlay1");

    // One call, not a restore then a commit: the author's color and `fill`
    // flag ride the same payload as the user's opacity, so the ramp's color
    // is replaced rather than left sitting under it.
    const calls = rampLayer.leaves[0].setStyle.mock.calls.map(c => c[0]);
    expect(calls.at(-1)).toEqual({
      fillColor: "#aabbcc",
      fillOpacity: 0.4,
      fill: true,
    });
  });

  it("a color-only solid apply after a ramp preserves the author's opacity", () => {
    setIntent(ui, "overlay1", "fillMode", "ramp");
    setIntent(ui, "overlay1", "fillRamp", RAMP);
    applyFillToLayer(ui, "overlay1");

    setIntent(ui, "overlay1", "fillMode", "solid");
    setIntent(ui, "overlay1", "fillColor", "#777777");
    applyFillToLayer(ui, "overlay1");

    // One call, color only. The author's opacity is left in place rather
    // than rewritten, so the ramp's color is replaced without touching it -
    // `toEqual` above rejects a payload that carried a fillOpacity at all.
    const calls = rampLayer.leaves[0].setStyle.mock.calls.map(c => c[0]);
    expect(calls.at(-1)).toEqual({ fillColor: "#777777", fill: true });
  });

  it("a switch back to the ramp repaints it, with the stored config kept", () => {
    // Both directions: the inactive config is never deleted, only ignored, so
    // the ramp comes back exactly where it left off.
    setIntent(ui, "overlay1", "fillMode", "ramp");
    setIntent(ui, "overlay1", "fillRamp", RAMP);
    applyFillToLayer(ui, "overlay1");
    expect(paintedColors()).toEqual(COLORS);

    setIntent(ui, "overlay1", "fillMode", "solid");
    applyFillToLayer(ui, "overlay1");

    setIntent(ui, "overlay1", "fillMode", "ramp");
    applyFillToLayer(ui, "overlay1");
    expect(paintedColors()).toEqual(COLORS);
    expect(getIntent(ui, "overlay1", "fillRamp")).toEqual(RAMP);
  });

  it("a ramp arm on a color basemap paints nothing rather than the stored solid", () => {
    // A basemap has no leaves to classify, so the ramp must degrade to the
    // pane's existing paint - and it must not fall through to the solid arm,
    // which would paint the stored solid color while the panel claims ramp.
    // The ramp config stays stored, so a later switch back has something to
    // restore against.
    manager.registerLayer({
      id: CONST.SOLID_BASEMAP_ID,
      name: "Color",
      role: "base",
      color: CONST.COLOR.DEFAULT,
    });
    setIntent(ui, CONST.SOLID_BASEMAP_ID, "fillColor", "#ff0000");
    setIntent(ui, CONST.SOLID_BASEMAP_ID, "fillMode", "ramp");
    setIntent(ui, CONST.SOLID_BASEMAP_ID, "fillRamp", RAMP);

    applyFillToLayer(ui, CONST.SOLID_BASEMAP_ID);

    expect(ui.currentColor).not.toBe("#ff0000");
    expect(getIntent(ui, CONST.SOLID_BASEMAP_ID, "fillColor")).toBe("#ff0000");
    expect(getIntent(ui, CONST.SOLID_BASEMAP_ID, "fillRamp")).toEqual(RAMP);
  });

  it("FILL_DIMENSION.write selects the ramp arm and paints on the next frame", () => {
    const schedule = vi.fn();
    ui.c.persistence = { schedule } as never;

    FILL_DIMENSION.write!(ui, "overlay1", {
      mode: "ramp",
      ramp: RAMP,
      opacity: 0.4,
    });

    expect(getIntent(ui, "overlay1", "fillMode")).toBe("ramp");
    expect(getIntent(ui, "overlay1", "fillRamp")).toEqual(RAMP);
    expect(ui.intentStore.isUserSet("overlay1", "fillMode")).toBe(true);
    expect(ui.intentStore.isUserSet("overlay1", "fillRamp")).toBe(true);
    expect(schedule).toHaveBeenCalled();

    flushStyleDimApply(FACE.FILL, "overlay1");
    const last = rampLayer.leaves[0].setStyle.mock.calls.at(-1)![0];
    expect(last.fillColor).toBe(COLORS[0]);
    expect(last.fillOpacity).toBe(0.4);
  });

  it("FILL_DIMENSION.write with a solid patch leaves the ramp arm stored", () => {
    // The writer writes the keys it is given and no more: a color pick while
    // the ramp arm is active must not delete the stored ramp, which is what a
    // mode switch back restores.
    setIntent(ui, "overlay1", "fillMode", "ramp");
    setIntent(ui, "overlay1", "fillRamp", RAMP);

    FILL_DIMENSION.write!(ui, "overlay1", { color: "#ff0000", opacity: 0.5 });

    expect(getIntent(ui, "overlay1", "fillColor")).toBe("#ff0000");
    expect(getIntent(ui, "overlay1", "fillOpacity")).toBe(0.5);
    expect(getIntent(ui, "overlay1", "fillMode")).toBe("ramp");
    expect(getIntent(ui, "overlay1", "fillRamp")).toEqual(RAMP);
  });

  it("a solid switch leaves the author's face in force on mouseout", () => {
    // The ramp config stays stored across the switch (it is the arm's
    // next-time state, not evidence the arm is active), so the getter a ramp
    // apply registered is still reachable. The solid arm has to take the leaf
    // back, or the next mouseout would repaint the ramp over the author's
    // face. The getter's own mode check is asserted in fillRamp.test.ts.
    const handlers: Array<() => void> = [];
    const leaf = {
      options: { fillColor: "#112233", fillOpacity: 0.6, fill: false },
      feature: { properties: { count: 1 }, geometry: { type: "Polygon" } },
      getLatLngs: RING,
      setStyle: vi.fn(),
      on: vi.fn((_type: string, fn: () => void) => {
        handlers.push(fn);
      }),
    };
    rampLayer.leaves[0] = leaf as never;
    setIntent(ui, "overlay1", "fillMode", "ramp");
    setIntent(ui, "overlay1", "fillRamp", RAMP);
    applyFillToLayer(ui, "overlay1");

    // folium's mouseout restores the author's face; the ramp's getter repays
    // the ramp color on top of it.
    leaf.setStyle({ fillColor: "#112233", fillOpacity: 0.6, fill: false });
    handlers[0]();
    expect(leaf.setStyle.mock.calls.at(-1)![0].fillColor).toBe(COLORS[0]);

    setIntent(ui, "overlay1", "fillMode", "solid");
    applyFillToLayer(ui, "overlay1");
    leaf.setStyle.mockClear();

    // Re-registering the key replaces the ramp's getter instead of stacking a
    // second closure, so the leaf still holds one mouseout handler.
    expect(handlers).toHaveLength(1);

    // folium's mouseout restores the author's face...
    leaf.setStyle({ fillColor: "#112233", fillOpacity: 0.6, fill: false });
    // ...and the (now solid) getter leaves it alone.
    handlers[0]();
    expect(leaf.setStyle).toHaveBeenCalledTimes(1);
  });

  it("reset clears both the ramp config and the mode", () => {
    setIntent(ui, "overlay1", "fillMode", "ramp");
    setIntent(ui, "overlay1", "fillRamp", RAMP);
    setIntent(ui, "overlay1", "fillOpacity", 0.25);

    resetLayerFill(ui, "overlay1");

    expect(getIntent(ui, "overlay1", "fillMode")).toBeUndefined();
    expect(getIntent(ui, "overlay1", "fillRamp")).toBeUndefined();
    expect(getIntent(ui, "overlay1", "fillOpacity")).toBeUndefined();
    expect(ui.intentStore.isUserSet("overlay1", "fillMode")).toBe(false);
    expect(ui.intentStore.isUserSet("overlay1", "fillRamp")).toBe(false);
  });
});

const makeLeaf = (value: number) => {
  const leaf = new L.Polygon() as {
    options: { fillColor?: string; fillOpacity?: number; fill?: boolean };
    feature: { properties: Record<string, unknown> };
    setStyle: ReturnType<typeof vi.fn<(style: StyleWrite) => void>>;
    on: ReturnType<typeof vi.fn>;
  };
  leaf.options = { fillColor: "#aabbcc", fillOpacity: 0.5, fill: true };
  leaf.feature = { properties: { count: value } };
  leaf.setStyle = vi.fn();
  leaf.on = vi.fn();
  return leaf;
};

const makeLayer = (values: number[]) => {
  const leaves = values.map(makeLeaf);
  const parent = {
    options: {},
    eachLayer: vi.fn((fn: (child: unknown) => void) => leaves.forEach(fn)),
    getBounds: vi.fn(() => ({
      isValid: vi.fn(() => true),
      getSouthWest: vi.fn(() => ({ lat: 0, lng: 0 })),
      getNorthEast: vi.fn(() => ({ lat: 1, lng: 1 })),
    })),
    leaves,
  };
  return parent as { leaves: typeof leaves };
};

const initWithValues = (values: number[] = [1, 5, 9]) => {
  installLeafletGlobals();
  const layer = makeLayer(values);
  const { manager, ui } = initFixture({
    data: [
      { id: "overlay1", name: "Polygons", role: "overlay", layer },
      {
        id: "base1",
        name: "OSM",
        role: "base",
        layer: { options: {}, setZIndex: vi.fn() } as never,
        paneName: "tilePane",
      },
    ],
  });
  ui.runtimeStore.setFields("overlay1", [{ name: "count", numeric: true }]);
  return { manager, ui, layer };
};

const openPanel = (ui: LayerUI): HTMLElement => {
  const item = findItem(ui, "overlay1");
  ui.openStylePanel("overlay1");
  const block = item.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_BLOCK}`,
  ) as HTMLElement | null;
  expect(block).not.toBeNull();
  return block!;
};

const modeSelect = (block: HTMLElement): HTMLSelectElement =>
  block.querySelector(`.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`) as HTMLSelectElement;

const details = (block: HTMLElement): HTMLElement =>
  block.querySelector(`.${CONST.CLASSES.STYLE_FILL_DETAIL}`) as HTMLElement;

const switchMode = (block: HTMLElement, mode: "solid" | "ramp"): void => {
  const select = modeSelect(block);
  select.value = mode;
  select.dispatchEvent(new Event("change", { bubbles: true }));
};

const flushFill = (): void => flushStyleDimApply(FACE.FILL, "overlay1");

describe("fill mode row — solid ↔ color by value", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let layer: ReturnType<typeof makeLayer>;

  beforeEach(() => {
    ({ manager, ui, layer } = initWithValues());
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("switching to by-value seeds the default ramp and repaints per leaf", () => {
    installChroma(["#111111", "#222222", "#333333", "#444444", "#555555", "#666666"]);
    const block = openPanel(ui);

    switchMode(block, "ramp");

    expect(getIntent(ui, "overlay1", "fillMode")).toBe("ramp");
    expect(getIntent(ui, "overlay1", "fillRamp")).toEqual({
      kind: "numeric",
      field: "count",
      method: CONST.RAMP.METHOD_DEFAULT,
      classes: CLASS_COUNT.DEFAULT,
      scheme: CONST.RAMP.SCHEME_DEFAULT,
    });
    // jenks/quantile read the simple-statistics CDN global, which jsdom does
    // not load; equal interval classifies on its own, so the paint assertion
    // below exercises the real ramp colors.
    const method = details(block).querySelector(
      `.${CONST.CLASSES.STYLE_FILL_METHOD_SELECT}`,
    ) as HTMLSelectElement;
    method.value = "equal";
    method.dispatchEvent(new Event("change", { bubbles: true }));
    flushFill();
    const rampColors = [
      "#111111",
      "#222222",
      "#333333",
      "#444444",
      "#555555",
      "#666666",
    ];
    for (const leaf of layer.leaves) {
      const call = leaf.setStyle.mock.calls.at(-1)?.[0];
      expect(rampColors).toContain(call?.fillColor);
    }
    // The detail slot now shows the ramp arm's three rows.
    expect(
      details(block).querySelector(`.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`),
    ).not.toBeNull();
  });

  it("switching back to solid keeps the ramp config for the next switch", () => {
    installChroma(["#111111", "#222222"]);
    const block = openPanel(ui);
    switchMode(block, "ramp");
    switchMode(block, "solid");

    expect(getIntent(ui, "overlay1", "fillMode")).toBe("solid");
    expect(getIntent(ui, "overlay1", "fillRamp")).toMatchObject({ field: "count" });
    // The solid arm is back: swatch + opacity, no ramp controls.
    expect(
      details(block).querySelector(`.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`),
    ).not.toBeNull();
    expect(
      details(block).querySelector(`.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`),
    ).toBeNull();
  });

  it("renders no mode select and writes no mode when there is no numeric field", () => {
    // A text-only layer: the field cache has no numeric entry and the tree
    // walk fallback finds no finite number either.
    ui.runtimeStore.setFields("overlay1", [{ name: "name", numeric: false }]);
    for (const leaf of layer.leaves) {
      leaf.feature.properties = { name: "a" };
    }
    const block = buildFillRow(ui, "overlay1");
    bindFillRow(ui, "overlay1", block);

    expect(block.querySelector(`.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`)).toBeNull();
    expect(getIntent(ui, "overlay1", "fillMode")).toBeUndefined();
    expect(getIntent(ui, "overlay1", "fillRamp")).toBeUndefined();
  });

  it("a color basemap keeps the single-swatch row (solid only)", () => {
    manager.registerLayer({
      id: "colormap",
      name: "Color",
      role: "base",
      color: "#3366cc",
      canvas: document.createElement("canvas"),
    });
    const row = buildFillRow(ui, "colormap");
    bindFillRow(ui, "colormap", row);

    expect(row.querySelector(`.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`)).toBeNull();
    const color = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`,
    ) as HTMLInputElement;
    expect(color).not.toBeNull();
    // The single row binds the same live swatch the solid arm uses.
    color.value = "#123456";
    color.dispatchEvent(new Event("input", { bubbles: true }));
    flushFill();
    expect(getIntent(ui, "colormap", "fillColor")).toBe("#123456");
  });

  it("falls back to the tree walk when the field cache is empty", () => {
    // The cache can be cold (or hold only labelable text fields) while the
    // features still carry numbers; the ramp field list must not go empty.
    ui.runtimeStore.setFields("overlay1", []);
    const block = buildFillRow(ui, "overlay1");
    bindFillRow(ui, "overlay1", block);
    const select = modeSelect(block);

    expect(
      (select.querySelector('option[value="ramp"]') as HTMLOptionElement).disabled,
    ).toBe(false);
    switchMode(block, "ramp");
    expect(getIntent(ui, "overlay1", "fillRamp")).toMatchObject({ field: "count" });
  });

  it("shows the stored ramp as solid when the layer has no numeric field", () => {
    // A record can outlive the data it was built for (field removed). The
    // panel must fall back to the solid arm instead of showing a ramp select
    // whose detail cannot classify anything.
    ui.runtimeStore.setFields("overlay1", [{ name: "name", numeric: false }]);
    for (const leaf of layer.leaves) {
      leaf.feature.properties = { name: "a" };
    }
    setIntent(ui, "overlay1", "fillMode", "ramp");
    setIntent(ui, "overlay1", "fillRamp", {
      field: "count",
      method: "jenks",
      classes: 3,
      scheme: "Blues",
    } as never);

    const block = buildFillRow(ui, "overlay1");

    // One honest arm: solid controls, no mode select, no ramp detail.
    expect(block.querySelector(`.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`)).toBeNull();
    expect(
      details(block).querySelector(`.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`),
    ).not.toBeNull();
    expect(
      details(block).querySelector(`.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`),
    ).toBeNull();
  });
});

describe("fill ramp detail — field / method / classes / scheme", () => {
  let ui: LayerUI;

  beforeEach(() => {
    installChroma(["#111111", "#222222", "#333333"]);
    ({ ui } = initWithValues());
    setIntent(ui, "overlay1", "fillMode", "ramp");
    setIntent(ui, "overlay1", "fillRamp", {
      field: "count",
      method: "jenks",
      classes: 3,
      scheme: "Blues",
    } as never);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("field selection writes the ramp field", () => {
    // Two numeric fields so a real choice exists (the field list is native).
    ui.runtimeStore.setFields("overlay1", [
      { name: "count", numeric: true },
      { name: "score", numeric: true },
    ]);
    const block = openPanel(ui);
    const select = details(block).querySelector(
      `.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`,
    ) as HTMLSelectElement;
    expect(select.value).toBe("count");

    select.value = "score";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "fillRamp")).toMatchObject({ field: "score" });
  });

  it("shows the first field when the stored field is no longer offered", () => {
    // Options come from the current data; a stored field that disappeared
    // cannot stay selected, or the select would render blank.
    ui.runtimeStore.setFields("overlay1", [{ name: "score", numeric: true }]);
    setIntent(ui, "overlay1", "fillRamp", {
      field: "count",
      method: "jenks",
      classes: 3,
      scheme: "Blues",
    } as never);

    const block = buildFillRow(ui, "overlay1");
    const field = details(block).querySelector(
      `.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`,
    ) as HTMLSelectElement;

    expect(Array.from(field.options).map(o => o.value)).toEqual(["score"]);
    expect(field.value).toBe("score");
  });

  it("method selection writes the ramp method", () => {
    const block = openPanel(ui);
    const method = details(block).querySelector(
      `.${CONST.CLASSES.STYLE_FILL_METHOD_SELECT}`,
    ) as HTMLSelectElement;
    method.value = "equal";
    method.dispatchEvent(new Event("change", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "fillRamp")).toMatchObject({ method: "equal" });
  });

  it("class count select writes the chosen count and offers the shared range", () => {
    const block = openPanel(ui);
    const classes = details(block).querySelector(
      `.${CONST.CLASSES.STYLE_FILL_CLASSES_SELECT}`,
    ) as HTMLSelectElement;

    // Same vocabulary as the heatmap: a select over the 2..9 range, never a
    // free number input.
    expect(Array.from(classes.options).map(o => o.value)).toEqual(
      Array.from({ length: CLASS_COUNT.MAX - CLASS_COUNT.MIN + 1 }, (_, i) =>
        String(CLASS_COUNT.MIN + i),
      ),
    );
    classes.value = "5";
    classes.dispatchEvent(new Event("change", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "fillRamp")).toMatchObject({ classes: 5 });
  });

  it("shared scheme picker selection writes the scheme (strip only, no name)", () => {
    const block = openPanel(ui);
    const trigger = details(block).querySelector(
      `.${CONST.CLASSES.STYLE_FILL_SCHEME_TRIGGER}`,
    ) as HTMLElement;
    // The trigger shows the color strip only; the scheme name lives on the
    // tooltip (picker contract), matching the heatmap trigger.
    expect(trigger.textContent?.trim()).toBe("");
    expect(trigger.title).toBe("Blues");

    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const item = document.querySelector(
      '.foliplus-scheme-picker-item[data-scheme-name="Reds"]',
    ) as HTMLElement;
    expect(item).not.toBeNull();
    item.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "fillRamp")).toMatchObject({ scheme: "Reds" });
    expect(trigger.title).toBe("Reds");
  });

  it("closing the panel destroys the open picker's dropdown", () => {
    const block = openPanel(ui);
    const trigger = details(block).querySelector(
      `.${CONST.CLASSES.STYLE_FILL_SCHEME_TRIGGER}`,
    ) as HTMLElement;
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".foliplus-scheme-picker-dropdown")).not.toBeNull();

    closeStylePanel(ui, false);

    expect(document.querySelector(".foliplus-scheme-picker-dropdown")).toBeNull();
  });
});

describe("fill row — original colors", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  const blockOf = (ui: LayerUI): HTMLElement => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    return item.querySelector(`.${CONST.CLASSES.STYLE_FILL_BLOCK}`) as HTMLElement;
  };

  const captionOf = (row: HTMLElement): string =>
    (
      details(row).querySelector(
        `.${CONST.CLASSES.STYLE_FILL_ORIGINAL_CAPTION}`,
      ) as HTMLElement
    ).textContent;

  it("opens on the original colors and offers no classification rows", () => {
    const { ui, layer } = initWithAuthorScale();
    const row = blockOf(ui);
    const select = modeSelect(row);
    const featureOption = select.querySelector(
      'option[value="feature"]',
    ) as HTMLOptionElement;

    expect(select.value).toBe("feature");
    // A detected state, not a choice: named by its own option, disabled so
    // the menu cannot return to it.
    expect(featureOption.disabled).toBe(true);
    expect(featureOption.textContent).toBe("LayerControl.style_fill_per_feature");
    // The detail names the column the author drew and shows the strip. None of
    // the classification controls render: Method/Classes/Scheme belong to the
    // user's own ramp, and rendering them here is what squeezed a 43-color
    // palette into the panel's 2-9 class vocabulary.
    expect(
      details(row).querySelector(`.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`),
    ).toBeNull();
    expect(
      details(row).querySelector(`.${CONST.CLASSES.STYLE_FILL_METHOD_SELECT}`),
    ).toBeNull();
    expect(
      details(row).querySelector(`.${CONST.CLASSES.STYLE_FILL_CLASSES_SELECT}`),
    ).toBeNull();
    expect(
      details(row).querySelector(`.${CONST.CLASSES.STYLE_FILL_SCHEME_TRIGGER}`),
    ).toBeNull();
    expect(
      (
        details(row).querySelector(
          `.${CONST.CLASSES.STYLE_FILL_ORIGINAL_COLUMN}`,
        ) as HTMLElement
      ).textContent,
    ).toBe("score");
    const strip = details(row).querySelector(
      `.${CONST.CLASSES.STYLE_FILL_ORIGINAL_STRIP}`,
    ) as HTMLElement;
    expect(strip.children.length).toBe(3);
    expect((strip.children[0] as HTMLElement).style.background).toBe("rgb(13, 8, 135)");
    expect(captionOf(row)).toBe("LayerControl.style_fill_original_continuous");
    // Opening writes no intent: the map keeps the author's own paint until the
    // user edits a fill control.
    for (const leaf of layer.leaves) expect(leaf.setStyle).not.toHaveBeenCalled();
  });

  it("activating the read-only entry writes nothing and keeps the state", () => {
    const { ui, layer } = initWithAuthorScale();
    const row = blockOf(ui);
    const select = modeSelect(row);

    // The entry is disabled, so a programmatic value write plus a change event
    // is the strongest form of "the user tried it": the no-op is proven
    // against the state, not against the menu.
    select.value = "feature";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(select.value).toBe("feature");
    expect(select.querySelector('option[value="feature"]')).not.toBeNull();
    expect(getIntent(ui, "overlay1", "fillMode")).toBeUndefined();
    expect(getIntent(ui, "overlay1", "fillColor")).toBeUndefined();
    for (const leaf of layer.leaves) expect(leaf.setStyle).not.toHaveBeenCalled();
  });

  it("describes the strip by what the author drew", () => {
    const stepped = initWithAuthorScale({
      scale: { kind: "stepped", column: "score", vmin: 10, vmax: 30, levels: 5 },
    });
    expect(captionOf(blockOf(stepped.ui))).toBe(
      "LayerControl.style_fill_original_levels",
    );
    const fallback = initWithAuthorScale({ scale: null });
    expect(captionOf(blockOf(fallback.ui))).toBe(
      "LayerControl.style_fill_original_colors",
    );
  });

  it("draws the strip without a field row when the caption named no column", () => {
    const { ui } = initWithAuthorScale({
      scale: { kind: "continuous", vmin: 10, vmax: 30 },
    });
    const row = blockOf(ui);

    // A scale the author could not be paired with still has the real colors,
    // so the strip renders; the panel must not invent a field name.
    expect(
      details(row).querySelector(`.${CONST.CLASSES.STYLE_FILL_ORIGINAL_COLUMN}`),
    ).toBeNull();
    expect(captionOf(row)).toBe("LayerControl.style_fill_original_continuous");
  });

  it("seeds the by-value arm with the shared defaults", () => {
    installChroma(["#111111", "#222222", "#333333"]);
    const { ui } = initWithAuthorScale();
    const row = blockOf(ui);
    const select = modeSelect(row);

    select.value = "ramp";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    flushStyleDimApply(FACE.FILL, "overlay1");

    // The seed is the user's own classification: the shared six classes on
    // jenks/Viridis over the column the author actually drew — never the
    // author's color count, so a 43-color palette cannot collapse to 9.
    expect(getIntent(ui, "overlay1", "fillRamp")).toMatchObject({
      field: "score",
      method: "jenks",
      classes: CLASS_COUNT.DEFAULT,
      scheme: "Viridis",
    });
    expect(select.querySelector('option[value="feature"]')).toBeNull();
    // The ramp detail is the user's classification now.
    expect(
      details(row).querySelector(`.${CONST.CLASSES.STYLE_FILL_METHOD_SELECT}`),
    ).not.toBeNull();
  });

  it("honours the author stepped class count when the panel can carry it", () => {
    installChroma(["#111111", "#222222", "#333333"]);
    const { ui } = initWithAuthorScale({
      scale: { kind: "stepped", column: "score", vmin: 10, vmax: 30, levels: 5 },
    });
    const select = modeSelect(blockOf(ui));

    select.value = "ramp";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "fillRamp")).toMatchObject({
      field: "score",
      classes: 5,
    });
  });

  it("falls back to the default class count past the panel vocabulary", () => {
    installChroma(["#111111", "#222222", "#333333"]);
    const { ui } = initWithAuthorScale({
      scale: { kind: "stepped", column: "score", vmin: 10, vmax: 30, levels: 12 },
    });
    const select = modeSelect(blockOf(ui));

    select.value = "ramp";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "fillRamp")).toMatchObject({
      classes: CLASS_COUNT.DEFAULT,
    });
  });

  it("seeds from the first numeric field when the scale names no column", () => {
    installChroma(["#111111", "#222222", "#333333"]);
    const { ui } = initWithAuthorScale({
      scale: { kind: "continuous", vmin: 10, vmax: 30 },
    });
    const select = modeSelect(blockOf(ui));

    select.value = "ramp";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "fillRamp")).toMatchObject({ field: "score" });
  });

  it("leaves the by-value arm out when the layer offers no numeric field", () => {
    const { ui, layer } = initWithAuthorScale();
    for (const leaf of layer.leaves as Array<{
      feature: { properties: Record<string, unknown> };
    }>) {
      delete leaf.feature.properties.score;
      delete leaf.feature.properties.count;
    }
    ui.runtimeStore.setFields("overlay1", []);

    const select = modeSelect(blockOf(ui));
    expect(select.value).toBe("feature");
    expect(select.querySelector('option[value="ramp"]')).toBeNull();
  });

  it("keeps the original colors when only the opacity was overridden", () => {
    const { ui } = initWithAuthorScale();
    setIntent(ui, "overlay1", "fillOpacity", 0.4);

    // The author's per-feature colors are still what the layer paints; only a
    // fill mode intent takes the arm over.
    expect(modeSelect(blockOf(ui)).value).toBe("feature");
  });

  it("yields the row once a mode intent exists", () => {
    const { ui } = initWithAuthorScale();
    setIntent(ui, "overlay1", "fillMode", "solid");

    const row = blockOf(ui);
    expect(modeSelect(row).value).toBe("solid");
    expect(row.querySelector(".foliplus-style-fill-color-input")).not.toBeNull();
  });
  it("switching from the original colors to solid seeds and paints one color", () => {
    const { ui, layer } = initWithAuthorScale();
    const row = blockOf(ui);
    const select = modeSelect(row);

    select.value = "solid";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    flushStyleDimApply(FACE.FILL, "overlay1");

    expect(getIntent(ui, "overlay1", "fillColor")).toBe("#0d0887");
    for (const leaf of layer.leaves) {
      expect(leaf.setStyle).toHaveBeenLastCalledWith({
        fillColor: "#0d0887",
        fill: true,
      });
    }
  });
});
describe("fill ramp persistence and reset", () => {
  let ui: LayerUI;
  let layer: ReturnType<typeof makeLayer>;

  beforeEach(() => {
    installChroma(["#111111", "#222222", "#333333"]);
    ({ ui, layer } = initWithValues());
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("reopening the panel shows the stored arm and replays the ramp", () => {
    setIntent(ui, "overlay1", "fillMode", "ramp");
    setIntent(ui, "overlay1", "fillRamp", {
      field: "count",
      // Equal interval: no simple-statistics dependency in jsdom.
      method: "equal",
      classes: 3,
      scheme: "Reds",
    } as never);

    replayFillState(ui, "overlay1");
    flushFill();
    expect(layer.leaves[0].setStyle).toHaveBeenCalledWith(
      expect.objectContaining({ fillColor: "#111111" }),
    );

    const block = openPanel(ui);
    expect(modeSelect(block).value).toBe("ramp");
    expect(
      (
        details(block).querySelector(
          `.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`,
        ) as HTMLSelectElement
      ).value,
    ).toBe("count");
  });

  it("reset clears both arms' intents and the panel opens solid", () => {
    setIntent(ui, "overlay1", "fillMode", "ramp");
    setIntent(ui, "overlay1", "fillRamp", {
      field: "count",
      method: "jenks",
      classes: 3,
      scheme: "Blues",
    } as never);
    setIntent(ui, "overlay1", "fillColor", "#ff0000");
    setIntent(ui, "overlay1", "fillOpacity", 0.4);

    resetLayerFill(ui, "overlay1");

    expect(getIntent(ui, "overlay1", "fillMode")).toBeUndefined();
    expect(getIntent(ui, "overlay1", "fillRamp")).toBeUndefined();
    expect(getIntent(ui, "overlay1", "fillColor")).toBeUndefined();
    expect(getIntent(ui, "overlay1", "fillOpacity")).toBeUndefined();

    const block = openPanel(ui);
    expect(modeSelect(block).value).toBe("solid");
    expect(FILL_DIMENSION.value!(ui, "overlay1")?.mode).toBe("solid");
  });

  it("clearIntent on the ramp keeps the solid arm untouched", () => {
    setIntent(ui, "overlay1", "fillMode", "solid");
    setIntent(ui, "overlay1", "fillColor", "#123456");
    setIntent(ui, "overlay1", "fillRamp", {
      field: "count",
      method: "jenks",
      classes: 3,
      scheme: "Blues",
    } as never);

    clearIntent(ui, "overlay1", "fillRamp");

    expect(getIntent(ui, "overlay1", "fillRamp")).toBeUndefined();
    expect(getIntent(ui, "overlay1", "fillColor")).toBe("#123456");
    const block = openPanel(ui);
    expect(modeSelect(block).value).toBe("solid");
  });
});

describe("fill mode switch after the layer's fields changed", () => {
  it("writes nothing when the numeric field disappeared under the open panel", () => {
    // The data can lose its numeric property while the style panel is open (a
    // streamed replacement, a filter). Switching to by-value then has no field
    // to classify, so the write is rejected instead of persisting a ramp with
    // an empty field.
    const fixture = initWithFillLayer();
    fixture.ui.openStylePanel("overlay1");
    const item = findItem(fixture.ui, "overlay1");
    const select = item.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`,
    ) as HTMLSelectElement;
    expect(select).not.toBeNull();

    fixture.ui.runtimeStore.setFields("overlay1", []);
    select.value = "ramp";
    select.dispatchEvent(new Event("change"));

    expect(getIntent(fixture.ui, "overlay1", "fillMode")).toBeUndefined();
    expect(getIntent(fixture.ui, "overlay1", "fillRamp")).toBeUndefined();
  });
});

describe("content-change replay", () => {
  it("repaints every leaf from the stored fill", () => {
    // The frame the content-change scheduler runs owns the repaint: without it
    // a streamed addData keeps the new features at the author's color.
    const fixture = initWithFillLayer();
    setIntent(fixture.ui, "overlay1", "fillColor", "#123456");
    setIntent(fixture.ui, "overlay1", "fillOpacity", 0.4);

    const policy = FILL_DIMENSION.contentChange as {
      run: (ui: LayerUI, layerId: string) => void;
    };
    policy.run(fixture.ui, "overlay1");

    for (const leaf of fixture.fillLayer.leaves) {
      expect(leaf.setStyle).toHaveBeenCalledWith({
        fillColor: "#123456",
        fillOpacity: 0.4,
        fill: true,
      });
    }
  });
});

describe("fill row — per-feature state", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  const modeSelect = (row: HTMLElement): HTMLSelectElement =>
    row.querySelector(`.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`) as HTMLSelectElement;

  it("shows the detected per-feature state instead of one swatch", () => {
    const { ui } = initWithPerFeatureLayer();
    const row = buildFillRow(ui, "feature1");
    const select = modeSelect(row);

    expect(select.value).toBe("feature");
    // Detected, not chosen: present so the row can name its state, disabled so
    // the menu cannot return to it (Reset is the way back).
    const featureOption = select.querySelector(
      'option[value="feature"]',
    ) as HTMLOptionElement;
    expect(featureOption.disabled).toBe(true);
    expect(select.querySelector('option[value="solid"]')).not.toBeNull();
    expect(select.querySelector('option[value="ramp"]')).not.toBeNull();
    // The explanation is a tooltip on the control, not a paragraph in the
    // drawer: the panel keeps one row and the reason is still reachable.
    expect(row.querySelector(".foliplus-style-fill-note")).toBeNull();
    expect(select.title).toBe("LayerControl.style_fill_per_feature_note");
    expect(select.getAttribute("aria-description")).toBe(
      "LayerControl.style_fill_per_feature_note",
    );
    expect(featureOption.title).toBe("LayerControl.style_fill_per_feature_note");
    expect(row.querySelector(`.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`)).toBeNull();
  });

  it("keeps the solid arm when the leaves share one color", () => {
    const { ui } = initWithPerFeatureLayer({
      colors: ["#aabbcc", "#aabbcc"],
      perFeature: false,
    });
    const select = modeSelect(buildFillRow(ui, "feature1"));

    expect(select.value).toBe("solid");
    expect(select.querySelector('option[value="feature"]')).toBeNull();
  });

  it("keeps the solid arm for a layer without the explore color property", () => {
    const { ui } = initWithPerFeatureLayer({
      perFeature: false,
      fillAuthor: null,
      withProperties: false,
    });
    const select = modeSelect(buildFillRow(ui, "feature1"));

    expect(select.value).toBe("solid");
    expect(select.querySelector('option[value="feature"]')).toBeNull();
  });

  it("yields to the user's fill intent", () => {
    const { ui } = initWithPerFeatureLayer();
    setIntent(ui, "feature1", "fillMode", "solid");
    const select = modeSelect(buildFillRow(ui, "feature1"));

    expect(select.value).toBe("solid");
    expect(select.querySelector('option[value="feature"]')).toBeNull();
  });

  it("does not offer the state for an empty layer", () => {
    const { ui } = initWithPerFeatureLayer({ colors: [], perFeature: false });
    const select = modeSelect(buildFillRow(ui, "feature1"));

    expect(select.value).toBe("solid");
    expect(select.querySelector('option[value="feature"]')).toBeNull();
  });

  it("choosing solid takes the paint over and binds the swatch", () => {
    const { ui, layer } = initWithPerFeatureLayer();
    const row = buildFillRow(ui, "feature1");
    document.body.append(row);
    bindFillRow(ui, "feature1", row);
    const select = modeSelect(row);

    select.value = "solid";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    flushStyleDimApply(FACE.FILL, "feature1");

    expect(getIntent(ui, "feature1", "fillMode")).toBe("solid");
    expect(select.querySelector('option[value="feature"]')).toBeNull();
    expect(
      row.querySelector(`.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`),
    ).not.toBeNull();
    // The choice must also reach the map: seeded from the swatch base, so the
    // row and the paint agree instead of claiming one color for many.
    expect(getIntent(ui, "feature1", "fillColor")).toBe("#0d0887");
    expect(layer.leaves[0].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#0d0887",
      fill: true,
    });
    expect(layer.leaves[1].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#0d0887",
      fill: true,
    });
  });

  it("reset restores every leaf's own author color and the detected state", () => {
    const { ui, layer } = initWithPerFeatureLayer();
    commitNow(ui, "feature1", "color", "#ff0000");
    expect(layer.leaves[0].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#ff0000",
      fill: true,
    });

    resetLayerFill(ui, "feature1");

    // Each leaf returns to its OWN author color — not the first leaf's.
    expect(layer.leaves[0].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#0d0887",
      fillOpacity: 0.5,
      fill: true,
    });
    expect(layer.leaves[1].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#f0f921",
      fillOpacity: 0.5,
      fill: true,
    });
    expect(modeSelect(buildFillRow(ui, "feature1")).value).toBe("feature");
  });

  it("reset falls back to the leaf bag when a feature lost the property", () => {
    const { ui, layer } = initWithPerFeatureLayer();
    commitNow(ui, "feature1", "color", "#ff0000");
    // A feature the author left uncolored: the lazy read reports null for it,
    // so reset restores that leaf captured bag rather than a neighbour color.
    delete (layer.leaves[1].feature as { properties?: unknown }).properties;

    resetLayerFill(ui, "feature1");

    expect(layer.leaves[0].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#0d0887",
      fillOpacity: 0.5,
      fill: true,
    });
    expect(layer.leaves[1].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#f0f921",
      fillOpacity: 0.5,
      fill: true,
    });
  });

  it("reset falls back to the fill defaults when no bag was captured", () => {
    // No prior write captured a style bag, so the author replay has to fall
    // back to the shared fill defaults rather than read stale options.
    const { ui, layer } = initWithPerFeatureLayer();

    resetLayerFill(ui, "feature1");

    expect(layer.leaves[0].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#0d0887",
      fillOpacity: 0.2,
      fill: true,
    });
  });
});
