// fillOpacityModes.test.ts
// P3+P4 contract tests for task-102 (lead m14436).
//
// These assert the FUTURE behavior — RED before P3+P4 land, GREEN after
// (落地即绿). They never touch product code.
//
// P4 (VALUE mode opacity): the by-value detail offers an EDITABLE opacity
//     number row (label style_fill_opacity). Committing 40 -> FILL_OPACITY
//     intent 0.4 without rewriting the VALUE config; the same override shows
//     in the SOLID mode (cross-mode shared override).
// P3 (ORIGINAL cmap opacity): a per-feature author's ORIGINAL detail keeps the
//     existing column/method/count/scheme rows PLUS a SEPARATE readonly
//     opacity row. Uniform author opacity -> concrete percent; per-leaf
//     inconsistent -> the em-dash.
// R3: ORIGINAL has no editable input[type=number]/[type=color] anywhere.
//
// Revert guards (fail modes, documented inline):
//   - if the VALUE opacity row is removed / its read is dropped, the P4 tests
//     go red (no number input in the value detail);
//   - if the cmap opacity is folded into the colors strip row (not its own
//     row), the P3 "separate row" assertion goes red.
import { initFixture, installLeafletGlobals } from "../fixture.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PANEL_CLASS } from "#ui/panelClassName.js";
import * as CONST from "#control/LayerControl/const.js";
import { getIntent } from "#control/LayerControl/ui/intent.js";
import { bindFillRow, buildFillRow } from "#control/LayerControl/ui/style/fill.js";

type LeafOpts = { fillColor?: string; fillOpacity?: number; fill?: boolean };

/** A fillable polygon layer with optional per-feature properties and an
 *  optional author record. Leaves carry distinct colors/opacities when given. */
