// test/js/control/LayerControl/ui/style/fill.declared — the declared foliplus fill declaration.
import { initFixture, installLeafletGlobals } from "../fixture.js";
import {
  details,
  installChroma,
  makePerFeatureLayer,
  makeRampedLayer,
  modeSelect,
  triggerOf,
} from "./fill.fixture.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dropdownOf } from "#ui/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { getIntent, setIntent } from "#control/LayerControl/ui/intent.js";
import {
  FILL_DIMENSION,
  applyFillToLayer,
  bindFillRow,
  buildFillRow,
  resetLayerFill,
} from "#control/LayerControl/ui/style/fill.js";

describe("declared fill — foliplus={'fill': ...}", () => {
  const declare = (
    layer: { options: Record<string, unknown> },

    fill: unknown,
  ): void => {
    layer.options.foliplus = { fill };
  };

  const declaredRampFixture = (fill: unknown) => {
    installChroma(["#111111", "#222222", "#333333"]);

    installLeafletGlobals();

    const rampLayer = makeRampedLayer([1, 5, 9]);

    declare(rampLayer as unknown as { options: Record<string, unknown> }, fill);

    const { manager, ui } = initFixture({
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

    return { manager, ui, rampLayer };
  };

  /** The last fillColor each leaf was painted with. */

  const paintedColors = (layer: ReturnType<typeof makeRampedLayer>): unknown[] =>
    layer.leaves.map(leaf => leaf.setStyle.mock.calls.at(-1)?.[0].fillColor);

  afterEach(() => {
    document.body.innerHTML = "";

    vi.clearAllMocks();

    vi.unstubAllGlobals();
  });

  /** A layer that both declares a ramp and paints its own per-feature face:


   *  the two boundary corollaries below are the two orders these can resolve


   *  in, and they differ only by whether the user has spoken. */

  const declaredOverAuthor = (fill: unknown) => {
    installChroma(["#111111", "#222222", "#333333"]);

    installLeafletGlobals();

    const layer = makePerFeatureLayer(["#0d0887", "#f0f921"]);

    declare(layer as unknown as { options: Record<string, unknown> }, fill);

    const { ui } = initFixture({
      data: [
        {
          id: "feature1",

          name: "Per feature",

          role: "overlay",

          layer,

          fillAuthor: {
            perFeature: true,

            distinct: 2,

            stops: ["#0d0887", "#f0f921"],
          },
        },
      ],
    });

    ui.runtimeStore.setFields("feature1", [{ name: "count", numeric: true }]);

    return { ui, layer, row: () => buildFillRow(ui, "feature1") };
  };
  it("paints the declared ramp at attach, before any panel touch", () => {
    // The declaration is a read-time default, so nothing in the intent store

    // replays it: the attach sweep has to paint it or the map would open on

    // the author's flat face until the first panel edit.

    const { ui, rampLayer } = declaredRampFixture({
      field: "count",

      method: "equal",

      classes: 3,

      scheme: "Reds",
    });

    expect(FILL_DIMENSION.value!(ui, "overlay1")).toMatchObject({
      mode: "value",

      value: { field: "count", method: "equal", classes: 3, scheme: "Reds" },
    });

    expect(paintedColors(rampLayer)).toEqual(["#111111", "#222222", "#333333"]);
  });

  it("paints every declared layer in one attach sweep", () => {
    // The sweep remembers what it already painted per UI, so a second declared

    // layer is painted by the same pass instead of only the first one — the

    // memo is keyed per control, not per layer.

    installChroma(["#111111", "#222222", "#333333"]);

    installLeafletGlobals();

    const declareRamp = (layer: ReturnType<typeof makeRampedLayer>) => {
      (layer as unknown as { options: Record<string, unknown> }).options.foliplus = {
        fill: { field: "count", method: "equal", classes: 3, scheme: "Reds" },
      };

      return layer;
    };

    const first = declareRamp(makeRampedLayer([1, 5, 9]));

    const second = declareRamp(makeRampedLayer([1, 5, 9]));

    initFixture({
      data: [
        { id: "overlay1", name: "Polygons", role: "overlay", layer: first },

        { id: "overlay2", name: "Polygons II", role: "overlay", layer: second },

        {
          id: "base1",

          name: "OSM",

          role: "base",

          layer: { options: {}, setZIndex: vi.fn() } as never,

          paneName: "tilePane",
        },
      ],
    });

    expect(paintedColors(first)).toEqual(["#111111", "#222222", "#333333"]);

    expect(paintedColors(second)).toEqual(["#111111", "#222222", "#333333"]);
  });

  it("replays the declared ramp on mouseout instead of folium's author face", () => {
    // The highlight pin's live reader is the declaration chain, not the intent

    // store: with no user record a pin reading intent alone returns null, and

    // folium's resetStyle puts the author's flat face back on the first hover.

    // Dropping that reader from the apply call is invisible to every paint

    // assertion above, so this is the test that holds the replay wiring.

    const { rampLayer } = declaredRampFixture({
      field: "count",

      method: "equal",

      classes: 3,

      scheme: "Reds",
    });

    // The pin is registered by the attach paint; folium's own mouseout handler

    // is the one it has to beat.

    const mouseoutOf = (leaf: { on: ReturnType<typeof vi.fn> }): (() => void) =>
      leaf.on.mock.calls.find(call => call[0] === "mouseout")?.[1] as () => void;

    for (const leaf of rampLayer.leaves) leaf.setStyle.mockClear();

    rampLayer.leaves.forEach(leaf => mouseoutOf(leaf)());

    // Each leaf gets its own class color back — not null, which would leave

    // folium's restore of the author's #aabbcc in force.

    expect(rampLayer.leaves.map(leaf => leaf.setStyle.mock.calls.at(-1)?.[0])).toEqual([
      { fill: true, fillColor: "#111111" },

      { fill: true, fillColor: "#222222" },

      { fill: true, fillColor: "#333333" },
    ]);
  });

  it("opens the panel on the declared mode with the declared values", () => {
    const { ui } = declaredRampFixture({
      field: "count",

      method: "quantile",

      classes: 4,

      scheme: "Blues",
    });

    const row = buildFillRow(ui, "overlay1");

    const mode = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`,
    ) as HTMLSelectElement;

    const field = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`,
    ) as HTMLSelectElement;

    const method = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_METHOD_SELECT}`,
    ) as HTMLSelectElement;

    const classes = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_CLASSES_SELECT}`,
    ) as HTMLSelectElement;

    expect(mode.value).toBe("value");

    expect(field.value).toBe("count");

    expect(method.value).toBe("quantile");

    expect(classes.value).toBe("4");

    // A declared ramp is an instruction, not a display approximation of the

    // author's palette: no per-feature/author note contradicts it.

    expect(mode.title).toBe("");

    // ORIGINAL is now always offered for a fill-capable layer, even

    // beside a declared ramp; the declared ramp still reads first.

    expect(mode.querySelector('option[value="original"]')).not.toBeNull();
  });

  it("shows a declared class count outside the editable range and converges on edit", () => {
    // The declared count is the author's data, so the panel states 12 even

    // though the picker only offers 2..9 — the same extra-option path an

    // author palette with 12 classes takes. Only a user write has to satisfy

    // the persisted vocabulary, so the first edit collapses the count.

    const { ui } = declaredRampFixture({
      field: "count",

      method: "equal",

      classes: 12,

      scheme: "Reds",
    });

    expect(FILL_DIMENSION.value!(ui, "overlay1")).toMatchObject({
      value: { classes: 12 },
    });

    const row = buildFillRow(ui, "overlay1");

    bindFillRow(ui, "overlay1", row);

    const classes = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_CLASSES_SELECT}`,
    ) as HTMLSelectElement;

    expect(classes.value).toBe("12");

    expect(classes.querySelector('option[value="12"]')).not.toBeNull();

    // The bridged select is hidden, so the explanation rides the trigger the

    // user actually sees; the row does not look broken next to a 2..9 list.

    expect(triggerOf(classes).title).toBe(
      "LayerControl.style_fill_classes_out_of_range",
    );

    classes.value = "9";

    classes.dispatchEvent(new Event("change", { bubbles: true }));

    // The declaration itself is untouched; only the user's record converges.

    expect(getIntent(ui, "overlay1", "fillValue")).toMatchObject({ classes: 9 });

    // Same panel, same row: the trigger label, its tooltip and the open list

    // all state the committed count. Leaving the declared count's presentation

    // behind showed 9 under the out-of-range tooltip with 12 still listed, and

    // picking that 12 again displayed 12 while the intent clamped to 9.

    expect(triggerOf(classes).textContent).toBe("9");

    expect(triggerOf(classes).title).toBe("9");

    const classesDropdown = dropdownOf(classes)!;

    classesDropdown.open();

    expect(
      Array.from(classesDropdown.getList()!.querySelectorAll('[role="option"]')).map(
        option => option.textContent,
      ),
    ).toEqual(["2", "3", "4", "5", "6", "7", "8", "9"]);

    classesDropdown.close();
  });

  it("Reset returns to the declared ramp after the user took the fill over", () => {
    const { ui, rampLayer } = declaredRampFixture({
      field: "count",

      method: "equal",

      classes: 3,

      scheme: "Reds",
    });

    // The user takes the fill over with a solid color: the declaration steps

    // aside (intent > declaration).

    setIntent(ui, "overlay1", "fillStyleMode", "solid");

    setIntent(ui, "overlay1", "fillColor", "#123456");

    applyFillToLayer(ui, "overlay1");

    expect(rampLayer.leaves[0].setStyle).toHaveBeenLastCalledWith(
      expect.objectContaining({ fillColor: "#123456" }),
    );

    expect(FILL_DIMENSION.value!(ui, "overlay1")?.mode).toBe("solid");

    resetLayerFill(ui, "overlay1");

    // Reset clears the intent, so the declaration is what shows through — the

    // same "Reset returns to the author's declaration" contract the label

    // dimension has.

    expect(FILL_DIMENSION.value!(ui, "overlay1")).toMatchObject({
      mode: "value",

      value: { field: "count", method: "equal", classes: 3, scheme: "Reds" },
    });

    expect(paintedColors(rampLayer)).toEqual(["#111111", "#222222", "#333333"]);
  });

  it("drops a kind-absent declaration whose field mixes number and category values", () => {
    // The author named a field that drives no single mode (numbers and strings

    // in one column): the declaration is dropped whole rather than painted

    // over a mismatched column, the same "no usable kind" rule an all-null

    // field gets — with its own one-time inference warning.

    installChroma(["#111111", "#222222", "#333333"]);

    installLeafletGlobals();

    const makeLeaf = (mix: number | string) => {
      const leaf = new L.Polygon() as L.Polygon & {
        options: { fillColor?: string; fillOpacity?: number; fill?: boolean };

        feature: { properties: { mix: number | string } };

        setStyle: ReturnType<typeof vi.fn>;

        on: ReturnType<typeof vi.fn>;
      };

      leaf.options = { fillColor: "#aabbcc", fillOpacity: 0.5, fill: true };

      leaf.feature = { properties: { mix } };

      leaf.setStyle = vi.fn();

      leaf.on = vi.fn();

      return leaf;
    };

    const leaves = [1, "a", 3].map(makeLeaf);

    const layer = {
      options: {},

      eachLayer: vi.fn((fn: (child: unknown) => void) => leaves.forEach(c => fn(c))),

      getBounds: vi.fn(() => ({
        isValid: () => true,

        getSouthWest: () => ({ lat: 0, lng: 0 }),

        getNorthEast: () => ({ lat: 1, lng: 1 }),
      })),

      leaves,
    } as never;

    declare(layer, { field: "mix", method: "equal", classes: 3, scheme: "Reds" });

    const { ui } = initFixture({
      data: [
        { id: "overlay1", name: "Polygons", role: "overlay", layer },

        {
          id: "base1",

          name: "OSM",

          role: "base",

          layer: { options: {}, setZIndex: vi.fn() } as never,

          paneName: "tilePane",
        },
      ],
    });

    // The declaration is dropped whole: no by-value ramp takes over, the

    // authored solid face stays — which reads as the author's original

    // colours, not a claimed solid.

    expect(FILL_DIMENSION.value!(ui, "overlay1")?.mode).toBe("original");
  });

  it("drops a declaration whose field vanished from the matching field set", () => {
    // The declaration names a numeric field the layer does not carry: it is

    // not re-pointed at another column, so the whole declaration steps aside

    // (the same rule a vanished declaration column gets) — the authored solid

    // face stays instead of a ramp over a mismatched column.

    const { ui } = declaredRampFixture({
      field: "count",

      method: "equal",

      classes: 3,

      scheme: "Reds",
    });

    // The panel's authoritative field set (the label cache) lists only a

    // different numeric column, so "count" is no longer offered even though

    // the layer still carries its values — a stale cache after the layer's

    // schema changed. The declaration is not re-pointed at another column: it

    // steps aside whole, so the authored solid face stays.

    ui.runtimeStore.setFields("overlay1", [{ name: "value", numeric: true }]);

    expect(FILL_DIMENSION.value!(ui, "overlay1")?.mode).toBe("original");
  });

  it("content-change gate resolves the declaration through findLayer while unlinked", () => {
    // The registry entry is populated but its layer reference is still null

    // (a transient pre-link state): the declaration gate re-resolves the

    // layer through findLayer rather than reading a null carrier, so a

    // content-change sweep still sees the author's declaration.

    const { ui, rampLayer } = declaredRampFixture({
      field: "count",

      method: "equal",

      classes: 3,

      scheme: "Reds",
    });

    (ui.c.layerRegistry.get("overlay1") as { layer: unknown }).layer = null;

    // findLayer re-resolves the carrier from the map: the declaration gate

    // reads through it rather than the null registry reference.

    vi.spyOn(ui.c, "findLayer").mockReturnValue(rampLayer as never);

    const when = (
      FILL_DIMENSION.contentChange as {
        when: (ui: LayerUI, layerId: string) => boolean;
      }
    ).when;

    expect(when(ui, "overlay1")).toBe(true);
  });

  it("keeps the user's stored ramp over the declaration", () => {
    const { ui, rampLayer } = declaredRampFixture({
      field: "count",

      method: "equal",

      classes: 3,

      scheme: "Reds",
    });

    // A different palette so the paint proves which config won.

    installChroma(["#aaaaaa", "#bbbbbb", "#cccccc"]);

    setIntent(ui, "overlay1", "fillStyleMode", "value");

    setIntent(ui, "overlay1", "fillValue", {
      field: "count",

      method: "equal",

      classes: 3,

      scheme: "Blues",
    });

    applyFillToLayer(ui, "overlay1");

    expect(paintedColors(rampLayer)).toEqual(["#aaaaaa", "#bbbbbb", "#cccccc"]);

    const method = buildFillRow(ui, "overlay1").querySelector(
      `.${CONST.CLASSES.STYLE_FILL_METHOD_SELECT}`,
    ) as HTMLSelectElement;

    expect(method.value).toBe("equal");

    // The user's record is what the panel reads, not the declaration.

    expect(getIntent(ui, "overlay1", "fillValue")).toMatchObject({
      scheme: "Blues",
    });
  });

  it("ignores a declaration whose column the data does not offer", () => {
    const { ui } = declaredRampFixture({
      field: "missing",

      method: "equal",

      classes: 3,

      scheme: "Reds",
    });

    // Not silently re-pointed at "count": the whole declaration falls back to

    // the original baseline instead of painting a column the author never

    // named.

    expect(FILL_DIMENSION.value!(ui, "overlay1")?.mode).toBe("original");

    const mode = buildFillRow(ui, "overlay1").querySelector(
      `.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`,
    ) as HTMLSelectElement;

    expect(mode.value).toBe("original");
  });

  it("a declared mode=solid ignores a ramp shell given beside it", () => {
    const { ui } = declaredRampFixture({
      mode: "solid",

      value: { field: "count" },
    });

    // The solid mode is the author's read-time default; the nested value shell
    // is not a known fill key, so the reader warns and drops it rather than
    // turning the declaration into a ramp (solid is a real mode).
    expect(FILL_DIMENSION.value!(ui, "overlay1")?.mode).toBe("solid");

    expect(FILL_DIMENSION.value!(ui, "overlay1")?.value).toBeUndefined();

    const mode = buildFillRow(ui, "overlay1").querySelector(
      `.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`,
    ) as HTMLSelectElement;

    expect(mode.value).toBe("solid");
  });

  it("takes the declared ramp over the detected per-feature paint", () => {
    installChroma(["#111111", "#222222", "#333333"]);

    installLeafletGlobals();

    const layer = makePerFeatureLayer(["#0d0887", "#f0f921"]);

    declare(layer as unknown as { options: Record<string, unknown> }, {
      // equal (not the jenks default): the classification tests carry no

      // simple-statistics global, and a failed build would paint the author's

      // own colors back.

      field: "count",

      method: "equal",
    });

    const { ui } = initFixture({
      data: [
        {
          id: "feature1",

          name: "Per feature",

          role: "overlay",

          layer,

          fillAuthor: { perFeature: true, fields: [] },
        },
      ],
    });

    ui.runtimeStore.setFields("feature1", [{ name: "count", numeric: true }]);

    const mode = buildFillRow(ui, "feature1").querySelector(
      `.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`,
    ) as HTMLSelectElement;

    expect(mode.value).toBe("value");

    // The three modes survive a declaration: the author's paint is still under

    // the ramp, so "Original Colors" stays selectable beside it.

    expect(mode.querySelector('option[value="original"]')).not.toBeNull();

    // The note explains that mode, which is still on offer, so it does not

    // contradict the declared ramp beside it.

    expect(mode.title).toBe("LayerControl.style_fill_per_feature_note");

    const rampColors = ["#111111", "#222222", "#333333"];

    expect(
      layer.leaves.every((leaf: { setStyle: ReturnType<typeof vi.fn> }) =>
        rampColors.includes(leaf.setStyle.mock.calls.at(-1)?.[0].fillColor as string),
      ),
    ).toBe(true);
  });

  it("corollary ②: with no intent, the declaration outranks the author's presentation", () => {
    const { ui, layer, row } = declaredOverAuthor({
      field: "count",

      method: "equal",
    });

    // Nobody has chosen yet, and the layer does paint per feature: the

    // declared ramp is still the mode the panel and the map show.

    expect(modeSelect(row()).value).toBe("value");

    expect(getIntent(ui, "feature1", "fillStyleMode")).toBeUndefined();

    expect(getIntent(ui, "feature1", "fillValue")).toBeUndefined();

    const rampColors = ["#111111", "#222222", "#333333"];

    expect(
      layer.leaves.every((leaf: { setStyle: ReturnType<typeof vi.fn> }) =>
        rampColors.includes(leaf.setStyle.mock.calls.at(-1)?.[0].fillColor as string),
      ),
    ).toBe(true);
  });

  it("corollary ①: an explicit Original Colors pick beats the declaration", () => {
    const { ui, layer, row } = declaredOverAuthor({
      field: "count",

      method: "equal",
    });

    // The one exception to "the declaration outranks": the user's own pick.

    setIntent(ui, "feature1", "fillStyleMode", "original");

    applyFillToLayer(ui, "feature1");

    expect(FILL_DIMENSION.value!(ui, "feature1")?.mode).toBe("original");

    const block = row();

    expect(modeSelect(block).value).toBe("original");

    // The Original Colors mode is read-only: the author's presentation, with no

    // control to edit it.

    expect(details(block).querySelector("select")).toBeNull();

    // The map follows the author's presentation again, not the ramp.

    expect(
      layer.leaves.map(
        (leaf: { setStyle: ReturnType<typeof vi.fn> }) =>
          leaf.setStyle.mock.calls.at(-1)?.[0].fillColor,
      ),
    ).toEqual(["#0d0887", "#f0f921"]);
  });

  it("a declared mode=solid surfaces over the detected per-feature display", () => {
    installLeafletGlobals();

    const layer = makePerFeatureLayer(["#0d0887", "#f0f921"]);

    declare(layer as unknown as { options: Record<string, unknown> }, {
      mode: "solid",
    });

    const { ui } = initFixture({
      data: [
        {
          id: "feature1",

          name: "Per feature",

          role: "overlay",

          layer,

          fillAuthor: {
            perFeature: true,

            distinct: 2,

            stops: ["#0d0887", "#f0f921"],
          },
        },
      ],
    });

    ui.runtimeStore.setFields("feature1", [{ name: "count", numeric: true }]);

    const mode = buildFillRow(ui, "feature1").querySelector(
      `.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`,
    ) as HTMLSelectElement;

    // The explicit declaration outranks the detected per-feature
    // presentation; the hint still explains what the authored original
    // colors are, so the per-feature sentence stays on the control.
    expect(mode.value).toBe("solid");

    expect(mode.title).toBe("LayerControl.style_fill_per_feature_note");
  });

  it("its content-change gate opens for a declared ramp", () => {
    const { ui } = declaredRampFixture({ field: "count" });

    const when = (
      FILL_DIMENSION.contentChange as {
        when?: (u: LayerUI, id: string) => boolean;
      }
    ).when!;

    expect(when(ui, "overlay1")).toBe(true);
  });
});
