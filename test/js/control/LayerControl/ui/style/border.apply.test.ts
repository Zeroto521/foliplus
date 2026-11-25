// test/js/control/LayerControl/ui/style/border.apply — applyBorderToLayer and the row builder.
import { initFixture } from "../fixture.js";
import {
  commitBorderNow,
  countRamp,
  installChroma,
  makeFeatureLeaf,
  makeGeoJsonGroup,
  makeHighlightLeaf,
  makeLeaf,
  registerFeatureLayer,
} from "./border.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import {
  clearIntent,
  getIntent,
  seedIntentMap,
  setIntent,
} from "#control/LayerControl/ui/intent.js";
import {
  applyBorderToLayer,
  authoredBorder,
  bindBorderRow,
  buildBorderRow,
  commitBorderColor,
  commitBorderWeight,
} from "#control/LayerControl/ui/style/border.js";
import { FACE, flushStyleDimApply } from "#control/LayerControl/ui/style/styleBag.js";

describe("applyBorderToLayer", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = {};
    seedIntentMap(ui, "visible", {});
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("writes the stored stroke onto the layer's leaves", () => {
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    setIntent(ui, "vec1", "borderColor", "#0000ff");
    setIntent(ui, "vec1", "borderWeight", 6);

    applyBorderToLayer(ui, "vec1");

    expect(leaf.setStyle).toHaveBeenCalledWith({
      color: "#0000ff",
      weight: 6,
      stroke: true,
    });
  });

  it("writes only the named layer, never a neighbor's stored stroke", () => {
    const a = makeLeaf();
    const b = makeLeaf();
    manager.registerLayer({ id: "vecA", name: "A", layer: a });
    manager.registerLayer({ id: "vecB", name: "B", layer: b });
    setIntent(ui, "vecA", "borderColor", "#0000ff");
    setIntent(ui, "vecB", "borderColor", "#00ff00");

    applyBorderToLayer(ui, "vecA");

    expect(a.setStyle).toHaveBeenCalledTimes(1);
    expect(b.setStyle).not.toHaveBeenCalled();
  });

  it("is a no-op with no stored value", () => {
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    applyBorderToLayer(ui, "vec1");

    expect(leaf.setStyle).not.toHaveBeenCalled();
  });

  it("is a no-op for an id with no registry entry", () => {
    setIntent(ui, "ghost", "borderColor", "#0000ff");

    expect(() => applyBorderToLayer(ui, "ghost")).not.toThrow();
  });

  it("the applyUserState sweep writes only user-set provenance keys, so a stored value with no record is not replayed", () => {
    const recorded = makeLeaf();
    const orphan = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: recorded });
    manager.registerLayer({ id: "vec2", name: "W", layer: orphan });
    setIntent(ui, "vec1", "borderColor", "#0000ff");
    setIntent(ui, "vec2", "borderColor", "#00ff00");
    ui.intentStore.seedProvenance("vec1", ["borderColor"]);
    // vec2 holds a stored value that never went through markOverride — the
    // drift the single enumeration source exists to ignore. Enumerating the
    // maps instead of the provenance axis would replay it while fill stayed put.

    ui.applyUserState();

    expect(recorded.setStyle).toHaveBeenCalledWith({
      color: "#0000ff",
      stroke: true,
    });
    expect(orphan.setStyle).not.toHaveBeenCalled();
  });

  it("restores the author's stroke when ORIGINAL mode has no override but the bag was captured", () => {
    // Line 364: ORIGINAL mode owns no user colour — the colour override is
    // treated as absent, and the walk restores each leaf's captured author
    // face. A leaf that was committed before (bag captured) must be restored,
    // not skipped.
    const leaf = makeHighlightLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    // Commit a colour first so the style bag captures the author face.
    commitBorderNow(ui, "vec1", "color", "#abcdef");
    // Now switch to ORIGINAL and clear the override: no user colour/weight in
    // force, but the bag exists, so restoreStyleDim must run.
    setIntent(ui, "vec1", "borderStyleMode", "original");
    clearIntent(ui, "vec1", "borderColor");
    clearIntent(ui, "vec1", "borderWeight");
    leaf.setStyle.mockClear();

    applyBorderToLayer(ui, "vec1");

    // The author's green face was restored (not the user's #abcdef).
    expect(leaf.setStyle).toHaveBeenCalled();
    expect(leaf.options.color).toBe("#00ff00");
  });

  it("shows the stored colour as SOLID when no mode is stored", () => {
    // Line 643: pre-mode record shape — a stored colour without a mode means
    // the user already painted the solid mode, so displayBorderMode must
    // resolve to SOLID rather than ORIGINAL (which would hide the user's
    // colour behind the author's).
    const leaf = makeLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    setIntent(ui, "vec1", "borderColor", "#ff0000");
    // No borderStyleMode intent.

    const row = buildBorderRow(ui, "vec1");
    const swatch = row.querySelector(
      ".foliplus-style-border-color-input",
    ) as HTMLInputElement;
    expect(swatch.value).toBe("#ff0000");
  });

  it("resolves the live stroke config through the value mode's callbacks", () => {
    // Lines 331-333: the value mode derives live config closures (resolveStored,
    // effectiveBorderValue, effectiveBorderMode) so the pin's getter agrees
    // with the paint. Exercise them through a real value-mode apply.
    installChroma(["#111111", "#222222", "#333333"]);
    const leaf = makeFeatureLeaf(5);
    registerFeatureLayer(manager, ui, "vec1", [leaf]);
    setIntent(ui, "vec1", "borderValue", countRamp());
    setIntent(ui, "vec1", "borderStyleMode", "value");

    applyBorderToLayer(ui, "vec1");

    const strokeCall = leaf.setStyle.mock.calls.at(-1)?.[0];
    expect(strokeCall).toMatchObject({ stroke: true });
    expect(typeof strokeCall.color).toBe("string");

    // Fire the highlight pin's mouseout replay: this runs the value mode's
    // live-config closures (resolveStored, effectiveBorderValue,
    // effectiveBorderMode) so the replay agrees with the paint.
    const mouseout = (leaf.on as any).mock.calls.find(
      ([evt]: [string]) => evt === "mouseout",
    )?.[1];
    expect(mouseout).toBeDefined();
    leaf.setStyle.mockClear();
    mouseout();
    const replayCall = leaf.setStyle.mock.calls.at(-1)?.[0];
    expect(replayCall).toMatchObject({ stroke: true });
    expect(typeof replayCall.color).toBe("string");
  });
  it("restores the author's stroke colour when ORIGINAL still owns a weight", () => {
    // The restore path #953 left fragile: a solid → ORIGINAL round-trip keeps
    // the user's weight (weight rides both modes), but the walk used to write
    // only { weight } back to the leaf — a real Leaflet setStyle merges, so the
    // solid colour stayed painted under the author's stroke. The row showed the
    // author's green while the map drew the user's red. The merged arm pulls
    // the author's stroke keys back in the same payload, so the colour reverts
    // with the weight kept.
    const leaf = makeHighlightLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    // Solid: commit a user colour and weight.
    setIntent(ui, "vec1", "borderStyleMode", "solid");
    commitBorderColor(ui, "vec1", "#ff0000");
    commitBorderWeight(ui, "vec1", 6);
    flushStyleDimApply(FACE.STROKE, "vec1");
    expect(leaf.options).toMatchObject({ color: "#ff0000", weight: 6 });

    // Back to ORIGINAL: the colour must revert to the author's, the weight
    // (still user-owned) stays.
    setIntent(ui, "vec1", "borderStyleMode", "original");
    applyBorderToLayer(ui, "vec1");

    expect(leaf.options.color).toBe("#00ff00");
    expect(leaf.options.weight).toBe(6);
    expect(leaf.options.stroke).toBe(true);
    // The merged write carries both author colour and user weight in one
    // payload — one setStyle per leaf, no restore-then-commit doubling.
    expect(leaf.setStyle).toHaveBeenLastCalledWith({
      color: "#00ff00",
      weight: 6,
      stroke: true,
    });
  });

  it("writes only the weight when SOLID has no colour yet — no author pull", () => {
    // The merged arm is ORIGINAL-only. In SOLID with just a weight, the walk
    // keeps the minimal contract (value keys + stroke bit); pulling the author
    // colour would repaint the author's stroke over a solid colour the user
    // has not yet chosen.
    const leaf = makeHighlightLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    setIntent(ui, "vec1", "borderStyleMode", "solid");
    commitBorderWeight(ui, "vec1", 6);
    flushStyleDimApply(FACE.STROKE, "vec1");

    expect(leaf.setStyle).toHaveBeenLastCalledWith({ weight: 6, stroke: true });
    expect(leaf.options.color).toBe("#00ff00");
  });
});

