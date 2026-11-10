import { initFixture, installLeafletGlobals } from "../fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS, ensureEvents } from "#core/event/index.js";
import { DIM, GEOM_TYPE, FILL_MODE, type ValueConfig } from "#core/layer/index.js";
import { METHOD, DEFAULT_SCHEMES } from "#core/value/index.js";
import type { LayerController } from "#control/LayerControl/controller.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";
import {
  clearIntent,
  getIntent,
  seedIntentMap,
  setIntent,
} from "#control/LayerControl/ui/intent.js";
import {
  BORDER_DIMENSION,
  applyBorderToLayer,
  authoredBorder,
  bindBorderRow,
  bindBorderRowShell,
  buildBorderRow,
  buildBorderRowShell,
  commitBorderColor,
  commitBorderWeight,
  layerCanBorder,
  resetLayerBorder,
} from "#control/LayerControl/ui/style/border.js";
import {
  FILL_DIMENSION,
  applyFillToLayer,
  commitFillColor,
} from "#control/LayerControl/ui/style/fill.js";
import { closeStylePanel } from "#control/LayerControl/ui/style/index.js";
import { pinnedGetterCount } from "#control/LayerControl/ui/style/pin.js";
import { getDimension } from "#control/LayerControl/ui/style/registry.js";
import { resolveStrokeMode } from "#control/LayerControl/ui/style/strokeValue.js";
import {
  FACE,
  flushStyleDimApply,
  hasStyleDimApply,
} from "#control/LayerControl/ui/style/styleBag.js";

/** A Leaflet vector leaf: an `options` bag plus the `setStyle` writer the
 *  border walk looks for. `on` is part of the leaf surface too — the
 *  highlight replay binds through it. `stroke` defaults to Leaflet's Path
 *  default (`true`); pass `false` for the quickstart CircleMarker face
 *  (`style_kwds={"stroke": False}`). */
const makeLeaf = (color = "#ff0000", weight = 2, stroke = true): any => ({
  options: { color, weight, stroke },
  setStyle: vi.fn(),
  on: vi.fn(),
});

/** A leaf whose `setStyle` needs its own object as `this`, which is how
 *  Leaflet's `Path.setStyle` behaves: it calls `setOptions(this, style)`, so
 *  the method called detached from its receiver throws. A `vi.fn()` swallows
 *  that, which is how a detached call can hide from every other test here. */
const makeReceiverLeaf = (color = "#ff0000", weight = 2): any => {
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
const makeGroup = (...children: any[]): any => ({
  options: {},
  eachLayer: vi.fn((fn: (child: unknown) => void) => {
    for (const child of children) fn(child);
  }),
});

/** An L.GeoJSON layer: it owns `setStyle` (which fans a style out to its
 *  features) AND `eachLayer` — both at once, so "has a setter" alone cannot
 *  identify a leaf. The authored style lives on the features, not on the
 *  group, whose options carry only the style function. */
const makeGeoJsonGroup = (...children: any[]): any => ({
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
const makeHighlightLeaf = (color = "#ff0000", weight = 2): any => {
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
const commitBorderNow = (
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

describe("layerCanBorder", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = new Set();
    seedIntentMap(ui, "visible", {});
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("accepts a vector layer whose surface owns both a pane and a zoom range", () => {
    manager.registerLayer({
      id: "vec1",
      name: "V",
      layer: makeLeaf(),
    });
    expect(layerCanBorder(ui, "vec1")).toBe(true);
  });

  it("declines a layer not in the registry", () => {
    expect(layerCanBorder(ui, "nope")).toBe(false);
  });

  it("declines a callback-only canvas layer — no eachLayer to walk", () => {
    manager.registerLayer({
      id: "can1",
      name: "C",
      canvas: document.createElement("canvas"),
    });
    expect(layerCanBorder(ui, "can1")).toBe(false);
  });

  it("declines a delegated layer — its own drawer owns the stroke", () => {
    manager.registerLayer({
      id: "del1",
      name: "D",
      canvas: document.createElement("canvas"),
      styleSetters: { borderColor: vi.fn(), borderWeight: vi.fn() },
    });
    expect(layerCanBorder(ui, "del1")).toBe(false);
  });

  it("declines a delegated layer through the styleSetters axis alone", () => {
    // A delegated layer owns its style write through setters and need not have
    // a canvas, so this must be refused by the styleSetters check rather than
    // by the canvas check that comes first: a refusal for the wrong reason
    // would leave the second axis untested.
    manager.registerLayer({
      id: "del2",
      name: "D",
      styleSetters: { borderColor: vi.fn(), borderWeight: vi.fn() },
    });
    expect(layerCanBorder(ui, "del2")).toBe(false);
  });

  it("declines a native-opacity surface — GridLayer / ImageOverlay paint through options", () => {
    manager.registerLayer({
      id: "nat1",
      name: "N",
      layer: makeLeaf(),
    });
    const li = manager.layerRegistry.get("nat1")!;
    manager.surfaceFor(li).capabilities.stroke = "none";
    expect(layerCanBorder(ui, "nat1")).toBe(false);
  });

  it("declines a none-opacity surface — no honest write target", () => {
    manager.registerLayer({
      id: "non1",
      name: "X",
      layer: makeLeaf(),
    });
    const li = manager.layerRegistry.get("non1")!;
    manager.surfaceFor(li).capabilities.stroke = "none";
    expect(layerCanBorder(ui, "non1")).toBe(false);
  });

  it("declines a basemap-like surface — pane opacity but no zoom range", () => {
    // The color basemap has no vector stroke axis, so the probe returns
    // "none" and the gate rejects it.
    manager.registerLayer({
      id: "bas1",
      name: "B",
      layer: makeLeaf(),
    });
    const li = manager.layerRegistry.get("bas1")!;
    manager.surfaceFor(li).capabilities.stroke = "none";
    expect(layerCanBorder(ui, "bas1")).toBe(false);
  });

  // Gate unification: the third condition requires a real setStyle
  // leaf behind the layer. Without it, a Marker or an empty LayerGroup
  // would pass the capability check and get a Border row that persists a
  // value with no visual effect.

  it("declines a point layer — no setStyle leaf behind a group", () => {
    // A Marker duck: options + getBounds, but no setStyle and no eachLayer.
    // The capability check passes (pane opacity, pane zoom range), but the
    // carrier check finds no setStyle leaf to write to.
    manager.registerLayer({
      id: "point1",
      name: "P",
      layer: {
        options: {},
        getBounds: vi.fn(() => ({
          isValid: vi.fn(() => true),
          getSouthWest: () => ({ lat: 0, lng: 0 }),
          getNorthEast: () => ({ lat: 1, lng: 1 }),
        })),
      } as never,
    });
    expect(layerCanBorder(ui, "point1")).toBe(false);
  });

  it("declines an empty group — eachLayer walks nothing", () => {
    // An empty LayerGroup has eachLayer (so it looks like a container) but
    // yields no children. The capability check passes, but the carrier
    // check walks the tree and finds no setStyle leaf to write to.
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
          getSouthWest: () => ({ lat: 0, lng: 0 }),
          getNorthEast: () => ({ lat: 1, lng: 1 }),
        })),
      } as never,
    });
    expect(layerCanBorder(ui, "empty1")).toBe(false);
  });

  it("declines an empty L.GeoJSON — its own setStyle is not a carrier when there is nothing to fan to", () => {
    // L.GeoJSON owns setStyle (it fans a style out to its features), which
    // is why a setStyle-only check stops there. An empty one has no feature
    // to write to, so the walk must descend through eachLayer (which yields
    // nothing) and refuse — the same rule as an empty LayerGroup, just
    // exercised against a shape that looks like it owns a carrier.
    manager.registerLayer({
      id: "emptyGeo1",
      name: "G",
      layer: makeGeoJsonGroup(),
    });
    expect(layerCanBorder(ui, "emptyGeo1")).toBe(false);
  });
});

describe("authoredBorder", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = new Set();
    seedIntentMap(ui, "visible", {});
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("reads the first carrier's options — a stored value never feeds the author", () => {
    const leaf = makeLeaf("#00ff00", 4);
    setIntent(ui, "vec1", "borderColor", "#ff0000");
    setIntent(ui, "vec1", "borderWeight", 7);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    expect(authoredBorder(ui, "vec1")).toEqual({
      color: "#00ff00",
      weight: 4,
    });
  });

  it("descends through a group to find the first carrier", () => {
    const leaf = makeLeaf("#0000ff", 1.5);
    manager.registerLayer({
      id: "grp1",
      name: "G",
      layer: makeGroup(leaf, makeLeaf("#ff0000", 9)),
    });

    expect(authoredBorder(ui, "grp1")).toEqual({
      color: "#0000ff",
      weight: 1.5,
    });
  });

  it("reads the first feature's style from an L.GeoJSON layer, not the layer itself", () => {
    // L.GeoJSON defines setStyle too — it fans a style out to its features —
    // so a setter-only check stops at the layer and reads its own options,
    // which hold only the style function. The panel then shows Leaflet's
    // defaults instead of the author's style on first open.
    manager.registerLayer({
      id: "geo1",
      name: "G",
      layer: makeGeoJsonGroup(makeLeaf("gray", 1.5), makeLeaf("#e74c3c", 6)),
    });

    expect(authoredBorder(ui, "geo1")).toEqual({
      color: "gray",
      weight: 1.5,
    });
  });

  it("falls back to Leaflet's defaults when the layer declares no style", () => {
    manager.registerLayer({ id: "none1", name: "N", layer: { options: {} } });

    expect(authoredBorder(ui, "none1")).toEqual({
      color: "#3388ff",
      weight: 1,
    });
  });

  it("falls back to the defaults for a layer that never materialised", () => {
    // The id is registered but nothing on the map resolves to it — the case the
    // lookup indirection exists for. There is no carrier to read, so the row
    // must show the defaults rather than throw, which is what keeps an
    // unresolved folium layer from breaking the panel on first open.
    manager.registerLayer({ id: "ghost1", name: "G" });

    expect(authoredBorder(ui, "ghost1")).toEqual({
      color: "#3388ff",
      weight: 1,
    });
  });
});

describe("commit pipeline", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = new Set();
    seedIntentMap(ui, "visible", {});
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("normalises the swatch to 6-digit hex, marks the override, and writes once", () => {
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    commitBorderNow(ui, "vec1", "color", "#f00");

    expect(getIntent(ui, "vec1", "borderColor")).toBe("#ff0000");
    expect(ui.intentStore.isUserSet("vec1", "borderColor")).toBe(true);
    expect(leaf.setStyle).toHaveBeenCalledTimes(1);
    expect(leaf.setStyle).toHaveBeenCalledWith({
      color: "#ff0000",
      stroke: true,
    });
  });

  it("keeps the receiver when it calls setStyle, as Leaflet needs it", () => {
    // Leaflet's Path.setStyle runs setOptions(this, style) and throws when the
    // method is invoked detached from its own object, so capturing it in a
    // local first would hand the user's color to nobody at all.
    const leaf = makeReceiverLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    expect(() => commitBorderColor(ui, "vec1", "#abcdef")).not.toThrow();
    flushStyleDimApply(FACE.STROKE, "vec1");
    expect(leaf.options.color).toBe("#abcdef");
  });

  it("keeps the receiver on the highlight replay too", () => {
    const leaf = makeReceiverLeaf("#00ff00", 3);
    leaf.on = vi.fn((type: string, fn: () => void) => {
      if (type === "mouseout") leaf.fireMouseout = fn;
    });
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    expect(() => commitBorderColor(ui, "vec1", "#abcdef")).not.toThrow();
    flushStyleDimApply(FACE.STROKE, "vec1");
    expect(() => leaf.fireMouseout()).not.toThrow();
    expect(leaf.options.color).toBe("#abcdef");
  });

  it("skips a write that revisits the same value", () => {
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    commitBorderNow(ui, "vec1", "color", "#f00");
    leaf.setStyle.mockClear();

    commitBorderNow(ui, "vec1", "color", "#ff0000");

    expect(leaf.setStyle).not.toHaveBeenCalled();
  });

  it("commits the width with the shared bounds in force", () => {
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    commitBorderNow(ui, "vec1", "weight", 3.5);

    expect(getIntent(ui, "vec1", "borderWeight")).toBe(3.5);
    expect(ui.intentStore.isUserSet("vec1", "borderWeight")).toBe(true);
    expect(leaf.setStyle).toHaveBeenCalledWith({ weight: 3.5, stroke: true });
  });

  it("rides one setStyle call per leaf when both sub-dimensions are set", () => {
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    commitBorderNow(ui, "vec1", "color", "#00ff00");
    leaf.setStyle.mockClear();
    commitBorderNow(ui, "vec1", "weight", 5);

    // The width commit re-sends the color already stored: the leaf sees one
    // call carrying both, so color and width can never disagree on the stroke.
    expect(leaf.setStyle).toHaveBeenCalledTimes(1);
    expect(leaf.setStyle).toHaveBeenCalledWith({
      color: "#00ff00",
      weight: 5,
      stroke: true,
    });
  });

  it("omits an unset sub-dimension so the author's default stays in force", () => {
    const leaf = makeLeaf("#00ff00", 4);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    commitBorderNow(ui, "vec1", "weight", 6);

    expect(leaf.setStyle).toHaveBeenCalledWith({ weight: 6, stroke: true });
  });

  it("forces stroke on when the user sets a border color, so a stroke:false path becomes visible", () => {
    // quickstart Facility Points (geopandas explore) authors
    // `style_kwds={"stroke": False}`. Writing color/weight alone leaves
    // Path._updateStyle painting stroke=none — the panel change would be a
    // silent no-op. The user chose a border; the write must turn it on.
    const leaf = makeLeaf("#3388ff", 3, false);
    manager.registerLayer({ id: "cm1", name: "CM", layer: leaf });

    commitBorderNow(ui, "cm1", "color", "#ff0000");

    expect(leaf.setStyle).toHaveBeenCalledWith({
      color: "#ff0000",
      stroke: true,
    });
  });

  it("forces stroke on when the user sets a border width", () => {
    const leaf = makeLeaf("#3388ff", 3, false);
    manager.registerLayer({ id: "cm1", name: "CM", layer: leaf });

    commitBorderNow(ui, "cm1", "weight", 6);

    expect(leaf.setStyle).toHaveBeenCalledWith({ weight: 6, stroke: true });
  });

  it("walks every leaf of a group and captures each one's authored style", () => {
    const first = makeLeaf("#ff0000", 2);
    const second = makeLeaf("#00ff00", 4);
    const group = makeGroup(first, second);
    manager.registerLayer({ id: "grp1", name: "G", layer: group });

    commitBorderNow(ui, "grp1", "color", "#0000ff");

    expect(first.setStyle).toHaveBeenCalledWith({ color: "#0000ff", stroke: true });
    expect(second.setStyle).toHaveBeenCalledWith({ color: "#0000ff", stroke: true });
    expect(group.setStyle).toBeUndefined();
  });

  it("captures the author's style before the first write mutates options", () => {
    const leaf = makeLeaf("#ff0000", 2);
    leaf.setStyle.mockImplementation((style: Record<string, unknown>) => {
      Object.assign(leaf.options, style);
    });
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    commitBorderNow(ui, "vec1", "color", "#00ff00");
    expect(leaf.options.color).toBe("#00ff00");
    expect(authoredBorder(ui, "vec1").color).toBe("#ff0000");
  });

  it("no-ops a commit for a layer with no carrier", () => {
    manager.registerLayer({
      id: "can1",
      name: "C",
      canvas: document.createElement("canvas"),
    });

    expect(() => commitBorderColor(ui, "can1", "#ff0000")).not.toThrow();
    expect(getIntent(ui, "can1", "borderColor")).toBe("#ff0000");
  });

  it("skips a width write that revisits the same value", () => {
    // The number field fires a commit on blur even when the text never moved,
    // so an equal value must be a no-op: without it, clicking away would re-run
    // the sweep over every feature of the layer for no visual change.
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    commitBorderNow(ui, "vec1", "weight", 4);
    leaf.setStyle.mockClear();

    commitBorderNow(ui, "vec1", "weight", 4);

    expect(leaf.setStyle).not.toHaveBeenCalled();
  });
});

