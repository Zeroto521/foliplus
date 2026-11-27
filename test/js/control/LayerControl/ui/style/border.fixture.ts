// test/js/control/LayerControl/ui/style/border.fixture — shared stubs for the border aspect suites.
import { installLeafletGlobals } from "../fixture.js";
import { vi } from "vitest";
import { type ValueConfig } from "#core/layer/index.js";
import { DEFAULT_SCHEMES, METHOD } from "#core/value/index.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import {
  commitBorderColor,
  commitBorderWeight,
} from "#control/LayerControl/ui/style/border.js";
import { FACE, flushStyleDimApply } from "#control/LayerControl/ui/style/styleBag.js";

/** A Leaflet vector leaf: an `options` bag plus the `setStyle` writer the
 *  border walk looks for. `on` is part of the leaf surface too — the
 *  highlight replay binds through it. `stroke` defaults to Leaflet's Path
 *  default (`true`); pass `false` for the quickstart CircleMarker face
 *  (`style_kwds={"stroke": False}`). */
export const makeLeaf = (color = "#ff0000", weight = 2, stroke = true): any => ({
  options: { color, weight, stroke },
  setStyle: vi.fn(),
  on: vi.fn(),
});

/** A leaf whose `setStyle` needs its own object as `this`, which is how
 *  Leaflet's `Path.setStyle` behaves: it calls `setOptions(this, style)`, so
 *  the method called detached from its receiver throws. A `vi.fn()` swallows
 *  that, which is how a detached call can hide from every other test here. */
export const makeReceiverLeaf = (color = "#ff0000", weight = 2): any => {
  const leaf: any = { options: { color, weight }, on: vi.fn() };
  leaf.setStyle = function (style: Record<string, unknown>): any {
    Object.prototype.hasOwnProperty.call(this, "options");
    Object.assign(this.options, style);
    return this;
  };
  return leaf;
};

/** A LayerGroup-like parent: it has no setter of its own and delegates to
 *  its children through `eachLayer`. */
export const makeGroup = (...children: any[]): any => ({
  options: {},
  eachLayer: vi.fn((fn: (child: unknown) => void) => {
    for (const child of children) fn(child);
  }),
});

/** An L.GeoJSON layer: it owns `setStyle` (which fans a style out to its
 *  features) AND `eachLayer` — both at once, so "has a setter" alone cannot
 *  identify a leaf. The authored style lives on the features, not on the
 *  group, whose options carry only the style function. */
export const makeGeoJsonGroup = (...children: any[]): any => ({
  options: {},
  setStyle: vi.fn(),
  eachLayer: vi.fn((fn: (child: unknown) => void) => {
    for (const child of children) fn(child);
  }),
});

/** A feature leaf under folium's GeoJson highlight. folium binds its own
 *  `mouseout` per feature during addData that runs the group's `resetStyle`,
 *  which hands the leaf back to the author's style function and undoes any
 *  `setStyle` made while the pointer was over it. */
export const makeHighlightLeaf = (color = "#ff0000", weight = 2): any => {
  const authored = { color, weight };
  const options = { ...authored };
  const setStyle = vi.fn((style: Record<string, unknown>) =>
    Object.assign(options, style),
  );
  const mouseout: Array<() => void> = [];
  const on = vi.fn((type: string, fn: () => void) => {
    if (type === "mouseout") mouseout.push(fn);
  });
  // folium's own handler is bound first, during addData.
  on("mouseout", () => {
    Object.assign(options, authored);
    setStyle({ ...authored });
  });
  return {
    options,
    // A declared polygon: the border tests are about the stroke axis, but the leaf
    // keeps its fill capability so no other row's visibility shifts.
    feature: { geometry: { type: "Polygon" } },
    setStyle,
    authored,
    on,
    getLatLngs: () => [
      [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 0 },
        { lat: 0, lng: 1 },
      ],
    ],
    mouseoutCount: () => mouseout.length,
    fireMouseout: () => {
      for (const fn of mouseout) fn();
    },
  };
};

/** Commit then force the deferred apply to land — the commit channel is
 *  rAF-coalesced, so a test that asserts the write must flush first. */
export const commitBorderNow = (
  ui: LayerUI,
  layerId: string,
  kind: "color" | "weight",
  value: string | number,
): void => {
  if (kind === "color") {
    commitBorderColor(ui, layerId, value as string);
  } else {
    commitBorderWeight(ui, layerId, value as number);
  }
  flushStyleDimApply(FACE.STROKE, layerId);
};