describe("buildBorderRow", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = {};
    seedIntentMap(ui, "visible", {});
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders one row with a swatch and a bounded width field", () => {
    const leaf = makeLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    // Editable colour: the border row is read-only in ORIGINAL mode (the
    // author's own stroke); a stored "solid" mode is what makes it a picker.
    setIntent(ui, "vec1", "borderStyleMode", "solid");

    const row = buildBorderRow(ui, "vec1");

    expect(row.classList.contains("foliplus-style-border-block")).toBe(true);
    expect(row.getAttribute("data-style-dim")).toBe("border");
    expect(row.textContent).toContain("LayerControl.border");

    const swatch = row.querySelector(
      ".foliplus-style-border-color-input",
    ) as HTMLInputElement;
    expect(swatch.type).toBe("color");
    expect(swatch.value).toBe("#00ff00");
    expect(swatch.getAttribute("aria-label")).toBe("LayerControl.style_border_color");

    const width = row.querySelector(
      ".foliplus-style-border-weight-input",
    ) as HTMLInputElement;
    expect(width.type).toBe("number");
    expect(width.value).toBe("3");
    expect(width.min).toBe("0");
    expect(width.max).toBe("10");
    expect(width.step).toBe("0.5");
    expect(width.getAttribute("aria-label")).toBe(
      "LayerControl.style_border_weight (foliplus.unit_px)",
    );
  });

  it("shows the stored choice over the authored value", () => {
    const leaf = makeLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    // Editable colour: the border row is read-only in ORIGINAL mode (the
    // author's own stroke); a stored "solid" mode is what makes it a picker.
    setIntent(ui, "vec1", "borderStyleMode", "solid");
    setIntent(ui, "vec1", "borderColor", "#ff0000");
    setIntent(ui, "vec1", "borderWeight", 5.5);

    const row = buildBorderRow(ui, "vec1");

    expect(
      (row.querySelector(".foliplus-style-border-color-input") as HTMLInputElement)
        .value,
    ).toBe("#ff0000");
    expect(
      (row.querySelector(".foliplus-style-border-weight-input") as HTMLInputElement)
        .value,
    ).toBe("5.5");
  });

  it("shows normalised 6-digit hex when the author declared a short form", () => {
    manager.registerLayer({ id: "vec1", name: "V", layer: makeLeaf("#f00", 2) });
    // Editable colour: the border row is read-only in ORIGINAL mode (the
    // author's own stroke); a stored "solid" mode is what makes it a picker.
    setIntent(ui, "vec1", "borderStyleMode", "solid");

    const row = buildBorderRow(ui, "vec1");

    expect(
      (row.querySelector(".foliplus-style-border-color-input") as HTMLInputElement)
        .value,
    ).toBe("#ff0000");
  });

  it("hands the swatch hex for a named color, not the name itself", () => {
    // The color input's value is only defined for #rrggbb, so a name must
    // reach the field resolved, not as the name. The resolver works through
    // the browser, so there is no name-to-hex table to keep in step with the
    // spec. The authored value is untouched: the map and a Reset keep the
    // name, and only the display boundary normalizes.
    manager.registerLayer({
      id: "geo1",
      name: "G",
      layer: makeGeoJsonGroup(makeLeaf("gray", 1.5), makeLeaf("#e74c3c", 6)),
    });

    // Editable colour: the border row is read-only in ORIGINAL mode (the
    // author's own stroke); a stored "solid" mode is what makes it a picker.
    setIntent(ui, "geo1", "borderStyleMode", "solid");
    const row = buildBorderRow(ui, "geo1");

    expect(
      (row.querySelector(".foliplus-style-border-color-input") as HTMLInputElement)
        .value,
    ).toBe("#808080");
  });

  it("hands the swatch hex for a functional color too", () => {
    // The author may declare a stroke in any CSS form, not only a name or a
    // hex literal — a function color resolves through the same path rather
    // than through a hand-kept name-to-hex table.
    manager.registerLayer({
      id: "vec1",
      name: "V",
      layer: makeLeaf("hsl(120, 100%, 50%)", 2),
    });

    // Editable colour: the border row is read-only in ORIGINAL mode (the
    // author's own stroke); a stored "solid" mode is what makes it a picker.
    setIntent(ui, "vec1", "borderStyleMode", "solid");
    const row = buildBorderRow(ui, "vec1");

    expect(
      (row.querySelector(".foliplus-style-border-color-input") as HTMLInputElement)
        .value,
    ).toBe("#00ff00");
  });

  it("leaves an unpaintable declaration unchanged and preserves it", () => {
    // A value no engine resolves to a color must reach the field as declared,
    // not as a hex we invented: fabricating one would claim a stroke the
    // author never wrote and the layer is not said to paint. The authored
    // value stays intact, and the control is left to show its own default.
    manager.registerLayer({
      id: "vec1",
      name: "V",
      layer: makeLeaf("notacolor", 2),
    });

    // Editable colour: the border row is read-only in ORIGINAL mode (the
    // author's own stroke); a stored "solid" mode is what makes it a picker.
    setIntent(ui, "vec1", "borderStyleMode", "solid");
    const row = buildBorderRow(ui, "vec1");

    expect(authoredBorder(ui, "vec1").color).toBe("notacolor");
    expect(
      (row.querySelector(".foliplus-style-border-color-input") as HTMLInputElement)
        .value,
    ).toBe("#000000");
  });

  it("passes a Color 4 stroke through unresolved and lets the field show its default", () => {
    // Measured in this engine: oklch/lab/lch/color are legal CSS, so the probe
    // accepts them into style.color, but getComputedStyle reports them
    // unnormalized and never as rgb(). The rgb parse therefore finds no
    // channel, the authored declaration is preserved, and the color input is
    // left to its own default rather than to a hex we invented.
    manager.registerLayer({
      id: "vec1",
      name: "V",
      layer: makeLeaf("oklch(0.5 0.1 100)", 2),
    });

    // Editable colour: the border row is read-only in ORIGINAL mode (the
    // author's own stroke); a stored "solid" mode is what makes it a picker.
    setIntent(ui, "vec1", "borderStyleMode", "solid");
    const row = buildBorderRow(ui, "vec1");

    expect(authoredBorder(ui, "vec1").color).toBe("oklch(0.5 0.1 100)");
    expect(
      (row.querySelector(".foliplus-style-border-color-input") as HTMLInputElement)
        .value,
    ).toBe("#000000");
  });

  it("shows the author's feature style for an L.GeoJSON layer, not the defaults", () => {
    // The reported symptom: folium GeoJson layers opened the panel showing
    // the Leaflet defaults instead of the style the layer was painting,
    // because the group's empty options were read as the author's stroke.
    manager.registerLayer({
      id: "geo1",
      name: "G",
      layer: makeGeoJsonGroup(makeLeaf("#e74c3c", 6), makeLeaf("gray", 1.5)),
    });

    // Editable colour: the border row is read-only in ORIGINAL mode (the
    // author's own stroke); a stored "solid" mode is what makes it a picker.
    setIntent(ui, "geo1", "borderStyleMode", "solid");
    const row = buildBorderRow(ui, "geo1");

    expect(
      (row.querySelector(".foliplus-style-border-color-input") as HTMLInputElement)
        .value,
    ).toBe("#e74c3c");
    expect(
      (row.querySelector(".foliplus-style-border-weight-input") as HTMLInputElement)
        .value,
    ).toBe("6");
  });

  it("renders the border colour read-only in ORIGINAL mode", () => {
    // The author's own stroke is not the user's to change: only switching the
    // mode to "solid" hands the colour to the picker. This is the reported
    // symptom (a red swatch opened a picker while Border Mode = Original).
    const leaf = makeLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    const row = buildBorderRow(ui, "vec1");

    // Same colour control as the single-color mode — a real swatch input, so
    // the ORIGINAL row stays pixel-identical to SINGLE — only inert: it must
    // not open a picker or accept an edit.
    const readOnly = row.querySelector(
      ".foliplus-style-border-color-input",
    ) as HTMLInputElement | null;
    expect(readOnly).not.toBeNull();
    expect(readOnly?.tagName).toBe("INPUT");
    expect(readOnly?.disabled).toBe(true);
    expect(readOnly?.readOnly).toBe(true);
    // The shared no-edit class is present so the unified hover rule in
    // common/input.css excludes it — a disabled border swatch carries no
    // hover/focus hint, same channel as the fill original mode's read-only box.
    expect(readOnly?.classList.contains("foliplus-readonly")).toBe(true);
    // The weight stays editable: it is a user-facing stroke attribute.
    const weight = row.querySelector(
      ".foliplus-style-border-weight-input",
    ) as HTMLInputElement | null;
    expect(weight).not.toBeNull();
    expect(weight?.disabled).toBe(false);
  });

  it("does not write a colour when the read-only swatch is pressed", () => {
    const leaf = makeLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });

    const row = buildBorderRow(ui, "vec1");
    bindBorderRow(ui, "vec1", row);

    const readOnly = row.querySelector(
      ".foliplus-style-border-color-input",
    ) as HTMLInputElement;
    readOnly.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(getIntent(ui, "vec1", "borderColor")).toBeUndefined();
    expect(ui.intentStore.isUserSet("vec1", "borderColor")).toBe(false);
    expect(leaf.setStyle).not.toHaveBeenCalled();
  });

  it("shows the author's stroke again after a solid → original round-trip", () => {
    // The reported bug: set a color in the single-color (solid) mode, switch
    // back to ORIGINAL, and the row showed the user's color instead of the
    // author's. ORIGINAL owns no user color — the row must read the author
    // face, never INTENT.BORDER_COLOR (which stays stored for the return to
    // solid).
    const leaf = makeLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    setIntent(ui, "vec1", "borderStyleMode", "solid");
    setIntent(ui, "vec1", "borderColor", "#ff0000");

    // Switch to ORIGINAL: the row rebuilds and must show the author's green,
    // not the user's red.
    setIntent(ui, "vec1", "borderStyleMode", "original");
    const row = buildBorderRow(ui, "vec1");
    const swatch = row.querySelector(
      ".foliplus-style-border-color-input",
    ) as HTMLInputElement;
    expect(swatch.value).toBe("#00ff00");
    // The row is inert: no picker, no edit.
    expect(swatch.disabled).toBe(true);
    expect(swatch.readOnly).toBe(true);
    // The intent stays stored: returning to solid hands the user's color back.
    expect(getIntent(ui, "vec1", "borderColor")).toBe("#ff0000");
  });
});
