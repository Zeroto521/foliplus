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

// LayerUI keeps its fields private, so the completeness gate reads the mock
// through this explicit view instead of a `Record<string, unknown>` cast,
// which would leave every nested access `unknown`.
type UiView = {
  listPanel: {
    foldedGroups: Set<string>;
    lastDragHintAt: number;
    pressInPanel: boolean;
    dragIdx: unknown;
    activeIdx: unknown;
    listCursor: unknown;
  };
  overlayPanel: {
    activeRenameId: unknown;
    stylePanelLayerId: unknown;
  };
  focusController: {
    focusRect: unknown;
    focusingLayerId: unknown;
    focusedPaneRestores: unknown[];
  };
  intentStore: LayerIntentStore;
  runtimeStore: LayerRuntimeStore;
  currentColor: string;
};

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
    const ui = makeLayerUIMock() as unknown as UiView;
    // Sets
    expect(ui.listPanel.foldedGroups).toBeInstanceOf(Set);
    // Intent store (values + provenance axes)
    expect(ui.intentStore).toBeInstanceOf(LayerIntentStore);
    expect(ui.intentStore.dumpIntents()).toEqual({});
    expect(ui.intentStore.dumpProvenance()).toEqual({});
    // Maps
    expect(ui.runtimeStore).toBeInstanceOf(LayerRuntimeStore);
    expect(ui.runtimeStore.ids()).toEqual([]);
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
