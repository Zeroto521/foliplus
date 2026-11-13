// originalDetail.test.ts
// The original-colours detail's P2 contract (the monochrome original readout, lead m14178):
//
// A monochrome author's ORIGINAL mode reads as ONE form-row holding the author's
// colour swatch and fill opacity side by side, both readOnlyValue boxes — the
// shape the SOLID row uses, except nothing is editable (R3/R4). The swatch and
// the percentage are readouts of the author's own paint, never controls.
//
// Revert guard: if the monochrome form regresses to the cmap multi-row form (or
// to editable inputs), these assertions go red.
import { initFixture, installLeafletGlobals } from "../fixture.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PANEL_CLASS } from "#ui/panelClassName.js";
import * as CONST from "#control/LayerControl/const.js";
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

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.unstubAllGlobals();
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
    const rows = Array.from(
      d.querySelectorAll(`.${PANEL_CLASS.FORM_ROW}`),
    ) as HTMLElement[];
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