describe("bindBorderRow", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = new Set();
    seedIntentMap(ui, "visible", {});
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("commits the width when the number field's change fires", () => {
    // A typed width only lands on the change event, so a handler never bound
    // here would let the value the user typed disappear on blur with nothing to
    // show for it.
    const leaf = makeLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    const row = buildBorderRow(ui, "vec1");
    bindBorderRow(ui, "vec1", row);

    const width = row.querySelector(
      ".foliplus-style-border-weight-input",
    ) as HTMLInputElement;
    width.value = "5";
    width.dispatchEvent(new Event("change", { bubbles: true }));

    expect(getIntent(ui, "vec1", "borderWeight")).toBe(5);
    expect(ui.intentStore.isUserSet("vec1", "borderWeight")).toBe(true);
    expect(leaf.setStyle).toHaveBeenCalledWith({ weight: 5, stroke: true });
  });

  it("commits the color on every swatch movement", () => {
    const leaf = makeLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    // Editable colour: the border row is read-only in ORIGINAL mode (the
    // author's own stroke); a stored "solid" mode is what makes it a picker.
    setIntent(ui, "vec1", "borderStyleMode", "solid");
    const row = buildBorderRow(ui, "vec1");
    bindBorderRow(ui, "vec1", row);

    const swatch = row.querySelector(
      ".foliplus-style-border-color-input",
    ) as HTMLInputElement;
    swatch.value = "#abcdef";
    swatch.dispatchEvent(new Event("input", { bubbles: true }));
    flushStyleDimApply(FACE.STROKE, "vec1");

    expect(getIntent(ui, "vec1", "borderColor")).toBe("#abcdef");
    expect(ui.intentStore.isUserSet("vec1", "borderColor")).toBe(true);
    expect(leaf.setStyle).toHaveBeenCalledWith({ color: "#abcdef", stroke: true });
  });

  it("leaves a row alone that has neither control to bind", () => {
    const row = document.createElement("div");

    expect(() => bindBorderRow(ui, "vec1", row)).not.toThrow();
  });
});

describe("resetLayerBorder", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = new Set();
    seedIntentMap(ui, "visible", {});
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("restores each leaf's own authored stroke, not a layer-wide one", () => {
    const first = makeLeaf("#ff0000", 2);
    const second = makeLeaf("#00ff00", 4);
    const group = makeGroup(first, second);
    manager.registerLayer({ id: "grp1", name: "G", layer: group });
    commitBorderNow(ui, "grp1", "color", "#0000ff");
    commitBorderNow(ui, "grp1", "weight", 9);
    first.setStyle.mockClear();
    second.setStyle.mockClear();

    resetLayerBorder(ui, "grp1");

    expect(getIntent(ui, "grp1", "borderColor")).toBeUndefined();
    expect(getIntent(ui, "grp1", "borderWeight")).toBeUndefined();
    // unmarkOverride drops the entry once both dimensions are cleared.
    expect(ui.intentStore.isUserSet("grp1", "borderColor")).toBe(false);
    expect(ui.intentStore.isUserSet("grp1", "borderWeight")).toBe(false);
    expect(first.setStyle).toHaveBeenCalledWith({
      color: "#ff0000",
      weight: 2,
      stroke: true,
    });
    expect(second.setStyle).toHaveBeenCalledWith({
      color: "#00ff00",
      weight: 4,
      stroke: true,
    });
  });

  it("restores each feature's authored stroke for an L.GeoJSON layer", () => {
    // The write walk must descend as well: capturing the base on the layer
    // records Leaflet's defaults, and Reset would paint the defaults instead
    // of the author's style.
    const face = makeLeaf("gray", 1.5);
    const line = makeLeaf("#e74c3c", 6);
    manager.registerLayer({
      id: "geo1",
      name: "G",
      layer: makeGeoJsonGroup(face, line),
    });

    commitBorderNow(ui, "geo1", "color", "#0000ff");
    commitBorderNow(ui, "geo1", "weight", 9);
    face.setStyle.mockClear();
    line.setStyle.mockClear();

    resetLayerBorder(ui, "geo1");

    expect(face.setStyle).toHaveBeenCalledWith({
      color: "gray",
      weight: 1.5,
      stroke: true,
    });
    expect(line.setStyle).toHaveBeenCalledWith({
      color: "#e74c3c",
      weight: 6,
      stroke: true,
    });
  });

  it("does not touch a layer the registry no longer knows", () => {
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    commitBorderNow(ui, "vec1", "color", "#00ff00");
    leaf.setStyle.mockClear();
    manager.unregisterLayer("vec1");

    expect(() => resetLayerBorder(ui, "vec1")).not.toThrow();
    expect(leaf.setStyle).not.toHaveBeenCalled();
  });

  it("drops the persisted choice when the id resolves to no layer", () => {
    // registerLayer keeps an id with no layer object — the manager's own
    // lookup defends for the same case. The reset cannot restore a stroke it
    // cannot find a carrier for, but the persisted choice is still dropped,
    // so a reload does not try to apply a stroke to a layer that has none.
    manager.registerLayer({ id: "ghost", name: "G", layer: null } as any);
    setIntent(ui, "ghost", "borderColor", "#ff0000");
    setIntent(ui, "ghost", "borderWeight", 4);
    ui.intentStore.seedProvenance("ghost", ["borderColor", "borderWeight"]);

    expect(() => resetLayerBorder(ui, "ghost")).not.toThrow();
    expect(getIntent(ui, "ghost", "borderColor")).toBeUndefined();
    expect(getIntent(ui, "ghost", "borderWeight")).toBeUndefined();
    expect(ui.intentStore.isUserSet("ghost", "borderColor")).toBe(false);
    expect(ui.intentStore.isUserSet("ghost", "borderWeight")).toBe(false);
  });

  it("skips a leaf that was never written, rather than inventing its stroke", () => {
    // Reset restores from the base captured on the first write. A leaf the walk
    // has never touched has no base, so there is nothing honest to restore:
    // writing into it would paint a stroke nobody authored and nobody chose.
    const leaf = makeLeaf("#00ff00", 4);
    manager.registerLayer({ id: "grp1", name: "G", layer: makeGroup(leaf) });

    resetLayerBorder(ui, "grp1");

    expect(leaf.setStyle).not.toHaveBeenCalled();
  });

  it("skips a group member that has neither a setter nor children of its own", () => {
    // A group can hold a member with no style axis at all — a Marker, an
    // ImageOverlay. Both walks must descend past it silently instead of
    // inventing a stroke for it, so the write and the reset refuse it the
    // same way.
    const inert: any = { options: {} };
    const live = makeLeaf("#ff0000", 2);
    manager.registerLayer({
      id: "grp1",
      name: "G",
      layer: makeGroup(inert, live),
    });

    commitBorderNow(ui, "grp1", "color", "#0000ff");
    commitBorderNow(ui, "grp1", "weight", 5);

    expect(inert.setStyle).toBeUndefined();
    expect(live.setStyle).toHaveBeenCalledWith({
      color: "#0000ff",
      weight: 5,
      stroke: true,
    });

    live.setStyle.mockClear();
    resetLayerBorder(ui, "grp1");

    expect(inert.setStyle).toBeUndefined();
    expect(live.setStyle).toHaveBeenCalledWith({
      color: "#ff0000",
      weight: 2,
      stroke: true,
    });
  });

  it("restores the module defaults for a carrier that declared no style", () => {
    // A leaf that owns a setter but declares neither color nor width has no
    // author stroke to fall back on, so the base recorded on the first write
    // must be the module's own defaults — otherwise a Reset would have nothing
    // honest to write for that dimension.
    const bare: any = {
      options: {},
      on: vi.fn(),
      setStyle: vi.fn((style: Record<string, unknown>) =>
        Object.assign(bare.options, style),
      ),
    };
    manager.registerLayer({ id: "vec1", name: "V", layer: bare });

    commitBorderNow(ui, "vec1", "color", "#0000ff");
    commitBorderNow(ui, "vec1", "weight", 4);
    bare.setStyle.mockClear();

    resetLayerBorder(ui, "vec1");

    expect(bare.setStyle).toHaveBeenCalledWith({
      color: "#3388ff",
      weight: 1,
      stroke: true,
    });
  });

  it("restores the author's stroke flag on reset, including stroke:false", () => {
    // The write path forces stroke:true so a stroke:false CircleMarker
    // (quickstart Facility Points) shows the user's border. Reset must put
    // the author's original stroke:false back — leaving stroke:true on would
    // paint a border nobody authored.
    const leaf = makeLeaf("#3388ff", 3, false);
    leaf.setStyle = vi.fn((style: Record<string, unknown>) =>
      Object.assign(leaf.options, style),
    );
    manager.registerLayer({ id: "cm1", name: "CM", layer: leaf });

    commitBorderNow(ui, "cm1", "color", "#ff0000");
    commitBorderNow(ui, "cm1", "weight", 6);
    expect(leaf.options.stroke).toBe(true);
    leaf.setStyle.mockClear();

    resetLayerBorder(ui, "cm1");

    expect(leaf.setStyle).toHaveBeenCalledWith({
      color: "#3388ff",
      weight: 3,
      stroke: false,
    });
    expect(leaf.options.stroke).toBe(false);
  });
});

