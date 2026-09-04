// Direct namespace tests for edit.ts — verifies the extracted module behaves
// identically to the Util re-exports and covers a few scenarios not exercised
// in util.test.ts (which tests through the Util namespace).
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindNodeDrag,
  buildEditOverlay,
  isDragSyntheticClick,
  markDragSyntheticClick,
} from "#foliplus/MeasureControl/edit.js";

// Reset the module-scoped one-shot flag before each test so a prior test's
// drag end doesn't leak into this test's click handler.
const resetDragFlag = () => {
  isDragSyntheticClick(); // consume any pending flag
};

beforeEach(() => {
  vi.clearAllMocks();
  resetDragFlag();
  window.L.DomEvent = {
    ...window.L.DomEvent,
    stopPropagation: vi.fn(),
  };
});

// ==================== buildEditOverlay (direct namespace) ====================

describe("buildEditOverlay", () => {
  function makeMap() {
    return { on: vi.fn(), off: vi.fn() } as any;
  }
  function makeHost(overrides: Record<string, unknown> = {}) {
    return { map: makeMap(), isEditMode: true, ...overrides };
  }

  it("open is idempotent — second call while open does not re-fire onOpen", () => {
    const onOpen = vi.fn();
    const overlay = buildEditOverlay(makeHost() as any, { onOpen });

    overlay.open({ originalEvent: {} } as any);
    overlay.open({ originalEvent: {} } as any);

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("close is idempotent — second close does not re-fire onEmpty", () => {
    const onEmpty = vi.fn();
    const overlay = buildEditOverlay(makeHost() as any, { onOpen: vi.fn(), onEmpty });

    overlay.open({ originalEvent: {} } as any);
    overlay.close();
    overlay.close();

    expect(onEmpty).toHaveBeenCalledTimes(1);
  });

  it("stops propagation on a drag-synthetic click so it never reaches the map click handler", () => {
    const host = makeHost() as any;
    const ev = { originalEvent: {} } as any;
    const overlay = buildEditOverlay(host, { onOpen: vi.fn() });

    markDragSyntheticClick();
    overlay.open(ev);

    // Synthetic click is fully neutralized — the same event object must not
    // bubble to any map listener (so a future edit to onMapClick's guard can't
    // accidentally re-open the path).
    expect(window.L.DomEvent.stopPropagation).toHaveBeenCalledWith(ev);
  });

  it("open respects a mid-session isEditMode toggle (gate re-checked each call)", () => {
    const host = makeHost() as any;
    const onOpen = vi.fn();
    const overlay = buildEditOverlay(host, { onOpen });

    overlay.open({ originalEvent: {} } as any);
    expect(onOpen).toHaveBeenCalledTimes(1);

    host.isEditMode = false;
    // Close so the overlay is no longer "open"; the next open call re-reads
    // the host's isEditMode gate.
    overlay.close();
    overlay.open({ originalEvent: {} } as any);

    expect(onOpen).toHaveBeenCalledTimes(1); // still 1 — the second open was gated
  });

  it("cleanup is a no-op on the closer unregister when called twice", () => {
    const closers: Array<() => void> = [];
    const host = {
      map: makeMap(),
      isEditMode: true,
      registerEditOverlayCloser: (c: () => void) => {
        closers.push(c);
        return () => {
          const i = closers.indexOf(c);
          if (i !== -1) closers.splice(i, 1);
        };
      },
    };
    const overlay = buildEditOverlay(host as any, { onOpen: vi.fn() });

    overlay.cleanup();
    overlay.cleanup(); // must not throw, must not double-unregister

    expect(closers).toHaveLength(0);
  });
});

// ==================== drag-synthetic click (direct namespace) ====================

describe("markDragSyntheticClick / isDragSyntheticClick", () => {
  it("returns true once after markDragSyntheticClick", () => {
    markDragSyntheticClick();
    expect(isDragSyntheticClick()).toBe(true);
    expect(isDragSyntheticClick()).toBe(false);
  });
});

// ==================== bindNodeDrag (direct namespace) ====================

describe("bindNodeDrag", () => {
  it("cleanup unbinds both the node mousedown AND mouseup handlers", () => {
    const node = { on: vi.fn(), off: vi.fn() };
    const map = {
      on: vi.fn(),
      off: vi.fn(),
    };
    const { cleanup } = bindNodeDrag(node as any, null, map as any, {});

    const mousedownHandler = (node.on as any).mock.calls.find(
      ([ev]) => ev === "mousedown",
    )?.[1];
    const mouseupHandler = (node.on as any).mock.calls.find(
      ([ev]) => ev === "mouseup",
    )?.[1];

    cleanup();

    expect(node.off).toHaveBeenCalledWith("mousedown", mousedownHandler);
    expect(node.off).toHaveBeenCalledWith("mouseup", mouseupHandler);
  });

  it("cleanup removes the map mousemove and mouseup handlers", () => {
    const node = { on: vi.fn(), off: vi.fn() };
    const map = { on: vi.fn(), off: vi.fn() };
    const { cleanup } = bindNodeDrag(node as any, null, map as any, {});

    const moveHandler = (map.on as any).mock.calls.find(
      ([ev]) => ev === "mousemove",
    )?.[1];
    const upHandler = (map.on as any).mock.calls.find(([ev]) => ev === "mouseup")?.[1];

    cleanup();

    expect(map.off).toHaveBeenCalledWith("mousemove", moveHandler);
    expect(map.off).toHaveBeenCalledWith("mouseup", upHandler);
  });

  it("delMarker is not moved when absent (null)", () => {
    const onDrag = vi.fn();
    const node = {
      on: vi.fn(),
      off: vi.fn(),
      setLatLng: vi.fn(),
    };
    const map = {
      on: vi.fn(),
      off: vi.fn(),
      mouseEventToContainerPoint: vi.fn(
        (raw: { clientX: number; clientY: number }) => ({
          x: raw.clientX,
          y: raw.clientY,
        }),
      ),
      dragging: { disable: vi.fn(), enable: vi.fn() },
    };
    const { setEnabled } = bindNodeDrag(node as any, null, map as any, { onDrag });
    setEnabled(true);

    const onDown = (node.on as any).mock.calls.find(([ev]) => ev === "mousedown")?.[1];
    const onMove = (map.on as any).mock.calls.find(([ev]) => ev === "mousemove")?.[1];

    onDown({ originalEvent: { clientX: 0, clientY: 0 } });
    onMove({
      originalEvent: { clientX: 10, clientY: 0 },
      latlng: { lat: 2, lng: 2 },
    } as any);

    expect(onDrag).toHaveBeenCalledWith({ lat: 2, lng: 2 });
    // With no delMarker, only node.setLatLng is called (exactly once).
    expect(node.setLatLng).toHaveBeenCalledTimes(1);
    expect(node.setLatLng).toHaveBeenCalledWith({ lat: 2, lng: 2 });
  });
});
