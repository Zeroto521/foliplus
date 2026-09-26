import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayerManager } from "#foliplus/LayerControl/manager.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import {
  applyBorderToLayer,
  authoredBorder,
  bindBorderRow,
  buildBorderRow,
  commitBorderColor,
  commitBorderWeight,
  layerCanBorder,
  replayBorderState,
  resetLayerBorder,
} from "#foliplus/LayerControl/ui/style/border.js";
import { initFixture } from "../fixture.js";

/** A Leaflet vector leaf: an `options` bag plus the `setStyle` writer the
 *  border walk looks for. `on` is part of the leaf surface too — the
 *  highlight replay binds through it. */
const makeLeaf = (color = "#ff0000", weight = 2): any => ({
  options: { color, weight },
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
    setStyle,
    authored,
    on,
    mouseoutCount: () => mouseout.length,
    fireMouseout: () => {
      for (const fn of mouseout) fn();
    },
  };
};

describe("layerCanBorder", () => {
  let manager: LayerManager;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.foldedGroups = new Set();
    ui.hiddenIds = new Set();
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
    manager.surfaceFor(li).capabilities.opacity = "native";
    expect(layerCanBorder(ui, "nat1")).toBe(false);
  });

  it("declines a none-opacity surface — no honest write target", () => {
    manager.registerLayer({
      id: "non1",
      name: "X",
      layer: makeLeaf(),
    });
    const li = manager.layerRegistry.get("non1")!;
    manager.surfaceFor(li).capabilities.opacity = "none";
    expect(layerCanBorder(ui, "non1")).toBe(false);
  });

  it("declines a basemap-like surface — pane opacity but no zoom range", () => {
    // The double check: a surface with pane opacity and no zoom range is a
    // solid-color basemap, which owns a background pane, not vector shapes.
    manager.registerLayer({
      id: "bas1",
      name: "B",
      layer: makeLeaf(),
    });
    const li = manager.layerRegistry.get("bas1")!;
    manager.surfaceFor(li).capabilities.zoomRange = "none";
    expect(layerCanBorder(ui, "bas1")).toBe(false);
  });
});

