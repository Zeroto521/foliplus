// test/js/control/LayerControl/ui/style/border — capability gate, commit pipeline, reset and highlight restore.
import { initFixture } from "../fixture.js";
import {
  commitBorderNow,
  makeGeoJsonGroup,
  makeGroup,
  makeHighlightLeaf,
  makeLeaf,
  makeReceiverLeaf,
} from "./border.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import {
  getIntent,
  seedIntentMap,
  setIntent,
} from "#control/LayerControl/ui/intent.js";
import {
  authoredBorder,
  bindBorderRow,
  buildBorderRow,
  commitBorderColor,
  layerCanBorder,
  resetLayerBorder,
} from "#control/LayerControl/ui/style/border.js";
import { commitFillColor } from "#control/LayerControl/ui/style/fill.js";
import { pinnedGetterCount } from "#control/LayerControl/ui/style/pin.js";
import { FACE, flushStyleDimApply } from "#control/LayerControl/ui/style/styleBag.js";

describe("layerCanBorder", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = {};
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
    ui.listPanel.foldedRoles = {};
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
    ui.listPanel.foldedRoles = {};
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
    ui.listPanel.foldedRoles = {};
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

  it("resolves a 3-digit author stroke to the swatch's 6-digit form", () => {
    // displayColor's short-hex path: the author's #f00 must reach the color
    // input as #ff0000 — the input's value is defined as #rrggbb only.
    const leaf = makeLeaf("#f00", 2);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    const row = buildBorderRow(ui, "vec1");
    const swatch = row.querySelector(
      ".foliplus-style-border-color-input",
    ) as HTMLInputElement;
    expect(swatch.value).toBe("#ff0000");
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
    ui.listPanel.foldedRoles = {};
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
    ui.listPanel.foldedRoles = {};
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
