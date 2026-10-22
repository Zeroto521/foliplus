import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { LayerController } from "#foliplus/LayerControl/controller.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { getIntent } from "#foliplus/LayerControl/ui/intent.js";
import { closeStylePanel } from "#foliplus/LayerControl/ui/style/index.js";
import {
  applySizeToLayer,
  bindSizeRow,
  buildSizeRow,
  commitSize,
  layerCanSize,
  resetLayerSize,
} from "#foliplus/LayerControl/ui/style/size.js";
import { findItem, initFixture } from "../fixture.js";

// A pixel-radius leaf: Leaflet's CircleMarker, which keeps its radius in
// `options.radius` and `_radius` and writes both through `setRadius`.
const makeRadiusLeaf = (radius = 10): any => {
  const leaf: any = {
    options: { radius, color: "#000000", weight: 2 },
    _radius: radius,
    setStyle: vi.fn(),
  };
  leaf.getRadius = () => leaf._radius;
  leaf.setRadius = vi.fn((px: number) => {
    leaf._radius = px;
    leaf.options.radius = px;
    return leaf;
  });
  return leaf;
};

// A metre-radius leaf: Leaflet's Circle. It inherits getRadius from
// CircleMarker and only gets a numeric `_radius` from `_project` once it is
// on the map — so the probe must look at `_mRadius`, not at the pixel field.
const makeMetreLeaf = (mRadius = 1000): any => {
  const leaf: any = {
    options: { radius: mRadius, color: "#000000", weight: 2 },
    _mRadius: mRadius,
    _radius: Math.round(mRadius / 25),
    setStyle: vi.fn(),
  };
  leaf.getRadius = () => leaf._mRadius;
  leaf.setRadius = vi.fn((m: number) => {
    leaf._mRadius = m;
    return leaf;
  });
  return leaf;
};

const makeGroup = (...children: any[]): any => ({
  options: {},
  eachLayer: vi.fn((fn: (child: unknown) => void) => {
    for (const child of children) fn(child);
  }),
});

const makePoly = (rings: boolean): any => ({
  options: {},
  setStyle: vi.fn(),
  getLatLngs: () =>
    rings
      ? [
          [
            { lat: 0, lng: 0 },
            { lat: 1, lng: 0 },
            { lat: 0, lng: 1 },
          ],
        ]
      : [
          { lat: 0, lng: 0 },
          { lat: 1, lng: 1 },
        ],
});

const makeGrid = (): any => ({ options: {} });

const BASE_LAYER = {
  id: "base1",
  name: "OSM",
  group: "base",
  layer: { options: {}, setZIndex: vi.fn() } as never,
  paneName: "tilePane",
};

const fixtureWithRadiusLayer = (radius = 10) => {
  const layer = makeRadiusLeaf(radius);
  const fixture = initFixture({
    data: [{ id: "overlay1", name: "CM", group: "overlay", layer }, BASE_LAYER],
  });
  return { ...fixture, layer };
};

const sizeInput = (row: HTMLElement): HTMLInputElement =>
  row.querySelector(`input.${CONST.CLASSES.STYLE_SIZE_INPUT}`) as HTMLInputElement;

