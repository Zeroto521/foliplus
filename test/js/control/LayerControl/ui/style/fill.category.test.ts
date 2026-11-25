// test/js/control/LayerControl/ui/style/fill.category — declared category-ramp fill.
import { initFixture, installLeafletGlobals } from "../fixture.js";
import { installChroma, makeRampedLayer } from "./fill.fixture.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#control/LayerControl/const.js";
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
  describe("category fill — foliplus={'fill': {'ramp': {'kind': 'category', ...}}}", () => {
    /** A categorical layer: leaves carry a string `cat` property, so the


     *  category mode has labels to classify. */

    const makeCategoryLayer = (labels: string[]) => {
      const makeLeaf = (label: string) => {
        const leaf = new L.Polygon() as L.Polygon & {
          options: { fillColor?: string; fillOpacity?: number; fill?: boolean };

          feature: { properties: { cat: string; count?: number } };

          setStyle: ReturnType<typeof vi.fn>;

          on: ReturnType<typeof vi.fn>;
        };

        leaf.options = { fillColor: "#aabbcc", fillOpacity: 0.5, fill: true };

        leaf.feature = { properties: { cat: label } };

        leaf.setStyle = vi.fn();

        leaf.on = vi.fn();

        return leaf;
      };

      const leaves = labels.map(makeLeaf);

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

      return parent as { leaves: typeof leaves };
    };

    /** Register a category layer with the given declaration stamped on its


     *  options, and a category field set in the runtime store. */

    const categoryFixture = (
      labels: string[],

      fill: unknown,

      chromaColors = ["#111111", "#222222", "#333333", "#444444"],
    ) => {
      installChroma(chromaColors);

      installLeafletGlobals();

      const layer = makeCategoryLayer(labels);

      (layer as unknown as { options: Record<string, unknown> }).options.foliplus = {
        fill,
      };

      const { manager, ui } = initFixture({
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

      ui.runtimeStore.setFields("overlay1", [{ name: "cat", numeric: false }]);

      return { manager, ui, layer };
    };

    const painted = (layer: ReturnType<typeof makeCategoryLayer>): unknown[] =>
      layer.leaves.map(leaf => leaf.setStyle.mock.calls.at(-1)?.[0].fillColor);

    afterEach(() => {
      document.body.innerHTML = "";

      vi.clearAllMocks();

      vi.unstubAllGlobals();
    });

    it("paints a declared category ramp at attach, first-seen deduped", () => {
      // forest, water, forest: the repeated label keeps its first-seen color,

      // so the palette is not re-indexed by the second sighting.

      const { ui, layer } = categoryFixture(["forest", "water", "forest", "urban"], {
        kind: "category",

        field: "cat",

        scheme: "Set3",
      });

      expect(FILL_DIMENSION.value!(ui, "overlay1")).toMatchObject({
        mode: "value",

        value: { kind: "category", field: "cat", scheme: "Set3" },
      });

      // Distinct labels forest/water/urban take colors 0/1/2; the repeated

      // forest reuses color 0, never a fourth palette entry.

      expect(painted(layer)).toEqual(["#111111", "#222222", "#111111", "#333333"]);
    });

    it("a category past the palette end takes the last color, not a cycle", () => {
      // The palette family caps at 12 (Set3); a 13th distinct label cannot

      // get a 13th color, so it takes the last available one instead of

      // cycling back to the first (a repeated first would be as confusing as

      // a repeated last). This is the same out-of-bounds fallback colorFor uses.

      const labels = Array.from({ length: 13 }, (_, i) => `label${i}`);

      const { layer } = categoryFixture(labels, {
        kind: "category",

        field: "cat",

        scheme: "Set3",
      });

      // All 13 labels map: the 13th gets the last of the stub palette (4

      // colors in the fixture), never a 13th color and never the first again.

      expect(painted(layer).length).toBe(13);

      expect(painted(layer)[12]).toBe("#444444");

      // The 13th did not cycle back to the first color.

      expect(painted(layer)[12]).not.toBe(painted(layer)[0]);
    });

    it("infers category for a kind-absent declaration on a string column", () => {
      // A declaration that names no kind on a string column: fill.ts infers

      // the mode from the layer's own values, so it paints as a category ramp

      // instead of dropping to the solid mode (the author named a field, and

      // the data says it is categorical).

      const { ui, layer } = categoryFixture(["forest", "water"], {
        field: "cat",

        method: "equal",

        classes: 3,

        scheme: "Reds",
      });

      expect(FILL_DIMENSION.value!(ui, "overlay1")?.mode).toBe("value");

      // The inferred category mode paints the distinct labels, not the author

      // face and not a dropped-to-solid fallback.

      expect(painted(layer)).toEqual(["#111111", "#222222"]);
    });

    it("a kind-absent declaration with the default scheme takes the category default palette", () => {
      // The author named no scheme on a string column that infers category:

      // the categorical mode needs a discrete palette, so the numeric DEFAULT

      // (Viridis) is replaced by the category default (Set3) — a named scheme

      // is kept verbatim, but the default is not carried across the mode.

      const { ui, layer } = categoryFixture(["forest", "water"], {
        field: "cat",

        method: "equal",

        classes: 3,

        scheme: CONST.FILL_VALUE.SCHEME_DEFAULT,
      });

      expect(FILL_DIMENSION.value!(ui, "overlay1")).toMatchObject({
        mode: "value",

        value: {
          kind: "category",

          field: "cat",

          scheme: CONST.FILL_VALUE.CATEGORY_SCHEME_DEFAULT,
        },
      });

      expect(painted(layer)).toEqual(["#111111", "#222222"]);
    });

    it("category field resolution re-resolves through findLayer while the registry layer is unlinked", () => {
      // No field cache has been populated (the label panel has not run),

      // so the category mode falls to the tree walk — which re-resolves the

      // carrier through findLayer when the registry reference is still null,

      // the same late-binding defense the numeric mode uses.

      installChroma(["#111111", "#222222"]);

      installLeafletGlobals();

      const layer = makeCategoryLayer(["forest", "water"]);

      (layer as unknown as { options: Record<string, unknown> }).options.foliplus = {
        fill: { field: "cat", method: "equal", classes: 3, scheme: "Reds" },
      };

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

      (ui.c.layerRegistry.get("overlay1") as { layer: unknown }).layer = null;

      // The field cache lists only a numeric column, so the category mode's

      // candidate list is empty there and falls to the tree walk — which

      // re-resolves the carrier through findLayer while the registry

      // reference is null, the same late-binding defense the numeric mode uses.

      ui.runtimeStore.setFields("overlay1", [{ name: "count", numeric: true }]);

      vi.spyOn(ui.c, "findLayer").mockReturnValue(layer as never);

      expect(FILL_DIMENSION.value!(ui, "overlay1")?.mode).toBe("value");
    });

    it("an empty category domain falls back to the author face without error", () => {
      // A declared category ramp whose field resolves no string value on any

      // leaf: the collection yields no labels, buildCategoryRamp returns an

      // empty map, catScale is null, and the write pass leaves the author

      // face in place instead of painting a fallback color.

      const makeBadLeaf = () => {
        const leaf = new L.Polygon() as L.Polygon & {
          options: { fillColor?: string; fillOpacity?: number; fill?: boolean };

          feature: { properties: { cat: number } };

          setStyle: ReturnType<typeof vi.fn>;

          on: ReturnType<typeof vi.fn>;
        };

        leaf.options = { fillColor: "#aabbcc", fillOpacity: 0.5, fill: true };

        leaf.feature = { properties: { cat: 42 } };

        leaf.setStyle = vi.fn();

        leaf.on = vi.fn();

        return leaf;
      };

      const layer = { leaves: [makeBadLeaf(), makeBadLeaf()], options: {} } as never;

      installChroma(["#111111", "#222222"]);

      installLeafletGlobals();

      const fixture = initFixture({
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

      fixture.manager.ui!.runtimeStore.setFields("overlay1", [
        { name: "cat", numeric: false },
      ]);

      const leaves = (
        layer as { leaves: typeof makeBadLeaf extends never ? never : any[] }
      ).leaves;

      expect(() => {
        expect(leaves.every(l => l.setStyle.mock.calls.length === 0)).toBe(true);
      }).not.toThrow();
    });

    it("persisted category ramp round-trips through storage and replays the colors", () => {
      // Store a category record, reload (fresh fixture), and confirm the paint

      // matches — the persisted writer keeps the category shape intact.

      const { ui, layer } = categoryFixture(["forest", "water", "urban"], {
        kind: "category",

        field: "cat",

        scheme: "Set3",
      });

      setIntent(ui, "overlay1", "fillStyleMode", "value");

      setIntent(ui, "overlay1", "fillValue", {
        kind: "category",

        field: "cat",

        method: "jenks",

        classes: 6,

        scheme: "Set3",
      });

      applyFillToLayer(ui, "overlay1");

      expect(painted(layer)).toEqual(["#111111", "#222222", "#333333"]);

      // Reload: fresh fixture, no intent, storage holds the record.

      window.localStorage.setItem(
        CONST.STORAGE.KEY,

        JSON.stringify({
          layers: {
            overlay1: {
              fillMode: "value",

              fillValue: {
                kind: "category",

                field: "cat",

                method: "jenks",

                classes: 6,

                scheme: "Set3",
              },

              overrides: ["fillStyleMode", "fillValue"],
            },
          },
        }),
      );

      const reloaded = categoryFixture(["forest", "water", "urban"], {
        kind: "category",

        field: "cat",

        scheme: "Set3",
      });

      // The persisted category record wins over the declaration and replays

      // the same colors.

      expect(reloaded.layer.leaves[0].setStyle).toHaveBeenCalledWith(
        expect.objectContaining({ fillColor: "#111111" }),
      );

      expect(getIntent(reloaded.ui, "overlay1", "fillValue")).toMatchObject({
        kind: "category",

        field: "cat",

        scheme: "Set3",
      });
    });

    it("resolves a category field from the layer when the store cache is empty", () => {
      // categoryFields falls back to categoricalPropertiesKeys when the

      // runtime store has no cached fields (a layer the panel never opened

      // still resolves its categorical columns for the declared ramp).

      const { ui, layer } = categoryFixture(["forest", "water"], {
        kind: "category",

        field: "cat",

        scheme: "Set3",
      });

      ui.runtimeStore.setFields("overlay1", []);

      // A declared category ramp on a field the cache now misses still

      // paints: the fallback scans the layer properties.

      expect(FILL_DIMENSION.value!(ui, "overlay1")).toMatchObject({
        mode: "value",

        value: { kind: "category", field: "cat", scheme: "Set3" },
      });

      expect(painted(layer)).toEqual(["#111111", "#222222"]);
    });

    it("keeps a declared category ramp on the value mode of the panel", () => {
      const { ui } = categoryFixture(["forest", "water"], {
        kind: "category",

        field: "cat",

        scheme: "Set3",
      });

      // A1 exposes the category mode on the value model; the panel ROW wiring

      // (buildFillRow/buildRampDetail still gate the ramp option on numeric

      // fields) is the A2 follow-up, so the row-level assertion is covered there.

      expect(FILL_DIMENSION.value!(ui, "overlay1")).toMatchObject({
        mode: "value",

        value: { kind: "category", field: "cat", scheme: "Set3" },
      });
    });
  });

  // ── declared solid (fill.color / fill.opacity) ───────────────────────
  // The solid mode's colour and opacity are read-time defaults like the
  // ramp's mode: the row shows them, the dimension readout carries them (the
  // getStyle snapshot reads the same value()), and the attach sweep paints
  // them — none of it writes user intent.

  it("a declared solid colour and opacity are the row's read-time defaults", () => {
    const { ui } = declaredRampFixture({
      mode: "solid",

      color: "#FF0000",

      opacity: 0.4,
    });

    expect(FILL_DIMENSION.value!(ui, "overlay1")).toMatchObject({
      mode: "solid",

      color: "#ff0000",

      opacity: 0.4,
    });

    const block = buildFillRow(ui, "overlay1");

    const mode = block.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`,
    ) as HTMLSelectElement;

    expect(mode.value).toBe("solid");

    const color = block.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`,
    ) as HTMLInputElement;

    expect(color.value).toBe("#ff0000");

    const opacity = block.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER}`,
    ) as HTMLInputElement;

    // The fill-opacity row is a percent input (0-100).
    expect(Number(opacity.value)).toBe(40);

    // A read-time default is not a user intent: Reset must still reveal it.
    expect(getIntent(ui, "overlay1", "fillColor")).toBeUndefined();

    expect(getIntent(ui, "overlay1", "fillOpacity")).toBeUndefined();
  });

  it("a declared solid colour paints at attach without writing intent", () => {
    const { rampLayer } = declaredRampFixture({
      mode: "solid",

      color: "#ff0000",

      opacity: 0.4,
    });

    expect(paintedColors(rampLayer)).toEqual(["#ff0000", "#ff0000", "#ff0000"]);
  });

  it("a stored solid colour still beats the declared one", () => {
    const { ui } = declaredRampFixture({ mode: "solid", color: "#ff0000" });

    setIntent(ui, "overlay1", "fillColor", "#00ff00");

    expect(FILL_DIMENSION.value!(ui, "overlay1")?.color).toBe("#00ff00");
  });
});