describe("authoredBorder", () => {
  let manager: LayerManager;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.foldedGroups = new Set();
    ui.hiddenIds = new Set();
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("reads the first carrier's options — a stored value never feeds the author", () => {
    const leaf = makeLeaf("#00ff00", 4);
    ui.borderColorMap.vec1 = "#ff0000";
    ui.borderWeightMap.vec1 = 7;
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    expect(authoredBorder(ui, "vec1")).toEqual({ color: "#00ff00", weight: 4 });
  });

  it("descends through a group to find the first carrier", () => {
    const leaf = makeLeaf("#0000ff", 1.5);
    manager.registerLayer({
      id: "grp1",
      name: "G",
      layer: makeGroup(leaf, makeLeaf("#ff0000", 9)),
    });

    expect(authoredBorder(ui, "grp1")).toEqual({ color: "#0000ff", weight: 1.5 });
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

    expect(authoredBorder(ui, "geo1")).toEqual({ color: "gray", weight: 1.5 });
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
  let manager: LayerManager;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.foldedGroups = new Set();
    ui.hiddenIds = new Set();
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("normalises the swatch to 6-digit hex, marks the override, and writes once", () => {
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    commitBorderColor(ui, "vec1", "#f00");

    expect(ui.borderColorMap.vec1).toBe("#ff0000");
    expect(ui.userOverrides.vec1).toContain("borderColor");
    expect(leaf.setStyle).toHaveBeenCalledTimes(1);
    expect(leaf.setStyle).toHaveBeenCalledWith({ color: "#ff0000" });
  });

  it("keeps the receiver when it calls setStyle, as Leaflet needs it", () => {
    // Leaflet's Path.setStyle runs setOptions(this, style) and throws when the
    // method is invoked detached from its own object, so capturing it in a
    // local first would hand the user's color to nobody at all.
    const leaf = makeReceiverLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    expect(() => commitBorderColor(ui, "vec1", "#abcdef")).not.toThrow();
    expect(leaf.options.color).toBe("#abcdef");
  });

  it("keeps the receiver on the highlight replay too", () => {
    const leaf = makeReceiverLeaf("#00ff00", 3);
    leaf.on = vi.fn((type: string, fn: () => void) => {
      if (type === "mouseout") leaf.fireMouseout = fn;
    });
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    expect(() => commitBorderColor(ui, "vec1", "#abcdef")).not.toThrow();
    expect(() => leaf.fireMouseout()).not.toThrow();
    expect(leaf.options.color).toBe("#abcdef");
  });

  it("skips a write that revisits the same value", () => {
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    commitBorderColor(ui, "vec1", "#f00");
    leaf.setStyle.mockClear();

    commitBorderColor(ui, "vec1", "#ff0000");

    expect(leaf.setStyle).not.toHaveBeenCalled();
  });

  it("commits the width with the shared bounds in force", () => {
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    commitBorderWeight(ui, "vec1", 3.5);

    expect(ui.borderWeightMap.vec1).toBe(3.5);
    expect(ui.userOverrides.vec1).toContain("borderWeight");
    expect(leaf.setStyle).toHaveBeenCalledWith({ weight: 3.5 });
  });

  it("rides one setStyle call per leaf when both sub-dimensions are set", () => {
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    commitBorderColor(ui, "vec1", "#00ff00");
    leaf.setStyle.mockClear();
    commitBorderWeight(ui, "vec1", 5);

    // The width commit re-sends the color already stored: the leaf sees one
    // call carrying both, so color and width can never disagree on the stroke.
    expect(leaf.setStyle).toHaveBeenCalledTimes(1);
    expect(leaf.setStyle).toHaveBeenCalledWith({ color: "#00ff00", weight: 5 });
  });

  it("omits an unset sub-dimension so the author's default stays in force", () => {
    const leaf = makeLeaf("#00ff00", 4);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    commitBorderWeight(ui, "vec1", 6);

    expect(leaf.setStyle).toHaveBeenCalledWith({ weight: 6 });
  });

  it("walks every leaf of a group and captures each one's authored style", () => {
    const first = makeLeaf("#ff0000", 2);
    const second = makeLeaf("#00ff00", 4);
    const group = makeGroup(first, second);
    manager.registerLayer({ id: "grp1", name: "G", layer: group });

    commitBorderColor(ui, "grp1", "#0000ff");

    expect(first.setStyle).toHaveBeenCalledWith({ color: "#0000ff" });
    expect(second.setStyle).toHaveBeenCalledWith({ color: "#0000ff" });
    expect(group.setStyle).toBeUndefined();
  });

  it("captures the author's style before the first write mutates options", () => {
    const leaf = makeLeaf("#ff0000", 2);
    leaf.setStyle.mockImplementation((style: Record<string, unknown>) => {
      Object.assign(leaf.options, style);
    });
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    commitBorderColor(ui, "vec1", "#00ff00");
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
    expect(ui.borderColorMap.can1).toBe("#ff0000");
  });

  it("skips a width write that revisits the same value", () => {
    // The number field fires a commit on blur even when the text never moved,
    // so an equal value must be a no-op: without it, clicking away would re-run
    // the sweep over every feature of the layer for no visual change.
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    commitBorderWeight(ui, "vec1", 4);
    leaf.setStyle.mockClear();

    commitBorderWeight(ui, "vec1", 4);

    expect(leaf.setStyle).not.toHaveBeenCalled();
  });
});

describe("bindBorderRow", () => {
  let manager: LayerManager;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.foldedGroups = new Set();
    ui.hiddenIds = new Set();
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

    expect(ui.borderWeightMap.vec1).toBe(5);
    expect(ui.userOverrides.vec1).toContain("borderWeight");
    expect(leaf.setStyle).toHaveBeenCalledWith({ weight: 5 });
  });

  it("commits the color on every swatch movement", () => {
    const leaf = makeLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    const row = buildBorderRow(ui, "vec1");
    bindBorderRow(ui, "vec1", row);

    const swatch = row.querySelector(
      ".foliplus-style-border-color-input",
    ) as HTMLInputElement;
    swatch.value = "#abcdef";
    swatch.dispatchEvent(new Event("input", { bubbles: true }));

    expect(ui.borderColorMap.vec1).toBe("#abcdef");
    expect(ui.userOverrides.vec1).toContain("borderColor");
    expect(leaf.setStyle).toHaveBeenCalledWith({ color: "#abcdef" });
  });

  it("leaves a row alone that has neither control to bind", () => {
    const row = document.createElement("div");

    expect(() => bindBorderRow(ui, "vec1", row)).not.toThrow();
  });
});

