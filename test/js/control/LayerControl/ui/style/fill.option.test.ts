// test/js/control/LayerControl/ui/style/fill.option — the original-colors option, readout geometry and availability.
import { initFixture, installLeafletGlobals } from "../fixture.js";
import {
  type LeafOpts,
  blockOf,
  commitNow,
  css,
  initWithPerFeatureLayer,
  origOpacity,
} from "./fill.fixture.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#control/LayerControl/const.js";
import { getIntent, setIntent } from "#control/LayerControl/ui/intent.js";
import {
  bindFillRow,
  buildFillRow,
  resetLayerFill,
} from "#control/LayerControl/ui/style/fill.js";
import { FACE, flushStyleDimApply } from "#control/LayerControl/ui/style/styleBag.js";

describe("fill row — original colors option", () => {
  afterEach(() => {
    document.body.innerHTML = "";

    vi.clearAllMocks();
  });

  const modeSelect = (row: HTMLElement): HTMLSelectElement =>
    row.querySelector(`.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`) as HTMLSelectElement;

  it("offers the original colors beside the other modes", () => {
    const { ui } = initWithPerFeatureLayer();

    const row = buildFillRow(ui, "feature1");

    const select = modeSelect(row);

    const option = select.querySelector(
      'option[value="original"]',
    ) as HTMLOptionElement;

    // The state the layer opens in, now offered as a real option: the author's

    // colors can be left and come back to.

    expect(select.value).toBe("original");

    expect(option.disabled).toBe(false);

    expect(option.textContent).toBe("LayerControl.style_mode_original");

    expect(select.querySelector('option[value="solid"]')).not.toBeNull();

    expect(select.querySelector('option[value="value"]')).not.toBeNull();

    // The explanation is a tooltip on the control, not a paragraph in the

    // drawer: the panel keeps one row and the reason is still reachable.

    expect(row.querySelector(".foliplus-style-fill-note")).toBeNull();

    expect(select.title).toBe("LayerControl.style_fill_per_feature_note");

    expect(select.getAttribute("aria-description")).toBe(
      "LayerControl.style_fill_per_feature_note",
    );

    expect(option.title).toBe("LayerControl.style_fill_per_feature_note");

    expect(row.querySelector(`.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`)).toBeNull();
  });

  it("reads the original mode when the leaves share one color", () => {
    const { ui } = initWithPerFeatureLayer({
      colors: ["#aabbcc", "#aabbcc"],

      perFeature: false,
    });

    const select = modeSelect(buildFillRow(ui, "feature1"));

    // Single-colour author, no intent: the honest baseline is ORIGINAL

    // and the option is now always offered.

    expect(select.value).toBe("original");

    expect(select.querySelector('option[value="original"]')).not.toBeNull();
  });

  it("reads the original mode for a layer without the explore color property", () => {
    const { ui } = initWithPerFeatureLayer({
      perFeature: false,

      fillAuthor: null,

      withProperties: false,
    });

    const select = modeSelect(buildFillRow(ui, "feature1"));

    // No author record and no intent: the baseline is still ORIGINAL

    // (the map paints the layer's own defaults), option always offered.

    expect(select.value).toBe("original");

    expect(select.querySelector('option[value="original"]')).not.toBeNull();
  });

  it("keeps the original colors offered after the user chose solid", () => {
    const { ui } = initWithPerFeatureLayer();

    setIntent(ui, "feature1", "fillStyleMode", "solid");

    const select = modeSelect(buildFillRow(ui, "feature1"));

    expect(select.value).toBe("solid");

    // The way back: the mode is still on the layer, so the option stays.

    expect(select.querySelector('option[value="original"]')).not.toBeNull();
  });

  it("reads the original mode for an empty layer", () => {
    const { ui } = initWithPerFeatureLayer({ colors: [], perFeature: false });

    const select = modeSelect(buildFillRow(ui, "feature1"));

    // An empty layer has no leaf to read, but it is still fill-capable and

    // the baseline readout is ORIGINAL (empty-layer fallback).

    expect(select.value).toBe("original");

    expect(select.querySelector('option[value="original"]')).not.toBeNull();
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

    expect(getIntent(ui, "feature1", "fillStyleMode")).toBe("solid");

    expect(select.querySelector('option[value="original"]')).not.toBeNull();

    expect(
      row.querySelector(`.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`),
    ).not.toBeNull();

    // The choice must also reach the map: the paint is derived from the

    // swatch base at apply time (no colour intent is written), so the row and

    // the paint agree instead of claiming one color for many.

    expect(getIntent(ui, "feature1", "fillColor")).toBeUndefined();

    expect(layer.leaves[0].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#0d0887",

      fill: true,
    });

    expect(layer.leaves[1].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#0d0887",

      fill: true,
    });
  });

  it("choosing the original colors back stores the choice and repaints", () => {
    const { ui, layer } = initWithPerFeatureLayer();

    const row = buildFillRow(ui, "feature1");

    document.body.append(row);

    bindFillRow(ui, "feature1", row);

    const select = modeSelect(row);

    select.value = "solid";

    select.dispatchEvent(new Event("change", { bubbles: true }));

    flushStyleDimApply(FACE.FILL, "feature1");

    for (const leaf of layer.leaves as Array<{ setStyle: { mockClear: () => void } }>) {
      leaf.setStyle.mockClear();
    }

    select.value = "original";

    select.dispatchEvent(new Event("change", { bubbles: true }));

    flushStyleDimApply(FACE.FILL, "feature1");

    // The mode is stored, so it survives a reload and a mode switch in either

    // direction; the map goes back to each leaf's own author color.

    expect(getIntent(ui, "feature1", "fillStyleMode")).toBe("original");

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

    // The read-only detail is back and holds nothing to operate.

    const detail = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_DETAIL}`,
    ) as HTMLElement;

    expect(detail.querySelector("select")).toBeNull();
  });

  it("opens on by-value when only a ramp config is stored", () => {
    const { ui } = initWithPerFeatureLayer();

    // The pre-fillMode record shape: a stored config and no mode means the

    // user already classified, so the row reads by-value rather than original.

    setIntent(ui, "feature1", "fillValue", {
      field: "count",

      method: "jenks",

      classes: 3,

      scheme: "Blues",
    });

    expect(modeSelect(buildFillRow(ui, "feature1")).value).toBe("value");
  });

  it("choosing the mode it is already in writes nothing", () => {
    const { ui } = initWithPerFeatureLayer();

    const row = buildFillRow(ui, "feature1");

    document.body.append(row);

    bindFillRow(ui, "feature1", row);

    modeSelect(row).dispatchEvent(new Event("change", { bubbles: true }));

    // The row opens on the author's colors without an intent; re-selecting the

    // mode it is already in must not turn that into a stored one.

    expect(getIntent(ui, "feature1", "fillStyleMode")).toBeUndefined();
  });

  it("does not replay a stale override on mouseout once back in the original mode", () => {
    const { ui, layer } = initWithPerFeatureLayer();

    let handler: (() => void) | null = null;

    for (const leaf of layer.leaves as Array<{ on: unknown }>) {
      leaf.on = vi.fn((_type: string, fn: () => void) => {
        handler = fn;
      });
    }

    const row = buildFillRow(ui, "feature1");

    document.body.append(row);

    bindFillRow(ui, "feature1", row);

    const select = modeSelect(row);

    // A solid write installs the highlight pin; going back to the author's

    // colors must leave folium's own mouseout restore in force, or the user's

    // old solid color would repaint over the author's colors on every hover.

    select.value = "solid";

    select.dispatchEvent(new Event("change", { bubbles: true }));

    flushStyleDimApply(FACE.FILL, "feature1");

    select.value = "original";

    select.dispatchEvent(new Event("change", { bubbles: true }));

    flushStyleDimApply(FACE.FILL, "feature1");

    for (const leaf of layer.leaves as Array<{ setStyle: { mockClear: () => void } }>) {
      leaf.setStyle.mockClear();
    }

    handler!();

    for (const leaf of layer.leaves as Array<{ setStyle: unknown }>) {
      expect(leaf.setStyle).not.toHaveBeenCalled();
    }
  });

  it("reset restores every leaf's own author color and the original mode", () => {
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

    expect(modeSelect(buildFillRow(ui, "feature1")).value).toBe("original");
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

describe("original-colors readout geometry (stylesheet contract)", () => {
  const layer = css("foliplus/css/control/LayerControl/style.css");

  it("gives the count readout the compact width and the right edge", () => {
    // The count is the number-field role: same secondary width token as the

    // by-value class-count select, pinned to the column's right edge.

    const count = blockOf(layer, ".foliplus-style-fill-original-count {");

    expect(count).toContain("var(--foliplus-form-secondary-width)");

    expect(count).toContain("flex-shrink: 0");

    // The value inside the box is horizontally centered, matching the count

    // select's own value.

    // The value span must fill the box (flex:1, min-width:0) for the

    // text-align to actually center the text: a flex child only as wide as its

    // content would ignore text-align.

    const value = blockOf(
      layer,

      ".foliplus-style-fill-original-count .foliplus-style-fill-original-value {",
    );

    expect(value).toContain("flex: 1");

    expect(value).toContain("min-width: 0");

    expect(value).toContain("text-align: center");
  });

  it("fills the control column for the method readout", () => {
    // The method is not a number field: no compact width, no shrink and no

    // right-hug of its own. It shares the row with the count, so it flexes to

    // absorb the control column the way the by-value method select does.

    const method = blockOf(layer, ".foliplus-style-fill-original-method {");

    expect(method).toContain("flex: 1");

    expect(method).toContain("min-width: 0");

    expect(method).not.toContain("var(--foliplus-form-secondary-width)");

    expect(method).not.toContain("flex-shrink");

    expect(method).not.toContain("margin-left");

    // No comma-joined selector merges the two — that would hide a shared

    // compact width behind the method's name.

    expect(layer.indexOf(".foliplus-style-fill-original-count,")).toBe(-1);

    // The method value is centered like the count value (a readout states a

    // value, not a spanning label).

    // Same centering contract as the count value: the span fills the box so

    // text-align:center is real, not a no-op on a content-width flex child.

    const value = blockOf(
      layer,

      ".foliplus-style-fill-original-method .foliplus-style-fill-original-value {",
    );

    expect(value).toContain("flex: 1");

    expect(value).toContain("min-width: 0");

    expect(value).toContain("text-align: center");
  });
});

describe("fill original availability (P1)", () => {
  const origMakeLayer = (leafOpts: LeafOpts[], fillAuthor?: unknown) => {
    installLeafletGlobals();

    const leaves = leafOpts.map(opts => {
      const leaf = new L.Polygon() as L.Polygon & {
        options: LeafOpts;

        setStyle: ReturnType<typeof vi.fn>;
      };

      leaf.options = { ...opts };

      leaf.setStyle = vi.fn();

      return leaf;
    });

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

    const entry: Record<string, unknown> = {
      id: "overlay1",

      name: "Polygons",

      role: "overlay",

      layer: parent as never,
    };

    if (fillAuthor !== undefined) entry.fillAuthor = fillAuthor;

    const { ui } = initFixture({
      data: [
        entry as never,

        {
          id: "base1",

          name: "OSM",

          role: "base",

          layer: { options: {}, setZIndex: vi.fn() } as never,

          paneName: "tilePane",
        },
      ],
    });

    return { ui, layer: parent as never };
  };

  const origSelect = (block: HTMLElement): HTMLSelectElement =>
    block.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`,
    ) as HTMLSelectElement;

  const origDetail = (block: HTMLElement): HTMLElement =>
    block.querySelector(`.${CONST.CLASSES.STYLE_FILL_DETAIL}`) as HTMLElement;

  const origToRgb = (hex: string): string => {
    const h = hex.replace("#", "");
    if (h.length !== 6) return hex;

    const r = parseInt(h.slice(0, 2), 16);

    const g = parseInt(h.slice(2, 4), 16);

    const b = parseInt(h.slice(4, 6), 16);

    return `rgb(${r}, ${g}, ${b})`;
  };

  /** True when the subtree shows `needle` as text OR as an inline colour. The


   *  monochrome swatch may be a text hex or a background-painted div; either is


   *  a faithful readout. jsdom normalizes a `background:#hex` cssText to


   *  `rgb(...)`, so the needle's rgb form is compared too. */

  const origDetailShows = (root: HTMLElement, needle: string): boolean => {
    const values: string[] = [root.textContent ?? ""];

    root.querySelectorAll("*").forEach(el => {
      const s = (el as HTMLElement).style;

      if (s.background) values.push(s.background);

      if (s.backgroundColor) values.push(s.backgroundColor);

      if (s.backgroundImage) values.push(s.backgroundImage);

      if (s.color) values.push(s.color);
    });

    const needles = [needle.toLowerCase(), origToRgb(needle).toLowerCase()];

    return values.some(v => {
      const low = v.toLowerCase();

      return needles.some(n => low.includes(n));
    });
  };

  const origOption = (select: HTMLSelectElement): Element | null =>
    select.querySelector('option[value="original"]');

  afterEach(() => {
    document.body.innerHTML = "";

    vi.clearAllMocks();

    vi.unstubAllGlobals();
  });

  it("offers original by default for a fill-capable layer with no author record", () => {
    // A polygon with no author record and no value field still paints a fill;

    // the honest baseline readout is the original colors state.

    const { ui } = origMakeLayer([{ fill: true }]);

    const block = buildFillRow(ui, "overlay1");

    const select = origSelect(block);

    expect(select).not.toBeNull();

    expect(origOption(select)).not.toBeNull();

    // No intent -> the baseline readout is selected and writes no mode.

    expect(select.value).toBe("original");

    // The baseline readout writes no mode: ORIGINAL is a read state, not a user choice.

    expect(getIntent(ui, "overlay1", "fillStyleMode")).toBeUndefined();

    // The detail reads the layer's own paint; no leaf value -> the constants.

    const d = origDetail(block);

    expect(origDetailShows(d, CONST.COLOR.DEFAULT)).toBe(true);

    expect(origOpacity(d)).toBe("20");
  });

  it("shows the author's own color and opacity for a monochrome author (revert guard)", () => {
    // Revert guard: paintsPerFeatureFill is false (a single-color author), yet

    // ORIGINAL is still offered because the author painted a fillColor. If

    // hasOriginal regresses to paintsPerFeatureFill, this test goes red.

    const { ui } = origMakeLayer(
      [{ fillColor: "#aabbcc", fillOpacity: 0.45, fill: true }],

      { perFeature: false, distinct: 1, stops: ["#aabbcc"] },
    );

    const block = buildFillRow(ui, "overlay1");

    const select = origSelect(block);

    expect(select).not.toBeNull();

    expect(origOption(select)).not.toBeNull();

    const d = origDetail(block);

    expect(origDetailShows(d, "#aabbcc")).toBe(true);

    expect(origOpacity(d)).toBe("45");
  });

  it("shows 0% opacity (not a dash) when the author painted transparent", () => {
    const { ui } = origMakeLayer(
      [{ fillColor: "#aabbcc", fillOpacity: 0, fill: true }],

      { perFeature: false, distinct: 1, stops: ["#aabbcc"] },
    );

    const block = buildFillRow(ui, "overlay1");

    const select = origSelect(block);

    expect(select).not.toBeNull();

    expect(origOption(select)).not.toBeNull();

    const d = origDetail(block);

    // 0% is a real value, not a missing one — the dash rule must not eat it.

    expect(origOpacity(d)).toBe("0");
  });

  it("stays original when only the opacity was overridden (no color/mode intent)", () => {
    // #953 invariant: an opacity-only override still paints the

    // author's colors — the mode readout must say ORIGINAL, not SOLID. A user

    // who only tuned transparency never asked for a single color.

    const { ui } = origMakeLayer(
      [{ fillColor: "#aabbcc", fillOpacity: 0.45, fill: true }],

      { perFeature: false, distinct: 1, stops: ["#aabbcc"] },
    );

    setIntent(ui, "overlay1", "fillOpacity", 0.4);

    const block = buildFillRow(ui, "overlay1");

    const select = origSelect(block);

    expect(select).not.toBeNull();

    expect(select.value).toBe("original");

    expect(origOption(select)).not.toBeNull();
  });
});