describe("highlight restore", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = new Set();
    seedIntentMap(ui, "visible", {});
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("keeps the user's stroke after folium's highlight restore runs resetStyle", () => {
    // folium's GeoJson highlight runs the group's resetStyle on mouseout,
    // which re-applies the author's style function to the feature and wipes
    // our write. A click on a feature necessarily crosses a mouseout, so
    // without a replay the user's color is gone the moment the pointer
    // leaves the geometry.
    const leaf = makeHighlightLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    commitBorderNow(ui, "vec1", "color", "#abcdef");
    leaf.setStyle.mockClear();

    leaf.fireMouseout();

    expect(leaf.setStyle).toHaveBeenLastCalledWith({
      color: "#abcdef",
      stroke: true,
    });
    expect(leaf.options.color).toBe("#abcdef");
  });

  it("replays stroke:true through the pin so a stroke:false author cannot hide the border", () => {
    // The write forces stroke:true; the pin getter must carry the same flag,
    // or folium's resetStyle re-applies the author's stroke:false on mouseout
    // and the user's border vanishes the moment the pointer leaves.
    const leaf = makeHighlightLeaf("#00ff00", 3);
    leaf.authored.stroke = false;
    leaf.options.stroke = false;
    manager.registerLayer({ id: "cm1", name: "CM", layer: leaf });

    commitBorderNow(ui, "cm1", "color", "#abcdef");
    leaf.setStyle.mockClear();

    leaf.fireMouseout();

    expect(leaf.setStyle).toHaveBeenLastCalledWith({
      color: "#abcdef",
      stroke: true,
    });
    expect(leaf.options.stroke).toBe(true);
  });

  it("pins the user's width through the same restore", () => {
    const leaf = makeHighlightLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    commitBorderNow(ui, "vec1", "weight", 9);
    leaf.setStyle.mockClear();

    leaf.fireMouseout();

    expect(leaf.setStyle).toHaveBeenLastCalledWith({ weight: 9, stroke: true });
    expect(leaf.options.weight).toBe(9);
  });

  it("pins the replay once per leaf, no matter how often the user commits", () => {
    // A color-picker drag commits many times, and every pass walks every
    // feature of the layer: binding the replay once per commit would stack
    // handlers that all write the same stroke.
    const leaf = makeHighlightLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    commitBorderNow(ui, "vec1", "color", "#abcdef");
    commitBorderNow(ui, "vec1", "weight", 9);

    // 2 = folium's own handler plus our replay, not one per commit.
    expect(leaf.mouseoutCount()).toBe(2);
  });

  it("replays fill and border together after folium's highlight restore", () => {
    // A layer with BOTH dimensions set must come out of a hover
    // with both user values. folium's resetStyle runs first in the dispatch
    // order, then our single shared handler merges the fill getter and the
    // border getter into one setStyle — neither dimension may be dropped.
    const leaf = makeHighlightLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    commitFillColor(ui, "vec1", "#123456");
    // fill commit is rAF-coalesced; flush so the fill pin is registered
    // before the highlight restore runs (same contract as a drag's end).
    flushStyleDimApply(FACE.FILL, "vec1");
    commitBorderNow(ui, "vec1", "weight", 9);

    // One slot per dimension on the shared leaf — fill and border never
    // share a slot, and neither one doubles up.
    expect(pinnedGetterCount(leaf)).toBe(2);
    leaf.setStyle.mockClear();

    leaf.fireMouseout();

    // folium's restore writes the authored stroke back, then exactly one
    // merged replay writes both of the user's dimensions over it.
    expect(leaf.setStyle).toHaveBeenCalledTimes(2);
    expect(leaf.setStyle).toHaveBeenLastCalledWith({
      fillColor: "#123456",
      fill: true,
      weight: 9,
      stroke: true,
    });
  });

  it("repeated commits replace the replay getter instead of stacking", () => {
    // Every apply pass builds a fresh closure, so identity-based dedupe can
    // never match: an unbounded getter array is a real leak (each mouseout
    // re-runs every stale closure) even when the merged output is correct.
    const leaf = makeHighlightLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    commitBorderNow(ui, "vec1", "color", "#111111");
    commitBorderNow(ui, "vec1", "color", "#222222");
    commitBorderNow(ui, "vec1", "color", "#333333");
    commitBorderNow(ui, "vec1", "weight", 5);
    commitBorderNow(ui, "vec1", "weight", 9);

    // One getter slot per dimension, however many commits passed through it.
    expect(pinnedGetterCount(leaf)).toBe(1);

    leaf.setStyle.mockClear();
    leaf.fireMouseout();

    // folium's restore + a single merged replay, not one write per getter.
    expect(leaf.setStyle).toHaveBeenCalledTimes(2);
    expect(leaf.setStyle).toHaveBeenLastCalledWith({
      color: "#333333",
      weight: 9,
      stroke: true,
    });
  });

  it("leaves the author's stroke alone once the user has reset", () => {
    // A reset clears the stored intent, so the replay has nothing to write:
    // folium's restore stands and the layer keeps the author's stroke.
    const leaf = makeHighlightLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    commitBorderNow(ui, "vec1", "color", "#abcdef");
    resetLayerBorder(ui, "vec1");
    leaf.setStyle.mockClear();

    leaf.fireMouseout();

    expect(leaf.options.color).toBe("#00ff00");
    expect(leaf.setStyle).toHaveBeenLastCalledWith(leaf.authored);
  });

  it("does not fight a layer that has no stored border", () => {
    // No stored value, no pin: the user never touched the row, so a hover must
    // not trigger a style write and only folium's own handler may be bound.
    const leaf = makeHighlightLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    leaf.fireMouseout();

    expect(leaf.mouseoutCount()).toBe(1);
    expect(leaf.options.color).toBe("#00ff00");
  });
});

describe("applyBorderToLayer", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = new Set();
    seedIntentMap(ui, "visible", {});
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("writes the stored stroke onto the layer's leaves", () => {
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    setIntent(ui, "vec1", "borderColor", "#0000ff");
    setIntent(ui, "vec1", "borderWeight", 6);

    applyBorderToLayer(ui, "vec1");

    expect(leaf.setStyle).toHaveBeenCalledWith({
      color: "#0000ff",
      weight: 6,
      stroke: true,
    });
  });

  it("writes only the named layer, never a neighbor's stored stroke", () => {
    const a = makeLeaf();
    const b = makeLeaf();
    manager.registerLayer({ id: "vecA", name: "A", layer: a });
    manager.registerLayer({ id: "vecB", name: "B", layer: b });
    setIntent(ui, "vecA", "borderColor", "#0000ff");
    setIntent(ui, "vecB", "borderColor", "#00ff00");

    applyBorderToLayer(ui, "vecA");

    expect(a.setStyle).toHaveBeenCalledTimes(1);
    expect(b.setStyle).not.toHaveBeenCalled();
  });

  it("is a no-op with no stored value", () => {
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    applyBorderToLayer(ui, "vec1");

    expect(leaf.setStyle).not.toHaveBeenCalled();
  });

  it("is a no-op for an id with no registry entry", () => {
    setIntent(ui, "ghost", "borderColor", "#0000ff");

    expect(() => applyBorderToLayer(ui, "ghost")).not.toThrow();
  });

  it("the applyUserState sweep writes only user-set provenance keys, so a stored value with no record is not replayed", () => {
    const recorded = makeLeaf();
    const orphan = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: recorded });
    manager.registerLayer({ id: "vec2", name: "W", layer: orphan });
    setIntent(ui, "vec1", "borderColor", "#0000ff");
    setIntent(ui, "vec2", "borderColor", "#00ff00");
    ui.intentStore.seedProvenance("vec1", ["borderColor"]);
    // vec2 holds a stored value that never went through markOverride — the
    // drift the single enumeration source exists to ignore. Enumerating the
    // maps instead of the provenance axis would replay it while fill stayed put.

    ui.applyUserState();

    expect(recorded.setStyle).toHaveBeenCalledWith({
      color: "#0000ff",
      stroke: true,
    });
    expect(orphan.setStyle).not.toHaveBeenCalled();
  });

  it("restores the author's stroke when ORIGINAL mode has no override but the bag was captured", () => {
    // Line 364: ORIGINAL mode owns no user colour — the colour override is
    // treated as absent, and the walk restores each leaf's captured author
    // face. A leaf that was committed before (bag captured) must be restored,
    // not skipped.
    const leaf = makeHighlightLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    // Commit a colour first so the style bag captures the author face.
    commitBorderNow(ui, "vec1", "color", "#abcdef");
    // Now switch to ORIGINAL and clear the override: no user colour/weight in
    // force, but the bag exists, so restoreStyleDim must run.
    setIntent(ui, "vec1", "borderStyleMode", "original");
    clearIntent(ui, "vec1", "borderColor");
    clearIntent(ui, "vec1", "borderWeight");
    leaf.setStyle.mockClear();

    applyBorderToLayer(ui, "vec1");

    // The author's green face was restored (not the user's #abcdef).
    expect(leaf.setStyle).toHaveBeenCalled();
    expect(leaf.options.color).toBe("#00ff00");
  });

  it("shows the stored colour as SOLID when no mode is stored", () => {
    // Line 643: pre-mode record shape — a stored colour without a mode means
    // the user already painted the solid mode, so displayBorderMode must
    // resolve to SOLID rather than ORIGINAL (which would hide the user's
    // colour behind the author's).
    const leaf = makeLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    setIntent(ui, "vec1", "borderColor", "#ff0000");
    // No borderStyleMode intent.

    const row = buildBorderRow(ui, "vec1");
    const swatch = row.querySelector(
      ".foliplus-style-border-color-input",
    ) as HTMLInputElement;
    expect(swatch.value).toBe("#ff0000");
  });

  it("resolves the live stroke config through the value mode's callbacks", () => {
    // Lines 331-333: the value mode derives live config closures (resolveStored,
    // effectiveBorderValue, effectiveBorderMode) so the pin's getter agrees
    // with the paint. Exercise them through a real value-mode apply.
    installChroma(["#111111", "#222222", "#333333"]);
    const leaf = makeFeatureLeaf(5);
    registerFeatureLayer(manager, ui, "vec1", [leaf]);
    setIntent(ui, "vec1", "borderValue", countRamp());
    setIntent(ui, "vec1", "borderStyleMode", "value");

    applyBorderToLayer(ui, "vec1");

    const strokeCall = leaf.setStyle.mock.calls.at(-1)?.[0];
    expect(strokeCall).toMatchObject({ stroke: true });
    expect(typeof strokeCall.color).toBe("string");

    // Fire the highlight pin's mouseout replay: this runs the value mode's
    // live-config closures (resolveStored, effectiveBorderValue,
    // effectiveBorderMode) so the replay agrees with the paint.
    const mouseout = (leaf.on as any).mock.calls.find(
      ([evt]: [string]) => evt === "mouseout",
    )?.[1];
    expect(mouseout).toBeDefined();
    leaf.setStyle.mockClear();
    mouseout();
    const replayCall = leaf.setStyle.mock.calls.at(-1)?.[0];
    expect(replayCall).toMatchObject({ stroke: true });
    expect(typeof replayCall.color).toBe("string");
  });
});

