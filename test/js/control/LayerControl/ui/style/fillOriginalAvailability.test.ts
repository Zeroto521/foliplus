// fillOriginalAvailability.test.ts
// P1+P2 contract tests for task-102 (lead m14178).
//
// These assert the FUTURE behavior — they are RED before P1+P2 land and GREEN
// after (落地即绿). They never touch product code.
//
// P1 (lead m14358): ORIGINAL is ALWAYS offered for a fill-capable layer AND a
//     no-fill-intent layer reads as ORIGINAL (the map paints the author's own
//     colors; SOLID would be a lie — it means "user picked a color"). Only a
//     FILL_COLOR intent (or a stored mode) reads as SOLID/VALUE.
//     hasOriginal = paintsPerFeatureFill || authorFillColorOf non-null.
//     The detail reads the layer's actual painted value via
//     leaf.options.fillColor/fillOpacity, falling back to
//     CONST.COLOR.DEFAULT (#cccccc) + VISIBLE_FILL_OPACITY (0.2 -> 20%) only
//     when a leaf carries no value (empty/offscreen layer).
// P2: monochrome ORIGINAL detail = ONE form-row [readonly color | readonly
//     opacity], both readOnlyValue boxes, no input[type=color]/[type=number].
//
// Revert guard: tests 2/5/6 use a monochrome author (paintsPerFeatureFill =
// false) and assert ORIGINAL is still offered. If an implementation regresses
// hasOriginal to paintsPerFeatureFill (the pre-P1 gate), a monochrome author
// loses ORIGINAL and those tests go red.
import { initFixture, installLeafletGlobals } from "../fixture.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PANEL_CLASS } from "#ui/panelClassName.js";
import * as CONST from "#control/LayerControl/const.js";
import { getIntent, setIntent } from "#control/LayerControl/ui/intent.js";
import { buildFillRow } from "#control/LayerControl/ui/style/fill.js";

type LeafOpts = { fillColor?: string; fillOpacity?: number; fill?: boolean };

