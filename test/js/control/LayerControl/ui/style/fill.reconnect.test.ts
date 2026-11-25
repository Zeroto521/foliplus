// test/js/control/LayerControl/ui/style/fill.reconnect — declared fill reconnection.
import { initFixture, installLeafletGlobals } from "../fixture.js";
import { installChroma, makePerFeatureLayer, makeRampedLayer } from "./fill.fixture.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { getIntent, setIntent } from "#control/LayerControl/ui/intent.js";
import {
  FILL_DIMENSION,
  applyFillToLayer,
  buildFillRow,
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
  describe("reconnection — the layer is removed, then added again", () => {
    /** The fill row's own readout: panel values, not manager internals. */

    const readFillRow = (ui: LayerUI, id: string) => {
      const row = buildFillRow(ui, id);

      const value = (selector: string) =>
        (row.querySelector(selector) as HTMLSelectElement | null)?.value;

      return {
        mode: value(`.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`),

        field: value(`.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`),

        method: value(`.${CONST.CLASSES.STYLE_FILL_METHOD_SELECT}`),

        classes: value(`.${CONST.CLASSES.STYLE_FILL_CLASSES_SELECT}`),
      };
    };

    it("paints the declared ramp again after the layer is re-registered", () => {
      const { manager, rampLayer } = declaredRampFixture({
        field: "count",

        method: "equal",

        classes: 3,

        scheme: "Reds",
      });

      expect(paintedColors(rampLayer)).toEqual(["#111111", "#222222", "#333333"]);

      // A reconnect is a fresh mount of the same layer: drop the recorded

      // writes so the assertion below can only pass if the ramp is painted

      // again, not if the attach-time call is still on the mock.

      rampLayer.leaves.forEach(leaf => leaf.setStyle.mockClear());

      manager.unregisterLayer("overlay1");

      manager.registerLayer({
        id: "overlay1",

        name: "Polygons",

        role: "overlay",

        layer: rampLayer,
      });

      // The declaration is a read-time default, not stored state: a reconnect

      // has to replay it, or the map falls back to the author's flat face.

      expect(paintedColors(rampLayer)).toEqual(["#111111", "#222222", "#333333"]);
    });

    it("keeps the declared panel values and writes no intent on reconnect", () => {
      const { manager, ui, rampLayer } = declaredRampFixture({
        field: "count",

        method: "equal",

        classes: 4,

        scheme: "Blues",
      });

      const before = readFillRow(ui, "overlay1");

      manager.unregisterLayer("overlay1");

      manager.registerLayer({
        id: "overlay1",

        name: "Polygons",

        role: "overlay",

        layer: rampLayer,
      });

      const after = readFillRow(ui, "overlay1");

      expect(after).toEqual(before);

      expect(after.mode).toBe("value");

      expect(after.field).toBe("count");

      expect(after.method).toBe("equal");

      expect(after.classes).toBe("4");

      // A reconnect replays the author's declaration; it must not be mistaken

      // for a user pick, or Reset would stop returning to the declaration.

      const intentKeys = [
        "fillColor",

        "fillOpacity",

        "fillStyleMode",

        "fillValue",
      ] as const;

      for (const key of intentKeys) {
        expect(getIntent(ui, "overlay1", key)).toBeUndefined();
      }
    });

    it("keeps the author's read-only per-feature state after a reconnect", () => {
      installLeafletGlobals();

      const layer = makePerFeatureLayer(["#0d0887", "#f0f921"]);

      const fillAuthor = {
        perFeature: true,

        distinct: 2,

        stops: ["#0d0887", "#f0f921"],
      };

      const { manager, ui } = initFixture({
        data: [
          {
            id: "feature1",

            name: "Per feature",

            role: "overlay",

            layer,

            fillAuthor,
          },
        ],
      });

      ui.runtimeStore.setFields("feature1", [{ name: "count", numeric: true }]);

      expect(readFillRow(ui, "feature1").mode).toBe("original");

      manager.unregisterLayer("feature1");

      manager.registerLayer({
        id: "feature1",

        name: "Per feature",

        role: "overlay",

        layer,

        fillAuthor,
      });

      // The detected state is the author's paint, not a fallback: a reconnect

      // must not degrade it into the solid mode.

      const mode = buildFillRow(ui, "feature1").querySelector(
        `.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`,
      ) as HTMLSelectElement;

      expect(mode.value).toBe("original");

      expect(mode.title).toBe("LayerControl.style_fill_per_feature_note");
    });

    it("keeps the user's intent across a reconnect — intent outranks the declaration", () => {
      const { manager, ui, rampLayer } = declaredRampFixture({
        value: { field: "count", method: "equal", classes: 3, scheme: "Reds" },
      });

      setIntent(ui, "overlay1", "fillStyleMode", "value");

      setIntent(ui, "overlay1", "fillValue", {
        kind: "numeric",

        field: "count",

        method: "equal",

        classes: 4,

        scheme: "Blues",
      });

      applyFillToLayer(ui, "overlay1");

      rampLayer.leaves.forEach(leaf => leaf.setStyle.mockClear());

      manager.unregisterLayer("overlay1");

      manager.registerLayer({
        id: "overlay1",

        name: "Polygons",

        role: "overlay",

        layer: rampLayer,
      });

      // The user's record survives the reconnect and still wins over the

      // declaration: the panel reports the user's ramp, not the declared one.

      expect(FILL_DIMENSION.value!(ui, "overlay1")).toMatchObject({
        mode: "value",

        value: { method: "equal", classes: 4, scheme: "Blues" },
      });

      expect(getIntent(ui, "overlay1", "fillValue")).toMatchObject({ classes: 4 });

      expect(
        paintedColors(rampLayer).filter(color => color !== undefined),
      ).toHaveLength(3);
    });
  });
});