const makeFillLayer = (
  leafOpts: LeafOpts[],
  fillAuthor?: unknown,
  props?: Array<{ count: number; __folium_color?: string }>,
) => {
  installLeafletGlobals();
  const leaves = leafOpts.map((opts, i) => {
    const leaf = new L.Polygon() as L.Polygon & {
      options: LeafOpts;
      feature: { properties: Record<string, unknown> };
      setStyle: ReturnType<typeof vi.fn>;
    };
    leaf.options = { ...opts };
    leaf.feature = { properties: props?.[i] ?? {} };
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

const switchMode = (block: HTMLElement, mode: string): void => {
  const select = modeSelect(block);
  select.value = mode;
  select.dispatchEvent(new Event("change", { bubbles: true }));
};

const formRows = (d: HTMLElement): HTMLElement[] =>
  Array.from(d.querySelectorAll(`.${PANEL_CLASS.FORM_ROW}`));

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("value-mode opacity row (P4)", () => {
  it.todo("offers an editable opacity number in the value detail", () => {
    const { ui } = makeFillLayer(
      [{ fillColor: "#aabbcc", fillOpacity: 0.5, fill: true }],
      { perFeature: false, distinct: 1, stops: ["#aabbcc"] },
      [{ count: 1 }],
    );
    ui.runtimeStore.setFields("overlay1", [{ name: "count", numeric: true }]);
    const block = buildFillRow(ui, "overlay1");
    bindFillRow(ui, "overlay1", block);
    switchMode(block, "value");

    const d = detail(block);
    const num = d.querySelector('input[type="number"]');
    expect(num).not.toBeNull();
    // The row is labelled with the shared opacity label.
    const row = (num as HTMLInputElement).closest(`.${PANEL_CLASS.FORM_ROW}`);
    expect(row).not.toBeNull();
    expect(text(row as HTMLElement)).toContain("style_fill_opacity");
  });

  it.todo("commits 40 as 0.4 without rewriting the value config", () => {
    const { ui } = makeFillLayer(
      [{ fillColor: "#aabbcc", fillOpacity: 0.5, fill: true }],
      { perFeature: false, distinct: 1, stops: ["#aabbcc"] },
      [{ count: 1 }],
    );
    ui.runtimeStore.setFields("overlay1", [{ name: "count", numeric: true }]);
    const block = buildFillRow(ui, "overlay1");
    switchMode(block, "value");
    const before = getIntent(ui, "overlay1", "fillValue");

    const num = detail(block).querySelector('input[type="number"]') as HTMLInputElement;
    num.value = "40";
    num.dispatchEvent(new Event("input", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "fillOpacity")).toBe(0.4);
    // The VALUE classification config is untouched by an opacity commit.
    expect(getIntent(ui, "overlay1", "fillValue")).toBe(before);
  });

  it.todo("shows the same override when switching back to solid", () => {
    const { ui } = makeFillLayer(
      [{ fillColor: "#aabbcc", fillOpacity: 0.5, fill: true }],
      { perFeature: false, distinct: 1, stops: ["#aabbcc"] },
      [{ count: 1 }],
    );
    ui.runtimeStore.setFields("overlay1", [{ name: "count", numeric: true }]);
    const block = buildFillRow(ui, "overlay1");
    bindFillRow(ui, "overlay1", block);
    switchMode(block, "value");
    const num = detail(block).querySelector('input[type="number"]') as HTMLInputElement;
    num.value = "40";
    num.dispatchEvent(new Event("input", { bubbles: true }));

    switchMode(block, "solid");
    const solidNum = detail(block).querySelector(
      'input[type="number"]',
    ) as HTMLInputElement;
    expect(solidNum).not.toBeNull();
    expect(solidNum.value).toBe("40");
  });
});

describe("original cmap opacity row (P3)", () => {
  const cmapAuthor = {
    perFeature: true,
    distinct: 2,
    stops: ["#0d0887", "#f0f921"],
  };

  it.todo(
    "keeps the cmap rows and adds a separate readonly opacity row (uniform)",
    () => {
      const { ui } = makeFillLayer(
        [
          { fillColor: "#0d0887", fillOpacity: 0.5, fill: true },
          { fillColor: "#f0f921", fillOpacity: 0.5, fill: true },
        ],
        cmapAuthor,
        [
          { count: 1, __folium_color: "#0d0887" },
          { count: 2, __folium_color: "#f0f921" },
        ],
      );
      const block = buildFillRow(ui, "overlay1");
      const d = detail(block);
      expect(modeSelect(block).value).toBe("original");

      // R3: nothing editable in the ORIGINAL detail.
      expect(d.querySelector('input[type="number"]')).toBeNull();
      expect(d.querySelector('input[type="color"]')).toBeNull();

      const rows = formRows(d);
      // The colors strip row exists (existing cmap form).
      const stripRow = (
        d.querySelector(`.${CONST.CLASSES.STYLE_FILL_ORIGINAL_COLORS}`) as HTMLElement
      ).closest(`.${PANEL_CLASS.FORM_ROW}`) as HTMLElement;
      expect(stripRow).not.toBeNull();
      // The opacity readout is its OWN row, separate from the strip row.
      const opacityRow = rows.find(r => r !== stripRow && text(r).includes("50%"));
      expect(opacityRow).toBeDefined();
      // It is a readout, not an input.
      expect(opacityRow!.querySelector(`.${PANEL_CLASS.READONLY}`)).not.toBeNull();
      expect(opacityRow!.querySelector("input")).toBeNull();
    },
  );

  it.todo(
    "shows the em-dash when the author's per-leaf opacity is inconsistent",
    () => {
      const { ui } = makeFillLayer(
        [
          { fillColor: "#0d0887", fillOpacity: 0.5, fill: true },
          { fillColor: "#f0f921", fillOpacity: 0.8, fill: true },
        ],
        cmapAuthor,
        [
          { count: 1, __folium_color: "#0d0887" },
          { count: 2, __folium_color: "#f0f921" },
        ],
      );
      const block = buildFillRow(ui, "overlay1");
      const d = detail(block);
      const stripRow = (
        d.querySelector(`.${CONST.CLASSES.STYLE_FILL_ORIGINAL_COLORS}`) as HTMLElement
      ).closest(`.${PANEL_CLASS.FORM_ROW}`) as HTMLElement;
      const rows = formRows(d);
      const opacityRow = rows.find(r => r !== stripRow && text(r).includes("%"));
      expect(opacityRow).toBeDefined();
      // No single honest percentage: the dash rule must report the inconsistency.
      expect(text(opacityRow!)).toContain("—");
    },
  );
});
