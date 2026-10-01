// FocusStore — cross-layer focus transient state defaults.
import { describe, expect, it } from "vitest";
import { FocusStore } from "#foliplus/LayerControl/ui/focusStore.js";

describe("FocusStore defaults", () => {
  it("starts with no focus in progress", () => {
    const fs = new FocusStore();
    expect(fs.focusRect).toBeNull();
    expect(fs.focusingLayerId).toBeNull();
    expect(fs.onFocusMapMove).toBeNull();
    expect(fs.focusMask).toBeNull();
    expect(fs.focusRenderer).toBeNull();
    expect(fs.focusedPaneRestores).toEqual([]);
  });
});