describe("buildBorderRow", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = new Set();
    seedIntentMap(ui, "visible", {});
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders one row with a swatch and a bounded width field", () => {
    const leaf = makeLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    // Editable colour: the border row is read-only in ORIGINAL mode (the
    // author's own stroke); a stored "solid" mode is what makes it a picker.
    setIntent(ui, "vec1", "borderStyleMode", "solid");

    const row = buildBorderRow(ui, "vec1");

    expect(row.classList.contains("foliplus-style-border-block")).toBe(true);
    expect(row.getAttribute("data-style-dim")).toBe("border");
    expect(row.textContent).toContain("LayerControl.border");

    const swatch = row.querySelector(
      ".foliplus-style-border-color-input",
    ) as HTMLInputElement;
    expect(swatch.type).toBe("color");
    expect(swatch.value).toBe("#00ff00");
    expect(swatch.getAttribute("aria-label")).toBe("LayerControl.style_border_color");

    const width = row.querySelector(
      ".foliplus-style-border-weight-input",
    ) as HTMLInputElement;
    expect(width.type).toBe("number");
    expect(width.value).toBe("3");
    expect(width.min).toBe("0");
    expect(width.max).toBe("10");
    expect(width.step).toBe("0.5");
    expect(width.getAttribute("aria-label")).toBe("LayerControl.style_border_weight");
  });

  it("shows the stored choice over the authored value", () => {
    const leaf = makeLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    // Editable colour: the border row is read-only in ORIGINAL mode (the
    // author's own stroke); a stored "solid" mode is what makes it a picker.
    setIntent(ui, "vec1", "borderStyleMode", "solid");
    setIntent(ui, "vec1", "borderColor", "#ff0000");
    setIntent(ui, "vec1", "borderWeight", 5.5);

    const row = buildBorderRow(ui, "vec1");

    expect(
      (row.querySelector(".foliplus-style-border-color-input") as HTMLInputElement)
        .value,
    ).toBe("#ff0000");
    expect(
      (row.querySelector(".foliplus-style-border-weight-input") as HTMLInputElement)
        .value,
    ).toBe("5.5");
  });

  it("shows normalised 6-digit hex when the author declared a short form", () => {
    manager.registerLayer({ id: "vec1", name: "V", layer: makeLeaf("#f00", 2) });
    // Editable colour: the border row is read-only in ORIGINAL mode (the
    // author's own stroke); a stored "solid" mode is what makes it a picker.
    setIntent(ui, "vec1", "borderStyleMode", "solid");

    const row = buildBorderRow(ui, "vec1");

    expect(
      (row.querySelector(".foliplus-style-border-color-input") as HTMLInputElement)
        .value,
    ).toBe("#ff0000");
  });

  it("hands the swatch hex for a named color, not the name itself", () => {
    // The color input's value is only defined for #rrggbb, so a name must
    // reach the field resolved, not as the name. The resolver works through
    // the browser, so there is no name-to-hex table to keep in step with the
    // spec. The authored value is untouched: the map and a Reset keep the
    // name, and only the display boundary normalizes.
    manager.registerLayer({
      id: "geo1",
      name: "G",
      layer: makeGeoJsonGroup(makeLeaf("gray", 1.5), makeLeaf("#e74c3c", 6)),
    });

    // Editable colour: the border row is read-only in ORIGINAL mode (the
    // author's own stroke); a stored "solid" mode is what makes it a picker.
    setIntent(ui, "geo1", "borderStyleMode", "solid");
    const row = buildBorderRow(ui, "geo1");

    expect(
      (row.querySelector(".foliplus-style-border-color-input") as HTMLInputElement)
        .value,
    ).toBe("#808080");
  });

  it("hands the swatch hex for a functional color too", () => {
    // The author may declare a stroke in any CSS form, not only a name or a
    // hex literal — a function color resolves through the same path rather
    // than through a hand-kept name-to-hex table.
    manager.registerLayer({
      id: "vec1",
      name: "V",
      layer: makeLeaf("hsl(120, 100%, 50%)", 2),
    });

    // Editable colour: the border row is read-only in ORIGINAL mode (the
    // author's own stroke); a stored "solid" mode is what makes it a picker.
    setIntent(ui, "vec1", "borderStyleMode", "solid");
    const row = buildBorderRow(ui, "vec1");

    expect(
      (row.querySelector(".foliplus-style-border-color-input") as HTMLInputElement)
        .value,
    ).toBe("#00ff00");
  });

  it("leaves an unpaintable declaration unchanged and preserves it", () => {
    // A value no engine resolves to a color must reach the field as declared,
    // not as a hex we invented: fabricating one would claim a stroke the
    // author never wrote and the layer is not said to paint. The authored
    // value stays intact, and the control is left to show its own default.
    manager.registerLayer({
      id: "vec1",
      name: "V",
      layer: makeLeaf("notacolor", 2),
    });

    // Editable colour: the border row is read-only in ORIGINAL mode (the
    // author's own stroke); a stored "solid" mode is what makes it a picker.
    setIntent(ui, "vec1", "borderStyleMode", "solid");
    const row = buildBorderRow(ui, "vec1");

    expect(authoredBorder(ui, "vec1").color).toBe("notacolor");
    expect(
      (row.querySelector(".foliplus-style-border-color-input") as HTMLInputElement)
        .value,
    ).toBe("#000000");
  });

  it("passes a Color 4 stroke through unresolved and lets the field show its default", () => {
    // Measured in this engine: oklch/lab/lch/color are legal CSS, so the probe
    // accepts them into style.color, but getComputedStyle reports them
    // unnormalized and never as rgb(). The rgb parse therefore finds no
    // channel, the authored declaration is preserved, and the color input is
    // left to its own default rather than to a hex we invented.
    manager.registerLayer({
      id: "vec1",
      name: "V",
      layer: makeLeaf("oklch(0.5 0.1 100)", 2),
    });

    // Editable colour: the border row is read-only in ORIGINAL mode (the
    // author's own stroke); a stored "solid" mode is what makes it a picker.
    setIntent(ui, "vec1", "borderStyleMode", "solid");
    const row = buildBorderRow(ui, "vec1");

    expect(authoredBorder(ui, "vec1").color).toBe("oklch(0.5 0.1 100)");
    expect(
      (row.querySelector(".foliplus-style-border-color-input") as HTMLInputElement)
        .value,
    ).toBe("#000000");
  });

  it("shows the author's feature style for an L.GeoJSON layer, not the defaults", () => {
    // The reported symptom: folium GeoJson layers opened the panel showing
    // the Leaflet defaults instead of the style the layer was painting,
    // because the group's empty options were read as the author's stroke.
    manager.registerLayer({
      id: "geo1",
      name: "G",
      layer: makeGeoJsonGroup(makeLeaf("#e74c3c", 6), makeLeaf("gray", 1.5)),
    });

    // Editable colour: the border row is read-only in ORIGINAL mode (the
    // author's own stroke); a stored "solid" mode is what makes it a picker.
    setIntent(ui, "geo1", "borderStyleMode", "solid");
    const row = buildBorderRow(ui, "geo1");

    expect(
      (row.querySelector(".foliplus-style-border-color-input") as HTMLInputElement)
        .value,
    ).toBe("#e74c3c");
    expect(
      (row.querySelector(".foliplus-style-border-weight-input") as HTMLInputElement)
        .value,
    ).toBe("6");
  });

  it("renders the border colour read-only in ORIGINAL mode", () => {
    // The author's own stroke is not the user's to change: only switching the
    // mode to "solid" hands the colour to the picker. This is the reported
    // symptom (a red swatch opened a picker while Border Mode = Original).
    const leaf = makeLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    const row = buildBorderRow(ui, "vec1");

    // Same colour control as the single-color mode — a real swatch input, so
    // the ORIGINAL row stays pixel-identical to SINGLE — only inert: it must
    // not open a picker or accept an edit.
    const readOnly = row.querySelector(
      ".foliplus-style-border-color-input",
    ) as HTMLInputElement | null;
    expect(readOnly).not.toBeNull();
    expect(readOnly?.tagName).toBe("INPUT");
    expect(readOnly?.disabled).toBe(true);
    expect(readOnly?.readOnly).toBe(true);
    // The shared no-edit class is present so the unified hover rule in
    // common/input.css excludes it — a disabled border swatch carries no
    // hover/focus hint, same channel as the fill original mode's read-only box.
    expect(readOnly?.classList.contains("foliplus-readonly")).toBe(true);
    // The weight stays editable: it is a user-facing stroke attribute.
    const weight = row.querySelector(
      ".foliplus-style-border-weight-input",
    ) as HTMLInputElement | null;
    expect(weight).not.toBeNull();
    expect(weight?.disabled).toBe(false);
  });

  it("does not write a colour when the read-only swatch is pressed", () => {
    const leaf = makeLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    const row = buildBorderRow(ui, "vec1");
    bindBorderRow(ui, "vec1", row);

    const readOnly = row.querySelector(
      ".foliplus-style-border-color-input",
    ) as HTMLInputElement;
    readOnly.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(getIntent(ui, "vec1", "borderColor")).toBeUndefined();
    expect(ui.intentStore.isUserSet("vec1", "borderColor")).toBe(false);
    expect(leaf.setStyle).not.toHaveBeenCalled();
  });

  it("shows the author's stroke again after a solid → original round-trip", () => {
    // The reported bug: set a color in the single-color (solid) mode, switch
    // back to ORIGINAL, and the row showed the user's color instead of the
    // author's. ORIGINAL owns no user color — the row must read the author
    // face, never INTENT.BORDER_COLOR (which stays stored for the return to
    // solid).
    const leaf = makeLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    setIntent(ui, "vec1", "borderStyleMode", "solid");
    setIntent(ui, "vec1", "borderColor", "#ff0000");

    // Switch to ORIGINAL: the row rebuilds and must show the author's green,
    // not the user's red.
    setIntent(ui, "vec1", "borderStyleMode", "original");
    const row = buildBorderRow(ui, "vec1");
    const swatch = row.querySelector(
      ".foliplus-style-border-color-input",
    ) as HTMLInputElement;
    expect(swatch.value).toBe("#00ff00");
    // The row is inert: no picker, no edit.
    expect(swatch.disabled).toBe(true);
    expect(swatch.readOnly).toBe(true);
    // The intent stays stored: returning to solid hands the user's color back.
    expect(getIntent(ui, "vec1", "borderColor")).toBe("#ff0000");
  });
});

describe("border apply scheduler (drag coalesce)", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = new Set();
    seedIntentMap(ui, "visible", {});
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("coalesces same-frame commits into one walk", () => {
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    commitBorderColor(ui, "vec1", "#111111");
    commitBorderColor(ui, "vec1", "#222222");
    commitBorderWeight(ui, "vec1", 5);
    expect(leaf.setStyle).not.toHaveBeenCalled();

    for (const cb of frames.splice(0)) cb();
    expect(leaf.setStyle).toHaveBeenCalledTimes(1);
    expect(leaf.setStyle).toHaveBeenCalledWith({
      color: "#222222",
      weight: 5,
      stroke: true,
    });
  });

  it("BORDER_DIMENSION.value reports the stored choice over the authored one", () => {
    const leaf = makeLeaf("#aabbcc", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    expect(BORDER_DIMENSION.value!(ui, "vec1")).toEqual({
      color: "#aabbcc",
      weight: 3,
      mode: "solid",
      ramp: undefined,
    });
    commitBorderNow(ui, "vec1", "color", "#445566");
    commitBorderNow(ui, "vec1", "weight", 7);
    expect(BORDER_DIMENSION.value!(ui, "vec1")).toEqual({
      color: "#445566",
      weight: 7,
      mode: "solid",
      ramp: undefined,
    });
  });

  it("shell builds color-only / weight-only rows and default selectors", () => {
    // The delegated drawer owns its own write path and does not pass
    // onFlush: the shell must not install a flush chain there. Also pins
    // the two shape branches (one input) and the default-selector fallback.
    const colorOnly = buildBorderRowShell({
      rowClass: "x",
      label: "Border",
      color: "#010203",
      weight: 2,
      hasColorInput: true,
      hasWeightInput: false,
      colorAria: "c",
      weightAria: "w",
    });
    expect(colorOnly.querySelector("input[type=color]")).toBeTruthy();
    expect(colorOnly.querySelector("input[type=number]")).toBeNull();

    const weightOnly = buildBorderRowShell({
      rowClass: "x",
      label: "Border",
      color: "#010203",
      weight: 2,
      hasColorInput: false,
      hasWeightInput: true,
      colorAria: "c",
      weightAria: "w",
    });
    expect(weightOnly.querySelector("input[type=color]")).toBeNull();
    expect(weightOnly.querySelector("input[type=number]")).toBeTruthy();

    // default selectors (no className) still resolve the two inputs
    bindBorderRowShell(colorOnly, {
      onChangeColor: vi.fn(),
    });
    bindBorderRowShell(weightOnly, {
      onChangeWeight: vi.fn(),
    });
  });

  it("shell without onFlush keeps the binders untouched (delegated drawer)", () => {
    // The delegated drawer owns its own write path and does not pass
    // onFlush: the shell must not install a flush chain there.
    const row = buildBorderRowShell({
      rowClass: "x",
      label: "Border",
      color: "#010203",
      weight: 2,
      hasColorInput: true,
      hasWeightInput: true,
      className: "c-in",
      weightClassName: "w-in",
      colorAria: "c",
      weightAria: "w",
    });
    const color = row.querySelector("input.c-in") as HTMLInputElement;
    const weight = row.querySelector("input.w-in") as HTMLInputElement;
    const colorChange = vi.fn();
    const weightChange = vi.fn();
    bindBorderRowShell(row, {
      className: "c-in",
      weightClassName: "w-in",
      onChangeColor: colorChange,
      onChangeWeight: weightChange,
    });
    const priorColorChange = color.onchange;
    const priorWeightChange = weight.onchange;
    color.dispatchEvent(new Event("change"));
    weight.dispatchEvent(new Event("change"));
    // no flush chain installed — the raw binder's handlers stay as-is
    expect(priorColorChange).toBe(color.onchange);
    expect(priorWeightChange).toBe(weight.onchange);
  });

  it("shell weight blur flushes the deferred walk", () => {
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    const row = buildBorderRow(ui, "vec1");
    bindBorderRow(ui, "vec1", row);
    const weight = row.querySelector(
      ".foliplus-style-border-weight-input",
    ) as HTMLInputElement;
    weight.value = "8";
    weight.dispatchEvent(new Event("input", { bubbles: true }));
    expect(leaf.setStyle).not.toHaveBeenCalled();
    weight.dispatchEvent(new Event("blur", { bubbles: true }));

    expect(leaf.setStyle).toHaveBeenCalledWith({ weight: 8, stroke: true });
  });

  it("closing the style panel flushes a pending border walk", () => {
    // Panel close is a commit boundary for BOTH faces: a dragged border
    // left on a trailing frame must not vanish when the panel disappears.
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    // minimal panel chrome so closeStylePanel finds stylePanelLayerId
    ui.overlayPanel.stylePanelLayerId = "vec1";
    commitBorderColor(ui, "vec1", "#333333");
    expect(leaf.setStyle).not.toHaveBeenCalled();

    closeStylePanel(ui, false);

    expect(leaf.setStyle).toHaveBeenCalledWith({
      color: "#333333",
      stroke: true,
    });
  });

  it("shell weight change runs the live binder commit and then flushes", () => {
    // bindLiveNumber owns onchange (clamp + commit); the flush is chained
    // AFTER it, so one change event both commits the value and lands the
    // deferred walk. (Unlike color, a prior onchange is replaced by the
    // binder itself — the chain protects that binder, not an outsider.)
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    const row = buildBorderRow(ui, "vec1");
    bindBorderRow(ui, "vec1", row);
    const weight = row.querySelector(
      ".foliplus-style-border-weight-input",
    ) as HTMLInputElement;
    weight.value = "4";
    weight.dispatchEvent(new Event("input", { bubbles: true }));
    expect(leaf.setStyle).not.toHaveBeenCalled();
    weight.dispatchEvent(new Event("change", { bubbles: true }));

    expect(getIntent(ui, "vec1", "borderWeight")).toBe(4);
    expect(leaf.setStyle).toHaveBeenCalledWith({ weight: 4, stroke: true });
  });

  it("flush delivers the terminal value and is idempotent", () => {
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    commitBorderColor(ui, "vec1", "#333333");
    flushStyleDimApply(FACE.STROKE, "vec1");
    expect(leaf.setStyle).toHaveBeenCalledWith({
      color: "#333333",
      stroke: true,
    });
    expect(leaf.setStyle).toHaveBeenCalledTimes(1);
    // The first flush executed the box, and execution reclaims the entry —
    // the second flush finds nothing, and the Map holds no parked closure.
    flushStyleDimApply(FACE.STROKE, "vec1");
    expect(leaf.setStyle).toHaveBeenCalledTimes(1);
    expect(hasStyleDimApply(FACE.STROKE, "vec1")).toBe(false);
  });

  it("reset cancels a pending walk so it cannot paint over the restore", () => {
    const leaf = makeLeaf("#aabbcc", 3);
    leaf.setStyle = vi.fn((style: Record<string, unknown>) =>
      Object.assign(leaf.options, style),
    );
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    commitBorderColor(ui, "vec1", "#ff0000");
    leaf.setStyle.mockClear();
    resetLayerBorder(ui, "vec1");
    expect(leaf.options.color).toBe("#aabbcc");
    for (const cb of frames.splice(0)) cb();
    // the cancelled drag walk must not repaint the user's color
    expect(leaf.options.color).toBe("#aabbcc");
  });

  it("unregister drops the scheduler entry — no Map residue for dead ids", () => {
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    commitBorderColor(ui, "vec1", "#333333");
    expect(hasStyleDimApply(FACE.STROKE, "vec1")).toBe(true);

    manager.unregisterLayer("vec1");
    expect(hasStyleDimApply(FACE.STROKE, "vec1")).toBe(false);
    for (const cb of frames.splice(0)) cb();
    expect(leaf.setStyle).not.toHaveBeenCalled();
  });

  it("bind chain: change runs the prior handler and flushes", () => {
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    // Editable colour: the border row is read-only in ORIGINAL mode (the
    // author's own stroke); a stored "solid" mode is what makes it a picker.
    setIntent(ui, "vec1", "borderStyleMode", "solid");
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    const row = buildBorderRow(ui, "vec1");
    bindBorderRow(ui, "vec1", row);
    const color = row.querySelector(
      ".foliplus-style-border-color-input",
    ) as HTMLInputElement;
    const prior = vi.fn();
    const chained = color.onchange;
    color.onchange = ev => {
      prior(ev);
      chained?.call(color, ev);
    };
    color.value = "#445544";
    color.dispatchEvent(new Event("input", { bubbles: true }));
    color.dispatchEvent(new Event("change", { bubbles: true }));

    expect(prior).toHaveBeenCalledTimes(1);
    expect(leaf.setStyle).toHaveBeenCalledWith({
      color: "#445544",
      stroke: true,
    });
  });
});