describe("resetLayerBorder", () => {
  let manager: LayerManager;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.foldedGroups = new Set();
    ui.hiddenIds = new Set();
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
    commitBorderColor(ui, "grp1", "#0000ff");
    commitBorderWeight(ui, "grp1", 9);
    first.setStyle.mockClear();
    second.setStyle.mockClear();

    resetLayerBorder(ui, "grp1");

    expect(ui.borderColorMap.grp1).toBeUndefined();
    expect(ui.borderWeightMap.grp1).toBeUndefined();
    // unmarkOverride drops the entry once both dimensions are cleared.
    const overrides = ui.userOverrides.grp1 ?? [];
    expect(overrides).not.toContain("borderColor");
    expect(overrides).not.toContain("borderWeight");
    expect(first.setStyle).toHaveBeenCalledWith({ color: "#ff0000", weight: 2 });
    expect(second.setStyle).toHaveBeenCalledWith({ color: "#00ff00", weight: 4 });
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

    commitBorderColor(ui, "geo1", "#0000ff");
    commitBorderWeight(ui, "geo1", 9);
    face.setStyle.mockClear();
    line.setStyle.mockClear();

    resetLayerBorder(ui, "geo1");

    expect(face.setStyle).toHaveBeenCalledWith({ color: "gray", weight: 1.5 });
    expect(line.setStyle).toHaveBeenCalledWith({ color: "#e74c3c", weight: 6 });
  });

  it("does not touch a layer the registry no longer knows", () => {
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    commitBorderColor(ui, "vec1", "#00ff00");
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
    ui.borderColorMap.ghost = "#ff0000";
    ui.borderWeightMap.ghost = 4;
    ui.userOverrides.ghost = ["borderColor", "borderWeight"];

    expect(() => resetLayerBorder(ui, "ghost")).not.toThrow();
    expect(ui.borderColorMap.ghost).toBeUndefined();
    expect(ui.borderWeightMap.ghost).toBeUndefined();
    const overrides = ui.userOverrides.ghost ?? [];
    expect(overrides).not.toContain("borderColor");
    expect(overrides).not.toContain("borderWeight");
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

    commitBorderColor(ui, "grp1", "#0000ff");
    commitBorderWeight(ui, "grp1", 5);

    expect(inert.setStyle).toBeUndefined();
    expect(live.setStyle).toHaveBeenCalledWith({ color: "#0000ff", weight: 5 });

    live.setStyle.mockClear();
    resetLayerBorder(ui, "grp1");

    expect(inert.setStyle).toBeUndefined();
    expect(live.setStyle).toHaveBeenCalledWith({ color: "#ff0000", weight: 2 });
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

    commitBorderColor(ui, "vec1", "#0000ff");
    commitBorderWeight(ui, "vec1", 4);
    bare.setStyle.mockClear();

    resetLayerBorder(ui, "vec1");

    expect(bare.setStyle).toHaveBeenCalledWith({ color: "#3388ff", weight: 1 });
  });
});

