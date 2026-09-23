// Completeness + isolation gates: the shared fixture must cover the failure
// modes that the two prior incidents (T85's missing `bindPopup`, T38's missing
// `rangeHiddenIds`) exposed, and the global beforeEach(resetState) must keep
// localStorage clean across tests. Every field on `LayerUI` and every
// constructor on `window.L` that production code touches is exercised here so
// a new field landing in production code produces a loud test failure instead
// of a silent crash a dozen tests downstream.
import { beforeEach, describe, expect, it } from "vitest";
import { makeLayerUIMock } from "./fixture.js";

describe("window.L marker mock", () => {
  it("every marker instance exposes bindPopup (the T85 incident)", () => {
    const marker = window.L.marker!();
    expect(typeof marker.bindPopup).toBe("function");
    expect(typeof marker.openPopup).toBe("function");
    expect(typeof marker.addTo).toBe("function");
    expect(typeof marker.on).toBe("function");
  });
});

describe("makeLayerUIMock — LayerUI field completeness", () => {
  it("exposes rangeHiddenIds as a Set with a working .delete (the T38 incident)", () => {
    const ui = makeLayerUIMock();
    expect(ui.rangeHiddenIds).toBeDefined();
    expect(typeof ui.rangeHiddenIds.delete).toBe("function");
  });

  it("covers every field the LayerUI constructor initialises", () => {
    const ui = makeLayerUIMock() as Record<string, unknown>;
    // Sets
    expect(ui.foldedGroups).toBeInstanceOf(Set);
    expect(ui.hiddenIds).toBeInstanceOf(Set);
    expect(ui.rangeHiddenIds).toBeInstanceOf(Set);
    // Maps
    expect(ui.authorVisible).toBeInstanceOf(Map);
    expect(ui.fieldCache).toBeInstanceOf(Map);
    // Records
    expect(ui.userOverrides).toEqual({});
    expect(ui.renamedNames).toEqual({});
    expect(ui.opacityMap).toEqual({});
    expect(ui.zoomRangeMap).toEqual({});
    expect(ui.labelConfigs).toEqual({});
    // Primitives with sensible defaults
    expect(ui.isColorActive).toBe(false);
    expect(ui.currentColor).toBe("#cccccc");
    expect(ui.lastDragHintAt).toBe(0);
    expect(ui.pressInPanel).toBe(false);
    // Null pointers
    expect(ui.activeRenameId).toBeNull();
    expect(ui.dragIdx).toBeNull();
    expect(ui.activeIdx).toBeNull();
    expect(ui.listCursor).toBeNull();
    expect(ui.focusRect).toBeNull();
    expect(ui.focusingLayerId).toBeNull();
    expect(ui.stylePanelLayerId).toBeNull();
    // Arrays
    expect(ui.focusedPaneRestores).toEqual([]);
    // m getter alias for manager
    (ui as any).manager = { foo: 1 };
    expect((ui as any).m.foo).toBe(1);
  });
});

describe("test isolation — localStorage does not leak across tests", () => {
  it("test A writes a value to localStorage", () => {
    window.localStorage.setItem("isol-test-key", "leaked-from-A");
  });

  it("test B sees no residue from test A (global beforeEach cleared it)", () => {
    expect(window.localStorage.getItem("isol-test-key")).toBeNull();
  });
});