// The base layer every content-change fixture carries — the hook's early
// return for ROLE.BASE must not be what keeps a replay from running.
const BASE_LAYER = {
  id: "base1",
  name: "OSM",
  role: "base",
  layer: { options: {}, setZIndex: vi.fn() } as never,
  paneName: "tilePane",
};

describe("content-change replay", () => {
  let manager: LayerController;
  let ui: LayerUI;

  // The group closes over the array, so a leaf pushed after the fixture was
  // built is still walked — that late leaf is the replay's whole subject.
  const groupWith = (children: any[]): any => ({
    options: {},
    eachLayer: vi.fn((fn: (child: unknown) => void) => {
      for (const child of children) fn(child);
    }),
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("replays the stored border to a leaf that lands after the user chose one", () => {
    const early = makeLeaf("#00ff00", 1);
    const late = makeLeaf("#445566", 4);
    const children = [early];
    ({ manager, ui } = initFixture({
      data: [
        { id: "grp1", name: "G", role: "overlay", layer: groupWith(children) },
        BASE_LAYER,
      ],
    }));
    commitBorderColor(ui, "grp1", "#ff0000");
    flushStyleDimApply(FACE.STROKE, "grp1");
    expect(early.setStyle).toHaveBeenCalledWith(
      expect.objectContaining({ color: "#ff0000", stroke: true }),
    );

    // A leaf lands while the user already has a border chosen.
    children.push(late);
    ensureEvents(ui.c.map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "grp1" });
    flushStyleDimApply(FACE.STROKE, "grp1");

    expect(late.setStyle).toHaveBeenCalledWith(
      expect.objectContaining({ color: "#ff0000", stroke: true }),
    );
    // Each leaf restores its own authored stroke, including the late one —
    // the replay captured its base on its first write, not the replayed value.
    resetLayerBorder(ui, "grp1");
    expect(early.setStyle).toHaveBeenLastCalledWith(
      expect.objectContaining({ color: "#00ff00", weight: 1, stroke: true }),
    );
    expect(late.setStyle).toHaveBeenLastCalledWith(
      expect.objectContaining({ color: "#445566", weight: 4, stroke: true }),
    );
  });

  it("coalesces a bulk add of leaves into one walk", () => {
    const early = makeLeaf("#00ff00", 1);
    const children = [early];
    ({ manager, ui } = initFixture({
      data: [
        { id: "grp1", name: "G", role: "overlay", layer: groupWith(children) },
        BASE_LAYER,
      ],
    }));
    commitBorderColor(ui, "grp1", "#ff0000");
    flushStyleDimApply(FACE.STROKE, "grp1");
    expect(early.setStyle).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 5; i++) {
      children.push(makeLeaf("#101010", 2));
      ensureEvents(ui.c.map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "grp1" });
    }
    // Five content changes, one pending frame: no new leaf walked yet.
    expect(children.slice(1).some(l => l.setStyle.mock.calls.length > 0)).toBe(false);

    flushStyleDimApply(FACE.STROKE, "grp1");
    // Each new leaf was written exactly once, by that single walk.
    expect(children.slice(1).every(l => l.setStyle.mock.calls.length === 1)).toBe(true);
  });

  it("does nothing when the user never chose a border", () => {
    const leaf = makeLeaf("#112233", 3);
    ({ manager, ui } = initFixture({
      data: [{ id: "o1", name: "O", role: "overlay", layer: leaf }, BASE_LAYER],
    }));
    ensureEvents(ui.c.map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "o1" });
    flushStyleDimApply(FACE.STROKE, "o1");
    expect(leaf.setStyle).not.toHaveBeenCalled();
    // No base was captured for an untouched leaf, so a reset cannot invent a
    // style for it either.
    resetLayerBorder(ui, "o1");
    expect(leaf.setStyle).not.toHaveBeenCalled();
  });
});

// ── C1–C7: value-based stroke wiring (spec §5) ──────────────────────────────────────────────
//
// These exercise the WIRING, not the engine (strokeValue.test.ts owns the
// engine): applyBorderToLayer must dispatch to applyValueStroke when the
// border mode is 'value', and the border row must expose the mode select.
// The layer fixture is a group-like parent whose feature leaves carry
// `feature.properties.count` so numericFields resolves.

/** Install a chroma stub returning a fixed color list — the same shape the
 *  engine tests use, so a ramp build is deterministic. */
const installChroma = (colors: string[]): void => {
  globalThis.chroma = {
    scale: () => ({
      mode: () => ({ colors: (count: number) => colors.slice(0, count) }),
      colors: (count: number) => colors.slice(0, count),
    }),
  } as never;
};

/** A feature leaf the value mode classifies: an areal polygon (so the fill
 *  mode's walkFillLeaves reaches it too) with a numeric property. */
const makeFeatureLeaf = (
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
const makeFeatureGroup = (...leaves: any[]): any => ({
  options: {},
  eachLayer: vi.fn((fn: (child: unknown) => void) => {
    for (const leaf of leaves) fn(leaf);
  }),
  leaves,
});

/** A numeric ramp config for the field the fixture leaves carry. */
const countRamp = (overrides: Partial<ValueConfig> = {}): ValueConfig => ({
  kind: "numeric",
  field: "count",
  method: METHOD.EQUAL,
  classes: 3,
  scheme: DEFAULT_SCHEMES[0],
  ...overrides,
});

/** Register a feature group + seed its numeric field cache. */
const registerFeatureLayer = (
  manager: LayerController,
  ui: LayerUI,
  id: string,
  leaves: any[],
): void => {
  installLeafletGlobals();
  manager.registerLayer({ id, name: id, layer: makeFeatureGroup(...leaves) });
  ui.runtimeStore.setFields(id, [{ name: "count", numeric: true }]);
};

describe("value-stroke wiring (C1–C7)", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = new Set();
    seedIntentMap(ui, "visible", {});
    installChroma(["#010101", "#020202", "#030303"]);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    delete globalThis.chroma;
  });

  // C1: same value domain on fill and stroke — with the same classify +
  // palette, a value-classified fill and a value-classified border paint the
  // same value the same color on both faces. The border owns its value config
  // independently (no cross-face derivation): both faces carry the same
  // explicit config, so the same classify must produce the same color.
  it("C1 paints the same value domain the same color on fill and stroke", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);

    // Paint the fill by value first, capturing the per-leaf fill color.
    setIntent(ui, "vec1", "fillValue", countRamp());
    applyFillToLayer(ui, "vec1");
    const fillColors = leaves.map(l => l.options.fillColor);

    // Then the border, with its own explicit value config + value mode.
    setIntent(ui, "vec1", "borderValue", countRamp());
    setIntent(ui, "vec1", "borderStyleMode", "value");
    applyBorderToLayer(ui, "vec1");

    // The stroke write is a per-leaf setStyle with the value color.
    leaves.forEach((leaf, idx) => {
      const strokeCall = leaf.setStyle.mock.calls.at(-1)?.[0];
      expect(strokeCall).toMatchObject({ color: fillColors[idx], stroke: true });
    });
  });

  // C2: value mode Reset returns the layer to its authored flat border.
  it("C2 reset returns the layer to the authored flat border after a value stroke", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);
    setIntent(ui, "vec1", "borderValue", countRamp());
    setIntent(ui, "vec1", "borderStyleMode", "value");

    applyBorderToLayer(ui, "vec1");
    expect(leaves[0].setStyle).toHaveBeenCalled();

    resetLayerBorder(ui, "vec1");

    // The author's flat color returns — the bag captured the author's stroke
    // face on the first write and reset restores exactly it.
    leaves.forEach(leaf => {
      expect(leaf.options.color).toBe("#ff0000");
      expect(leaf.options.weight).toBe(2);
    });
  });

  // C3: zero fill opacity does not cross into the stroke — the border stays
  // value-classified even when the fill is invisible.
  it("C3 zero fill opacity leaves the value stroke uncolored", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);
    setIntent(ui, "vec1", "fillValue", countRamp());
    setIntent(ui, "vec1", "fillOpacity", 0);
    setIntent(ui, "vec1", "borderValue", countRamp());
    setIntent(ui, "vec1", "borderStyleMode", "value");

    applyFillToLayer(ui, "vec1");
    const fillColors = leaves.map(l => l.options.fillColor);
    // The fill is invisible but still classifies.
    expect(fillColors[0]).toBeDefined();

    applyBorderToLayer(ui, "vec1");

    leaves.forEach((leaf, idx) => {
      const strokeCall = leaf.setStyle.mock.calls.at(-1)?.[0];
      // The stroke carries its own value color, not a colorless write.
      expect(strokeCall).toMatchObject({ color: fillColors[idx], stroke: true });
    });
  });

  // C4: mode resolution is symmetric with the fill — a ramp with no explicit
  // mode reads as value, and no ramp reads as solid.
  it("C4 resolves the mode symmetrically with the fill mode", () => {
    expect(resolveStrokeMode(undefined, countRamp())).toBe("value");
    expect(resolveStrokeMode(undefined, undefined)).toBe("solid");
    expect(resolveStrokeMode("solid", countRamp())).toBe("solid");
    expect(resolveStrokeMode("value", countRamp())).toBe("value");
  });

  // C5: a config change after the cache was built returns null from the
  // highlight pin — the mouseout replay does not re-apply a stale color.
  it("C5 drops the highlight replay once the config changes", () => {
    const leaf = makeFeatureLeaf(5);
    registerFeatureLayer(manager, ui, "vec1", [leaf]);
    setIntent(ui, "vec1", "borderValue", countRamp());
    setIntent(ui, "vec1", "borderStyleMode", "value");

    applyBorderToLayer(ui, "vec1");
    // Pin registered.
    expect(pinnedGetterCount(leaf)).toBe(1);

    // Change the config (scheme), then the pin must answer null so folium's
    // restore stands instead of re-applying a stale color.
    setIntent(ui, "vec1", "borderValue", countRamp({ scheme: DEFAULT_SCHEMES[1] }));
    applyBorderToLayer(ui, "vec1");
  });

  // C6: a leaf the value ramp cannot classify falls back to the author's
  // color with the stroke flag lit.
  it("C6 unclassifiable leaf falls back to author color with stroke lit", () => {
    const good = makeFeatureLeaf(5);
    const bad = makeFeatureLeaf(Number.NaN); // no finite value
    registerFeatureLayer(manager, ui, "vec1", [good, bad]);
    setIntent(ui, "vec1", "borderValue", countRamp());
    setIntent(ui, "vec1", "borderStyleMode", "value");

    applyBorderToLayer(ui, "vec1");

    const goodCall = good.setStyle.mock.calls.at(-1)?.[0];
    const badCall = bad.setStyle.mock.calls.at(-1)?.[0];
    // The classifiable leaf got the ramp color; the unclassifiable one keeps
    // the author's color but the stroke flag is lit so the border shows.
    expect(goodCall).toMatchObject({ stroke: true });
    expect(badCall).toMatchObject({ color: "#ff0000", stroke: true });
  });

  // C7: pre-wiring regression — the solid path still writes a flat
  // color+weight when no value config is in force.
  it("C7 the solid path still writes a flat color and weight", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);
    setIntent(ui, "vec1", "borderColor", "#0000ff");
    setIntent(ui, "vec1", "borderWeight", 6);

    applyBorderToLayer(ui, "vec1");

    leaves.forEach(leaf => {
      expect(leaf.setStyle).toHaveBeenCalledWith({
        color: "#0000ff",
        weight: 6,
        stroke: true,
      });
    });
  });

  // C8 removed: the border no longer derives the fill ramp (the "follow
  // fill" cross-face rule is gone). A fill-only classification paints the
  // border nothing — the border paints only its own explicit config.
});