describe("highlight restore", () => {
  let manager: LayerManager;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.foldedGroups = new Set();
    ui.hiddenIds = new Set();
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

    commitBorderColor(ui, "vec1", "#abcdef");
    leaf.setStyle.mockClear();

    leaf.fireMouseout();

    expect(leaf.setStyle).toHaveBeenLastCalledWith({ color: "#abcdef" });
    expect(leaf.options.color).toBe("#abcdef");
  });

  it("pins the user's width through the same restore", () => {
    const leaf = makeHighlightLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    commitBorderWeight(ui, "vec1", 9);
    leaf.setStyle.mockClear();

    leaf.fireMouseout();

    expect(leaf.setStyle).toHaveBeenLastCalledWith({ weight: 9 });
    expect(leaf.options.weight).toBe(9);
  });

  it("pins the replay once per leaf, no matter how often the user commits", () => {
    // A color-picker drag commits many times, and every pass walks every
    // feature of the layer: binding the replay once per commit would stack
    // handlers that all write the same stroke.
    const leaf = makeHighlightLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    commitBorderColor(ui, "vec1", "#abcdef");
    commitBorderWeight(ui, "vec1", 9);

    // 2 = folium's own handler plus our replay, not one per commit.
    expect(leaf.mouseoutCount()).toBe(2);
  });

  it("leaves the author's stroke alone once the user has reset", () => {
    // A reset clears the stored intent, so the replay has nothing to write:
    // folium's restore stands and the layer keeps the author's stroke.
    const leaf = makeHighlightLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    commitBorderColor(ui, "vec1", "#abcdef");
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

describe("replayBorderState", () => {
  let manager: LayerManager;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.foldedGroups = new Set();
    ui.hiddenIds = new Set();
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("replays a stored stroke onto the layer, so a reload keeps it", () => {
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    ui.borderColorMap.vec1 = "#0000ff";
    ui.borderWeightMap.vec1 = 6;

    replayBorderState(ui);

    expect(leaf.setStyle).toHaveBeenCalledWith({ color: "#0000ff", weight: 6 });
  });

  it("scopes a single id when one is given", () => {
    const a = makeLeaf();
    const b = makeLeaf();
    manager.registerLayer({ id: "vecA", name: "A", layer: a });
    manager.registerLayer({ id: "vecB", name: "B", layer: b });
    ui.borderColorMap.vecA = "#0000ff";
    ui.borderColorMap.vecB = "#00ff00";

    replayBorderState(ui, "vecA");

    expect(a.setStyle).toHaveBeenCalledTimes(1);
    expect(b.setStyle).not.toHaveBeenCalled();
  });

  it("leaves a layer alone when the user never set a border", () => {
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    replayBorderState(ui);

    expect(leaf.setStyle).not.toHaveBeenCalled();
  });
});

describe("applyBorderToLayer", () => {
  let manager: LayerManager;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.foldedGroups = new Set();
    ui.hiddenIds = new Set();
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("is a no-op with no stored value", () => {
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    applyBorderToLayer(ui, "vec1");

    expect(leaf.setStyle).not.toHaveBeenCalled();
  });

  it("is a no-op for an id with no registry entry", () => {
    ui.borderColorMap.ghost = "#0000ff";

    expect(() => applyBorderToLayer(ui, "ghost")).not.toThrow();
  });
});

describe("buildBorderRow", () => {
  let manager: LayerManager;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.foldedGroups = new Set();
    ui.hiddenIds = new Set();
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders one row with a swatch and a bounded width field", () => {
    const leaf = makeLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    const row = buildBorderRow(ui, "vec1");

    expect(row.classList.contains("foliplus-form-row")).toBe(true);
    expect(row.classList.contains("foliplus-style-border-row")).toBe(true);
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
    ui.borderColorMap.vec1 = "#ff0000";
    ui.borderWeightMap.vec1 = 5.5;

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
});