describe("layerCanSize", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = fixtureWithRadiusLayer());
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("accepts a CircleMarker leaf", () => {
    expect(layerCanSize(ui, "overlay1")).toBe(true);
  });

  it("declines a layer outside the registry", () => {
    expect(layerCanSize(ui, "nope")).toBe(false);
  });

  it("declines a metre-radius circle, which shares getRadius", () => {
    manager.registerLayer({
      id: "c1",
      name: "C",
      group: "overlay",
      layer: makeMetreLeaf(2000),
    });
    expect(layerCanSize(ui, "c1")).toBe(false);
  });

  it("declines a polygon, a polyline and a tile layer", () => {
    manager.registerLayer({
      id: "p1",
      name: "P",
      group: "overlay",
      layer: makePoly(true),
    });
    manager.registerLayer({
      id: "pl1",
      name: "PL",
      group: "overlay",
      layer: makePoly(false),
    });
    manager.registerLayer({ id: "g1", name: "G", group: "overlay", layer: makeGrid() });
    expect(layerCanSize(ui, "p1")).toBe(false);
    expect(layerCanSize(ui, "pl1")).toBe(false);
    expect(layerCanSize(ui, "g1")).toBe(false);
  });

  it("accepts a group holding a CircleMarker", () => {
    manager.registerLayer({
      id: "grp1",
      name: "G",
      group: "overlay",
      layer: makeGroup(makeRadiusLeaf(12)),
    });
    expect(layerCanSize(ui, "grp1")).toBe(true);
  });

  it("declines a group that holds only metre-radius circles", () => {
    manager.registerLayer({
      id: "grp2",
      name: "G",
      group: "overlay",
      layer: makeGroup(makeMetreLeaf(500)),
    });
    expect(layerCanSize(ui, "grp2")).toBe(false);
  });
});
describe("buildSizeRow", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let layer: any;

  beforeEach(() => {
    ({ manager, ui } = fixtureWithRadiusLayer());
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("returns null for a layer with no pixel-radius leaf", () => {
    manager.registerLayer({
      id: "p1",
      name: "P",
      group: "overlay",
      layer: makePoly(true),
    });
    expect(buildSizeRow(ui, "p1")).toBeNull();
  });

  it("returns null for a layer outside the registry", () => {
    expect(buildSizeRow(ui, "nope")).toBeNull();
  });

  it("returns null for a metre-radius circle", () => {
    manager.registerLayer({
      id: "c1",
      name: "C",
      group: "overlay",
      layer: makeMetreLeaf(2000),
    });
    expect(buildSizeRow(ui, "c1")).toBeNull();
  });

  it("builds the row with bounds, step, unit and its own row class", () => {
    const row = buildSizeRow(ui, "overlay1")!;
    expect(row.classList.contains(CONST.CLASSES.STYLE_SIZE_ROW)).toBe(true);
    const input = sizeInput(row);
    expect(input.min).toBe(String(CONST.SIZE.MIN));
    expect(input.max).toBe(String(CONST.SIZE.MAX));
    expect(input.step).toBe(String(CONST.SIZE.STEP));
    const unit = row.querySelector(".foliplus-form-unit");
    expect(unit?.textContent).toBe("px");
  });

  it("labels the row through the scoped translator", () => {
    const row = buildSizeRow(ui, "overlay1")!;
    const labelText = row.querySelector(`.${CONST.CLASSES.FORM_LABEL}`)?.textContent;
    expect(labelText).toBe("LayerControl.style_size");
    expect(sizeInput(row).getAttribute("aria-label")).toBe("LayerControl.style_size");
  });

  it("seeds the field from the authored radius, not a constant", () => {
    expect(sizeInput(buildSizeRow(ui, "overlay1")!).value).toBe("10");
  });

  it("shows an author-declared radius outside the bounds as declared", () => {
    // Clamping here would make the field lie about the map.
    const f = fixtureWithRadiusLayer(200);
    expect(sizeInput(buildSizeRow(f.ui, "overlay1")!).value).toBe("200");
  });

  it("prefers the stored choice over the authored radius", () => {
    commitSize(ui, "overlay1", 30);
    expect(sizeInput(buildSizeRow(ui, "overlay1")!).value).toBe("30");
  });

  it("reopens on the authored radius, not the last user value", () => {
    // commitSize then clear the intent without restoring: the row must still
    // show the frozen authored value even though the leaf now holds 30.
    ({ manager, ui, layer } = fixtureWithRadiusLayer(10));
    commitSize(ui, "overlay1", 30);
    ui.intentStore.clear("overlay1", "size");
    expect(layer.getRadius()).toBe(30);
    expect(sizeInput(buildSizeRow(ui, "overlay1")!).value).toBe("10");
  });
});
describe("commitSize", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let layer: any;

  beforeEach(() => {
    ({ manager, ui } = fixtureWithRadiusLayer());
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("records intent and provenance, then writes the leaf", () => {
    ({ manager, ui, layer } = fixtureWithRadiusLayer());
    commitSize(ui, "overlay1", 30);
    expect(getIntent(ui, "overlay1", "size")).toBe(30);
    expect(ui.intentStore.isUserSet("overlay1", "size")).toBe(true);
    expect(layer.setRadius).toHaveBeenCalledWith(30);
  });

  it("is a no-op when the value has not moved", () => {
    ({ manager, ui, layer } = fixtureWithRadiusLayer());
    commitSize(ui, "overlay1", 30);
    vi.clearAllMocks();
    commitSize(ui, "overlay1", 30);
    expect(layer.setRadius).not.toHaveBeenCalled();
  });

  it("writes every pixel-radius leaf in the tree", () => {
    const a = makeRadiusLeaf(8);
    const b = makeRadiusLeaf(20);
    manager.registerLayer({
      id: "grp1",
      name: "G",
      group: "overlay",
      layer: makeGroup(a, b),
    });
    commitSize(ui, "grp1", 25);
    expect(a.setRadius).toHaveBeenCalledWith(25);
    expect(b.setRadius).toHaveBeenCalledWith(25);
  });

  it("skips leaves that do not carry a pixel radius", () => {
    const cm = makeRadiusLeaf(8);
    const metre = makeMetreLeaf(1500);
    manager.registerLayer({
      id: "mix1",
      name: "M",
      group: "overlay",
      layer: makeGroup(cm, metre),
    });
    commitSize(ui, "mix1", 30);
    expect(cm.setRadius).toHaveBeenCalledWith(30);
    expect(metre.setRadius).not.toHaveBeenCalled();
  });

  it("persists under layers[id].size with its provenance marker", () => {
    commitSize(ui, "overlay1", 30);
    ui.c.persistence.flushAll();
    const rec = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY)!);
    expect(rec.layers.overlay1.size).toBe(30);
    expect(rec.layers.overlay1.overrides).toContain("size");
  });

  it("only writes the radius key", () => {
    commitSize(ui, "overlay1", 30);
    ui.c.persistence.flushAll();
    const entry = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY)!).layers
      .overlay1;
    expect(entry).toEqual({ size: 30, overrides: ["size"] });
  });
});
describe("applySizeToLayer", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let layer: any;

  beforeEach(() => {
    ({ manager, ui } = fixtureWithRadiusLayer());
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("is a no-op when no size was ever committed", () => {
    ({ manager, ui, layer } = fixtureWithRadiusLayer());
    expect(() => applySizeToLayer(ui, "overlay1")).not.toThrow();
    expect(layer.setRadius).not.toHaveBeenCalled();
  });

  it("freezes the authored radius on the first write, never on a later one", () => {
    ({ manager, ui, layer } = fixtureWithRadiusLayer(10));
    commitSize(ui, "overlay1", 30);
    commitSize(ui, "overlay1", 45);
    resetLayerSize(ui, "overlay1");
    expect(layer.getRadius()).toBe(10);
  });

  it("restores the author's value, not the user's last choice", () => {
    ({ manager, ui, layer } = fixtureWithRadiusLayer(10));
    commitSize(ui, "overlay1", 30);
    commitSize(ui, "overlay1", 45);
    resetLayerSize(ui, "overlay1");
    resetLayerSize(ui, "overlay1");
    expect(layer.getRadius()).toBe(10);
    expect(getIntent(ui, "overlay1", "size")).toBeUndefined();
  });
});
describe("resetLayerSize", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let layer: any;

  beforeEach(() => {
    ({ manager, ui } = fixtureWithRadiusLayer());
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("is a no-op for a layer outside the registry", () => {
    expect(() => resetLayerSize(ui, "ghost")).not.toThrow();
  });

  it("restores the authored radius and drops value, provenance and disk entry", () => {
    ({ manager, ui, layer } = fixtureWithRadiusLayer(12));
    commitSize(ui, "overlay1", 40);
    resetLayerSize(ui, "overlay1");
    ui.c.persistence.flushAll();
    expect(layer.getRadius()).toBe(12);
    expect(getIntent(ui, "overlay1", "size")).toBeUndefined();
    expect(ui.intentStore.isUserSet("overlay1", "size")).toBe(false);
    const entry = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY)!).layers
      ?.overlay1;
    expect(entry?.size).toBeUndefined();
    expect(entry?.overrides ?? []).not.toContain("size");
  });

  it("has nothing to restore when the user never wrote", () => {
    ({ manager, ui, layer } = fixtureWithRadiusLayer(10));
    resetLayerSize(ui, "overlay1");
    expect(layer.setRadius).not.toHaveBeenCalled();
    expect(layer.getRadius()).toBe(10);
  });

  it("restores each leaf to its own authored radius", () => {
    const a = makeRadiusLeaf(8);
    const b = makeRadiusLeaf(20);
    manager.registerLayer({
      id: "grp1",
      name: "G",
      group: "overlay",
      layer: makeGroup(a, b),
    });
    commitSize(ui, "grp1", 30);
    resetLayerSize(ui, "grp1");
    expect(a.getRadius()).toBe(8);
    expect(b.getRadius()).toBe(20);
  });

  it("is safe to call twice", () => {
    ({ manager, ui, layer } = fixtureWithRadiusLayer(10));
    commitSize(ui, "overlay1", 30);
    resetLayerSize(ui, "overlay1");
    expect(() => resetLayerSize(ui, "overlay1")).not.toThrow();
    expect(layer.getRadius()).toBe(10);
  });
});
describe("bindSizeRow", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let layer: any;

  beforeEach(() => {
    ({ manager, ui } = fixtureWithRadiusLayer());
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const bind = () => {
    ({ manager, ui, layer } = fixtureWithRadiusLayer());
    const row = buildSizeRow(ui, "overlay1")!;
    bindSizeRow(ui, "overlay1", row);
    return { layer, input: sizeInput(row) };
  };

  it("commits an in-range value on every keystroke", () => {
    const { layer, input } = bind();
    input.value = "30";
    input.dispatchEvent(new Event("input"));
    expect(layer.setRadius).toHaveBeenCalledWith(30);
    expect(getIntent(ui, "overlay1", "size")).toBe(30);
  });

  it("ignores an out-of-range keystroke rather than committing it", () => {
    const { layer, input } = bind();
    input.value = "999";
    input.dispatchEvent(new Event("input"));
    expect(layer.setRadius).not.toHaveBeenCalled();
  });

  it("clamps and rewrites the field on change", () => {
    const { layer, input } = bind();
    input.value = "0";
    input.dispatchEvent(new Event("change"));
    expect(input.value).toBe(String(CONST.SIZE.MIN));
    expect(layer.setRadius).toHaveBeenCalledWith(CONST.SIZE.MIN);

    input.value = "999";
    input.dispatchEvent(new Event("change"));
    expect(input.value).toBe(String(CONST.SIZE.MAX));
    expect(layer.setRadius).toHaveBeenCalledWith(CONST.SIZE.MAX);
  });

  it("rounds a fraction on the way in, so the map never sees a decimal", () => {
    const { layer, input } = bind();
    input.value = "30.5";
    input.dispatchEvent(new Event("input"));
    expect(layer.setRadius).toHaveBeenCalledWith(31);
    expect(getIntent(ui, "overlay1", "size")).toBe(31);
  });

  it("rewrites the field to the rounded value on change", () => {
    // Without this, a fraction committed mid-typing is stored as-is and only
    // rounds on the next read — the map changes size while the saved value does
    // not. The whole-value rule has to hold on the write side as well.
    const { layer, input } = bind();
    input.value = "30.5";
    input.dispatchEvent(new Event("change"));
    expect(input.value).toBe("31");
    expect(layer.setRadius).toHaveBeenCalledWith(31);
    expect(getIntent(ui, "overlay1", "size")).toBe(31);
  });

  it("falls back for an empty field", () => {
    const { layer, input } = bind();
    input.value = "";
    input.dispatchEvent(new Event("change"));
    expect(input.value).toBe(String(CONST.SIZE.DEFAULT));
    expect(layer.setRadius).toHaveBeenCalledWith(CONST.SIZE.DEFAULT);
  });

  it("ignores a row with no input", () => {
    expect(() =>
      bindSizeRow(ui, "overlay1", document.createElement("div")),
    ).not.toThrow();
  });
});
describe("panel integration", () => {
  let manager: LayerController;
  let ui: LayerUI;

  const rows = (row: HTMLElement) =>
    Array.from(
      row.querySelectorAll<HTMLElement>(`div.${CONST.CLASSES.FORM_ROW}`),
    ).filter(el => el.querySelector("input") !== null);

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("renders the size row for a CircleMarker, right after the fill row", () => {
    ({ manager, ui } = fixtureWithRadiusLayer());
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const styleRows = rows(item);
    const sizeIdx = styleRows.findIndex(r =>
      r.classList.contains(CONST.CLASSES.STYLE_SIZE_ROW),
    );
    expect(sizeIdx).toBeGreaterThan(-1);
    expect(
      styleRows[sizeIdx - 1].classList.contains(CONST.CLASSES.STYLE_FILL_ROW),
    ).toBe(true);
    closeStylePanel(ui, false);
  });

  it("renders no size row for a metre-radius circle", () => {
    const layer = makeMetreLeaf(2000);
    ({ manager, ui } = initFixture({
      data: [{ id: "overlay1", name: "C", group: "overlay", layer }, BASE_LAYER],
    }));
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const styleRows = rows(item);
    expect(styleRows.length).toBeGreaterThan(0);
    expect(
      styleRows.every(r => !r.classList.contains(CONST.CLASSES.STYLE_SIZE_ROW)),
    ).toBe(true);
    closeStylePanel(ui, false);
  });

  it("renders no size row for a polygon", () => {
    ({ manager, ui } = initFixture({
      data: [
        { id: "overlay1", name: "P", group: "overlay", layer: makePoly(true) },
        BASE_LAYER,
      ],
    }));
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    expect(item.querySelector(`.${CONST.CLASSES.STYLE_SIZE_ROW}`)).toBeNull();
    closeStylePanel(ui, false);
  });

  it("replays a persisted size onto the layer at attach time", () => {
    // Regression: the style rows are self-managed dimensions, so without a
    // replay hook a reload would restore the drawer field while the map kept
    // the author's radius.
    const layer = makeRadiusLeaf(10);
    window.localStorage.setItem(
      CONST.STORAGE.KEY,
      JSON.stringify({ layers: { overlay1: { size: 30, overrides: ["size"] } } }),
    );
    ({ manager, ui } = initFixture({
      data: [{ id: "overlay1", name: "CM", group: "overlay", layer }, BASE_LAYER],
    }));
    expect(getIntent(ui, "overlay1", "size")).toBe(30);
    expect(layer.getRadius()).toBe(30);
  });
});
