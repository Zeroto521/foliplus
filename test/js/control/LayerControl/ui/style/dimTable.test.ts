// dimTable — single-source structural table guard.
//
// The table is the one place that says "what style dimensions exist, in
// which panel role, read from which capability slot". These tests lock it
// against the two other consumers that used to hand-copy the same facts:
// the registry display orders and the delegated drawer's row list.
import { describe, expect, it } from "vitest";
import { DIM } from "#core/layer/index.js";
import {
  DELEGATED_DIM_ORDER,
  STYLE_DIM_TABLE,
  dimsInRole,
} from "#control/LayerControl/ui/style/dimTable.js";
import {
  DIM_ORDER,
  LABEL_DIM_ORDER,
} from "#control/LayerControl/ui/style/registry.js";
import { DELEGATED_DIM_ORDER as REGISTRY_DELEGATED } from "#control/LayerControl/ui/style/delegated.js";

describe("STYLE_DIM_TABLE structural facts", () => {
  it("lists exactly the nine built-in style dims, once each", () => {
    expect(STYLE_DIM_TABLE.length).toBe(9);
    const keys = STYLE_DIM_TABLE.map(d => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers the known dim vocabulary (no key drift)", () => {
    const keys = STYLE_DIM_TABLE.map(d => d.key).sort();
    expect(keys).toEqual([
      DIM.BORDER,
      DIM.FILL,
      DIM.ICON,
      DIM.ICON_COLOR,
      DIM.LABEL,
      DIM.MARKER_COLOR,
      DIM.OPACITY,
      DIM.SIZE,
      DIM.ZOOM_RANGE,
    ].sort());
  });

  it("every capSlot is a real LayerCapabilities key (compile-time + runtime)", () => {
    // The capSlot string must be a property on LayerCapabilities; the type
    // is keyof LayerCapabilities, but a runtime guard catches a table row
    // whose slot got renamed in the interface without the table following.
    const knownSlots = new Set([
      "fill", "stroke", "size", "icon", "iconColor", "markerColor",
      "opacity", "zoomRange", "visibility", "label", "relocatable", "bounds",
    ]);
    for (const spec of STYLE_DIM_TABLE) {
      expect(knownSlots.has(spec.capSlot), `unknown capSlot "${spec.capSlot}"`).toBe(true);
    }
  });

  it("section role matches the registry display orders", () => {
    expect(dimsInRole("layer")).toEqual(DIM_ORDER);
    expect(dimsInRole("label")).toEqual(LABEL_DIM_ORDER);
  });

  it("delegated drawer order matches the table's LayerControl-owned rows", () => {
    const expected = dimsInRole("layer").filter(
      key => !STYLE_DIM_TABLE.find(d => d.key === key)?.delegatedOwned,
    );
    expect(DELEGATED_DIM_ORDER).toEqual(expected);
    expect(REGISTRY_DELEGATED).toEqual(DELEGATED_DIM_ORDER);
  });

  it("the delegated drawer keeps only opacity and zoomRange today", () => {
    // Pins the current delegation contract: the six component-write dims
    // (fill/border/size/icon/iconColor/markerColor) are excluded; only the
    // LayerControl-owned opacity and zoomRange ride the delegated sweep.
    expect(DELEGATED_DIM_ORDER).toEqual([DIM.OPACITY, DIM.ZOOM_RANGE]);
  });
});
