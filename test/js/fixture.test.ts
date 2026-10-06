// Completeness + isolation gates: the shared fixture must cover the failure
// modes that two prior incidents (a missing `bindPopup` on marker mocks, a
// missing state field on LayerUI) exposed, and the global beforeEach(resetState) must keep
// localStorage clean across tests. Every field on `LayerUI` and every
// constructor on `window.L` that production code touches is exercised here so
// a new field landing in production code produces a loud test failure instead
// of a silent crash a dozen tests downstream.
import { describe, expect, it } from "vitest";
import { LayerRuntimeStore } from "#core/layer/index.js";
import { LayerIntentStore } from "#foliplus/LayerControl/domain/index.js";
import { makeLayerUIMock } from "./fixture.js";

describe("window.L marker mock", () => {
  it("every marker instance exposes bindPopup (the missing-bindPopup incident)", () => {
    const marker = window.L.marker!();
    expect(typeof marker.bindPopup).toBe("function");
    expect(typeof marker.openPopup).toBe("function");
    expect(typeof marker.addTo).toBe("function");
    expect(typeof marker.on).toBe("function");
  });
});

describe("makeLayerUIMock — LayerUI field completeness", () => {
  it("covers every field the LayerUI constructor initialises", () => {
    const ui = makeLayerUIMock() as Record<string, unknown>;
    // Sets
    expect(ui.listPanel.foldedGroups).toBeInstanceOf(Set);
    // Intent store (values + provenance axes)
    expect(ui.intentStore).toBeInstanceOf(LayerIntentStore);
    expect((ui.intentStore as LayerIntentStore).dumpIntents()).toEqual({});
    expect((ui.intentStore as LayerIntentStore).dumpProvenance()).toEqual({});
    // Maps
    expect(ui.runtimeStore).toBeInstanceOf(LayerRuntimeStore);
    expect(ui.runtimeStore.ids()).toEqual([]);
    // Records
    expect(ui.renamedNames).toEqual({});
    // Primitives with sensible defaults
    expect(ui.currentColor).toBe("#cccccc");
    expect(ui.listPanel.lastDragHintAt).toBe(0);
    expect(ui.listPanel.pressInPanel).toBe(false);
    // Null pointers
    expect(ui.overlayPanel.activeRenameId).toBeNull();
    expect(ui.listPanel.dragIdx).toBeNull();
    expect(ui.listPanel.activeIdx).toBeNull();
    expect(ui.listPanel.listCursor).toBeNull();
    expect(ui.focusController.focusRect).toBeNull();
    expect(ui.focusController.focusingLayerId).toBeNull();
    expect(ui.overlayPanel.stylePanelLayerId).toBeNull();
    // Arrays
    expect(ui.focusController.focusedPaneRestores).toEqual([]);
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
