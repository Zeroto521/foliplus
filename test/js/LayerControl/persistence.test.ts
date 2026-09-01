import { beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import { LayerPersistence } from "#foliplus/LayerControl/persistence.js";
import * as Storage from "#common/storage.js";

const makeRegistry = (ids: string[]) =>
  ({
    layers: ids.map(id => ({ id })),
    get: id => (ids.includes(id) ? { id } : null),
  }) as any;

describe("LayerPersistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useRealTimers();
    window.CONF = { ...window.CONF, name: "LayerControl" };
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  const makePersistence = (ids: string[]) => new LayerPersistence(makeRegistry(ids));

  // ── Order ────────────────────────────────────────────────────────

  describe("order", () => {
    it("loads persisted order and drops unknown ids", () => {
      vi.spyOn(Storage, "load").mockReturnValue(["a", "ghost", "b", "gone"]);
      const p = makePersistence(["a", "b", "c"]);
      expect(p.loadOrder()).toEqual(["a", "b"]);
    });

    it("returns null for missing or non-array storage", () => {
      vi.spyOn(Storage, "load").mockReturnValue("not-array");
      const p = makePersistence(["a"]);
      expect(p.loadOrder()).toBeNull();
    });

    it("debounces rapid saveOrder calls into one write", () => {
      vi.useFakeTimers();
      const save = vi.spyOn(Storage, "save").mockImplementation(() => undefined);
      const p = makePersistence(["a", "b"]);
      p.saveOrder(() => ["a", "b"]);
      p.saveOrder(() => ["b", "a"]);
      p.saveOrder(() => ["b", "a", "c"]);
      expect(save).not.toHaveBeenCalled();

      vi.advanceTimersByTime(CONST.SAVE_ORDER_DEBOUNCE_MS + 50);

      // The last getter wins — reads the live order, not the order at first
      // call during the batch.
      expect(save.mock.calls[0][1]).toEqual(["b", "a", "c"]);
      expect(save).toHaveBeenCalledTimes(1);
      save.mockRestore();
      vi.useRealTimers();
    });

    it("cancelSaveOrder suppresses a pending write", () => {
      vi.useFakeTimers();
      const save = vi.spyOn(Storage, "save").mockImplementation(() => undefined);
      const p = makePersistence(["a"]);
      p.saveOrder(() => ["a"]);
      p.cancelSaveOrder();
      vi.advanceTimersByTime(CONST.SAVE_ORDER_DEBOUNCE_MS + 50);
      expect(save).not.toHaveBeenCalled();
      save.mockRestore();
      vi.useRealTimers();
    });
  });

  // ── Fold ─────────────────────────────────────────────────────────

  describe("fold", () => {
    it("loads persisted fold state", () => {
      vi.spyOn(Storage, "load").mockReturnValue(["OVERLAYS"]);
      const p = makePersistence(["a"]);
      expect(p.loadFoldedGroups()).toEqual(new Set(["OVERLAYS"]));
    });

    it("returns empty set when storage is missing", () => {
      vi.spyOn(Storage, "load").mockReturnValue(null);
      const p = makePersistence(["a"]);
      expect(p.loadFoldedGroups()).toEqual(new Set());
    });

    it("saves fold state synchronously", () => {
      const save = vi.spyOn(Storage, "save").mockImplementation(() => undefined);
      const p = makePersistence(["a"]);
      p.saveFoldedGroups(new Set(["BASE", "OVERLAYS"]));
      expect(save).toHaveBeenCalledWith(
        CONST.STORAGE.FOLD_KEY,
        ["BASE", "OVERLAYS"],
        "LayerControl",
      );
      save.mockRestore();
    });
  });

  // ── Visibility ───────────────────────────────────────────────────

  describe("visibility (hidden ids)", () => {
    it("loads hidden ids, filtering non-string entries", () => {
      vi.spyOn(Storage, "load").mockReturnValue(["a", 123, "b", null]);
      const p = makePersistence(["a", "b", "c"]);
      expect(p.loadHiddenIds()).toEqual(new Set(["a", "b"]));
    });

    it("returns empty set when storage is missing", () => {
      vi.spyOn(Storage, "load").mockReturnValue(null);
      const p = makePersistence(["a"]);
      expect(p.loadHiddenIds()).toEqual(new Set());
    });

    it("debounces rapid saveHiddenIds calls into one write", () => {
      vi.useFakeTimers();
      const save = vi.spyOn(Storage, "save").mockImplementation(() => undefined);
      const p = makePersistence(["a", "b"]);
      p.saveHiddenIds(() => new Set(["a"]));
      p.saveHiddenIds(() => new Set(["a", "b"]));
      expect(save).not.toHaveBeenCalled();

      vi.advanceTimersByTime(CONST.SAVE_ORDER_DEBOUNCE_MS + 50);
      expect(save.mock.calls[0][1]).toEqual(["a", "b"]);
      save.mockRestore();
      vi.useRealTimers();
    });

    it("cancelSaveHiddenIds suppresses a pending write", () => {
      vi.useFakeTimers();
      const save = vi.spyOn(Storage, "save").mockImplementation(() => undefined);
      const p = makePersistence(["a"]);
      p.saveHiddenIds(() => new Set(["a"]));
      p.cancelSaveHiddenIds();
      vi.advanceTimersByTime(CONST.SAVE_ORDER_DEBOUNCE_MS + 50);
      expect(save).not.toHaveBeenCalled();
      save.mockRestore();
      vi.useRealTimers();
    });
  });
});
