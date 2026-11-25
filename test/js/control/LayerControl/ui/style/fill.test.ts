// test/js/control/LayerControl/ui/style/fill — row builder and state replay.
import { findItem, initFixture } from "../fixture.js";
import {
  RING,
  commitNow,
  initWithFillLayer,
  initWithRampedLayer,
  installChroma,
  makeFillableLayer,
  makeRampedLayer,
  origOpacity,
  triggerOf,
} from "./fill.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PANEL_CLASS } from "#ui/panelClassName.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { getIntent, setIntent } from "#control/LayerControl/ui/intent.js";
import {
  FILL_DIMENSION,
  applyFillToLayer,
  buildFillRow,
  replayFillState,
  resetLayerFill,
} from "#control/LayerControl/ui/style/fill.js";

describe("buildFillRow", () => {
  let ui: LayerUI;

  let manager: LayerController;

  beforeEach(() => {
    const fixture = initWithFillLayer();

    ui = fixture.ui;

    manager = fixture.manager;
  });

  afterEach(() => {
    document.body.innerHTML = "";

    vi.clearAllMocks();
  });

  it("emits the fill block: mode row + detail slot with the swatch input", () => {
    setIntent(ui, "overlay1", "fillStyleMode", "solid");

    const row = buildFillRow(ui, "overlay1");

    expect(row.classList.contains(CONST.CLASSES.STYLE_FILL_BLOCK)).toBe(true);

    const modeRow = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_ROW}`,
    ) as HTMLElement;

    expect(modeRow.classList.contains(PANEL_CLASS.FORM_ROW)).toBe(true);

    expect(
      row.querySelector(`.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`),
    ).not.toBeNull();

    expect(row.querySelector(`.${CONST.CLASSES.STYLE_FILL_DETAIL}`)).not.toBeNull();

    expect(
      row.querySelector(`.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`),
    ).not.toBeNull();
  });

  it("the mode row renders the locale key's translated value", () => {
    const row = buildFillRow(ui, "overlay1");

    const label = row.querySelector(`.${PANEL_CLASS.FORM_LABEL}`);

    expect(label?.textContent).toBe("LayerControl.style_fill_mode");
  });

  it("defaults to the solid mode with the by-value option available", () => {
    const row = buildFillRow(ui, "overlay1");

    const select = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`,
    ) as HTMLSelectElement;

    const rampOption = select.querySelector(
      'option[value="value"]',
    ) as HTMLOptionElement;

    expect(select.value).toBe("original");

    expect(rampOption.disabled).toBe(false);
  });

  it("offers the original and solid modes for a layer with no value field", () => {
    const fixture = initWithFillLayer();

    // Count is the only numeric property; make it a string-only layer.

    fixture.manager.registerLayer({
      id: "textonly",

      name: "Text",

      role: "overlay",

      layer: (() => {
        const leaf = new L.Polygon() as L.Polygon & {
          options: Record<string, unknown>;

          feature: { properties: Record<string, unknown> };

          setStyle: ReturnType<typeof vi.fn>;
        };

        leaf.options = { fillColor: "#aabbcc", fill: true };

        // An empty feature bag: no value mode, but the mode row still offers

        // ORIGINAL + SOLID (a fill-capable layer always has a baseline state).

        leaf.feature = { properties: {} };

        leaf.setStyle = vi.fn();

        return {
          options: {},

          eachLayer: (fn: (child: unknown) => void) => fn(leaf),

          getBounds: () => ({
            isValid: () => true,

            getSouthWest: () => ({ lat: 0, lng: 0 }),

            getNorthEast: () => ({ lat: 1, lng: 1 }),
          }),
        };
      })(),
    });

    fixture.ui.runtimeStore.setFields("textonly", []);

    const row = buildFillRow(fixture.ui, "textonly");

    // A fill-capable layer always owns a baseline state (ORIGINAL) plus SOLID,

    // so the mode row exists; VALUE is absent (no field).

    const select = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`,
    ) as HTMLSelectElement;

    expect(select).not.toBeNull();

    expect(select.querySelector('option[value="original"]')).not.toBeNull();

    expect(select.querySelector('option[value="value"]')).toBeNull();

    // The colour block reuses the SOLID chrome but as a read-only div (no
    // editable input, no number field) — the ORIGINAL baseline is a state
    // readout, not a control.
    const colorBlock = row.querySelector(`.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`);
    expect(colorBlock).not.toBeNull();
    expect(colorBlock?.classList.contains(PANEL_CLASS.READONLY)).toBe(true);
    expect(row.querySelector(`.${CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER}`)).toBeNull();
  });

  it("puts the original color and opacity in one readonly row", () => {
    const row = buildFillRow(ui, "overlay1");

    const fillRows = row.querySelectorAll(`.${CONST.CLASSES.STYLE_FILL_ROW}`);

    // The default state is ORIGINAL (no intent): the monochrome

    // readout is one row [colour | opacity], both readonly, no editable inputs.

    expect(fillRows.length).toBe(2);

    const detailRow = fillRows[1];

    // The monochrome colour block reuses the SOLID row's own chrome
    // (STYLE_FILL_COLOR_INPUT), so it is present — but as a read-only div,
    // not an editable input: the readonly marker and no number input.
    const colorBlock = detailRow.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`,
    );
    expect(colorBlock).not.toBeNull();
    expect(colorBlock?.classList.contains(PANEL_CLASS.READONLY)).toBe(true);

    expect(
      detailRow.querySelector(`.${CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER}`),
    ).toBeNull();

    expect(detailRow.querySelector(`.${PANEL_CLASS.READONLY}`)).not.toBeNull();
  });

  it("renders the ramp detail when a stored config says ramp", () => {
    setIntent(ui, "overlay1", "fillStyleMode", "value");

    setIntent(ui, "overlay1", "fillValue", {
      field: "count",

      method: "equal",

      classes: 4,

      scheme: "Reds",
    } as never);

    const row = buildFillRow(ui, "overlay1");

    const select = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`,
    ) as HTMLSelectElement;

    const fieldSelect = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`,
    ) as HTMLSelectElement;

    const methodSelect = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_METHOD_SELECT}`,
    ) as HTMLSelectElement;

    const classes = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_CLASSES_SELECT}`,
    ) as HTMLSelectElement;

    const trigger = row.querySelector(`.${CONST.CLASSES.STYLE_FILL_SCHEME_TRIGGER}`);

    expect(select.value).toBe("value");

    expect(fieldSelect.value).toBe("count");

    expect(methodSelect.value).toBe("equal");

    expect(classes.value).toBe("4");

    expect(trigger).not.toBeNull();

    expect(trigger!.textContent?.trim()).toBe("");

    expect(row.querySelector(`.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`)).toBeNull();
  });

  it("the value opacity row does not sink the mode to solid (#953)", () => {
    // The VALUE mode's opacity row commits an opacity-only patch: the stored
    // mode stays VALUE (never solid) — the #953 invariant for the by-value
    // mode. One construction point (buildValueDetail) owns the row, and the
    // binder attaches with the rest of the row when the panel opens.
    setIntent(ui, "overlay1", "fillStyleMode", "value");
    setIntent(ui, "overlay1", "fillValue", {
      field: "count",
      method: "equal",
      classes: 4,
      scheme: "Reds",
    } as never);
    ui.openStylePanel("overlay1");
    const item = findItem(ui, "overlay1");
    const opacity = item.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER}`,
    ) as HTMLInputElement;
    expect(opacity).not.toBeNull();
    opacity.value = "60";
    opacity.dispatchEvent(new Event("input", { bubbles: true }));
    expect(getIntent(ui, "overlay1", "fillOpacity")).toBe(0.6);
    expect(getIntent(ui, "overlay1", "fillStyleMode")).toBe("value");
  });

  it("labels the ramp row by method and names both selects distinctly", () => {
    // One visible label for two selects: it reads by the primary control —

    // the classification method — the same word the heatmap panel shows. The

    // class count is announced by the count select's own aria label, so the

    // pair stays distinguishable to a screen reader.

    setIntent(ui, "overlay1", "fillStyleMode", "value");

    setIntent(ui, "overlay1", "fillValue", {
      field: "count",

      method: "equal",

      classes: 4,

      scheme: "Reds",
    } as never);

    const row = buildFillRow(ui, "overlay1");

    const method = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_METHOD_SELECT}`,
    ) as HTMLSelectElement;

    const classes = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_CLASSES_SELECT}`,
    ) as HTMLSelectElement;

    const label = method

      .closest(`.${PANEL_CLASS.FORM_ROW}`)!
      .querySelector(`.${PANEL_CLASS.FORM_LABEL}`);

    expect(label?.textContent).toBe("foliplus.classification_method");

    expect(triggerOf(method).getAttribute("aria-label")).toBe(
      "foliplus.classification_method",
    );

    expect(triggerOf(classes).getAttribute("aria-label")).toBe(
      "LayerControl.style_fill_classes",
    );

    expect(triggerOf(method).getAttribute("aria-label")).not.toBe(
      triggerOf(classes).getAttribute("aria-label"),
    );
  });

  it("falls back to the documented default for an unregistered layer", () => {
    // No registry entry, no leaf — the monochrome ORIGINAL readout shows the

    // documented default swatch (#cccccc, CONST.COLOR.DEFAULT) + 20%, the

    // "no leaf declares a value" fallback.

    const row = buildFillRow(ui, "ghost");

    const boxes = Array.from(row.querySelectorAll(`.${PANEL_CLASS.READONLY}`));

    expect(boxes.length).toBeGreaterThanOrEqual(2);

    expect(origOpacity(row)).toBe("20");

    // The monochrome colour block reuses the SOLID row's own chrome
    // (STYLE_FILL_COLOR_INPUT) — the default fallback paints it.
    expect(
      row.querySelector(`.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`),
    ).not.toBeNull();
  });

  it("falls back to the documented default when no leaf declares a fill value", () => {
    const fixture = initWithFillLayer();

    delete fixture.fillLayer.leaves[0].options.fillColor;

    delete fixture.fillLayer.leaves[0].options.fillOpacity;

    delete fixture.fillLayer.leaves[1].options.fillColor;

    delete fixture.fillLayer.leaves[1].options.fillOpacity;

    // ORIGINAL monochrome readout (no intent): with no leaf declaring a fill

    // value at all, the documented defaults apply.

    const row = buildFillRow(fixture.ui, "overlay1");

    expect(origOpacity(row)).toBe("20");

    // The monochrome colour block reuses the SOLID row's own chrome
    // (STYLE_FILL_COLOR_INPUT) — the default fallback paints it.
    expect(
      row.querySelector(`.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`),
    ).not.toBeNull();
  });

  it("round-trips a dirty opacity through the 1-decimal normalize", () => {
    // A user can type a float that does not carry cleanly in binary. The
    // display rounds to one decimal percent and the commit stores the rounded
    // ratio, so the stored value and the readout agree and never leak a
    // 55.50000000000001-style tail. The input must live in the open panel
    // (the live binder wires the commit), not in a detached row.
    setIntent(ui, "overlay1", "fillStyleMode", "solid");

    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    const input = item.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER}`,
    ) as HTMLInputElement;

    input.value = "55.49999";

    input.dispatchEvent(new Event("input", { bubbles: true }));

    // The stored ratio is the rounded percent over 100, one clean decimal.
    expect(getIntent(ui, "overlay1", "fillOpacity")).toBe(0.555);

    // A rebuild re-reads the stored value and shows the rounded percent.
    const rebuilt = buildFillRow(ui, "overlay1");

    const readout = rebuilt.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER}`,
    ) as HTMLInputElement;

    expect(readout.value).toBe("55.5");
  });

  it("the fill opacity input allows any integer 0–100 (step 1)", () => {
    // The number field is the precise input; a coarse step would keep the

    // spinner on multiples of 5 while every integer is a legal opacity.

    setIntent(ui, "overlay1", "fillStyleMode", "solid");

    const row = buildFillRow(ui, "overlay1");

    const input = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER}`,
    ) as HTMLInputElement;

    expect(input.step).toBe("1");

    expect(input.min).toBe("0");

    expect(input.max).toBe("100");
  });

  it("the fill opacity input seeds from the authored fillOpacity", () => {
    // First leaf declares fillOpacity 0.5 — the field shows 50%, not the

    // Leaflet default constant, mirroring how the swatch shows the author's

    // color.

    setIntent(ui, "overlay1", "fillStyleMode", "solid");

    const row = buildFillRow(ui, "overlay1");

    const input = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER}`,
    ) as HTMLInputElement;

    expect(input.value).toBe("50");
  });

  it("the fill opacity input falls back to 20 when no leaf declares an opacity", () => {
    const fixture = initWithFillLayer();

    delete fixture.fillLayer.leaves[0].options.fillOpacity;

    delete fixture.fillLayer.leaves[1].options.fillOpacity;

    setIntent(fixture.ui, "overlay1", "fillStyleMode", "solid");

    const row = buildFillRow(fixture.ui, "overlay1");

    const input = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER}`,
    ) as HTMLInputElement;

    expect(input.value).toBe("20");
  });

  it("degrades to the default swatch when the browser probe returns a non-hex", () => {
    // The <input type=color> probe always yields hex in jsdom and Chromium;

    // if a UA ever returns garbage, the swatch must not receive it raw.

    const orig = document.createElement.bind(document) as any;

    vi.spyOn(document, "createElement").mockImplementationOnce(
      (tag: string, ...args: unknown[]) => {
        const el = orig(tag, ...args);

        if (tag === "input") {
          Object.defineProperty(el, "value", { get: () => "zzz", set: () => {} });
        }

        return el;
      },
    );

    setIntent(ui, "overlay1", "fillColor", "gray");

    const row = buildFillRow(ui, "overlay1");

    const input = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`,
    ) as HTMLInputElement;

    expect(input.value).toBe("#000000");
  });

  // ─────────────────── captureBase fallback ───────────────────

  it("captureBase falls back to Leaflet default #3388ff when options.fillColor is unset", () => {
    // A bare Leaflet GeoJSON layer with no style function has no

    // options.fillColor — the swatch shows what the browser would paint.

    const fixture = initWithFillLayer();

    delete fixture.fillLayer.leaves[0].options.fillColor;

    commitNow(fixture.ui, "overlay1", "color", "#ff0000");

    resetLayerFill(fixture.ui, "overlay1");

    expect(fixture.fillLayer.leaves[0].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#3388ff",

      fillOpacity: 0.5,

      fill: true,
    });
  });

  // ─────────────────── SVG repaint gate ───────────────────

  it("applyFillToLayer updates the SVG fill attribute (repaint gate)", () => {
    // User report: "改色后没生效". This gate asserts that a color change

    // actually reaches the rendered fill — not just options.fillColor, but

    // the attribute Leaflet paints into the SVG. If Leaflet's setStyle

    // stopped triggering _updateStyle for fillColor-only writes, this test

    // would go red before the fix.

    const fixture = initWithFillLayer();

    const svgFill = vi.fn();

    const path = {
      options: { fillColor: "#aabbcc", fillOpacity: 0.5, fill: true },

      feature: { geometry: { type: "Polygon" } },

      getLatLngs: RING,

      _path: { setAttribute: svgFill },

      _renderer: true as any,

      setStyle: vi.fn(function (this: any, style: Record<string, unknown>) {
        Object.assign(this.options, style);

        // Simulate Leaflet's _updateStyle: set the SVG fill attribute.

        this._path.setAttribute("fill", String(this.options.fillColor ?? ""));
      }),

      _updateStyle: vi.fn(),

      redraw: vi.fn(),
    };

    fixture.fillLayer.leaves[0] = path as never;

    setIntent(fixture.ui, "overlay1", "fillColor", "#ff0000");

    applyFillToLayer(fixture.ui, "overlay1");

    expect(svgFill).toHaveBeenCalledWith("fill", "#ff0000");

    expect(path.options.fillColor).toBe("#ff0000");
  });

  it("commitFillColor changes a hollow layer's color without touching fillOpacity", () => {
    // Honest rendering: a hollow polygon (fillOpacity=0) keeps its hole. The

    // color change is committed and reaches the fill attribute, but

    // fill-opacity stays 0, so the new color is not painted — the author's

    // value is respected rather than silently lifted.

    const fixture = initWithFillLayer();

    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0, fill: true },

      feature: { geometry: { type: "Polygon" } },

      getLatLngs: RING,

      setStyle: vi.fn(),
    };

    fixture.fillLayer.leaves[0] = leaf;

    commitNow(fixture.ui, "overlay1", "color", "#ff0000");

    expect(getIntent(fixture.ui, "overlay1", "fillColor")).toBe("#ff0000");

    expect(getIntent(fixture.ui, "overlay1", "fillOpacity")).toBeUndefined();

    expect(fixture.ui.intentStore.isUserSet("overlay1", "fillOpacity")).toBe(false);

    expect(leaf.setStyle).toHaveBeenCalledWith({ fillColor: "#ff0000", fill: true });
  });

  it("a hollow layer's opacity input still reads 0 after a color change", () => {
    // No fillOpacity override was written, so a reopened panel falls back to

    // the authored 0 — the panel and the map agree the layer is still hollow.

    const fixture = initWithFillLayer();

    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0, fill: true },

      feature: { geometry: { type: "Polygon" } },

      getLatLngs: RING,

      setStyle: vi.fn(),
    };

    fixture.fillLayer.leaves[0] = leaf;

    commitNow(fixture.ui, "overlay1", "color", "#ff0000");

    const row = buildFillRow(fixture.ui, "overlay1");

    const input = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER}`,
    ) as HTMLInputElement;

    expect(input.value).toBe("0");
  });

  it("commitFillColor keeps a user-set fillOpacity (even 0) untouched", () => {
    // An explicit fillOpacity is the user's own choice — the color commit

    // only reads it when building the setStyle payload, never rewrites it.

    const fixture = initWithFillLayer();

    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0, fill: true },

      feature: { geometry: { type: "Polygon" } },

      getLatLngs: RING,

      setStyle: vi.fn(),
    };

    fixture.fillLayer.leaves[0] = leaf;

    setIntent(fixture.ui, "overlay1", "fillOpacity", 0);

    commitNow(fixture.ui, "overlay1", "color", "#ff0000");

    expect(getIntent(fixture.ui, "overlay1", "fillOpacity")).toBe(0);

    expect(leaf.setStyle).toHaveBeenCalledWith({
      fillColor: "#ff0000",

      fillOpacity: 0,

      fill: true,
    });
  });

  it("commitFillOpacity writes to the map, persists, and marks the override", () => {
    const setLayer = vi.spyOn(manager.persistence, "schedule");

    commitNow(ui, "overlay1", "opacity", 50);

    expect(getIntent(ui, "overlay1", "fillOpacity")).toBe(0.5);

    expect(ui.intentStore.isUserSet("overlay1", "fillOpacity")).toBe(true);

    expect(setLayer).toHaveBeenCalled();
  });

  it("commitFillOpacity no-ops when the value did not change", () => {
    setIntent(ui, "overlay1", "fillOpacity", 0.5);

    const setLayer = vi.spyOn(manager.persistence, "schedule");

    commitNow(ui, "overlay1", "opacity", 50);

    expect(setLayer).not.toHaveBeenCalled();
  });

  it("commitFillOpacity clamps out-of-range values", () => {
    commitNow(ui, "overlay1", "opacity", 150);

    expect(getIntent(ui, "overlay1", "fillOpacity")).toBe(1);

    commitNow(ui, "overlay1", "opacity", -10);

    expect(getIntent(ui, "overlay1", "fillOpacity")).toBe(0);
  });

  it("resetLayerFill clears intents.fillOpacity and restores the author's opacity", () => {
    // A fillOpacity the user wrote is dropped by reset: the captured authored

    // base is replayed, so a hollow layer (0) comes back hollow rather than

    // keeping the user's 0.5.

    const fixture = initWithFillLayer();

    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0, fill: true },

      feature: { geometry: { type: "Polygon" } },

      getLatLngs: RING,

      setStyle: vi.fn(),
    };

    fixture.fillLayer.leaves[0] = leaf;

    commitNow(fixture.ui, "overlay1", "color", "#ff0000");

    commitNow(fixture.ui, "overlay1", "opacity", 50);

    expect(getIntent(fixture.ui, "overlay1", "fillOpacity")).toBe(0.5);

    resetLayerFill(fixture.ui, "overlay1");

    expect(getIntent(fixture.ui, "overlay1", "fillOpacity")).toBeUndefined();

    expect(fixture.ui.intentStore.isUserSet("overlay1", "fillOpacity")).toBe(false);

    expect(leaf.setStyle).toHaveBeenLastCalledWith({
      fillColor: "#aabbcc",

      fillOpacity: 0,

      fill: true,
    });
  });
});