// The base layer every content-change fixture carries — the hook's early
// return for ROLE.BASE must not be what keeps a replay from running.
export const BASE_LAYER = {
  id: "base1",
  name: "OSM",
  role: "base",
  layer: { options: {}, setZIndex: vi.fn() } as never,
  paneName: "tilePane",
};

// ── C1–C7: value-based stroke wiring ────────────────────────────────────────────────────────
//
// These exercise the WIRING, not the engine (strokeValue.test.ts owns the
// engine): applyBorderToLayer must dispatch to applyValueStroke when the
// border mode is 'value', and the border row must expose the mode select.
// The layer fixture is a group-like parent whose feature leaves carry
// `feature.properties.count` so numericFields resolves.

/** Install a chroma stub returning a fixed color list — the same shape the
 *  engine tests use, so a ramp build is deterministic. */
export const installChroma = (colors: string[]): void => {
  globalThis.chroma = {
    scale: () => ({
      mode: () => ({ colors: (count: number) => colors.slice(0, count) }),
      colors: (count: number) => colors.slice(0, count),
    }),
  } as never;
};

/** A feature leaf the value mode classifies: an areal polygon (so the fill
 *  mode's walkFillLeaves reaches it too) with a numeric property. */
export const makeFeatureLeaf = (
  count: number,
  color = "#ff0000",
  weight = 2,
  opts: { fillColor?: string; fillOpacity?: number } = {},
): any => {
  const leaf = new L.Polyline() as any;
  leaf.options = { color, weight, stroke: true, ...opts };
  leaf.feature = {
    geometry: { type: "Polygon" },
    properties: { count },
  };
  // A spy that ALSO mutates options in place — the value mode writes
  // fillColor/color through setStyle, and a bare vi.fn() would swallow it,
  // leaving options reads undefined. Mutating mirrors Leaflet's Path.setStyle
  // (setOptions(this, style)) while the spy still records the call.
  const setStyle = vi.fn((style: Record<string, unknown>) => {
    Object.assign(leaf.options, style);
    return leaf;
  });
  leaf.setStyle = setStyle;
  leaf.on = vi.fn();
  return leaf;
};

/** A group-like layer the manager registers: `eachLayer` recurses the walk
 *  into the feature leaves. */
export const makeFeatureGroup = (...leaves: any[]): any => ({
  options: {},
  eachLayer: vi.fn((fn: (child: unknown) => void) => {
    for (const leaf of leaves) fn(leaf);
  }),
  leaves,
});

/** A numeric ramp config for the field the fixture leaves carry. */
export const countRamp = (overrides: Partial<ValueConfig> = {}): ValueConfig => ({
  kind: "numeric",
  field: "count",
  method: METHOD.EQUAL,
  classes: 3,
  scheme: DEFAULT_SCHEMES[0],
  ...overrides,
});

/** Register a feature group + seed its numeric field cache. */
export const registerFeatureLayer = (
  manager: LayerController,
  ui: LayerUI,
  id: string,
  leaves: any[],
): void => {
  installLeafletGlobals();
  manager.registerLayer({ id, name: id, layer: makeFeatureGroup(...leaves) });
  ui.runtimeStore.setFields(id, [{ name: "count", numeric: true }]);
};

/** A real Leaflet feature leaf of the given geometry kind so geometryType()
 *  returns the actual kind (the contract row in "border options per geometry"
 *  is the REAL geometry, not a config string or a layer-name match). */
export const makeLayerForGeometry = (
  kind: "line" | "polygon" | "point",
  count = 5,
): any => {
  const cls =
    kind === "line" ? "Polyline" : kind === "polygon" ? "Polygon" : "CircleMarker";
  const leaf = new (globalThis as any).L[cls]() as any;
  leaf.options = { color: "#ff0000", weight: 2, stroke: true };
  leaf.feature = {
    geometry: {
      type: kind === "line" ? "LineString" : kind === "polygon" ? "Polygon" : "Point",
    },
    properties: { count },
  };
  const setStyle = vi.fn((style: Record<string, unknown>) => {
    Object.assign(leaf.options, style);
    return leaf;
  });
  leaf.setStyle = setStyle;
  leaf.on = vi.fn();
  return leaf;
};