const makeFillLayer = (leafOpts: LeafOpts[], fillAuthor?: unknown) => {
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

const modeSelect = (block: HTMLElement): HTMLSelectElement =>
  block.querySelector(`.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`) as HTMLSelectElement;

const detail = (block: HTMLElement): HTMLElement =>
  block.querySelector(`.${CONST.CLASSES.STYLE_FILL_DETAIL}`) as HTMLElement;

const text = (el: HTMLElement): string => (el.textContent ?? "").trim();

/** True when the subtree shows `needle` as text OR as an inline colour.
 *  The monochrome swatch may be a text hex or a background-painted div;
 *  either is a faithful readout, so the contract accepts both. */
/** jsdom normalizes a `background:#hex` cssText to `rgb(...)`, so a needle
 *  like "#aabbcc" never matches a style readback. Compare the needle's rgb
 *  form too; both are the same colour, just two spellings. */
const toRgb = (hex: string): string => {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
};
const detailShows = (root: HTMLElement, needle: string): boolean => {
  const values: string[] = [root.textContent ?? ""];
  root.querySelectorAll("*").forEach(el => {
    const s = (el as HTMLElement).style;
    if (s.background) values.push(s.background);
    if (s.backgroundColor) values.push(s.backgroundColor);
    if (s.backgroundImage) values.push(s.backgroundImage);
    if (s.color) values.push(s.color);
  });
  const needles = [needle.toLowerCase(), toRgb(needle).toLowerCase()];
  return values.some(v => {
    const low = v.toLowerCase();
    return needles.some(n => low.includes(n));
  });
};

const originalOption = (select: HTMLSelectElement): Element | null =>
  select.querySelector('option[value="original"]');

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("fill original availability (P1)", () => {
  it("offers original by default for a fill-capable layer with no author record", () => {
    // A polygon with no author record and no value field still paints a fill;
    // the honest baseline readout is the original colors state.
    const { ui } = makeFillLayer([{ fill: true }]);
    const block = buildFillRow(ui, "overlay1");
    const select = modeSelect(block);
    expect(select).not.toBeNull();
    expect(originalOption(select)).not.toBeNull();
    // No intent -> the baseline readout is selected and writes no mode.
    expect(select.value).toBe("original");
    // The baseline readout writes no mode: ORIGINAL is a read state, not a user choice.
    expect(getIntent(ui, "overlay1", "fillStyleMode")).toBeUndefined();
    // The detail reads the layer's own paint; no leaf value -> the constants.
    const d = detail(block);
    expect(detailShows(d, CONST.COLOR.DEFAULT)).toBe(true);
    expect(text(d)).toContain("20%");
  });

  it("shows the author's own color and opacity for a monochrome author (revert guard)", () => {
    // Revert guard: paintsPerFeatureFill is false (a single-color author), yet
    // ORIGINAL is still offered because the author painted a fillColor. If
    // hasOriginal regresses to paintsPerFeatureFill, this test goes red.
    const { ui } = makeFillLayer(
      [{ fillColor: "#aabbcc", fillOpacity: 0.45, fill: true }],
      { perFeature: false, distinct: 1, stops: ["#aabbcc"] },
    );
    const block = buildFillRow(ui, "overlay1");
    const select = modeSelect(block);
    expect(select).not.toBeNull();
    expect(originalOption(select)).not.toBeNull();
    const d = detail(block);
    expect(detailShows(d, "#aabbcc")).toBe(true);
    expect(text(d)).toContain("45%");
  });

  it("shows 0% opacity (not a dash) when the author painted transparent", () => {
    const { ui } = makeFillLayer(
      [{ fillColor: "#aabbcc", fillOpacity: 0, fill: true }],
      { perFeature: false, distinct: 1, stops: ["#aabbcc"] },
    );
    const block = buildFillRow(ui, "overlay1");
    const select = modeSelect(block);
    expect(select).not.toBeNull();
    expect(originalOption(select)).not.toBeNull();
    const d = detail(block);
    // 0% is a real value, not a missing one — the dash rule must not eat it.
    expect(text(d)).toContain("0%");
  });
});

it("stays original when only the opacity was overridden (no color/mode intent)", () => {
  // #953 invariant (lead m14358 ④): an opacity-only override still paints the
  // author's colors — the mode readout must say ORIGINAL, not SOLID. A user
  // who only tuned transparency never asked for a single color.
  const { ui } = makeFillLayer(
    [{ fillColor: "#aabbcc", fillOpacity: 0.45, fill: true }],
    { perFeature: false, distinct: 1, stops: ["#aabbcc"] },
  );
  setIntent(ui, "overlay1", "fillOpacity", 0.4);
  const block = buildFillRow(ui, "overlay1");
  const select = modeSelect(block);
  expect(select).not.toBeNull();
  expect(select.value).toBe("original");
  expect(originalOption(select)).not.toBeNull();
});

describe("monochrome original detail (P2)", () => {
  it("paints the swatch and opacity as one readonly row", () => {
    const { ui } = makeFillLayer(
      [{ fillColor: "#aabbcc", fillOpacity: 0.45, fill: true }],
      { perFeature: false, distinct: 1, stops: ["#aabbcc"] },
    );
    const block = buildFillRow(ui, "overlay1");
    const select = modeSelect(block);
    expect(select.value).toBe("original");
    const d = detail(block);
    // R3: no editable controls anywhere in the original detail.
    expect(d.querySelector('input[type="color"]')).toBeNull();
    expect(d.querySelector('input[type="number"]')).toBeNull();
    // R4: one form-row holding both readouts, both readonly.
    const rows = Array.from(d.querySelectorAll(`.${PANEL_CLASS.FORM_ROW}`));
    expect(rows).toHaveLength(1);
    const boxes = Array.from(rows[0].querySelectorAll(`.${PANEL_CLASS.READONLY}`));
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    const rowOfBoxes = boxes.map(b => b.closest(`.${PANEL_CLASS.FORM_ROW}`));
    expect(rowOfBoxes.every(r => r === rows[0])).toBe(true);
    // The two readouts carry the colour and the percentage.
    expect(detailShows(rows[0], "#aabbcc")).toBe(true);
    expect(text(rows[0])).toContain("45%");
  });

  it.todo("a per-feature author keeps the cmap multi-row original form (P3)");
  // P3 (a later slice): a per-feature author keeps buildOriginalDetail's
  // multi-row form — column row, colors strip, method/count row — plus an
  // OPACITY separate readonly row. The assertion here (once un-todoed) is:
  //   makeFillLayer perFeature=true -> the detail has >=2 form rows, no
  //   inputs, the colors strip present, and a separate opacity row whose
  //   value is the author's per-leaf fillOpacity or the em-dash when the
  //   leaves disagree.
});

describe("revert guard (hasOriginal regressed to paintsPerFeatureFill)", () => {
  it("a monochrome author still gets original when perFeature is forced false", async () => {
    const fa = await import("#control/LayerControl/ui/style/fillAuthor.js");
    const spy = vi.spyOn(fa, "paintsPerFeatureFill").mockReturnValue(false);
    try {
      const { ui } = makeFillLayer(
        [{ fillColor: "#aabbcc", fillOpacity: 0.45, fill: true }],
        { perFeature: false, distinct: 1, stops: ["#aabbcc"] },
      );
      const block = buildFillRow(ui, "overlay1");
      const select = modeSelect(block);
      expect(select).not.toBeNull();
      expect(originalOption(select)).not.toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
