// T58 — the fill mode row and its by-value detail (fill.ts + row.ts).
//
// Covers what the data-layer tests cannot: the mode select switching arms in
// place, the ramp detail writing field/method/classes/scheme through the fill
// intent, the no-numeric-field degradation, the shared scheme picker (portal,
// selection, disposal on panel close), persistence replay and reset.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { LayerController } from "#foliplus/LayerControl/controller.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { clearIntent, getIntent, setIntent } from "#foliplus/LayerControl/ui/intent.js";
import {
  FILL_DIMENSION,
  bindFillRow,
  buildFillRow,
  replayFillState,
  resetLayerFill,
} from "#foliplus/LayerControl/ui/style/fill.js";
import { closeStylePanel } from "#foliplus/LayerControl/ui/style/index.js";
import { FACE, flushStyleDimApply } from "#foliplus/LayerControl/ui/style/styleBag.js";
import { findItem, initFixture, installLeafletGlobals } from "../fixture.js";

type StyleWrite = {
  fillColor?: string;
  fillOpacity?: number;
  fill?: boolean;
};

const makeLeaf = (value: number) => {
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

const makeLayer = (values: number[]) => {
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

const initWithValues = (values: number[] = [1, 5, 9]) => {
  installLeafletGlobals();
  const layer = makeLayer(values);
  const { manager, ui } = initFixture({
    data: [
      { id: "overlay1", name: "Polygons", group: "overlay", layer },
      {
        id: "base1",
        name: "OSM",
        group: "base",
        layer: { options: {}, setZIndex: vi.fn() } as never,
        paneName: "tilePane",
      },
    ],
  });
  ui.runtimeStore.setFields("overlay1", [{ name: "count", numeric: true }]);
  return { manager, ui, layer };
};

const installChroma = (colors: string[]): void => {
  globalThis.chroma = {
    scale: () => ({ mode: () => ({ colors: () => colors }) }),
  } as never;
};

const openPanel = (ui: LayerUI): HTMLElement => {
  const item = findItem(ui, "overlay1");
  ui.openStylePanel("overlay1");
  const block = item.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_BLOCK}`,
  ) as HTMLElement | null;
  expect(block).not.toBeNull();
  return block!;
};

const modeSelect = (block: HTMLElement): HTMLSelectElement =>
  block.querySelector(`.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`) as HTMLSelectElement;

const details = (block: HTMLElement): HTMLElement =>
  block.querySelector(`.${CONST.CLASSES.STYLE_FILL_DETAIL}`) as HTMLElement;

const switchMode = (block: HTMLElement, mode: "solid" | "ramp"): void => {
  const select = modeSelect(block);
  select.value = mode;
  select.dispatchEvent(new Event("change", { bubbles: true }));
};

const flushFill = (): void => flushStyleDimApply(FACE.FILL, "overlay1");

describe("fill mode row — solid ↔ color by value", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let layer: ReturnType<typeof makeLayer>;

  beforeEach(() => {
    ({ manager, ui, layer } = initWithValues());
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("switching to by-value seeds the default ramp and repaints per leaf", () => {
    installChroma(["#111111", "#222222", "#333333", "#444444", "#555555", "#666666"]);
    const block = openPanel(ui);

    switchMode(block, "ramp");

    expect(getIntent(ui, "overlay1", "fillMode")).toBe("ramp");
    expect(getIntent(ui, "overlay1", "fillRamp")).toEqual({
      kind: "numeric",
      field: "count",
      method: CONST.RAMP.METHOD_DEFAULT,
      classes: CONST.RAMP.CLASSES_DEFAULT,
      scheme: CONST.RAMP.SCHEME_DEFAULT,
    });
    // jenks/quantile read the simple-statistics CDN global, which jsdom does
    // not load; equal interval classifies on its own, so the paint assertion
    // below exercises the real ramp colours.
    const method = details(block).querySelector(
      `.${CONST.CLASSES.STYLE_FILL_METHOD_SELECT}`,
    ) as HTMLSelectElement;
    method.value = "equal";
    method.dispatchEvent(new Event("change", { bubbles: true }));
    flushFill();
    const rampColors = [
      "#111111",
      "#222222",
      "#333333",
      "#444444",
      "#555555",
      "#666666",
    ];
    for (const leaf of layer.leaves) {
      const call = leaf.setStyle.mock.calls.at(-1)?.[0];
      expect(rampColors).toContain(call?.fillColor);
    }
    // The detail slot now shows the ramp arm's three rows.
    expect(
      details(block).querySelector(`.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`),
    ).not.toBeNull();
  });

  it("switching back to solid keeps the ramp config for the next switch", () => {
    installChroma(["#111111", "#222222"]);
    const block = openPanel(ui);
    switchMode(block, "ramp");
    switchMode(block, "solid");

    expect(getIntent(ui, "overlay1", "fillMode")).toBe("solid");
    expect(getIntent(ui, "overlay1", "fillRamp")).toMatchObject({ field: "count" });
    // The solid arm is back: swatch + opacity, no ramp controls.
    expect(
      details(block).querySelector(`.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`),
    ).not.toBeNull();
    expect(
      details(block).querySelector(`.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`),
    ).toBeNull();
  });

  it("mode switching is a no-op write when no numeric field exists", () => {
    // A text-only layer: the field cache has no numeric entry and the tree
    // walk fallback finds no finite number either.
    ui.runtimeStore.setFields("overlay1", [{ name: "name", numeric: false }]);
    for (const leaf of layer.leaves) {
      leaf.feature.properties = { name: "a" };
    }
    const block = buildFillRow(ui, "overlay1");
    bindFillRow(ui, "overlay1", block);

    switchMode(block, "ramp");

    expect(getIntent(ui, "overlay1", "fillMode")).toBeUndefined();
    expect(getIntent(ui, "overlay1", "fillRamp")).toBeUndefined();
    expect(modeSelect(block).value).toBe("solid");
  });

  it("a color basemap keeps the single-swatch row (solid only)", () => {
    manager.registerLayer({
      id: "colormap",
      name: "Color",
      group: "base",
      color: "#3366cc",
      canvas: document.createElement("canvas"),
    });
    const row = buildFillRow(ui, "colormap");
    bindFillRow(ui, "colormap", row);

    expect(row.querySelector(`.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`)).toBeNull();
    const color = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`,
    ) as HTMLInputElement;
    expect(color).not.toBeNull();
    // The single row binds the same live swatch the solid arm uses.
    color.value = "#123456";
    color.dispatchEvent(new Event("input", { bubbles: true }));
    flushFill();
    expect(getIntent(ui, "colormap", "fillColor")).toBe("#123456");
  });

  it("falls back to the tree walk when the field cache is empty", () => {
    // The cache can be cold (or hold only labelable text fields) while the
    // features still carry numbers; the ramp field list must not go empty.
    ui.runtimeStore.setFields("overlay1", []);
    const block = buildFillRow(ui, "overlay1");
    bindFillRow(ui, "overlay1", block);
    const select = modeSelect(block);

    expect(
      (select.querySelector('option[value="ramp"]') as HTMLOptionElement).disabled,
    ).toBe(false);
    switchMode(block, "ramp");
    expect(getIntent(ui, "overlay1", "fillRamp")).toMatchObject({ field: "count" });
  });

  it("shows the stored ramp as solid when the layer has no numeric field", () => {
    // A record can outlive the data it was built for (field removed). The
    // panel must fall back to the solid arm instead of showing a ramp select
    // whose detail cannot classify anything.
    ui.runtimeStore.setFields("overlay1", [{ name: "name", numeric: false }]);
    for (const leaf of layer.leaves) {
      leaf.feature.properties = { name: "a" };
    }
    setIntent(ui, "overlay1", "fillMode", "ramp");
    setIntent(ui, "overlay1", "fillRamp", {
      field: "count",
      method: "jenks",
      classes: 3,
      scheme: "Blues",
    } as never);

    const block = buildFillRow(ui, "overlay1");

    expect(modeSelect(block).value).toBe("solid");
    expect(
      details(block).querySelector(`.${CONST.CLASSES.STYLE_FILL_NO_FIELD}`),
    ).not.toBeNull();
  });
});