describe("replayFillState", () => {
  let ui: LayerUI;

  let manager: LayerController;

  let fillLayer: ReturnType<typeof makeFillableLayer>;

  beforeEach(() => {
    const fixture = initWithFillLayer();

    ui = fixture.ui;

    manager = fixture.manager;

    fillLayer = fixture.fillLayer;
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();

    document.body.innerHTML = "";

    vi.clearAllMocks();
  });

  it("applies a stored fill color and opacity onto every leaf", () => {
    setIntent(ui, "overlay1", "fillColor", "#123456");

    setIntent(ui, "overlay1", "fillOpacity", 0.4);

    replayFillState(ui, "overlay1");

    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",

      fillOpacity: 0.4,

      fill: true,
    });

    expect(fillLayer.leaves[1].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",

      fillOpacity: 0.4,

      fill: true,
    });
  });

  it("is a no-op when only one fill dimension is stored", () => {
    setIntent(ui, "overlay1", "fillColor", "#123456");

    replayFillState(ui, "overlay1");

    // The absent dimension is omitted from the write so the author's

    // fillOpacity stays in force.

    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",

      fill: true,
    });
  });

  it("is a no-op for a layer outside the registry", () => {
    setIntent(ui, "ghost", "fillColor", "#123456");

    expect(() => replayFillState(ui, "ghost")).not.toThrow();
  });

  it("its content-change gate reads the same intent-key set the replay does", () => {
    // One array (FILL_INTENT_KEYS) feeds both the gate and the replay loop.

    // Pin the agreement at the boundary: no stored key gates the frame off,

    // a stored key gates it on — so a future intent cannot be replayed

    // without also passing the gate, or vice versa.

    const policy = FILL_DIMENSION.contentChange;

    expect(policy.kind).toBe("frame");

    const when = (policy as { when?: (u: LayerUI, id: string) => boolean }).when!;

    expect(when(ui, "overlay1")).toBe(false);

    setIntent(ui, "overlay1", "fillColor", "#123456");

    expect(when(ui, "overlay1")).toBe(true);
  });

  it("attachUI replays a stored fill onto a registered layer", () => {
    // Regression: the initial layers never go through registerLayer (where

    // the id-specified replay lives), so attach itself must replay fill —

    // otherwise a reload shows the author's default color.

    const fillLayer = makeFillableLayer();

    window.localStorage.setItem(
      CONST.STORAGE.KEY,

      JSON.stringify({
        layers: {
          overlay1: { fillColor: "#123456", overrides: ["fillColor"] },
        },
      }),
    );

    const fixture = initFixture({
      data: [
        { id: "overlay1", name: "Polygons", role: "overlay", layer: fillLayer },

        {
          id: "base1",

          name: "OSM",

          role: "base",

          layer: { options: {}, setZIndex: vi.fn() } as never,

          paneName: "tilePane",
        },
      ],
    });

    expect(getIntent(fixture.manager.ui!, "overlay1", "fillColor")).toBe("#123456");

    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",

      fill: true,
    });
  });

  it("attachUI replays a persisted ramp — a reload keeps the value colors", () => {
    // Regression: a persisted ramp with no solid color used to fall through

    // the empty-intent guard and paint nothing after a reload.

    const rampLayer = makeRampedLayer([1, 5, 9]);

    installChroma(["#111111", "#222222", "#333333"]);

    window.localStorage.setItem(
      CONST.STORAGE.KEY,

      JSON.stringify({
        layers: {
          overlay1: {
            fillMode: "value",

            fillValue: {
              kind: "numeric",

              field: "count",

              method: "equal",

              classes: 3,

              scheme: "Reds",
            },

            overrides: ["fillStyleMode", "fillValue"],
          },
        },
      }),
    );

    const fixture = initFixture({
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

    fixture.manager.ui!.runtimeStore.setFields("overlay1", [
      { name: "count", numeric: true },
    ]);

    expect(getIntent(fixture.manager.ui!, "overlay1", "fillStyleMode")).toBe("value");

    // The redundant default never reaches the apply path.

    expect(
      getIntent(fixture.manager.ui!, "overlay1", "fillValue")?.kind,
    ).toBeUndefined();

    // Each leaf got the color of its own value class, not the author's.

    const colors = rampLayer.leaves.map(
      leaf => leaf.setStyle.mock.calls.at(-1)![0].fillColor as string,
    );

    expect(colors).toEqual(["#111111", "#222222", "#333333"]);
  });

  it("replays a persisted fillOpacity alongside the ramp color", () => {
    const fixture = initWithRampedLayer([1, 5, 9]);

    installChroma(["#111111", "#222222", "#333333"]);

    setIntent(fixture.ui, "overlay1", "fillStyleMode", "value");

    setIntent(fixture.ui, "overlay1", "fillValue", {
      field: "count",

      method: "equal",

      classes: 3,

      scheme: "Reds",
    });

    // The solid mode's opacity survives the mode switch — the ramp replaces

    // only the color.

    setIntent(fixture.ui, "overlay1", "fillOpacity", 0.25);

    replayFillState(fixture.ui, "overlay1");

    expect(fixture.rampLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#111111",

      fillOpacity: 0.25,

      fill: true,
    });
  });
});
