import { describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import {
  ATTRS_ROW_WRAP_CHARS,
  applyNameProjection,
  formatTimestamp,
  isKeyboardVisibleFocus,
  owningRow,
} from "#foliplus/LayerControl/ui/context.js";
import type { LayerInfo } from "#foliplus/core/layer/index.js";

describe("ui/context", () => {
  it("owningRow resolves a child control to its layer row", () => {
    const row = document.createElement("div");
    row.className = CONST.CLASSES.LAYER_ITEM;
    const child = document.createElement("input");
    row.appendChild(child);
    document.body.appendChild(row);
    expect(owningRow(child)).toBe(row);
    expect(owningRow(document.body)).toBeNull();
    row.remove();
  });

  it("isKeyboardVisibleFocus is false in jsdom (no :focus-visible)", () => {
    const el = document.createElement("button");
    expect(isKeyboardVisibleFocus(el)).toBe(false);
  });

  it("formatTimestamp renders epoch ms in the browser timezone", () => {
    const ms = Date.UTC(2026, 8, 12, 6, 5, 0);
    const out = formatTimestamp(ms);
    expect(out).toContain("2026");
    expect(out).not.toBe("");
  });

  it("formatTimestamp returns empty string for unparsable input", () => {
    expect(formatTimestamp("not-a-date")).toBe("");
    expect(formatTimestamp(NaN)).toBe("");
  });

  it("ATTRS_ROW_WRAP_CHARS is a positive width threshold", () => {
    expect(ATTRS_ROW_WRAP_CHARS).toBeGreaterThan(0);
  });

  it("applyNameProjection writes the name onto layerInfo when it differs", () => {
    const layerInfo = { id: "a", name: "old" } as LayerInfo;
    applyNameProjection(layerInfo, null, "new");
    expect(layerInfo.name).toBe("new");
  });

  it("applyNameProjection skips the write when the name already matches", () => {
    const layerInfo = { id: "a", name: "same" } as LayerInfo;
    applyNameProjection(layerInfo, null, "same");
    expect(layerInfo.name).toBe("same");
  });

  it("applyNameProjection is a no-op when both layerInfo and item are missing", () => {
    expect(() => applyNameProjection(null, null, "x")).not.toThrow();
  });
});
