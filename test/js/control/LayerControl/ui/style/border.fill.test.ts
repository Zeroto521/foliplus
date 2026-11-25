// test/js/control/LayerControl/ui/style/border.fill — the follow-fill border mode.
import { initFixture, installLeafletGlobals } from "../fixture.js";
import {
  installChroma,
  makeFeatureGroup,
  makeHighlightLeaf,
  makeLayerForGeometry,
  registerFeatureLayer,
} from "./border.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import {
  getIntent,
  seedIntentMap,
  setIntent,
} from "#control/LayerControl/ui/intent.js";
import {
  BORDER_DIMENSION,
  applyBorderToLayer,
  bindBorderRow,
  buildBorderRow,
  replayDeclaredBorder,
  resetLayerBorder,
} from "#control/LayerControl/ui/style/border.js";
import { FILL_DIMENSION } from "#control/LayerControl/ui/style/fill.js";
import { FACE, flushStyleDimApply } from "#control/LayerControl/ui/style/styleBag.js";

describe("follow-fill border mode", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = {};
    seedIntentMap(ui, "visible", {});
    installChroma(["#010101", "#020202", "#030303"]);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    delete globalThis.chroma;
  });

  /** A genuine areal leaf: the border is the outline, the fill owns the face. */
  const makeAreaLeaf = (count: number, opts: Record<string, unknown> = {}): any => {
    installLeafletGlobals();
    const leaf = new (globalThis as any).L.Polygon() as any;
    leaf.options = { color: "#ff0000", weight: 2, stroke: true, ...opts };
    leaf.feature = { geometry: { type: "Polygon" }, properties: { count } };
    leaf.setStyle = vi.fn((style: Record<string, unknown>) => {
      Object.assign(leaf.options, style);
      return leaf;
    });
    leaf.on = vi.fn();
    return leaf;
  };

  /** A genuine line leaf: the border is the element's own primary colour. */
  const makeLineLeaf = (count: number): any => {
    installLeafletGlobals();
    const leaf = new (globalThis as any).L.Polyline() as any;
    leaf.options = { color: "#ff0000", weight: 2, stroke: true };
    leaf.feature = { geometry: { type: "LineString" }, properties: { count } };
    leaf.setStyle = vi.fn((style: Record<string, unknown>) => {
      Object.assign(leaf.options, style);
      return leaf;
    });
    leaf.on = vi.fn();
    return leaf;
  };

  const openRow = (id: string, leaves: any[]) => {
    registerFeatureLayer(manager, ui, id, leaves);
    const block = buildBorderRow(ui, id) as HTMLElement;
    document.body.appendChild(block);
    bindBorderRow(ui, id, block);
    return block;
  };
  const selectOf = (block: HTMLElement) =>
    block.querySelector(
      ".foliplus-style-border-mode-select",
    ) as HTMLSelectElement | null;

  it("polygon: FOLLOW_FILL IS offered in the mode options", () => {
    const leaves = [makeAreaLeaf(1), makeAreaLeaf(5)];
    const block = openRow("poly1", leaves);
    const values = Array.from(selectOf(block)!.options).map(o => o.value);
    expect(values).toContain("followFill");
    // by_value is NOT offered on a non-line (existing contract).
    expect(values).not.toContain("value");
  });

  it("line: FOLLOW_FILL is NOT offered (no fill to follow)", () => {
    const leaves = [makeLineLeaf(1), makeLineLeaf(5)];
    const block = openRow("line1", leaves);
    const values = Array.from(selectOf(block)!.options).map(o => o.value);
    expect(values).not.toContain("followFill");
    // by_value IS offered on a line (existing contract).
    expect(values).toContain("value");
  });

  it("display holds FOLLOW_FILL across every fill state (no solid-only fallback)", () => {
    const leaves = [makeAreaLeaf(1), makeAreaLeaf(5)];
    openRow("poly1", leaves);
    setIntent(ui, "poly1", "borderStyleMode", "followFill");
    // Fill goes by-value (a state the old fallback collapsed to ORIGINAL).
    setIntent(ui, "poly1", "fillStyleMode", "value");
    const block2 = buildBorderRow(ui, "poly1") as HTMLElement;
    document.body.appendChild(block2);
    const select2 = selectOf(block2);
    // Follow holds: the select still reads followFill, not original.
    expect(select2!.value).toBe("followFill");
    // Persistence keeps followFill.
    expect(getIntent(ui, "poly1", "borderStyleMode")).toBe("followFill");
  });

  it("derived paint: followFill reads the leaf's current fill colour, not a copy", () => {
    // The leaf's live fill paint is the single source. Simulate the fill
    // having been applied (solid colour lands in leaf.options.fillColor).
    const leaves = [makeAreaLeaf(1, { fillColor: "#123456" })];
    registerFeatureLayer(manager, ui, "poly1", leaves);
    setIntent(ui, "poly1", "fillStyleMode", "solid");
    setIntent(ui, "poly1", "fillColor", "#123456");
    setIntent(ui, "poly1", "borderStyleMode", "followFill");
    applyBorderToLayer(ui, "poly1");
    // The border paints the leaf's fill colour (derived) — the borderColor
    // intent stays absent so a later fill edit recomputes the border.
    leaves.forEach(leaf => {
      const call = leaf.setStyle.mock.calls.at(-1)?.[0];
      expect(call.color).toBe("#123456");
    });
    expect(getIntent(ui, "poly1", "borderColor")).toBeUndefined();
  });

  it("per-feature fill + follow: each leaf paints its own fill colour", () => {
    const leaves = [
      makeAreaLeaf(1, { fillColor: "#111111" }),
      makeAreaLeaf(5, { fillColor: "#222222" }),
    ];
    registerFeatureLayer(manager, ui, "poly1", leaves);
    setIntent(ui, "poly1", "borderStyleMode", "followFill");
    applyBorderToLayer(ui, "poly1");
    const colors = leaves.map(leaf => leaf.setStyle.mock.calls.at(-1)?.[0].color);
    expect(colors[0]).toBe("#111111");
    expect(colors[1]).toBe("#222222");
    expect(colors[0]).not.toBe(colors[1]);
  });

  it("fill colour change: the border re-derives on the next apply", () => {
    const leaves = [makeAreaLeaf(1, { fillColor: "#111111" })];
    registerFeatureLayer(manager, ui, "poly1", leaves);
    setIntent(ui, "poly1", "borderStyleMode", "followFill");
    applyBorderToLayer(ui, "poly1");
    expect(leaves[0].setStyle.mock.calls.at(-1)?.[0].color).toBe("#111111");
    leaves[0].options.fillColor = "#abcdef";
    applyBorderToLayer(ui, "poly1");
    expect(leaves[0].setStyle.mock.calls.at(-1)?.[0].color).toBe("#abcdef");
  });

  it("fill write triggers a border re-apply when the border follows fill", () => {
    // The lead's critical contract: editing the fill (colour, mode, value)
    // must re-derive a follow-fill border on the SAME commit path — no
    // extra listener, no cross-face event.
    const leaves = [makeAreaLeaf(1, { fillColor: "#111111" })];
    registerFeatureLayer(manager, ui, "poly1", leaves);
    setIntent(ui, "poly1", "fillStyleMode", "solid");
    setIntent(ui, "poly1", "borderStyleMode", "followFill");
    // The user edits the fill colour through the dimension write.
    FILL_DIMENSION.write!(ui, "poly1", { color: "#abcdef" });
    flushStyleDimApply(FACE.FILL, "poly1");
    flushStyleDimApply(FACE.STROKE, "poly1");
    // The border follow-fill replay fired and re-derived the leaf's stroke.
    expect(leaves[0].setStyle.mock.calls.at(-1)?.[0].color).toBe("#abcdef");
    // The border colour intent stays absent (derived, not copied).
    expect(getIntent(ui, "poly1", "borderColor")).toBeUndefined();
  });

  it("follow DOM: no colour input, width-only row in the right column", () => {
    setIntent(ui, "poly1", "borderStyleMode", "followFill");
    const block2 = buildBorderRow(ui, "poly1") as HTMLElement;
    document.body.appendChild(block2);
    expect(block2.querySelector("input[type=color]")).toBeNull();
    const weight = block2.querySelector(".foliplus-style-border-weight-input");
    expect(weight).not.toBeNull();
    const sizeRow = weight!.closest(".foliplus-style-size-row");
    expect(sizeRow).not.toBeNull();
  });

  it("derivedFillColor falls back through the three-arm chain", () => {
    const fillLeaf = makeAreaLeaf(1, { fillColor: "#123456" });
    const propLeaf = makeAreaLeaf(2);
    delete propLeaf.options.fillColor;
    propLeaf.feature.properties.__folium_color = "#654321";
    const strokeLeaf = makeAreaLeaf(3);
    delete strokeLeaf.options.fillColor;
    const leaves = [fillLeaf, propLeaf, strokeLeaf];
    registerFeatureLayer(manager, ui, "poly1", leaves);
    setIntent(ui, "poly1", "borderStyleMode", "followFill");
    applyBorderToLayer(ui, "poly1");
    const colors = leaves.map(l => l.setStyle.mock.calls.at(-1)?.[0].color);
    expect(colors[0]).toBe("#123456");
    expect(colors[1]).toBe("#654321");
    expect(colors[2]).toBe("#ff0000");
  });

  it("highlight replay re-derives the follow-fill colour (pin followFill arm)", () => {
    const leaf = makeHighlightLeaf("#ff0000", 2);
    leaf.options.fillColor = "#123456";
    manager.registerLayer({ id: "poly1", name: "P", layer: leaf });
    setIntent(ui, "poly1", "borderStyleMode", "followFill");
    applyBorderToLayer(ui, "poly1");
    expect(leaf.options.color).toBe("#123456");
    leaf.fireMouseout();
    expect(leaf.options.color).toBe("#123456");
  });
  it("per-feature ORIGINAL: read-only original rows + width-only row (no colour input)", () => {
    const leaves = [makeAreaLeaf(1), makeAreaLeaf(2)];
    installLeafletGlobals();
    manager.registerLayer({
      id: "pf1",
      name: "pf1",
      layer: makeFeatureGroup(...leaves),
      fillAuthor: {
        perFeature: true,
        distinct: 2,
        stops: ["#111111", "#222222"],
        scale: { kind: "continuous", column: "count" },
      },
    });
    const block = buildBorderRow(ui, "pf1") as HTMLElement;
    document.body.appendChild(block);
    bindBorderRow(ui, "pf1", block);
    setIntent(ui, "pf1", "borderStyleMode", "original");
    const block2 = buildBorderRow(ui, "pf1") as HTMLElement;
    document.body.appendChild(block2);
    // No colour input at all (the author has no single colour value).
    expect(block2.querySelector("input[type=color]")).toBeNull();
    // The read-only original rows are present: the colours strip box + count.
    expect(block2.querySelector(".foliplus-style-fill-original-colors")).not.toBeNull();
    expect(block2.querySelector(".foliplus-style-fill-original-count")).not.toBeNull();
    // The width input exists and sits in the right column (size row).
    const weight = block2.querySelector(".foliplus-style-border-weight-input");
    expect(weight).not.toBeNull();
    const sizeRow = weight!.closest(".foliplus-style-size-row");
    expect(sizeRow).not.toBeNull();
  });

  it("single-colour author ORIGINAL keeps the real swatch (counter-guard)", () => {
    const leaves = [makeAreaLeaf(1)];
    registerFeatureLayer(manager, ui, "poly1", leaves);
    setIntent(ui, "poly1", "borderStyleMode", "original");
    const block = buildBorderRow(ui, "poly1") as HTMLElement;
    document.body.appendChild(block);
    // A single-colour author keeps the colour swatch (inert but present).
    const swatch = block.querySelector(".foliplus-style-border-color-input");
    expect(swatch).not.toBeNull();
    expect((swatch as HTMLInputElement).readOnly).toBe(true);
    // Width input present too.
    expect(block.querySelector(".foliplus-style-border-weight-input")).not.toBeNull();
  });

  // ── declared follow_fill (foliplus.border) ─────────────────────────────
  // The declaration is a read-time mode default: no stored intent, no
  // derived value — the border shows and paints follow_fill from the
  // author's foliplus.border, and a stored mode/Reset behave as declared.

  /** A feature group whose own options carry a foliplus border declaration
   *  (the same stamp folium lays on the registered layer). */
  const makeDeclaredGroup = (declaration: unknown, ...leaves: any[]): any => ({
    options: { foliplus: { border: declaration } },
    eachLayer: vi.fn((fn: (child: unknown) => void) => {
      for (const leaf of leaves) fn(leaf);
    }),
    leaves,
  });

  const registerDeclared = (id: string, declaration: unknown, leaves: any[]): void => {
    installLeafletGlobals();
    manager.registerLayer({
      id,
      name: id,
      layer: makeDeclaredGroup(declaration, ...leaves),
    });
    ui.runtimeStore.setFields(id, [{ name: "count", numeric: true }]);
  };

  it("declared follow_fill drives the display with no stored mode", () => {
    const leaves = [makeAreaLeaf(1), makeAreaLeaf(5)];
    registerDeclared("dpoly1", { mode: "follow_fill" }, leaves);
    const block = buildBorderRow(ui, "dpoly1") as HTMLElement;
    document.body.appendChild(block);
    const select = selectOf(block)!;
    // The declaration is the default mode: the select shows followFill, and
    // the option is offered (polygon: the natural follow-fill channel).
    expect(select.value).toBe("followFill");
    expect(Array.from(select.options).map(o => o.value)).toContain("followFill");
  });

  it("declared follow_fill paints the derived fill colour on apply", () => {
    const leaves = [makeAreaLeaf(1, { fillColor: "#123456" })];
    registerDeclared("dpoly2", { mode: "follow_fill" }, leaves);
    applyBorderToLayer(ui, "dpoly2");
    expect(leaves[0].setStyle.mock.calls.at(-1)?.[0].color).toBe("#123456");
    // No border colour intent is written: the derivation reads the leaf live.
    expect(getIntent(ui, "dpoly2", "borderColor")).toBeUndefined();
  });

  it("declared follow_fill is inapplicable on a line (no fill to follow)", () => {
    const leaves = [makeLineLeaf(1), makeLineLeaf(5)];
    registerDeclared("dline1", { mode: "follow_fill" }, leaves);
    const block = buildBorderRow(ui, "dline1") as HTMLElement;
    document.body.appendChild(block);
    const select = selectOf(block);
    // A line cannot paint follow_fill: the declaration steps aside, so the
    // select falls to the derived default and the mode option stays absent.
    expect(select!.value).not.toBe("followFill");
    expect(Array.from(select!.options).map(o => o.value)).not.toContain("followFill");
  });

  it("stored solid beats the declared follow_fill (intent > declaration)", () => {
    const leaves = [makeAreaLeaf(1, { fillColor: "#123456" })];
    registerDeclared("dpoly3", { mode: "follow_fill" }, leaves);
    setIntent(ui, "dpoly3", "borderStyleMode", "solid");
    setIntent(ui, "dpoly3", "borderColor", "#abcdef");
    applyBorderToLayer(ui, "dpoly3");
    expect(leaves[0].setStyle.mock.calls.at(-1)?.[0].color).toBe("#abcdef");
  });

  it("reset reveals the declared follow_fill (not the author stroke)", () => {
    const leaves = [makeAreaLeaf(1, { fillColor: "#123456" })];
    registerDeclared("dpoly4", { mode: "follow_fill" }, leaves);
    // User commits a solid colour first, then resets.
    setIntent(ui, "dpoly4", "borderStyleMode", "solid");
    setIntent(ui, "dpoly4", "borderColor", "#abcdef");
    applyBorderToLayer(ui, "dpoly4");
    expect(leaves[0].setStyle.mock.calls.at(-1)?.[0].color).toBe("#abcdef");
    resetLayerBorder(ui, "dpoly4");
    // Reset clears the intents and re-applies the declaration: the border
    // re-derives from the leaf's current fill (the author's default paint).
    expect(getIntent(ui, "dpoly4", "borderStyleMode")).toBeUndefined();
    expect(leaves[0].setStyle.mock.calls.at(-1)?.[0].color).toBe("#123456");
  });

  it("fill edit replays a declared follow_fill border (fill write gate)", () => {
    const leaves = [makeAreaLeaf(1, { fillColor: "#111111" })];
    registerDeclared("dpoly5", { mode: "follow_fill" }, leaves);
    applyBorderToLayer(ui, "dpoly5");
    expect(leaves[0].setStyle.mock.calls.at(-1)?.[0].color).toBe("#111111");
    // Change the fill through the FILL write (the single commit path). The
    // border replay must ride it even without a stored border mode; the
    // replay is frame-coalesced, so flush the stroke frame.
    FILL_DIMENSION.write!(ui, "dpoly5", { color: "#abcdef" });
    flushStyleDimApply(FACE.FILL, "dpoly5");
    flushStyleDimApply(FACE.STROKE, "dpoly5");
    expect(leaves[0].setStyle.mock.calls.at(-1)?.[0].color).toBe("#abcdef");
  });

  it("replayDeclaredBorder paints a declared follow_fill border with no stored intent", () => {
    const leaves = [makeAreaLeaf(1, { fillColor: "#123456" })];
    registerDeclared("drep1", { mode: "follow_fill" }, leaves);
    replayDeclaredBorder(ui, "drep1");
    expect(leaves[0].setStyle.mock.calls.at(-1)?.[0].color).toBe("#123456");
  });

  it("replayDeclaredBorder is a no-op once a stored intent exists", () => {
    const leaves = [makeAreaLeaf(1, { fillColor: "#123456" })];
    registerDeclared("drep2", { mode: "follow_fill" }, leaves);
    setIntent(ui, "drep2", "borderStyleMode", "solid");
    setIntent(ui, "drep2", "borderColor", "#abcdef");
    const before = leaves[0].setStyle.mock.calls.length;
    replayDeclaredBorder(ui, "drep2");
    expect(leaves[0].setStyle.mock.calls.length).toBe(before);
  });

  it("replayDeclaredBorder dedupes per layer (paint once)", () => {
    const leaves = [makeAreaLeaf(1, { fillColor: "#123456" })];
    registerDeclared("drep3", { mode: "follow_fill" }, leaves);
    replayDeclaredBorder(ui, "drep3");
    const calls = leaves[0].setStyle.mock.calls.length;
    replayDeclaredBorder(ui, "drep3");
    expect(leaves[0].setStyle.mock.calls.length).toBe(calls);
  });

  // ── declared solid colour + weight ───────────────────────────────────
  // The solid declaration's colour/weight are the border row's read-time
  // defaults, and the attach sweep paints them — no user intent is written.

  it("a declared solid colour and weight are the border row's read-time defaults", () => {
    const leaves = [makeAreaLeaf(1)];
    registerDeclared("dsolid1", { mode: "solid", color: "#FF0000", weight: 5 }, leaves);
    const block = buildBorderRow(ui, "dsolid1") as HTMLElement;
    document.body.appendChild(block);
    expect(selectOf(block)!.value).toBe("solid");
    expect(
      (block.querySelector(".foliplus-style-border-color-input") as HTMLInputElement)
        .value,
    ).toBe("#ff0000");
    expect(
      (block.querySelector(".foliplus-style-border-weight-input") as HTMLInputElement)
        .value,
    ).toBe("5");
    // The dimension readout (what getStyle's snapshot reads) carries the same.
    expect(BORDER_DIMENSION.value!(ui, "dsolid1")).toMatchObject({
      mode: "solid",
      color: "#ff0000",
      weight: 5,
    });
    expect(getIntent(ui, "dsolid1", "borderColor")).toBeUndefined();
    expect(getIntent(ui, "dsolid1", "borderWeight")).toBeUndefined();
  });

  it("replayDeclaredBorder paints a declared solid colour and weight", () => {
    const leaves = [makeAreaLeaf(1)];
    registerDeclared("dsolid2", { mode: "solid", color: "#ff0000", weight: 5 }, leaves);
    replayDeclaredBorder(ui, "dsolid2");
    expect(leaves[0].setStyle.mock.calls.at(-1)?.[0]).toMatchObject({
      color: "#ff0000",
      weight: 5,
    });
  });

  it("a stored colour still beats the declared solid colour", () => {
    const leaves = [makeAreaLeaf(1)];
    registerDeclared("dsolid3", { mode: "solid", color: "#ff0000", weight: 5 }, leaves);
    setIntent(ui, "dsolid3", "borderColor", "#00ff00");
    applyBorderToLayer(ui, "dsolid3");
    expect(leaves[0].setStyle.mock.calls.at(-1)?.[0]).toMatchObject({
      color: "#00ff00",
    });
  });

  it("replayDeclaredBorder shares the per-ui paint set across layers (second layer first paint)", () => {
    // The dedupe set is per-ui, not per-layer: a second declared layer on the
    // SAME ui must paint once too, even though the set already exists (the
    // `if (!painted)` init arm already ran for the first layer). This is the
    // `!painted` false arm of the replay set-up — a real two-layer page, not
    // a defensive guard.
    const leavesA = [makeAreaLeaf(1, { fillColor: "#123456" })];
    const leavesB = [makeAreaLeaf(2, { fillColor: "#654321" })];
    registerDeclared("drepA", { mode: "follow_fill" }, leavesA);
    registerDeclared("drepB", { mode: "follow_fill" }, leavesB);
    replayDeclaredBorder(ui, "drepA");
    expect(leavesA[0].setStyle).toHaveBeenCalled();
    replayDeclaredBorder(ui, "drepB");
    expect(leavesB[0].setStyle).toHaveBeenCalled();
    // The second paint does not re-paint the first layer.
    const aCalls = leavesA[0].setStyle.mock.calls.length;
    replayDeclaredBorder(ui, "drepA");
    expect(leavesA[0].setStyle.mock.calls.length).toBe(aCalls);
  });

  it("replayDeclaredBorder is a no-op on a non-follow_fill layer", () => {
    const leaves = [makeAreaLeaf(1, { fillColor: "#123456" })];
    registerDeclared("drep4", { mode: "solid" }, leaves);
    replayDeclaredBorder(ui, "drep4");
    expect(leaves[0].setStyle).not.toHaveBeenCalled();
  });
  it("replayDeclaredBorder paints a declared value (colormap) border on attach", () => {
    // A declared value border is a read-time default like follow_fill: the
    // attach sweep is the only pass that reaches it, so without a replay arm
    // the map opens on the author's flat stroke and only a style-mode round
    // trip paints the ramp .. The replay must apply the classified
    // stroke, not skip it.
    const leaves = [makeLineLeaf(1), makeLineLeaf(5)];
    registerDeclared(
      "dval1",
      { mode: "value", field: "count", scheme: "Reds" },
      leaves,
    );
    // Registration itself must not paint the border: the ramp reaches the map
    // only through the attach replay, so assert on the delta not the absolute.
    const before = leaves[0].setStyle.mock.calls.length;
    replayDeclaredBorder(ui, "dval1");
    expect(leaves[0].setStyle.mock.calls.length).toBeGreaterThan(before);
    // The classified stroke carries a real colour (the ramp), not the flat
    // author stroke the leaf was created with.
    // The classified stroke carries a real ramp colour, not the flat author
    // stroke the leaf was created with — assert the concrete Reds values
    // (leaf0=#010101, leaf1=#020202) so a solid or no-op paint cannot pass.
    const painted0 = leaves[0].setStyle.mock.calls.at(-1)?.[0] as { color?: string };
    const painted1 = leaves[1].setStyle.mock.calls.at(-1)?.[0] as { color?: string };
    expect(painted0.color).toBe("#010101");
    expect(painted1.color).toBe("#020202");
  });
  it("replayDeclaredBorder paints a declared value border on a CircleMarker (point) at attach", () => {
    // The reported case: a CircleMarker declares a value (colormap) border and
    // the author expects the ramp on the stroke at attach. Point geometry is
    // value-carrying like a line — the border is the marker's own outline and
    // classifies per marker (polygon stays follow-fill-only by contract).
    const leaves = [makeLayerForGeometry("point"), makeLayerForGeometry("point")];
    leaves.forEach((leaf, i) => {
      leaf.feature.properties.count = i + 1;
    });
    registerDeclared(
      "dval_point",
      { mode: "value", field: "count", scheme: "Reds" },
      leaves,
    );
    const before0 = leaves[0].setStyle.mock.calls.length;
    replayDeclaredBorder(ui, "dval_point");
    expect(leaves[0].setStyle.mock.calls.length).toBeGreaterThan(before0);
    // The ramp lands on the stroke, not the flat author colour — assert the
    // concrete Reds scheme values
    // (marker 0=#010101, marker 1=#020202) so a solid or no-op paint cannot pass.
    const painted0 = leaves[0].setStyle.mock.calls.at(-1)?.[0] as { color?: string };
    const painted1 = leaves[1].setStyle.mock.calls.at(-1)?.[0] as { color?: string };
    expect(painted0.color).toBe("#010101");
    expect(painted1.color).toBe("#020202");
  });
  it("a layer registered after the sweep still gets its declared value border", () => {
    // #1285 leg 1: the declared-value attach replay runs once over the layers
    // already in the registry. A CircleMarker layer that lands AFTER that sweep
    // (component first, layer added later -- the late-registration family) must still
    // reach the map with its ramp, either through a content-change replay or a
    // registration-time replay. Before the fix it opened on the author's flat
    // stroke and only a style-mode toggle recovered it.
    const leaves = [makeLayerForGeometry("point"), makeLayerForGeometry("point")];
    leaves.forEach((leaf, i) => {
      leaf.feature.properties.count = i + 1;
    });
    // Register the layer AFTER the one-shot sweep has already run for the
    // initial registry (nothing else registered yet, so the sweep is a no-op).
    ui.applyUserState();
    const before0 = leaves[0].setStyle.mock.calls.length;
    registerDeclared(
      "dval_late",
      { mode: "value", field: "count", scheme: "Reds" },
      leaves,
    );
    // The late layer gets its declared value border through the registration
    // or content-change replay (not left on the author's flat stroke).
    ui.applyUserState("dval_late");
    const painted0 = leaves[0].setStyle.mock.calls.at(-1)?.[0] as { color?: string };
    const painted1 = leaves[1].setStyle.mock.calls.at(-1)?.[0] as { color?: string };
    expect(leaves[0].setStyle.mock.calls.length).toBeGreaterThan(before0);
    expect(painted0.color).toBe("#010101");
    expect(painted1.color).toBe("#020202");
  });
  it("geometryKindOf falls back to the surface answer when the layer is absent", () => {
    // Lines 973-974: when the surface answers UNKNOWN and the layer object is
    // absent from both the registry entry and findLayer, geometryKindOf
    // returns the surface answer (UNKNOWN) rather than throwing.
    const leaves = [makeLayerForGeometry("point")];
    leaves.forEach(leaf => {
      delete leaf.feature;
    });
    manager.registerLayer({
      id: "no_layer_obj",
      name: "no_layer_obj",
      layer: makeFeatureGroup(...leaves),
      fillAuthor: {
        perFeature: true,
        distinct: 1,
        stops: ["#0d0887"],
        scale: { kind: "continuous", column: "count" },
      },
    });
    // Overwrite the registry entry to strip the layer object so the
    // !layer early return fires.
    const li = ui.c.layerRegistry.get("no_layer_obj");
    if (li) (li as any).layer = undefined;
    // buildBorderRow reads geometryKindOf: with the layer object absent it
    // falls through 973-974 and the row still renders a mode select.
    const row = buildBorderRow(ui, "no_layer_obj") as HTMLElement;
    expect(row).not.toBeNull();
  });
  it("borderCarriesValue is true for a CircleMarker the surface reads as unknown", () => {
    // An unenveloped marker (no .feature) makes the surface answer UNKNOWN.
    // geometryKindOf then walks the leaves and infers POINT from the
    // CircleMarker, so a declared value border still carries value on such a
    // layer instead of stepping aside.
    const leaves = [makeLayerForGeometry("point"), makeLayerForGeometry("point")];
    leaves.forEach(leaf => {
      delete leaf.feature;
    });
    registerDeclared(
      "unknown_geom",
      { mode: "value", field: "count", scheme: "Reds" },
      leaves,
    );
    const row = buildBorderRow(ui, "unknown_geom") as HTMLElement;
    document.body.appendChild(row);
    const select = row.querySelector(
      ".foliplus-style-border-mode-select",
    ) as HTMLSelectElement | null;
    // POINT inferred -> by_value is offered, proving the leaf inference ran.
    expect(select).not.toBeNull();
    expect(Array.from(select!.options).map(o => o.value)).toContain("value");
  });
  it("hasBorderProvenance is true from a declaration alone (no intent)", () => {
    // The right arm of hasBorderProvenance: a declared border with no stored
    // intent still counts as provenance, so the attach sweep repaints it.
    const leaves = [makeLayerForGeometry("point"), makeLayerForGeometry("point")];
    registerDeclared(
      "decl_only",
      { mode: "value", field: "count", scheme: "Reds" },
      leaves,
    );
    const before0 = leaves[0].setStyle.mock.calls.length;
    ui.applyUserState("decl_only");
    expect(leaves[0].setStyle.mock.calls.length).toBeGreaterThan(before0);
  });

  it("authorStrokeDisabled treats weight:0 as no outline even with stroke unset", () => {
    // The right arm of the stroke/weight check: weight 0 alone (stroke left at
    // its default) is still "no outline", so the gate holds.
    const leaves = [makeLayerForGeometry("point"), makeLayerForGeometry("point")];
    leaves.forEach((leaf, i) => {
      delete leaf.options.stroke;
      leaf.options.weight = 0;
      leaf.options.color = ["#0d0887", "#7e03a8"][i];
      leaf.options.fillColor = leaf.options.color;
    });
    registerDeclared("w0_nostroke", undefined, leaves);
    ui.c.layerRegistry.get("w0_nostroke")!.fillAuthor = {
      perFeature: true,
      distinct: 2,
      stops: ["#0d0887", "#7e03a8"],
      scale: { kind: "continuous", column: "count" },
    };
    const before0 = leaves[0].setStyle.mock.calls.length;
    ui.applyUserState("w0_nostroke");
    expect(leaves[0].setStyle.mock.calls.length).toBe(before0);
  });

  it("applyUserState attach sweep paints a declared value border on first frame", () => {
    // The reported quickstart: a CircleMarker layer declares foliplus.border
    // value and the map must open on the ramp, not the author's flat stroke.
    // Drive the REAL attach entry (applyUserState with no id = the full sweep)
    // rather than replayDeclaredBorder directly, so the test reproduces the
    // attach ordering and the geometry/materialisation state the sweep sees.
    const leaves = [makeLayerForGeometry("point"), makeLayerForGeometry("point")];
    leaves.forEach((leaf, i) => {
      leaf.feature.properties.count = i + 1;
    });
    registerDeclared(
      "dval_attach",
      { mode: "value", field: "count", scheme: "Reds" },
      leaves,
    );
    // Attach sweep (no id = the full-sweep half): the final stroke on every
    // leaf must be the classified ramp colour, not the author's flat stroke.
    ui.applyUserState();
    const painted0 = leaves[0].setStyle.mock.calls.at(-1)?.[0] as { color?: string };
    const painted1 = leaves[1].setStyle.mock.calls.at(-1)?.[0] as { color?: string };
    expect(painted0.color).toBe("#010101");
    expect(painted1.color).toBe("#020202");
  });
  // declared value (foliplus.border value mode)
  // The declaration is a read-time value default: no stored intent - the
  // border shows and classifies by the author's declared field/config.

  it("declared value drives the display with no stored mode", () => {
    const leaves = [makeLineLeaf(1), makeLineLeaf(5)];
    registerDeclared("dv1", { mode: "value", field: "count", scheme: "Reds" }, leaves);
    const block = buildBorderRow(ui, "dv1") as HTMLElement;
    document.body.appendChild(block);
    const select = selectOf(block)!;
    expect(select.value).toBe("value");
    // The declared config seeds the value detail.
    const field = block.querySelector(
      ".foliplus-style-fill-field-select",
    ) as HTMLSelectElement | null;
    expect(field?.value).toBe("count");
  });

  it("declared value paints the classified stroke on apply", () => {
    const leaves = [makeLineLeaf(1), makeLineLeaf(5)];
    registerDeclared("dv2", { mode: "value", field: "count", scheme: "Reds" }, leaves);
    applyBorderToLayer(ui, "dv2");
    // The border classified by value writes a color intent (the classification
    // resolves a concrete stroke) and paints it.
    expect(getIntent(ui, "dv2", "borderStyleMode")).toBeUndefined();
    expect(leaves[0].setStyle).toHaveBeenCalled();
  });

  it("declared value is inapplicable on a polygon (outline never classifies)", () => {
    // polygon area leaves carry the border only as the outline: the value mode
    // steps aside on a channel that cannot paint it, like a stored value.
    const leaves = [makeAreaLeaf(1), makeAreaLeaf(5)];
    registerDeclared("dv3", { mode: "value", field: "count", scheme: "Reds" }, leaves);
    const block = buildBorderRow(ui, "dv3") as HTMLElement;
    document.body.appendChild(block);
    const select = selectOf(block);
    // value is not a mode option on a polygon border (only original+solid).
    expect(Array.from(select!.options).map(o => o.value)).not.toContain("value");
  });

  it("per-feature solid with no intent: the engine passes the derived author base (435 base arm)", () => {
    // Line 435 `base ?? solidColorOf`: the base (left) side is the missing
    // branch. It is reached only when a per-feature layer derives a base AND
    // the engine passes it — i.e. needsDerivation=true and no colour intent,
    // so deriveSolidBase=true and the engine's authorFace("color") supplies a
    // concrete base. A uniform layer would have base=undefined (solidColorOf
    // side); a per-feature layer whose author paints per feature is the state
    // that makes the engine pass a base at all.
    const leaves = [
      makeAreaLeaf(1, { color: "#0a0b0c" }),
      makeAreaLeaf(5, { color: "#0d0e0f" }),
    ];
    installLeafletGlobals();
    manager.registerLayer({
      id: "pf_solid",
      name: "pf_solid",
      layer: makeFeatureGroup(...leaves),
      fillAuthor: {
        perFeature: true,
        distinct: 2,
        stops: ["#0a0b0c", "#0d0e0f"],
        scale: { kind: "continuous", column: "count" },
      },
    });
    // No borderStyleMode / borderColor / borderWeight intent: the mode
    // resolves to SOLID (no value), needsDerivation=true, so the engine
    // derives base=authorFace("color")=the first leaf's author stroke.
    applyBorderToLayer(ui, "pf_solid");
    // The walk wrote the derived base onto the leaves (the solid arm's
    // contract — the base is the single solid colour for a per-feature layer
    // with no user override). Both leaves receive the base, not their own
    // per-leaf author colours (that is the ORIGINAL mode's job).
    expect(leaves[0].setStyle).toHaveBeenCalled();
    expect(leaves[1].setStyle).toHaveBeenCalled();
    expect(leaves[0].options.color).toBe("#0a0b0c");
    expect(leaves[1].options.color).toBe("#0a0b0c");
  });

  it("per-feature solid with no authored colour: the engine's undefined base falls back to solidColorOf (435 right arm)", () => {
    // Block 26 of line 435 `base ?? solidColorOf`: the RIGHT side is reached
    // when deriveSolidBase=true (per-feature layer) but the engine passes
    // base=undefined. The engine derives base=authorFace("color"), which is
    // undefined when the first style leaf carries no authored colour — the
    // fallback then reads the shared solidColorOf (defaults applied inside).
    const leaves = [
      makeAreaLeaf(1, { color: undefined }),
      makeAreaLeaf(5, { color: undefined }),
    ];
    installLeafletGlobals();
    manager.registerLayer({
      id: "pf_nocolor",
      name: "pf_nocolor",
      layer: makeFeatureGroup(...leaves),
      fillAuthor: {
        perFeature: true,
        distinct: 2,
        stops: ["#0a0b0c", "#0d0e0f"],
        scale: { kind: "continuous", column: "count" },
      },
    });
    // No intent: mode resolves to SOLID, needsDerivation=true, but the engine's
    // authorFace returns undefined -> base=undefined -> solidColorOf supplies
    // the face default (Leaflet's "#3388ff").
    applyBorderToLayer(ui, "pf_nocolor");
    expect(leaves[0].setStyle).toHaveBeenCalled();
    expect(leaves[0].options.color).toBe("#3388ff");
    expect(leaves[1].options.color).toBe("#3388ff");
  });
});
