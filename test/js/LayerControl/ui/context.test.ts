import { describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import {
  ATTRS_ROW_WRAP_CHARS,
  formatTimestamp,
  isKeyboardVisibleFocus,
  owningRow,
} from "#foliplus/LayerControl/ui/context.js";

describe("ui/context helpers", () => {
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
});