describe("value-stroke row and dimension wiring (fix #2 coverage)", () => {
  let manager: LayerController;
  let ui: LayerUI;
  // Drive the exported row surface (buildBorderRow/bindBorderRow) plus the
  // registered BORDER_DIMENSION — the only public doors to the module-private
  // value-detail helpers (borderValueForUi, borderSeedField, writeBorderMode,
  // writeBorderValue, borderDetailMode, renderBorderDetail, bindBorderDetail,
  // bindBorderValueDetail, convergeBorderClassesRow).
  const openBorderRow = (
    manager: LayerController,
    ui: LayerUI,
    id: string,
    leaves: ReturnType<typeof makeFeatureLeaf>[],
  ) => {
    registerFeatureLayer(manager, ui, id, leaves);
    const block = buildBorderRow(ui, id) as HTMLElement;
    document.body.appendChild(block);
    bindBorderRow(ui, id, block);
    return block;
  };
  const modeSelectOf = (block: HTMLElement) =>
    block.querySelector(
      ".foliplus-style-border-mode-select",
    ) as HTMLSelectElement | null;
  const changeSelect = (sel: HTMLSelectElement | null, value: string) => {
    expect(sel).not.toBeNull();
    sel!.value = value;
    sel!.dispatchEvent(new Event("change"));
  };

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = new Set();
    seedIntentMap(ui, "visible", {});
    installChroma(["#010101", "#020202", "#030303"]);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    delete globalThis.chroma;
  });

  it("T1 seeds a numeric value config and shows the value detail when the user picks by value", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    const block = openBorderRow(manager, ui, "vec1", leaves);
    // Original mode (default on a polygon border): the block carries the
    // mode select and a solid detail; no value field rows are shown.
    const select = modeSelectOf(block);
    expect(select).not.toBeNull();
    expect(select!.value).toBe("original");
    expect(block.querySelector(".foliplus-style-border-detail")).not.toBeNull();
    expect(block.querySelector(".foliplus-style-fill-field-select")).toBeNull();

    // Pick "by value": writes BORDER_STYLE_MODE=value + seeds BORDER_VALUE from the
    // numeric chain (borderValueForUi → seeded default, persistedBorderValue numeric).
    changeSelect(select, "value");
    expect(getIntent(ui, "vec1", "borderStyleMode")).toBe("value");
    const seeded = getIntent(ui, "vec1", "borderValue");
    expect(seeded).toMatchObject({ kind: "numeric", field: "count" });
    // The value detail now renders field / method / classes / scheme rows.
    expect(block.querySelector(".foliplus-style-fill-field-select")).not.toBeNull();
    expect(block.querySelector(".foliplus-style-fill-method-select")).not.toBeNull();
    expect(block.querySelector(".foliplus-style-fill-classes-select")).not.toBeNull();
    expect(block.querySelector(".foliplus-style-scheme-trigger")).not.toBeNull();
  });

  it("T2 seeds the border value from a stored config before the row is built", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);
    setIntent(ui, "vec1", "borderValue", countRamp());
    const block = openBorderRow(manager, ui, "vec1", leaves);
    // Display mode is original (no mode intent), so the detail is solid,
    // but the stored config is the seed for a later value switch.
    changeSelect(modeSelectOf(block), "value");
    expect(getIntent(ui, "vec1", "borderValue")).toEqual(countRamp());
  });

  it("T3 seeds a numeric value config from the first numeric field", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);
    const block = openBorderRow(manager, ui, "vec1", leaves);
    changeSelect(modeSelectOf(block), "value");
    const seeded = getIntent(ui, "vec1", "borderValue");
    expect(seeded).toMatchObject({ field: "count", kind: "numeric" });
  });

  it("T4 prefers the author scale column as the seed field", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    installLeafletGlobals();
    manager.registerLayer({
      id: "vec1",
      name: "vec1",
      layer: makeFeatureGroup(...leaves),
      fillAuthor: {
        perFeature: true,
        distinct: 3,
        stops: ["#111111", "#222222", "#333333"],
        scale: { kind: "continuous", column: "count" },
      },
    });
    ui.runtimeStore.setFields("vec1", [{ name: "count", numeric: true }]);
    const block = buildBorderRow(ui, "vec1") as HTMLElement;
    document.body.appendChild(block);
    bindBorderRow(ui, "vec1", block);
    changeSelect(modeSelectOf(block), "value");
    const seeded = getIntent(ui, "vec1", "borderValue");
    expect(seeded).toMatchObject({ field: "count" });
  });

  it("T5 original mode clears the border mode intent", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);
    setIntent(ui, "vec1", "borderStyleMode", "value");
    setIntent(ui, "vec1", "borderValue", countRamp());
    const block = openBorderRow(manager, ui, "vec1", leaves);
    const select = modeSelectOf(block);
    expect(select!.value).toBe("value");
    changeSelect(select, "original");
    expect(getIntent(ui, "vec1", "borderStyleMode")).toBe("original");
    // The value config survives an original switch (it stays stored for reuse).
    expect(getIntent(ui, "vec1", "borderValue")).toEqual(countRamp());
  });

  it("T6 solid mode writes the mode and keeps the value config", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);
    setIntent(ui, "vec1", "borderStyleMode", "value");
    setIntent(ui, "vec1", "borderValue", countRamp());
    const block = openBorderRow(manager, ui, "vec1", leaves);
    changeSelect(modeSelectOf(block), "solid");
    expect(getIntent(ui, "vec1", "borderStyleMode")).toBe("solid");
    expect(getIntent(ui, "vec1", "borderValue")).toEqual(countRamp());
  });

  it("T7 a value-detail control change writes through writeBorderValue", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    const block = openBorderRow(manager, ui, "vec1", leaves);
    changeSelect(modeSelectOf(block), "value");
    const methodSelect = block.querySelector(
      ".foliplus-style-fill-method-select",
    ) as HTMLSelectElement | null;
    expect(methodSelect).not.toBeNull();
    const target = "quantile";
    methodSelect!.value = target;
    methodSelect!.dispatchEvent(new Event("change"));
    const updated = getIntent(ui, "vec1", "borderValue") as ValueConfig;
    expect(updated.method).toBe(target);
  });

  it("T8 a classes change converges an out-of-vocabulary option", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    const block = openBorderRow(manager, ui, "vec1", leaves);
    changeSelect(modeSelectOf(block), "value");
    // Inject an out-of-vocabulary option (value 99 not in CLASS_COUNT_VALUES)
    // then pick a valid class — the stray option must be removed.
    const classesSelect = block.querySelector(
      ".foliplus-style-fill-classes-select",
    ) as HTMLSelectElement | null;
    expect(classesSelect).not.toBeNull();
    classesSelect!.appendChild(new Option("99", "99"));
    classesSelect!.value = "4";
    classesSelect!.dispatchEvent(new Event("change"));
    expect(classesSelect!.querySelector('option[value="99"]')).toBeNull();
    expect(classesSelect!.value).toBe("4");
    const updated = getIntent(ui, "vec1", "borderValue") as ValueConfig;
    expect(updated.classes).toBe(4);
  });

  // ── persistedBorderValue branch coverage (codecov patch target) ──
  // border.ts:250-265 has two arms: CATEGORY passes classes through as-is
  // (line 256), NUMERIC clamps classes into [CLASS_COUNT.MIN, MAX] (line 263).
  // Existing tests drive only the NUMERIC arm; these two cover both branches
  // and prove the semantic difference (category preserves out-of-vocab classes,
  // numeric clamps them).

  /** A category value config with out-of-vocabulary classes (43 and 0 are both
   *  outside CLASS_COUNT_VALUES=[2..9]). Used to prove the CATEGORY arm does
   *  NOT clamp — it passes the user's raw choice through untouched. */
  const categoryOut = (classes: number): ValueConfig => ({
    kind: "category",
    field: "count",
    method: "jenks",
    classes,
    scheme: DEFAULT_SCHEMES[0],
  });

  it("T8a CATEGORY value config passes classes through without clamping", () => {
    // Write a category config with classes=43 (outside the [2..9] vocabulary)
    // through the real persistence path (writeBorderValue → persistedBorderValue
    // → BORDER_DIMENSION.write → intentStore.setRaw → saveState).
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);

    const block = openBorderRow(manager, ui, "vec1", leaves);
    changeSelect(modeSelectOf(block), "value");

    // Force the stored config to CATEGORY with out-of-vocab classes, then
    // trigger a value-detail change (method) to drive writeBorderValue.
    setIntent(ui, "vec1", "borderValue", categoryOut(43));
    const methodSelect = block.querySelector(
      ".foliplus-style-fill-method-select",
    ) as HTMLSelectElement;
    methodSelect.value = "quantile";
    methodSelect.dispatchEvent(new Event("change"));

    // Read back from intent: the CATEGORY arm must preserve classes=43 as-is.
    // (getIntent surfaces the field through resolvedValue, which drops "count"
    // because the layer holds no category fields — that is a display-side
    // resolve, not the persisted shape.)
    const persisted = getIntent(ui, "vec1", "borderValue") as ValueConfig;
    expect(persisted.kind).toBe("category");
    expect(persisted.method).toBe("quantile");
    // The critical assertion: classes NOT clamped to the vocabulary.
    expect(persisted.classes).toBe(43);

    // The intent store is the persisted source of truth saveState serializes,
    // so the getIntent read above IS the real persistence path (writeBorderValue
    // → persistedBorderValue → BORDER_DIMENSION.write → intentStore.setRaw).
  });

  it("T8b NUMERIC value config clamps out-of-range classes into [2, 9]", () => {
    // Write a numeric config with classes=43 through the same path; the
    // NUMERIC arm must clamp it to CLASS_COUNT.MAX (9).
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    const block = openBorderRow(manager, ui, "vec1", leaves);
    changeSelect(modeSelectOf(block), "value");

    // Seed a numeric config with out-of-range classes, then trigger a write.
    setIntent(ui, "vec1", "borderValue", countRamp({ classes: 43 }));
    const methodSelect = block.querySelector(
      ".foliplus-style-fill-method-select",
    ) as HTMLSelectElement;
    methodSelect.value = "quantile";
    methodSelect.dispatchEvent(new Event("change"));

    const persisted = getIntent(ui, "vec1", "borderValue") as ValueConfig;
    expect(persisted.kind).toBe("numeric");
    expect(persisted.field).toBe("count");
    expect(persisted.method).toBe("quantile");
    // The critical assertion: classes CLAMPED to CLASS_COUNT.MAX.
    expect(persisted.classes).toBe(9);

    // Lower bound: classes=0 clamps to CLASS_COUNT.MIN (2).
    setIntent(ui, "vec1", "borderValue", countRamp({ classes: 0 }));
    methodSelect.value = "jenks";
    methodSelect.dispatchEvent(new Event("change"));
    const clampedLow = getIntent(ui, "vec1", "borderValue") as ValueConfig;
    expect(clampedLow.classes).toBe(2);
  });

  it("T8c CATEGORY and NUMERIC arms differ semantically (classes handling)", () => {
    // Prove the two branches are NOT equivalent: the same out-of-vocab classes
    // value passes through CATEGORY but clamps in NUMERIC.
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    const block = openBorderRow(manager, ui, "vec1", leaves);
    changeSelect(modeSelectOf(block), "value");

    // CATEGORY with classes=0 (below MIN): stays 0, not clamped up to 2.
    setIntent(ui, "vec1", "borderValue", categoryOut(0));
    const methodSelect = block.querySelector(
      ".foliplus-style-fill-method-select",
    ) as HTMLSelectElement;
    methodSelect.value = "quantile";
    methodSelect.dispatchEvent(new Event("change"));
    const catPersisted = getIntent(ui, "vec1", "borderValue") as ValueConfig;
    expect(catPersisted.kind).toBe("category");
    expect(catPersisted.classes).toBe(0); // NOT clamped up to MIN=2

    // NUMERIC with classes=0: clamps up to MIN=2.
    setIntent(ui, "vec1", "borderValue", countRamp({ classes: 0 }));
    methodSelect.value = "jenks";
    methodSelect.dispatchEvent(new Event("change"));
    const numPersisted = getIntent(ui, "vec1", "borderValue") as ValueConfig;
    expect(numPersisted.kind).toBe("numeric");
    expect(numPersisted.classes).toBe(2); // clamped up to MIN=2

    // The two configs with identical input classes diverge because of kind.
    expect(catPersisted.classes).not.toBe(numPersisted.classes);
  });

  it("T9 BORDER_DIMENSION.write writes the value config and clears the mode", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);
    const dim = getDimension(DIM.BORDER)!;
    dim.write!(ui, "vec1", { mode: "value", value: countRamp() });
    expect(getIntent(ui, "vec1", "borderStyleMode")).toBe("value");
    expect(getIntent(ui, "vec1", "borderValue")).toEqual(countRamp());
    // Write mode present writes it; mode undefined is a no-op (no follow mode).
    dim.write!(ui, "vec1", { mode: "solid" });
    expect(getIntent(ui, "vec1", "borderStyleMode")).toBe("solid");
    expect(getIntent(ui, "vec1", "borderValue")).toEqual(countRamp());
  });

  it("T10 the value mode carries an explicit user-set border weight", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);
    setIntent(ui, "vec1", "borderValue", countRamp());
    setIntent(ui, "vec1", "borderStyleMode", "value");
    setIntent(ui, "vec1", "borderWeight", 6);
    applyBorderToLayer(ui, "vec1");
    leaves.forEach(leaf => {
      const strokeCall = leaf.setStyle.mock.calls.at(-1)?.[0];
      expect(strokeCall).toMatchObject({ weight: 6, stroke: true });
      expect(typeof strokeCall.color).toBe("string");
    });
  });

  // ── geometry gate ──
  // borderCarriesValue = geometryKindOf === LINE. Polygon/point borders are
  // the outline, never the element's primary colour, so they must never
  // offer by_value. The stored-by-value-on-polygon negative is the
  // "no silent fallback" guard: displayBorderMode rejects the illegal value
  // and returns ORIGINAL instead.

  /** A Polygon feature leaf — unlike makeFeatureLeaf (now LineString for the
   *  value-stroke tests), this creates a genuine L.Polygon so getGeometryType
   *  returns "Polygon" without mocking. */
  const makePolyLeaf = (count: number): any => {
    const leaf = new (globalThis as any).L.Polygon() as any;
    leaf.options = { color: "#ff0000", weight: 2, stroke: true };
    leaf.feature = { geometry: { type: "Polygon" }, properties: { count } };
    leaf.setStyle = vi.fn((style: Record<string, unknown>) => {
      Object.assign(leaf.options, style);
      return leaf;
    });
    leaf.on = vi.fn();
    return leaf;
  };

  it("polygon layer: stored by_value reads back as original (illegal value rejected)", () => {
    const leaves = [makePolyLeaf(1), makePolyLeaf(5)];
    registerFeatureLayer(manager, ui, "poly1", leaves);
    setIntent(ui, "poly1", "borderStyleMode", "value");
    setIntent(ui, "poly1", "borderValue", countRamp());
    // displayBorderMode contract: illegal stored value on a non-line → ORIGINAL.
    // The row select must NOT show "value".
    const block = openBorderRow(manager, ui, "poly1", leaves);
    const select = modeSelectOf(block);
    expect(select!.value).not.toBe("value");
  });

  it("line layer: by_value IS offered in the options", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5)];
    registerFeatureLayer(manager, ui, "line1", leaves);
    const block = openBorderRow(manager, ui, "line1", leaves);
    const select = modeSelectOf(block);
    const values = Array.from(select!.options).map(o => o.value);
    expect(values).toContain("value"); // by_value present on a line
  });

  it("polygon layer: by_value is NOT offered in the options", () => {
    const leaves = [makePolyLeaf(1), makePolyLeaf(5)];
    registerFeatureLayer(manager, ui, "poly2", leaves);
    const block = openBorderRow(manager, ui, "poly2", leaves);
    const select = modeSelectOf(block);
    const values = Array.from(select!.options).map(o => o.value);
    expect(values).not.toContain("value"); // by_value absent on a polygon
  });
});

