// test/js/control/LayerControl/controller.order — persisted layer order and its replay.
import {
  ENFORCE_ORDER_DEBOUNCE_MS,
  createLayerControllerFixture,
  makeStore,
  readOrderTreeStorage,
  seedOrderDoc,
  seedStorage,
  teardownLayerControllerFixture,
} from "./controller.fixture.js";
import { initFixture, makeDerivedUI } from "./ui/fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { ROLE, orderKeyOf } from "#core/layer/index.js";
import * as Storage from "#platform/storage.js";
import * as CONST from "#control/LayerControl/const.js";
import { LayerController } from "#control/LayerControl/controller.js";
import { getIntent } from "#control/LayerControl/ui/intent.js";
import { dropPersistedLayerState, saveState } from "#control/LayerControl/ui/state.js";

describe("LayerController", () => {
  let manager: LayerController;
  let map: any;

  beforeEach(() => {
    ({ manager, map } = createLayerControllerFixture());
  });

  afterEach(() => {
    teardownLayerControllerFixture(manager);
  });

  // ── batch registration coalescing ──

  it("registerLayer does not run enforceOrder synchronously", () => {
    const spy = vi.spyOn(manager, "enforceOrder");
    manager.registerLayer({ id: "a", name: "A", layer: new window.L.TileLayer() });
    manager.registerLayer({ id: "b", name: "B", layer: new window.L.TileLayer() });
    expect(spy).not.toHaveBeenCalled();
  });

  it("batch registration coalesces into a single debounced enforceOrder", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(manager, "enforceOrder");
    manager.registerLayer({ id: "a", name: "A", layer: new window.L.TileLayer() });
    manager.registerLayer({ id: "b", name: "B", layer: new window.L.TileLayer() });
    vi.advanceTimersByTime(ENFORCE_ORDER_DEBOUNCE_MS);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  // ── layeradd re-entry during enforceOrder ──

  it("layeradd during enforceOrder does NOT reschedule debouncedEnforce (prevents freeze loop)", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(manager, "enforceOrder");
    manager.isEnforcing = true;
    manager.onLayerAdd({ layer: new window.L.Path() });
    vi.advanceTimersByTime(ENFORCE_ORDER_DEBOUNCE_MS);
    expect(spy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("saveOrder persists the current registry order to its own key", () => {
    // saveOrder re-ranks the doc's root blocks from the live registry and
    // writes the doc immediately (saveOrderDoc -> saveRecord, no debounce).
    manager.registerLayer({ id: "a", name: "A", layer: new window.L.TileLayer() });
    const spy = vi.spyOn(Storage, "saveRecord");
    manager.saveOrder();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe(orderKeyOf(map));
    spy.mockRestore();
  });

  describe("loadSavedOrder", () => {
    it("restores a persisted overlay/base order", () => {
      seedOrderDoc(map, ["overlay1", "base1"]);
      const m = new LayerController(map, [
        { id: "base1", name: "B", role: "base" },
        { id: "overlay1", name: "O", role: "overlay" },
      ]);
      expect(m.layers.map(l => l.id)).toEqual(["overlay1", "base1"]);
    });

    it("drops unknown ids from persisted order and keeps the rest", () => {
      // Unknown ids still land in the doc, but nothing registers them, so the
      // layer projection is just the declared ids in their persisted ranks.
      seedOrderDoc(map, ["ghost", "overlay1", "gone", "base1"]);
      const m = new LayerController(map, [
        { id: "base1", name: "B", role: "base" },
        { id: "overlay1", name: "O", role: "overlay" },
      ]);
      expect(m.layers.map(l => l.id)).toEqual(["overlay1", "base1"]);
    });

    it("ignores an invalid persisted doc", () => {
      // An unknown/incomplete shape fails isOrderDoc, loadOrderDoc returns
      // null, and the default (declaration) order is used.
      window.localStorage.setItem(orderKeyOf(map), JSON.stringify({ nodes: "nope" }));
      const m = new LayerController(map, [
        { id: "overlay1", name: "O", role: "overlay" },
      ]);
      // falls back to the initial (insertion) order
      expect(m.layers.map(l => l.id)).toEqual(["overlay1"]);
    });

    it("reads the record once at construction time", () => {
      // The constructor runs before LayerControl's UI has attached. The order
      // doc is read from its own map-scoped key in this one read rather than a
      // second one against a registry that has since grown.
      const spy = vi.spyOn(Storage, "loadRecord");
      new LayerController(map, [
        { id: "base1", name: "B", role: "base" },
        { id: "overlay1", name: "O", role: "overlay" },
      ]);
      const keys = spy.mock.calls.map(c => c[0]);
      expect(keys).toEqual([orderKeyOf(map)]);
      spy.mockRestore();
    });
  });

  // ── Saved-order replay ─────────────────────────────────────────

  // The record's order is read once at construction and held in `savedOrder`;
  // nothing re-applies it afterwards, so every appearance point has to. A
  // component that registers after the record was loaded (Heatmap, Measure)
  // keeps the slot it was inserted into unless its position is replayed, and a
  // flush that lands first would otherwise erase the position that registration
  // is meant to read back.
  describe("saved-order replay", () => {
    it("places a late registration at its persisted position", () => {
      seedOrderDoc(map, ["B", "H", "A"]);
      const m = new LayerController(map, [
        { id: "A", name: "A", role: "overlay" },
        { id: "B", name: "B", role: "overlay" },
      ]);

      m.registerLayer({ id: "H", name: "H", role: "overlay" });

      expect(m.layers.map(l => l.id)).toEqual(["B", "H", "A"]);
    });

    it("keeps a layer stored below every registered layer at the bottom", () => {
      // Nothing below H is registered, so the placement falls back to the end
      // of the group. That end must actually be the end — the layer is the
      // rightmost of the layers that exist, not the topmost.
      seedOrderDoc(map, ["B", "A", "H"]);
      const m = new LayerController(map, [
        { id: "A", name: "A", role: "overlay" },
        { id: "B", name: "B", role: "overlay" },
      ]);

      m.registerLayer({ id: "H", name: "H", role: "overlay" });

      expect(m.layers.map(l => l.id)).toEqual(["B", "A", "H"]);
    });

    it("skips a saved neighbor that has not registered yet", () => {
      // G sits between X and Y in the stored order but is not registered, so it
      // cannot be located. The walk keeps going past the gap instead of stopping
      // there and leaving X where prepend put it.
      seedOrderDoc(map, ["X", "G", "Y"]);
      const m = new LayerController(map, [{ id: "Y", name: "Y", role: "overlay" }]);

      m.registerLayer({ id: "X", name: "X", role: "overlay" });

      expect(m.layers.map(l => l.id)).toEqual(["X", "Y"]);
    });

    it("re-applies the stored order to a layer that drifted below its neighbor", () => {
      // The drag moved A under B without a flush landing yet. A is now below its
      // own saved neighbor, which is the case where the target index is not the
      // neighbor's shifted-down index.
      seedOrderDoc(map, ["A", "B"]);
      const m = new LayerController(map, [
        { id: "A", name: "A", role: "overlay" },
        { id: "B", name: "B", role: "overlay" },
      ]);
      {
        const arr = m.layerRegistry.layers.slice();
        const [mv] = arr.splice(0, 1);
        arr.splice(1, 0, mv);
        m.layerRegistry.replace(arr);
      }
      expect(m.layers.map(l => l.id)).toEqual(["B", "A"]);

      m.replaySavedOrder();

      expect(m.layers.map(l => l.id)).toEqual(["A", "B"]);
    });

    it("leaves the registry alone for an id that is not registered", () => {
      seedOrderDoc(map, ["A"]);
      const m = new LayerController(map, [{ id: "A", name: "A", role: "overlay" }]);

      expect(() => m.replaySavedOrder()).not.toThrow();
      expect(m.layers.map(l => l.id)).toEqual(["A"]);
    });

    it("keeps a layer the record never ranked at its live position", () => {
      // D arrived this session, so the record has no rank for it. The sweep
      // sorts the ranked ids by rank and leaves the unranked ones in their own
      // relative order at the bottom.
      seedOrderDoc(map, ["D"]);
      const m = new LayerController(map, [
        { id: "A", name: "A", role: "overlay" },
        { id: "B", name: "B", role: "overlay" },
        { id: "C", name: "C", role: "overlay" },
        { id: "D", name: "D", role: "overlay" },
      ]);
      {
        const arr = m.layerRegistry.layers.slice();
        const [mv] = arr.splice(0, 1);
        arr.splice(2, 0, mv);
        m.layerRegistry.replace(arr);
      }
      expect(m.layers.map(l => l.id)).toEqual(["A", "B", "D", "C"]);

      m.replaySavedOrder();

      expect(m.layers.map(l => l.id)).toEqual(["D", "A", "B", "C"]);
    });

    it("writes no saved order from registration alone (no user action)", () => {
      // #515's original semantics, now enforced by the mechanism itself: only
      // explicit user reorders snapshot the live order. A boot that registers
      // the color basemap and further layers must leave the order slot
      // untouched — not even a snapshot that happens to match the registration
      // sequence is a user order.
      seedStorage({});
      const m = new LayerController(map, [
        { id: "fg", name: "FG", role: "overlay" },
        { id: "tile", name: "Tile", role: "base" },
      ]);
      m.registerLayer({
        id: "foliplus_color_map",
        name: "Color",
        role: "base",
      });
      m.registerLayer({ id: "X", name: "X", role: "overlay" });
      m.persistence.flushAll();

      const record = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY)!) as {
        data?: { order?: string[] | null };
      };
      // No order key at all — registration never touched the saved order.
      expect(record.data?.order).toBeUndefined();
    });

    it("snapshots every layer present at the user reorder, color basemap included", () => {
      // A user reorder writes the full live order. The color basemap is an
      // ordinary layer with zero privileges, so its slot lands on disk like
      // any other layer's — a late registration that is not on the map yet
      // does not: the snapshot is what was on screen.
      seedOrderDoc(map, ["fg", "tile"]);
      const m = new LayerController(map, [
        { id: "fg", name: "FG", role: "overlay" },
        { id: "tile", name: "Tile", role: "base" },
      ]);
      m.registerLayer({
        id: "foliplus_color_map",
        name: "Color",
        role: "base",
      });
      expect(m.layers.map(l => l.id)).toEqual(["fg", "foliplus_color_map", "tile"]);

      m.saveOrder();

      // The order now lives in its own key as a doc; the root layer sequence
      // is the persisted snapshot.
      const stored = readOrderTreeStorage(map)!;
      const rootIds = Object.entries(stored.nodes as Record<string, any>)
        .filter(([, n]) => n.parent === null && n.kind === "layer")
        .sort((a, b) => (a[1].rank as string).localeCompare(b[1].rank as string))
        .map(([k]) => k.replace(/^layer:/, ""));
      expect(rootIds).toEqual(["fg", "foliplus_color_map", "tile"]);
    });

    it("keeps a dragged solid-color basemap position across a reload (user bug)", () => {
      // The user drags the color basemap up within the base group and reloads:
      // the dragged slot must survive. Before the fix, the color layer's slot
      // was treated as attach timing and dropped from every write, so the
      // reload fell back to the registration order (bottom of the base group).
      const m = new LayerController(map, [
        { id: "fg", name: "FG", role: "overlay" },
        { id: "tile", name: "Tile", role: "base" },
      ]);
      m.registerLayer({
        id: "foliplus_color_map",
        name: "Color",
        role: "base",
        baseInsert: "bottom",
      });
      // Registration order: fg, tile, color (color at the bottom, as createColor
      // mounts it).
      expect(m.layers.map(l => l.id)).toEqual(["fg", "tile", "foliplus_color_map"]);

      // The drag moves the color basemap above the tile basemap.
      {
        const arr = m.layerRegistry.layers.slice();
        const [mv] = arr.splice(2, 1);
        arr.splice(1, 0, mv);
        m.layerRegistry.replace(arr);
      }
      m.saveOrder();

      const stored = readOrderTreeStorage(map)!;
      const rootIds = Object.entries(stored.nodes as Record<string, any>)
        .filter(([, n]) => n.parent === null && n.kind === "layer")
        .sort((a, b) => (a[1].rank as string).localeCompare(b[1].rank as string))
        .map(([k]) => k.replace(/^layer:/, ""));
      expect(rootIds).toEqual(["fg", "foliplus_color_map", "tile"]);

      // Reload, the way a real page does it: the color basemap is not part of
      // the author's data — LayerControl re-creates it through registerLayer
      // (baseInsert bottom), which must replay the dragged slot from the
      // record instead of sinking to the bottom of the base block.
      const reloaded = new LayerController(map, [
        { id: "fg", name: "FG", role: "overlay" },
        { id: "tile", name: "Tile", role: "base" },
      ]);
      reloaded.registerLayer({
        id: "foliplus_color_map",
        name: "Color",
        role: "base",
        baseInsert: "bottom",
      });
      expect(reloaded.layers.map(l => l.id)).toEqual([
        "fg",
        "foliplus_color_map",
        "tile",
      ]);
    });

    it("replays a dragged base layer into the base block, never the overlay end", () => {
      // placeBeforeSavedNeighbor's no-registered-neighbor fallback is
      // group-local: a base layer with no registered saved neighbor below it
      // lands at the end of the base block (the registry end), not at the end
      // of the overlay block — the overlay-before-base invariant holds.
      seedOrderDoc(map, ["fg", "baseA", "baseB"]);
      const m = new LayerController(map, [{ id: "fg", name: "FG", role: "overlay" }]);
      m.registerLayer({ id: "baseA", name: "A", role: "base" });

      // Neither baseB nor anything else is registered below baseA in the
      // stored order, so the fallback is the base-block end: below the
      // overlay, at the bottom of the registry.
      expect(m.layers.map(l => l.id)).toEqual(["fg", "baseA"]);
    });
  });

  // ── replayStoredState (single replay entry) ──

  describe("replayStoredState", () => {
    it("replays projection/name/order/style via applyUserState then filter, in that order", () => {
      manager.ui = makeDerivedUI({
        applyUserState: vi.fn(() => []),
      }) as any;
      const filterSpy = vi
        .spyOn(manager as unknown as { replayFilter(id: string): void }, "replayFilter")
        .mockImplementation(() => {});

      const moved = manager.replayStoredState("overlay1");

      // The single-entry contract: projection → name → order → style dims run
      // inside applyUserState(id), then filter replays after — filter's hidden
      // class depends on the DOM the style pass paints.
      expect(manager.ui!.applyUserState).toHaveBeenCalledWith("overlay1");
      expect(filterSpy).toHaveBeenCalledWith("overlay1");
      expect(filterSpy.mock.invocationCallOrder[0]).toBeGreaterThan(
        (manager.ui!.applyUserState as ReturnType<typeof vi.fn>).mock
          .invocationCallOrder[0],
      );
      expect(moved).toEqual([]);
    });

    it("is idempotent — a second call replays the same dimensions the same way", () => {
      manager.ui = makeDerivedUI({
        applyUserState: vi.fn(() => []),
      }) as any;
      const filterSpy = vi
        .spyOn(manager as unknown as { replayFilter(id: string): void }, "replayFilter")
        .mockImplementation(() => {});

      manager.replayStoredState("overlay1");
      manager.replayStoredState("overlay1");

      expect(manager.ui!.applyUserState).toHaveBeenCalledTimes(2);
      expect(manager.ui!.applyUserState).toHaveBeenNthCalledWith(1, "overlay1");
      expect(manager.ui!.applyUserState).toHaveBeenNthCalledWith(2, "overlay1");
      expect(filterSpy).toHaveBeenCalledTimes(2);
      expect(filterSpy).toHaveBeenNthCalledWith(1, "overlay1");
      expect(filterSpy).toHaveBeenNthCalledWith(2, "overlay1");
    });

    it("applyDoc is a no-op on the same doc reference (early return skips persist)", () => {
      // The doc is the single source; re-applying the SAME reference is a
      // command that changed nothing. The early return must skip the whole
      // apply — no re-derive, no persist — so a no-op command cannot write
      // storage or perturb the derived state.
      const persistSpy = vi
        .spyOn(manager as unknown as { persistOrderDoc(): void }, "persistOrderDoc")
        .mockImplementation(() => {});
      const beforeView = (manager as unknown as { lastView: unknown }).lastView;
      (
        manager as unknown as {
          applyDoc(next: unknown, opts: { persist: boolean }): void;
        }
      ).applyDoc(manager.orderDoc, { persist: true });
      expect(persistSpy).not.toHaveBeenCalled();
      expect((manager as unknown as { lastView: unknown }).lastView).toBe(beforeView);
    });

    it("tolerates a missing ui (pre-attach) and still replays the filter", () => {
      manager.ui = undefined as any;
      const filterSpy = vi
        .spyOn(manager as unknown as { replayFilter(id: string): void }, "replayFilter")
        .mockImplementation(() => {});

      const moved = manager.replayStoredState("overlay1");

      expect(moved).toEqual([]);
      expect(filterSpy).toHaveBeenCalledWith("overlay1");
    });
  });

  describe("replayStoredStateAll", () => {
    it("sweeps applyUserState() once then replays the filter for every registered layer", () => {
      manager.ui = makeDerivedUI({
        applyUserState: vi.fn(() => []),
      }) as any;
      const filterSpy = vi
        .spyOn(manager as unknown as { replayFilter(id: string): void }, "replayFilter")
        .mockImplementation(() => {});
      const ids = manager.layerRegistry.items.map(l => l.id);

      const moved = manager.replayStoredStateAll();

      // The A-path sweep: projection-all + name + order + declared style dims
      // in one applyUserState(), then per-layer filter replay.
      expect(manager.ui!.applyUserState).toHaveBeenCalledTimes(1);
      expect(manager.ui!.applyUserState).toHaveBeenCalledWith();
      expect(filterSpy).toHaveBeenCalledTimes(ids.length);
      for (const id of ids) expect(filterSpy).toHaveBeenCalledWith(id);
      expect(moved).toEqual([]);
    });
  });

  // ── forgetSavedOrder ──

  // Component clear paths (Heatmap, Measure) call this to drop an id from the
  // stored order without retiring the layer. The next registration lands at
  // the top of the overlay stack rather than back at the old slot. Contrast
  // with deleteLayer: forgetSavedOrder filters savedOrder only; it must never
  // touch removedIds, otherwise a cleared layer could not be re-registered.
  describe("forgetSavedOrder", () => {
    it("drops the id from the order doc and persists the change", () => {
      // Component clears always unregister the layer before calling this —
      // the doc would otherwise re-insert an id that is still live.
      seedOrderDoc(map, ["A", "H", "B", "C"]);
      const m = new LayerController(map, [
        { id: "A", name: "A", role: "overlay" },
        { id: "H", name: "H", role: "overlay" },
        { id: "B", name: "B", role: "overlay" },
        { id: "C", name: "C", role: "overlay" },
      ]);
      m.unregisterLayer("H");

      expect(m.forgetSavedOrder("H")).toBe(true);
      // The tree is the single order source: the node is gone, the neighbours
      // keep their ranks.
      expect((m as any).orderDoc.nodes["layer:H"]).toBeUndefined();
      expect(Object.keys((m as any).orderDoc.nodes)).toEqual([
        "layer:A",
        "layer:B",
        "layer:C",
      ]);
    });

    it("persists the pruned order so a reload does not resurrect the old slot", () => {
      seedOrderDoc(map, ["A", "H", "B"]);
      const m = new LayerController(map, [
        { id: "A", name: "A", role: "overlay" },
        { id: "H", name: "H", role: "overlay" },
        { id: "B", name: "B", role: "overlay" },
      ]);
      m.unregisterLayer("H");
      m.forgetSavedOrder("H");
      m.persistence.flushAll();

      // The layer_order document no longer ranks H, so a reload builds the
      // default from the remaining declarations and H is not resurrected.
      const doc = JSON.parse(window.localStorage.getItem(orderKeyOf(map))!) as {
        nodes: Record<string, unknown>;
      };
      expect(doc.nodes["layer:H"]).toBeUndefined();
      expect(doc.nodes["layer:A"]).toBeDefined();
      expect(doc.nodes["layer:B"]).toBeDefined();
    });

    it("returns false for an id that is not in savedOrder", () => {
      seedOrderDoc(map, ["A", "B"]);
      const m = new LayerController(map, [
        { id: "A", name: "A", role: "overlay" },
        { id: "B", name: "B", role: "overlay" },
      ]);
      expect(m.forgetSavedOrder("never")).toBe(false);
    });

    it("returns false when nothing was saved (fresh page)", () => {
      // A fresh page has only the default doc, not a saved slot: an id that was
      // never declared has no node at all, so forget says so rather than
      // pretending it dropped a position.
      const m = new LayerController(map, [{ id: "A", name: "A", role: "overlay" }]);
      expect(m.forgetSavedOrder("Z")).toBe(false);
    });

    it("does NOT retire the layer — it stays registerable", () => {
      seedOrderDoc(map, ["A", "H", "B"]);
      const m = new LayerController(map, [
        { id: "A", name: "A", role: "overlay" },
        { id: "H", name: "H", role: "overlay" },
        { id: "B", name: "B", role: "overlay" },
      ]);
      m.unregisterLayer("H");
      m.forgetSavedOrder("H");

      // The doc node is dropped (not hidden), so the layer is not retired.
      expect((m as any).orderDoc.nodes["layer:H"]).toBeUndefined();
      // And a subsequent registration actually works:
      m.registerLayer({ id: "H", name: "H", role: "overlay" });
      expect(m.layerRegistry.has("H")).toBe(true);
    });

    it("next registration lands at the top of the overlay stack", () => {
      // Without forgetSavedOrder the re-registration would land back at index 1
      // (below A). With it, insertOverlayAt's prepend branch wins because the
      // id has no stored rank anymore.
      seedOrderDoc(map, ["A", "H", "B"]);
      const m = new LayerController(map, [
        { id: "A", name: "A", role: "overlay" },
        { id: "H", name: "H", role: "overlay" },
        { id: "B", name: "B", role: "overlay" },
      ]);
      m.unregisterLayer("H");
      m.forgetSavedOrder("H");
      m.registerLayer({ id: "H", name: "H", role: "overlay" });

      expect(m.layers.map(l => l.id)).toEqual(["H", "A", "B"]);
    });

    it("preserves neighbor order across a reload after forget", () => {
      // A clear must not disturb the layers around it: forget only removes the
      // one id and leaves the rest in their saved positions, which replay on
      // the next construction.
      seedOrderDoc(map, ["A", "H", "B", "C"]);
      const m = new LayerController(map, [
        { id: "A", name: "A", role: "overlay" },
        { id: "H", name: "H", role: "overlay" },
        { id: "B", name: "B", role: "overlay" },
        { id: "C", name: "C", role: "overlay" },
      ]);
      m.unregisterLayer("H");
      m.forgetSavedOrder("H");
      m.persistence.flushAll();

      // Simulate reload: a fresh manager reads the record and gets neighbors
      // in the same relative order.
      const fresh = new LayerController(map, [
        { id: "A", name: "A", role: "overlay" },
        { id: "B", name: "B", role: "overlay" },
        { id: "C", name: "C", role: "overlay" },
      ]);
      expect(fresh.layers.map(l => l.id)).toEqual(["A", "B", "C"]);
    });
  });

  // ── dropPersistedLayerState ──

  // The component-clear counterpart of deleteLayer: it drops the same two
  // sections (stored order + intent row) but never retires the id, so a
  // cleared component can draw again from the author's defaults.
  describe("dropPersistedLayerState", () => {
    it("drops the intent row and its provenance, keeps the id registerable", () => {
      const m = new LayerController(map, [
        { id: "A", name: "A", role: "overlay" },
        { id: "H", name: "H", role: "overlay" },
      ]);
      const save = vi.fn(() => saveState(m.ui!));
      m.ui = makeDerivedUI({
        c: m,
        listPanel: {} as never,
        intentStore: makeStore(
          {
            H: { visible: false, opacity: 0.35 },
            A: { visible: false, opacity: 0.4 },
          },
          { H: ["visible", "opacity"], A: ["visible", "opacity"] },
        ),
        dropPersistedLayerState: (id: string) => dropPersistedLayerState(m.ui!, id),
        saveState: save,
        invalidateFields: vi.fn(),
      }) as any;
      // A component clear always unregisters first (saveOrder would otherwise
      // re-insert an id that is still live).
      m.unregisterLayer("H");

      expect(m.dropPersistedLayerState("H")).toBe(true);

      expect(getIntent(m.ui!, "H", "visible")).toBeUndefined();
      expect(getIntent(m.ui!, "H", "opacity")).toBeUndefined();
      // A sibling's tuning is nobody's business on a component clear.
      expect(getIntent(m.ui!, "A", "visible")).toBe(false);
      expect(getIntent(m.ui!, "A", "opacity")).toBe(0.4);
      expect(m.ui!.intentStore.dumpProvenance()).toEqual({
        A: ["visible", "opacity"],
      });
      expect(save).toHaveBeenCalledTimes(1);
      // A clear is not a delete: the id stays registerable (no doc node, so
      // nothing retires it).
      m.registerLayer({ id: "H", name: "H", role: "overlay" });
      expect(m.layerRegistry.has("H")).toBe(true);
    });

    it("drops the stored order slot too, so a redraw lands at the top", () => {
      seedOrderDoc(map, ["A", "H", "B"]);
      const m = new LayerController(map, [
        { id: "A", name: "A", role: "overlay" },
        { id: "H", name: "H", role: "overlay" },
        { id: "B", name: "B", role: "overlay" },
      ]);
      m.unregisterLayer("H");

      expect(m.dropPersistedLayerState("H")).toBe(true);

      // The doc node is gone (the tree is the single order source).
      expect((m as any).orderDoc.nodes["layer:H"]).toBeUndefined();
      m.registerLayer({ id: "H", name: "H", role: "overlay" });
      expect(m.layers.map(l => l.id)).toEqual(["H", "A", "B"]);
    });

    it("returns false when nothing was stored for the id", () => {
      // No panel and no doc node — a clear of a layer the user never touched
      // erases nothing, and must say so rather than throwing.
      const m = new LayerController(map, [{ id: "H", name: "H", role: "overlay" }]);
      expect(m.dropPersistedLayerState("Z")).toBe(false);
    });

    it("persists the erase so a reload cannot resurrect the old tuning", () => {
      // The probe that motivated this: the entry survived both clear paths, so
      // a redraw — or a plain reload — handed back the opacity and visibility
      // the user had arranged for the previous draw.
      seedStorage({
        layers: {
          H: {
            visible: false,
            opacity: 0.35,
            overrides: ["visible", "opacity"],
          },
        },
      });
      const m = new LayerController(map, [{ id: "H", name: "H", role: "overlay" }]);
      const save = vi.fn(() => saveState(m.ui!));
      m.ui = makeDerivedUI({
        c: m,
        listPanel: {} as never,
        intentStore: makeStore(
          { H: { visible: false, opacity: 0.35 } },
          { H: ["visible", "opacity"] },
        ),
        dropPersistedLayerState: (id: string) => dropPersistedLayerState(m.ui!, id),
        saveState: save,
        invalidateFields: vi.fn(),
      }) as any;
      m.unregisterLayer("H");
      m.dropPersistedLayerState("H");
      m.persistence.flushAll();

      const record = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY)!)
        .data as {
        layers?: Record<string, unknown>;
      };
      expect(record.layers?.H).toBeUndefined();
      expect(save).toHaveBeenCalledTimes(1);
    });
  });

  it("BEFORE_EXPORT flushes the pending order before the exporter captures", () => {
    // A debounced reorder would otherwise land after the capture, exporting the
    // stale z-order the panel already showed.
    const spy = vi
      .spyOn(manager, "enforceOrder")
      .mockImplementation(() => ({ failed: [], skipped: false }));
    manager.events.publish(EVENTS.BEFORE_EXPORT as string);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a cross-role re-registration after unregister replays its order role-locally", () => {
    // The gate says "unregister first"; that path must stay safe. A's old
    // saved rank sits above B, but A is now a base and B an overlay — an
    // unconditional replay would push A into the overlay block and strand
    // the boundary.
    const { manager } = initFixture({
      seed: { order: ["A", "B"] },
      data: [
        { id: "A", name: "A", role: "overlay" },
        { id: "B", name: "B", role: "overlay" },
        { id: "T", name: "T", role: "base" },
      ],
    });

    manager.unregisterLayer("A");
    manager.registerLayer({ id: "A", name: "A", role: "base" });

    const firstBase = manager.layers.findIndex(l => l.role === ROLE.BASE);
    expect(firstBase).not.toBe(-1);
    expect(manager.layers.slice(0, firstBase).every(l => l.role !== ROLE.BASE)).toBe(
      true,
    );
    expect(manager.layerRegistry.firstBaseIdx).toBe(firstBase);
  });

  it("a stored record that interleaves roles still replays partitioned", () => {
    // A corrupted or legacy record ranks T(base) above B(overlay) above
    // A(base). The full replay sorts per role and concatenates, so the
    // overlay block never inherits a base.
    const { manager } = initFixture({
      seed: { order: ["T", "B", "A"] },
      data: [
        { id: "A", name: "A", role: "base" },
        { id: "B", name: "B", role: "overlay" },
        { id: "T", name: "T", role: "base" },
      ],
    });

    const firstBase = manager.layers.findIndex(l => l.role === ROLE.BASE);
    expect(manager.layers.slice(0, firstBase).every(l => l.role !== ROLE.BASE)).toBe(
      true,
    );
    expect(manager.layerRegistry.firstBaseIdx).toBe(firstBase);
    expect(manager.layers[0].id).toBe("B");
  });
});