describe("fill ramp detail — field / method / classes / scheme", () => {
  let ui: LayerUI;

  beforeEach(() => {
    installChroma(["#111111", "#222222", "#333333"]);
    ({ ui } = initWithValues());
    setIntent(ui, "overlay1", "fillMode", "ramp");
    setIntent(ui, "overlay1", "fillRamp", {
      field: "count",
      method: "jenks",
      classes: 3,
      scheme: "Blues",
    } as never);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("field selection writes the ramp field", () => {
    const block = openPanel(ui);
    const select = details(block).querySelector(
      `.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`,
    ) as HTMLSelectElement;
    ui.runtimeStore.setFields("overlay1", [
      { name: "count", numeric: true },
      { name: "score", numeric: true },
    ]);
    // Rebuild the row so the new field option is offered.
    document.body.innerHTML = "";
    const refreshed = openPanel(ui);
    const refreshedSelect = details(refreshed).querySelector(
      `.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`,
    ) as HTMLSelectElement;
    refreshedSelect.value = "score";
    refreshedSelect.dispatchEvent(new Event("change", { bubbles: true }));

    expect(select.value).toBe("count");
    expect(getIntent(ui, "overlay1", "fillRamp")).toMatchObject({ field: "score" });
  });

  it("shows the first field when the stored field is no longer offered", () => {
    // Options come from the current data; a stored field that disappeared
    // cannot stay selected, or the select would render blank.
    ui.runtimeStore.setFields("overlay1", [{ name: "score", numeric: true }]);
    setIntent(ui, "overlay1", "fillRamp", {
      field: "count",
      method: "jenks",
      classes: 3,
      scheme: "Blues",
    } as never);

    const block = buildFillRow(ui, "overlay1");
    const field = details(block).querySelector(
      `.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`,
    ) as HTMLSelectElement;

    expect(Array.from(field.options).map(o => o.value)).toEqual(["score"]);
    expect(field.value).toBe("score");
  });

  it("method selection writes the ramp method", () => {
    const block = openPanel(ui);
    const method = details(block).querySelector(
      `.${CONST.CLASSES.STYLE_FILL_METHOD_SELECT}`,
    ) as HTMLSelectElement;
    method.value = "equal";
    method.dispatchEvent(new Event("change", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "fillRamp")).toMatchObject({ method: "equal" });
  });

  it("class count typing writes clamped integer classes", () => {
    const block = openPanel(ui);
    const classes = details(block).querySelector(
      `.${CONST.CLASSES.STYLE_FILL_CLASSES_NUMBER}`,
    ) as HTMLInputElement;
    classes.value = "5";
    classes.dispatchEvent(new Event("input", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "fillRamp")).toMatchObject({ classes: 5 });

    // Out-of-range input is clamped on commit (bindLiveNumber's change leg).
    classes.value = "42";
    classes.dispatchEvent(new Event("change", { bubbles: true }));
    expect(classes.value).toBe(String(CONST.RAMP.CLASSES_MAX));
    expect(getIntent(ui, "overlay1", "fillRamp")).toMatchObject({
      classes: CONST.RAMP.CLASSES_MAX,
    });
  });

  it("shared scheme picker selection writes the scheme and updates the label", () => {
    const block = openPanel(ui);
    const trigger = details(block).querySelector(
      `.${CONST.CLASSES.STYLE_FILL_SCHEME_TRIGGER}`,
    ) as HTMLElement;
    const name = trigger.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_SCHEME_NAME}`,
    ) as HTMLElement;
    expect(name.textContent).toBe("Blues");

    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const item = document.querySelector(
      '.foliplus-scheme-picker-item[data-scheme-name="Reds"]',
    ) as HTMLElement;
    expect(item).not.toBeNull();
    item.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "fillRamp")).toMatchObject({ scheme: "Reds" });
    expect(name.textContent).toBe("Reds");
  });

  it("closing the panel destroys the open picker's dropdown", () => {
    const block = openPanel(ui);
    const trigger = details(block).querySelector(
      `.${CONST.CLASSES.STYLE_FILL_SCHEME_TRIGGER}`,
    ) as HTMLElement;
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".foliplus-scheme-picker-dropdown")).not.toBeNull();

    closeStylePanel(ui, false);

    expect(document.querySelector(".foliplus-scheme-picker-dropdown")).toBeNull();
  });
});

describe("fill ramp persistence and reset", () => {
  let ui: LayerUI;
  let layer: ReturnType<typeof makeLayer>;

  beforeEach(() => {
    installChroma(["#111111", "#222222", "#333333"]);
    ({ ui, layer } = initWithValues());
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("reopening the panel shows the stored arm and replays the ramp", () => {
    setIntent(ui, "overlay1", "fillMode", "ramp");
    setIntent(ui, "overlay1", "fillRamp", {
      field: "count",
      // Equal interval: no simple-statistics dependency in jsdom.
      method: "equal",
      classes: 3,
      scheme: "Reds",
    } as never);

    replayFillState(ui, "overlay1");
    flushFill();
    expect(layer.leaves[0].setStyle).toHaveBeenCalledWith(
      expect.objectContaining({ fillColor: "#111111" }),
    );

    const block = openPanel(ui);
    expect(modeSelect(block).value).toBe("ramp");
    expect(
      (
        details(block).querySelector(
          `.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`,
        ) as HTMLSelectElement
      ).value,
    ).toBe("count");
  });

  it("reset clears both arms' intents and the panel opens solid", () => {
    setIntent(ui, "overlay1", "fillMode", "ramp");
    setIntent(ui, "overlay1", "fillRamp", {
      field: "count",
      method: "jenks",
      classes: 3,
      scheme: "Blues",
    } as never);
    setIntent(ui, "overlay1", "fillColor", "#ff0000");
    setIntent(ui, "overlay1", "fillOpacity", 0.4);

    resetLayerFill(ui, "overlay1");

    expect(getIntent(ui, "overlay1", "fillMode")).toBeUndefined();
    expect(getIntent(ui, "overlay1", "fillRamp")).toBeUndefined();
    expect(getIntent(ui, "overlay1", "fillColor")).toBeUndefined();
    expect(getIntent(ui, "overlay1", "fillOpacity")).toBeUndefined();

    const block = openPanel(ui);
    expect(modeSelect(block).value).toBe("solid");
    expect(FILL_DIMENSION.value!(ui, "overlay1")?.mode).toBe("solid");
  });

  it("clearIntent on the ramp keeps the solid arm untouched", () => {
    setIntent(ui, "overlay1", "fillMode", "solid");
    setIntent(ui, "overlay1", "fillColor", "#123456");
    setIntent(ui, "overlay1", "fillRamp", {
      field: "count",
      method: "jenks",
      classes: 3,
      scheme: "Blues",
    } as never);

    clearIntent(ui, "overlay1", "fillRamp");

    expect(getIntent(ui, "overlay1", "fillRamp")).toBeUndefined();
    expect(getIntent(ui, "overlay1", "fillColor")).toBe("#123456");
    const block = openPanel(ui);
    expect(modeSelect(block).value).toBe("solid");
  });
});