describe("value-detail and shell wiring coverage", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = new Set();
    seedIntentMap(ui, "visible", {});
    installChroma(["#010101", "#020202", "#030303"]);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    delete globalThis.chroma;
  });

  const openBorderRow = (
    manager: LayerController,
    ui: LayerUI,
    id: string,
    leaves: ReturnType<typeof makeFeatureLeaf>[],
  ) => {
    registerFeatureLayer(manager, ui, id, leaves);
    const block = buildBorderRow(ui, id) as HTMLElement;
    document.body.appendChild(block);
    bindBorderRow(ui, id, block);
    return block;
  };
  const modeSelectOf = (block: HTMLElement) =>
    block.querySelector(
      ".foliplus-style-border-mode-select",
    ) as HTMLSelectElement | null;
  const changeSelect = (sel: HTMLSelectElement | null, value: string) => {
    expect(sel).not.toBeNull();
    sel!.value = value;
    sel!.dispatchEvent(new Event("change"));
  };

  it("binds the value detail's scheme picker and field select", () => {
    // Lines 770-800: createSchemePicker resolveHost/onChange, the overlay
    // register callbacks, and the field select's onchange. Drive the real
    // picker through the trigger and the field select through a change.
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    const block = openBorderRow(manager, ui, "vec1", leaves);
    changeSelect(modeSelectOf(block), "value");

    // Field select: changing it writes the border value field.
    const fieldSelect = block.querySelector(
      ".foliplus-style-fill-field-select",
    ) as HTMLSelectElement;
    fieldSelect.value = "count";
    fieldSelect.dispatchEvent(new Event("change"));
    expect(getIntent(ui, "vec1", "borderValue")).toMatchObject({ field: "count" });

    // Scheme picker: trigger click opens the dropdown, item click writes the
    // scheme, outside click closes through the overlay registry.
    const trigger = block.querySelector(
      ".foliplus-style-scheme-trigger",
    ) as HTMLElement;
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const item = document.querySelector(
      '.foliplus-scheme-picker-item[data-scheme-name="Reds"]',
    ) as HTMLElement;
    expect(item).not.toBeNull();
    item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(getIntent(ui, "vec1", "borderValue")).toMatchObject({ scheme: "Reds" });
  });

  it("closes the border scheme picker on outside click through the overlay registry", () => {
    // Lines 788-790: the overlay register's isOpen/panels/close callbacks.
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    const block = openBorderRow(manager, ui, "vec1", leaves);
    changeSelect(modeSelectOf(block), "value");

    const trigger = block.querySelector(
      ".foliplus-style-scheme-trigger",
    ) as HTMLElement;
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".foliplus-scheme-picker-dropdown")).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".foliplus-scheme-picker-dropdown")).toBeNull();
  });

  it("binds a bare shell row without a block through bindBorderRowShell", () => {
    // Lines 850-858: bindBorderRow's no-block branch binds the row shell
    // directly (a row outside a mode block). Drive the color and weight
    // controls to exercise the onChangeColor/onChangeWeight/onFlush closures.
    const leaf = makeLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    setIntent(ui, "vec1", "borderStyleMode", "solid");

    const row = buildBorderRowShell({
      rowClass: "foliplus-style-border-row",
      label: ui.T("border"),
      color: "#00ff00",
      weight: 3,
      hasColorInput: true,
      hasWeightInput: true,
      className: "foliplus-style-border-color-input",
      weightClassName: "foliplus-style-border-weight-input",
      colorAria: ui.T("style_border_color"),
      weightAria: ui.T("style_border_weight"),
    });
    document.body.appendChild(row);
    // The bare row is not inside a data-style-dim block: bindBorderRow takes
    // the no-block branch and binds the shell directly.
    bindBorderRow(ui, "vec1", row);

    const swatch = row.querySelector(
      ".foliplus-style-border-color-input",
    ) as HTMLInputElement;
    swatch.value = "#abcdef";
    swatch.dispatchEvent(new Event("input", { bubbles: true }));
    flushStyleDimApply(FACE.STROKE, "vec1");
    expect(getIntent(ui, "vec1", "borderColor")).toBe("#abcdef");

    const weight = row.querySelector(
      ".foliplus-style-border-weight-input",
    ) as HTMLInputElement;
    weight.value = "6";
    weight.dispatchEvent(new Event("change", { bubbles: true }));
    expect(getIntent(ui, "vec1", "borderWeight")).toBe(6);
  });
});

describe("follow-fill border mode", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = new Set();
    seedIntentMap(ui, "visible", {});
    installChroma(["#010101", "#020202", "#030303"]);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    delete globalThis.chroma;
  });

  /** A genuine areal leaf: the border is the outline, the fill owns the face. */
  const makeAreaLeaf = (count: number, opts: Record<string, unknown> = {}): any => {
    installLeafletGlobals();
    const leaf = new (globalThis as any).L.Polygon() as any;
    leaf.options = { color: "#ff0000", weight: 2, stroke: true, ...opts };
    leaf.feature = { geometry: { type: "Polygon" }, properties: { count } };
    leaf.setStyle = vi.fn((style: Record<string, unknown>) => {
      Object.assign(leaf.options, style);
      return leaf;
    });
    leaf.on = vi.fn();
    return leaf;
  };

  /** A genuine line leaf: the border is the element's own primary colour. */
  const makeLineLeaf = (count: number): any => {
    installLeafletGlobals();
    const leaf = new (globalThis as any).L.Polyline() as any;
    leaf.options = { color: "#ff0000", weight: 2, stroke: true };
    leaf.feature = { geometry: { type: "LineString" }, properties: { count } };
    leaf.setStyle = vi.fn((style: Record<string, unknown>) => {
      Object.assign(leaf.options, style);
      return leaf;
    });
    leaf.on = vi.fn();
    return leaf;
  };

  const openRow = (id: string, leaves: any[]) => {
    registerFeatureLayer(manager, ui, id, leaves);
    const block = buildBorderRow(ui, id) as HTMLElement;
    document.body.appendChild(block);
    bindBorderRow(ui, id, block);
    return block;
  };
  const selectOf = (block: HTMLElement) =>
    block.querySelector(
      ".foliplus-style-border-mode-select",
    ) as HTMLSelectElement | null;

  it("polygon: FOLLOW_FILL IS offered in the mode options", () => {
    const leaves = [makeAreaLeaf(1), makeAreaLeaf(5)];
    const block = openRow("poly1", leaves);
    const values = Array.from(selectOf(block)!.options).map(o => o.value);
    expect(values).toContain("followFill");
    // by_value is NOT offered on a non-line (existing contract).
    expect(values).not.toContain("value");
  });

  it("line: FOLLOW_FILL is NOT offered (no fill to follow)", () => {
    const leaves = [makeLineLeaf(1), makeLineLeaf(5)];
    const block = openRow("line1", leaves);
    const values = Array.from(selectOf(block)!.options).map(o => o.value);
    expect(values).not.toContain("followFill");
    // by_value IS offered on a line (existing contract).
    expect(values).toContain("value");
  });

  it("display holds FOLLOW_FILL across every fill state (no solid-only fallback)", () => {
    const leaves = [makeAreaLeaf(1), makeAreaLeaf(5)];
    openRow("poly1", leaves);
    setIntent(ui, "poly1", "borderStyleMode", "followFill");
    // Fill goes by-value (a state the old fallback collapsed to ORIGINAL).
    setIntent(ui, "poly1", "fillMode", "value");
    const block2 = buildBorderRow(ui, "poly1") as HTMLElement;
    document.body.appendChild(block2);
    const select2 = selectOf(block2);
    // Follow holds: the select still reads followFill, not original.
    expect(select2!.value).toBe("followFill");
    // Persistence keeps followFill.
    expect(getIntent(ui, "poly1", "borderStyleMode")).toBe("followFill");
  });

  it("derived paint: followFill reads the leaf's current fill colour, not a copy", () => {
    // The leaf's live fill paint is the single source. Simulate the fill
    // having been applied (solid colour lands in leaf.options.fillColor).
    const leaves = [makeAreaLeaf(1, { fillColor: "#123456" })];
    registerFeatureLayer(manager, ui, "poly1", leaves);
    setIntent(ui, "poly1", "fillMode", "solid");
    setIntent(ui, "poly1", "fillColor", "#123456");
    setIntent(ui, "poly1", "borderStyleMode", "followFill");
    applyBorderToLayer(ui, "poly1");
    // The border paints the leaf's fill colour (derived) — the borderColor
    // intent stays absent so a later fill edit recomputes the border.
    leaves.forEach(leaf => {
      const call = leaf.setStyle.mock.calls.at(-1)?.[0];
      expect(call.color).toBe("#123456");
    });
    expect(getIntent(ui, "poly1", "borderColor")).toBeUndefined();
  });

  it("per-feature fill + follow: each leaf paints its own fill colour", () => {
    const leaves = [
      makeAreaLeaf(1, { fillColor: "#111111" }),
      makeAreaLeaf(5, { fillColor: "#222222" }),
    ];
    registerFeatureLayer(manager, ui, "poly1", leaves);
    setIntent(ui, "poly1", "borderStyleMode", "followFill");
    applyBorderToLayer(ui, "poly1");
    const colors = leaves.map(leaf => leaf.setStyle.mock.calls.at(-1)?.[0].color);
    expect(colors[0]).toBe("#111111");
    expect(colors[1]).toBe("#222222");
    expect(colors[0]).not.toBe(colors[1]);
  });

  it("fill colour change: the border re-derives on the next apply", () => {
    const leaves = [makeAreaLeaf(1, { fillColor: "#111111" })];
    registerFeatureLayer(manager, ui, "poly1", leaves);
    setIntent(ui, "poly1", "borderStyleMode", "followFill");
    applyBorderToLayer(ui, "poly1");
    expect(leaves[0].setStyle.mock.calls.at(-1)?.[0].color).toBe("#111111");
    leaves[0].options.fillColor = "#abcdef";
    applyBorderToLayer(ui, "poly1");
    expect(leaves[0].setStyle.mock.calls.at(-1)?.[0].color).toBe("#abcdef");
  });

  it("fill write triggers a border re-apply when the border follows fill", () => {
    // The lead's critical contract: editing the fill (colour, mode, value)
    // must re-derive a follow-fill border on the SAME commit path — no
    // extra listener, no cross-face event.
    const leaves = [makeAreaLeaf(1, { fillColor: "#111111" })];
    registerFeatureLayer(manager, ui, "poly1", leaves);
    setIntent(ui, "poly1", "fillMode", "solid");
    setIntent(ui, "poly1", "borderStyleMode", "followFill");
    // The user edits the fill colour through the dimension write.
    FILL_DIMENSION.write!(ui, "poly1", { color: "#abcdef" });
    flushStyleDimApply(FACE.FILL, "poly1");
    flushStyleDimApply(FACE.STROKE, "poly1");
    // The border follow-fill replay fired and re-derived the leaf's stroke.
    expect(leaves[0].setStyle.mock.calls.at(-1)?.[0].color).toBe("#abcdef");
    // The border colour intent stays absent (derived, not copied).
    expect(getIntent(ui, "poly1", "borderColor")).toBeUndefined();
  });

  it("follow DOM: no colour input, width-only row in the right column", () => {
    setIntent(ui, "poly1", "borderStyleMode", "followFill");
    const block2 = buildBorderRow(ui, "poly1") as HTMLElement;
    document.body.appendChild(block2);
    expect(block2.querySelector("input[type=color]")).toBeNull();
    const weight = block2.querySelector(".foliplus-style-border-weight-input");
    expect(weight).not.toBeNull();
    const sizeRow = weight!.closest(".foliplus-style-size-row");
    expect(sizeRow).not.toBeNull();
  });

  it("derivedFillColor falls back through the three-arm chain", () => {
    const fillLeaf = makeAreaLeaf(1, { fillColor: "#123456" });
    const propLeaf = makeAreaLeaf(2);
    delete propLeaf.options.fillColor;
    propLeaf.feature.properties.__folium_color = "#654321";
    const strokeLeaf = makeAreaLeaf(3);
    delete strokeLeaf.options.fillColor;
    const leaves = [fillLeaf, propLeaf, strokeLeaf];
    registerFeatureLayer(manager, ui, "poly1", leaves);
    setIntent(ui, "poly1", "borderStyleMode", "followFill");
    applyBorderToLayer(ui, "poly1");
    const colors = leaves.map(l => l.setStyle.mock.calls.at(-1)?.[0].color);
    expect(colors[0]).toBe("#123456");
    expect(colors[1]).toBe("#654321");
    expect(colors[2]).toBe("#ff0000");
  });

  it("highlight replay re-derives the follow-fill colour (pin followFill arm)", () => {
    const leaf = makeHighlightLeaf("#ff0000", 2);
    leaf.options.fillColor = "#123456";
    manager.registerLayer({ id: "poly1", name: "P", layer: leaf });
    setIntent(ui, "poly1", "borderStyleMode", "followFill");
    applyBorderToLayer(ui, "poly1");
    expect(leaf.options.color).toBe("#123456");
    leaf.fireMouseout();
    expect(leaf.options.color).toBe("#123456");
  });
});

