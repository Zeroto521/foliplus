// test/js/control/LayerControl/ui/style/fill.fixture — shared stubs for the fill aspect suites.
import { repoPath } from "#test/path.js";
import { findItem, initFixture, installLeafletGlobals } from "../fixture.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, vi } from "vitest";
import { dropdownOf } from "#ui/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import {
  commitFillColor,
  commitFillOpacity,
} from "#control/LayerControl/ui/style/fill.js";
import { FACE, flushStyleDimApply } from "#control/LayerControl/ui/style/styleBag.js";

/** A layer duck with a real setStyle spy and a set of polygon leaves each


 *  with their own setStyle. The leaves are `L.Polygon` instances so the areal


 *  gate in `layerCanFill` admits the layer. The parent's eachLayer callback


 *  dispatches to each child, matching how Leaflet LayerGroup.setStyle walks


 *  its tree. */

/** The visible control of a bridged style select: the shared dropdown trigger.


 *  Accessible names live there; the select itself is hidden behind it. */

export const triggerOf = (select: HTMLSelectElement): HTMLButtonElement =>
  dropdownOf(select)!.trigger;

export const makeFillableLayer = () => {
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

  // layer, so the fill row keeps its normal solid/ramp modes. Per-feature

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

export const RING = () => [
  [
    { lat: 0, lng: 0 },

    { lat: 1, lng: 0 },

    { lat: 0, lng: 1 },
  ],
];

/** The style write a leaf spy records. */

export type StyleWrite = { fillColor?: string; fillOpacity?: number; fill?: boolean };

/** Build a LayerController/UI fixture with a real fillable overlay layer


 *  registered under `overlay1`, replacing the fixture's bare polygon duck. */

export const initWithFillLayer = () => {
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

export const makePerFeatureLayer = (colors: readonly string[]) => {
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
      properties: { __folium_color: color, cat: `c${value}`, count: value },
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

export const initWithPerFeatureLayer = ({
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

export const initWithAuthorScale = ({
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

    method?: "equal" | null;
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


 *  `feature.properties.count`, so the ramp mode has values to classify. */

export const makeRampedLayer = (values: number[]) => {
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


 *  `applyValueFill` has values to classify. */

export const initWithRampedLayer = (values: number[] = [1, 5, 9]) => {
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


 *  was requested. The stub answers both palette shapes: the numeric path


 *  calls `scale().mode().colors(count)`, the categorical path calls


 *  `scale().colors(count)` directly (a category palette is qualitative, no


 *  interpolation mode). */

export const installChroma = (colors: string[]): void => {
  globalThis.chroma = {
    scale: () => ({
      mode: () => ({ colors: (count: number) => colors.slice(0, count) }),

      colors: (count: number) => colors.slice(0, count),
    }),
  } as never;
};

/** Commit then force the deferred apply to land — the commit channel is


 *  rAF-coalesced, so a test that asserts the write must flush first. */

export const commitNow = (
  ui: LayerUI,

  layerId: string,

  kind: "color" | "opacity",

  value: string | number,
): void => {
  if (kind === "color") commitFillColor(ui, layerId, value as string);
  else commitFillOpacity(ui, layerId, value as number);

  flushStyleDimApply(FACE.FILL, layerId);
};

export const origOpacity = (root: HTMLElement): string => {
  const box = root.querySelector(`.${CONST.CLASSES.STYLE_FILL_ORIGINAL_OPACITY}`);
  return (
    box?.querySelector(`.${CONST.CLASSES.STYLE_FILL_ORIGINAL_VALUE}`)?.textContent ?? ""
  ).trim();
};

export const makeLeaf = (value: number) => {
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

export const makeLayer = (values: number[]) => {
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

export const initWithValues = (values: number[] = [1, 5, 9]) => {
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

export const openPanel = (ui: LayerUI): HTMLElement => {
  const item = findItem(ui, "overlay1");

  ui.openStylePanel("overlay1");

  const block = item.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_BLOCK}`,
  ) as HTMLElement | null;

  expect(block).not.toBeNull();

  return block!;
};

export const modeSelect = (block: HTMLElement): HTMLSelectElement =>
  block.querySelector(`.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`) as HTMLSelectElement;

export const details = (block: HTMLElement): HTMLElement =>
  block.querySelector(`.${CONST.CLASSES.STYLE_FILL_DETAIL}`) as HTMLElement;

export const switchMode = (
  block: HTMLElement,
  mode: "solid" | "value" | "original",
): void => {
  const select = modeSelect(block);

  select.value = mode;

  select.dispatchEvent(new Event("change", { bubbles: true }));
};

export const flushFill = (): void => flushStyleDimApply(FACE.FILL, "overlay1");

// ── Original-colors readout geometry (stylesheet contract) ──

//

// The method and class count share one row (the by-value rampForm classes

// row's shape): the method readout fills the control column the way the

// by-value method select does, and the count readout takes the compact

// secondary width (the number-field role). These assertions pin the

// *relationships* in the stylesheet sources (which rule carries which

// property) rather than pixel values, which the browser probe records. The

// method must stay free of the number-field geometry (no compact width, no

// shrink, no right-hug of its own) or it would be mistaken for a number

// field again.

export const ROOT = repoPath();

/** Read a stylesheet with normalized line endings. */

export const css = (rel: string): string =>
  readFileSync(resolve(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");

/** The declaration block that starts at `selector` (first match), found by


 *  brace matching so a block that contains nested rules is returned whole. */

export const blockOf = (source: string, selector: string): string => {
  const start = source.indexOf(selector);

  expect(start, `${selector} is missing`).toBeGreaterThanOrEqual(0);

  const open = source.indexOf("{", start);

  expect(open, `${selector} has no opening brace`).toBeGreaterThanOrEqual(0);

  let depth = 0;

  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;

      if (depth === 0) return source.slice(open, i + 1);
    }
  }

  throw new Error(`${selector} block never closes`);
};

export type LeafOpts = { fillColor?: string; fillOpacity?: number; fill?: boolean };
