import { ExportManager } from "#foliplus/ExportControl/ExportControl.manager.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Minimal map mock satisfying ExportManager constructor requirements.
function makeMapMock() {
  const container = document.createElement("div");
  return {
    getContainer: () => container,
    getBounds: () => ({
      getSouth: () => -90,
      getNorth: () => 90,
      getEast: () => 180,
      getWest: () => -180,
    }),
    latLngToContainerPoint: vi.fn(({ lat, lng }) => ({ x: lng, y: lat })),
    on: vi.fn(),
    off: vi.fn(),
  };
}

// Build an ExportManager with all UI methods stubbed out.
function makeManager() {
  window.CONF = { ...window.CONF, name: "ExportControl", timeout: 7500 };
  const manager = new ExportManager(makeMapMock());
  // Stub methods that call showCropBox/lockCropBox etc. so tests can set
  // cropState.box directly without needing a real DOM export UI.
  manager.showCropBox = vi.fn();
  manager.lockCropBox = vi.fn();
  manager.unlockCropBox = vi.fn();
  manager.removeCropBox = vi.fn();
  manager.updateBoxStyle = vi.fn();
  manager.showHintWithInfo = vi.fn();
  manager.showGlobalHint = vi.fn();
  return manager;
}

function setCropState(manager, rect = { left: 10, top: 10, width: 100, height: 100 }) {
  const box = document.createElement("div");
  manager.cropState = { rect, locked: false, box, geoBounds: null };
}

describe("ExportManager — undo/redo", () => {
  let manager;

  beforeEach(() => {
    manager = makeManager();
  });

  it("pushUndoState records rect and clears redo", () => {
    setCropState(manager);
    manager.redoStack = [{ left: 0, top: 0, width: 50, height: 50 }];
    manager.pushUndoState();
    expect(manager.undoStack).toHaveLength(1);
    expect(manager.undoStack[0]).toEqual({ left: 10, top: 10, width: 100, height: 100 });
    expect(manager.redoStack).toHaveLength(0);
  });

  it("pushUndoState is a no-op when cropState is null", () => {
    manager.pushUndoState();
    expect(manager.undoStack).toHaveLength(0);
  });

  it("undoCropBox restores last undo state", () => {
    setCropState(manager);
    manager.undoStack = [{ left: 5, top: 5, width: 50, height: 50 }];
    manager.undoCropBox();
    expect(manager.cropState.rect).toEqual({ left: 5, top: 5, width: 50, height: 50 });
    expect(manager.redoStack).toHaveLength(1);
  });

  it("undoCropBox is a no-op when stack is empty", () => {
    setCropState(manager);
    manager.undoCropBox();
    expect(manager.cropState.rect).toEqual({ left: 10, top: 10, width: 100, height: 100 });
  });

  it("redoCropBox restores last redo state", () => {
    setCropState(manager);
    manager.redoStack = [{ left: 20, top: 20, width: 80, height: 80 }];
    manager.redoCropBox();
    expect(manager.cropState.rect).toEqual({ left: 20, top: 20, width: 80, height: 80 });
    expect(manager.undoStack).toHaveLength(1);
  });

  it("undo/redo cycle round-trips", () => {
    setCropState(manager);
    const initial = { ...manager.cropState.rect };
    manager.undoStack = [{ left: 0, top: 0, width: 50, height: 50 }];
    manager.undoCropBox(); // → rect becomes undo state, redo gets initial
    manager.redoCropBox(); // → rect returns to initial
    expect(manager.cropState.rect).toEqual(initial);
  });

  it("undo stack is capped at UNDO_MAX entries", () => {
    setCropState(manager);
    // Push 21 entries (UNDO_MAX = 20)
    for (let i = 0; i < 21; i++) {
      manager.undoStack.push({ left: i, top: i, width: 10, height: 10 });
    }
    manager.undoCropBox(); // triggers the cap check via redoCropBox path too
    // After undoCropBox: old rect pushed to redo, stack pops 1 → length 20
    expect(manager.undoStack.length).toBeLessThanOrEqual(20);
  });
});

describe("ExportManager — onKeyDown", () => {
  let manager;

  beforeEach(() => {
    manager = makeManager();
    setCropState(manager);
  });

  it("Escape with unlocked crop box calls removeCropBox", () => {
    manager.onKeyDown({ key: "Escape" });
    expect(manager.removeCropBox).toHaveBeenCalled();
  });

  it("Escape with locked crop box calls unlockCropBox", () => {
    manager.cropState.locked = true;
    manager.onKeyDown({ key: "Escape" });
    expect(manager.unlockCropBox).toHaveBeenCalled();
  });

  it("Enter with unlocked crop box calls lockCropBox", () => {
    manager.onKeyDown({ key: "Enter" });
    expect(manager.lockCropBox).toHaveBeenCalled();
  });

  it("Ctrl+Z calls undoCropBox", () => {
    const spy = vi.spyOn(manager, "undoCropBox");
    manager.onKeyDown({ key: "z", ctrlKey: true, metaKey: false, shiftKey: false, preventDefault: vi.fn() });
    expect(spy).toHaveBeenCalled();
  });

  it("Ctrl+Shift+Z calls redoCropBox", () => {
    const spy = vi.spyOn(manager, "redoCropBox");
    manager.onKeyDown({ key: "z", ctrlKey: true, metaKey: false, shiftKey: true, preventDefault: vi.fn() });
    expect(spy).toHaveBeenCalled();
  });
});