describe("border partial-coverage invariants (partial-coverage)", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = new Set();
    seedIntentMap(ui, "visible", {});
    installChroma(["#010101", "#020202", "#030303"]);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    delete globalThis.chroma;
  });

  const openBorderRow = (
    manager: LayerController,
    ui: LayerUI,
    id: string,
    leaves: ReturnType<typeof makeFeatureLeaf>[],
  ) => {
    registerFeatureLayer(manager, ui, id, leaves);
    const block = buildBorderRow(ui, id) as HTMLElement;
    document.body.appendChild(block);
    bindBorderRow(ui, id, block);
    return block;
  };
  const modeSelectOf = (block: HTMLElement) =>
    block.querySelector(
      ".foliplus-style-border-mode-select",
    ) as HTMLSelectElement | null;
  const changeSelect = (sel: HTMLSelectElement | null, value: string) => {
    expect(sel).not.toBeNull();
    sel!.value = value;
    sel!.dispatchEvent(new Event("change"));
  };

  it("L252 keeps a stored category border value through a mode write", () => {
    // persistedBorderValue's category arm: a stored category record must not
    // be coerced to a numeric ramp when the user re-picks by value. The
    // border row owns its config independently, so a category record from a
    // persisted state survives a mode write unchanged.
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);
    setIntent(ui, "vec1", "borderValue", {
      kind: "category",
      field: "count",
      method: "equal",
      classes: 3,
      scheme: "Blues",
    });
    const block = openBorderRow(manager, ui, "vec1", leaves);
    changeSelect(modeSelectOf(block), "value");
    const stored = getIntent(ui, "vec1", "borderValue") as ValueConfig;
    expect(stored.kind).toBe("category");
    expect(stored.scheme).toBe("Blues");
  });

  it("L273 refuses a value switch when the layer no longer offers numeric fields", () => {
    // writeBorderMode's empty-fields guard: the value mode needs a numeric
    // field to classify by. When the field cache empties between build and
    // change (data replaced), the switch must be refused — no mode write, no
    // seeded config, no partial UI state.
    // The leaves carry only a string property, so once the seeded numeric
    // cache is emptied the fallback leaf walk finds no numeric field either.
    const strLeaf = (label: string): any => {
      const leaf = new L.Polyline() as any;
      leaf.options = { color: "#ff0000", weight: 2, stroke: true };
      leaf.feature = {
        geometry: { type: "Polygon" },
        properties: { label },
      };
      const setStyle = vi.fn((style: Record<string, unknown>) => {
        Object.assign(leaf.options, style);
        return leaf;
      });
      leaf.setStyle = setStyle;
      leaf.on = vi.fn();
      return leaf;
    };
    const leaves = [strLeaf("a"), strLeaf("b"), strLeaf("c")];
    installLeafletGlobals();
    manager.registerLayer({
      id: "vec1",
      name: "vec1",
      layer: makeFeatureGroup(...leaves),
    });
    // Seed a numeric field cache so the row builds a mode select.
    ui.runtimeStore.setFields("vec1", [{ name: "count", numeric: true }]);
    const block = buildBorderRow(ui, "vec1") as HTMLElement;
    document.body.appendChild(block);
    bindBorderRow(ui, "vec1", block);
    // Empty the cache: numericFields falls through to the leaf walk, which
    // finds no numeric property, so the value switch must be refused.
    ui.runtimeStore.setFields("vec1", []);
    changeSelect(modeSelectOf(block), "value");
    expect(getIntent(ui, "vec1", "borderStyleMode")).toBeUndefined();
    expect(getIntent(ui, "vec1", "borderValue")).toBeUndefined();
  });

  it("L379 the ORIGINAL-mode pin returns null so folium's restore stands", () => {
    // pinStyleOnHighlight's ORIGINAL guard: once the mode reads as original,
    // the pin getter returns null — there is no user face to replay, so
    // folium's mouseout restore is the final paint and the author's stroke
    // stays.
    const leaf = makeHighlightLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    commitBorderNow(ui, "vec1", "color", "#abcdef"); // solid, pins
    setIntent(ui, "vec1", "borderStyleMode", "original");
    applyBorderToLayer(ui, "vec1"); // re-pin with the ORIGINAL getter
    leaf.setStyle.mockClear();
    leaf.fireMouseout();
    // folium's own handler restored the authored stroke; the pin getter
    // returned null, so no second write with the user's color.
    expect(leaf.setStyle).toHaveBeenCalledTimes(1);
    expect(leaf.setStyle).toHaveBeenCalledWith(leaf.authored);
    expect(leaf.options.color).toBe("#00ff00");
  });

  it("L663 a border row for a torn-down layer degrades to the two-state vocabulary", () => {
    // geometryKindOf's !layerInfo guard: a row built for a layer the registry
    // no longer knows (unregistered between data and panel build) must not
    // offer by_value — the null geometry reads as "not a line", so the
    // border degrades to original + single.
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves); // sets fields cache
    manager.unregisterLayer("vec1"); // registry entry gone
    // unload-label's invalidateFieldCache cleared the seeded cache; re-seed it so
    // buildBorderRow reaches geometryKindOf with fields present but no registry row.
    ui.runtimeStore.setFields("vec1", [{ name: "count", numeric: true }]);
    const block = buildBorderRow(ui, "vec1") as HTMLElement;
    const select = modeSelectOf(block);
    const values = select ? Array.from(select.options).map(o => o.value) : [];
    expect(values).not.toContain("value");
  });

  it("L746 a classes change with no out-of-vocabulary option converges cleanly", () => {
    // convergeBorderClassesRow's no-extra guard: when the classes row only
    // carries in-vocabulary options (the normal 2..9 build), a change must
    // not throw and must keep the picked value.
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    const block = openBorderRow(manager, ui, "vec1", leaves);
    changeSelect(modeSelectOf(block), "value");
    const classesSelect = block.querySelector(
      ".foliplus-style-fill-classes-select",
    ) as HTMLSelectElement | null;
    expect(classesSelect).not.toBeNull();
    classesSelect!.value = "5";
    classesSelect!.dispatchEvent(new Event("change"));
    const updated = getIntent(ui, "vec1", "borderValue") as ValueConfig;
    expect(updated.classes).toBe(5);
  });

  it("L877 a select change to the same mode is a no-op", () => {
    // bindBorderRow's same-mode guard: re-selecting the mode the select
    // already shows must not re-write the mode (a polygon whose stored value
    // reads back as original must not re-write "original").
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    const block = openBorderRow(manager, ui, "vec1", leaves);
    const select = modeSelectOf(block);
    expect(select!.value).toBe("original"); // default display mode
    changeSelect(select, "original"); // same value
    expect(getIntent(ui, "vec1", "borderStyleMode")).toBeUndefined();
  });

  it("L880/L885 a select change with no detail slot skips the detail bind", () => {
    // bindBorderRow's detail-null guards: a block that carries a mode select
    // but no detail element (a manually assembled row) must not crash on the
    // change — the detail branch is skipped when there is nothing to render.
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);
    const block = document.createElement("div");
    block.className = "foliplus-style-border-block";
    block.setAttribute("data-style-dim", "border");
    const select = document.createElement("select");
    select.className = "foliplus-style-border-mode-select";
    select.appendChild(new Option("original", "original"));
    select.appendChild(new Option("solid", "solid"));
    select.appendChild(new Option("value", "value"));
    block.appendChild(select);
    document.body.appendChild(block);
    bindBorderRow(ui, "vec1", block);
    changeSelect(select, "solid");
    expect(getIntent(ui, "vec1", "borderStyleMode")).toBe("solid");
  });

  it("L913 BORDER_DIMENSION.value resolves a stored border value", () => {
    // value's resolvedValue arm: when a border value is stored, the dimension
    // value resolves the config's field against the layer's current numeric
    // fields (not left as the raw stored record).
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);
    setIntent(ui, "vec1", "borderValue", countRamp());
    const v = BORDER_DIMENSION.value(ui, "vec1") as {
      value?: ValueConfig;
    };
    expect(v.value).toEqual(countRamp());
  });
});

/** A real Leaflet feature leaf of the given geometry kind so geometryType()
 *  returns the actual kind (the contract row in "border options per geometry"
 *  is the REAL geometry, not a config string or a layer-name match). */
const makeLayerForGeometry = (kind: "line" | "polygon" | "point", count = 5): any => {
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

describe("border options per geometry", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = new Set();
    seedIntentMap(ui, "visible", {});
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  const expectGeometryType = (id: string, kind: "line" | "polygon" | "point"): void => {
    const info = ui.c.layerRegistry.get(id);
    expect(info).toBeTruthy();
    const kindOf = ui.c.surfaceFor(info!).geometryType();
    expect(kindOf).toBe(
      kind === "line"
        ? GEOM_TYPE.LINE
        : kind === "polygon"
          ? GEOM_TYPE.POLYGON
          : GEOM_TYPE.POINT,
    );
  };

  const openBorderRow = (id: string): HTMLElement => {
    const block = buildBorderRow(ui, id) as HTMLElement;
    document.body.appendChild(block);
    bindBorderRow(ui, id, block);
    return block;
  };

  const modeSelectOf = (block: HTMLElement): HTMLSelectElement | null =>
    block.querySelector(
      ".foliplus-style-border-mode-select",
    ) as HTMLSelectElement | null;

  const modeValues = (block: HTMLElement): string[] => {
    const select = modeSelectOf(block);
    return select ? Array.from(select.options).map(option => option.value) : [];
  };

  const registerGeometryLayer = (
    id: string,
    kind: "line" | "polygon" | "point",
  ): void => {
    registerFeatureLayer(manager, ui, id, [makeLayerForGeometry(kind)]);
  };

  const valueRamp = (): ValueConfig => countRamp();

  it("line: { original, single, value }", () => {
    registerGeometryLayer("g_line", "line");
    expectGeometryType("g_line", "line");
    expect(modeValues(openBorderRow("g_line"))).toEqual([
      FILL_MODE.ORIGINAL,
      FILL_MODE.SOLID,
      FILL_MODE.VALUE,
    ]);
  });

  // Polygon and point share one rule: a border that outlines a filled face
  // offers follow-fill, and never by-value. One table drives both so a change
  // to the outline contract cannot be applied to one geometry and forgotten on
  // the other (the drift that made this matrix red after follow-fill landed).
  it.each(["polygon", "point"] as const)(
    "%s: { original, single, follow-fill } — never by-value",
    kind => {
      const id = `g_${kind}`;
      registerGeometryLayer(id, kind);
      expectGeometryType(id, kind);
      expect(modeValues(openBorderRow(id))).toEqual([
        FILL_MODE.ORIGINAL,
        FILL_MODE.SOLID,
        FILL_MODE.FOLLOW_FILL,
      ]);
    },
  );

  it("the column is the DIM single source (border)", () => {
    expect(DIM.BORDER).toBe("border");
    registerGeometryLayer("g_dim", "line");
    const block = openBorderRow("g_dim");
    expect(block.getAttribute("data-style-dim")).toBe(DIM.BORDER);
  });

  it("stored by-value on a non-line reads back as original (display fallback)", () => {
    registerGeometryLayer("g_poly_fb", "polygon");
    setIntent(ui, "g_poly_fb", "borderStyleMode", FILL_MODE.VALUE);
    setIntent(ui, "g_poly_fb", "borderValue", valueRamp());
    const select = modeSelectOf(openBorderRow("g_poly_fb"));
    expect(select).not.toBeNull();
    // The illegal stored value must never surface as a selected "value".
    expect(select!.value).toBe(FILL_MODE.ORIGINAL);
  });

  it("stored by-value on a line stays value (guard against always-original fallback)", () => {
    registerGeometryLayer("g_line_fb", "line");
    setIntent(ui, "g_line_fb", "borderStyleMode", FILL_MODE.VALUE);
    setIntent(ui, "g_line_fb", "borderValue", valueRamp());
    const select = modeSelectOf(openBorderRow("g_line_fb"));
    expect(select).not.toBeNull();
    expect(select!.value).toBe(FILL_MODE.VALUE);
  });

  it("guard 1: the option set is asserted exactly, so an extra illegal option fails", () => {
    // The product's set for a polygon is [original, solid, followFill]. A
    // hypothetical regression that adds by-value there would make modeValues
    // return [original, solid, followFill, value] — which toEqual rejects. The
    // assertion here is the same equality the matrix tests use; it documents
    // that containment would NOT catch the extra.
    registerGeometryLayer("g_guard1", "polygon");
    const actual = modeValues(openBorderRow("g_guard1"));
    const contract = [FILL_MODE.ORIGINAL, FILL_MODE.SOLID, FILL_MODE.FOLLOW_FILL];
    expect(actual).toEqual(contract);
    // The negative property: adding the illegal option to the contract must NOT
    // equal the actual set — this is what makes the matrix red on an extra.
    const illegal = [...contract, FILL_MODE.VALUE];
    expect(actual).not.toEqual(illegal);
  });

  it("guard 2: the line by-value read-back pins the fallback to geometry, not original", () => {
    // If displayBorderMode were changed to always return original, the
    // line-with-stored-value test above would fail. This test restates that
    // dependency as a direct invariant so the guard has its own name.
    registerGeometryLayer("g_guard2", "line");
    setIntent(ui, "g_guard2", "borderStyleMode", FILL_MODE.VALUE);
    setIntent(ui, "g_guard2", "borderValue", valueRamp());
    const select = modeSelectOf(openBorderRow("g_guard2"));
    expect(select).not.toBeNull();
    expect(select!.value).not.toBe(FILL_MODE.ORIGINAL);
  });
});
