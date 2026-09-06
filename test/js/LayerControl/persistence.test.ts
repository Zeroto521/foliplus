import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import { LayerPersistence } from "#foliplus/LayerControl/persistence.js";
import * as Storage from "#common/storage.js";

const makeRegistry = (ids: string[]) =>
  ({
    layers: ids.map(id => ({ id })),
    get: id => (ids.includes(id) ? { id } : null),
  }) as any;

const makePersistence = (ids: string[]) => new LayerPersistence(makeRegistry(ids));

/** Seed localStorage with raw JSON, mirroring what the writes produce -- so
 *  load() is exercised against corrupt shapes. Keys are the real storage keys,
 *  passed straight through rather than looked up by property name. */
const seedStorage = (fixture: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(fixture)) {
    if (value !== undefined) window.localStorage.setItem(key, JSON.stringify(value));
  }
};

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

  // ── Read ────────────────────────────────────────────────────────

  describe("load", () => {
    it("loads every dimension and drops unknown order and visibility ids", () => {
      seedStorage({
        [CONST.STORAGE.ORDER_KEY]: ["a", "ghost", "b", "gone"],
        [CONST.STORAGE.VISIBILITY_KEY]: ["a", "ghost", "b", "gone"],
        [CONST.STORAGE.FOLD_KEY]: ["OVERLAYS"],
        [CONST.STORAGE.NAMES_KEY]: { a: "A2", "not-registered-yet": "Pending" },
      });
      const p = makePersistence(["a", "b", "c"]);

      expect(p.load()).toEqual({
        order: ["a", "b"],
        foldedGroups: new Set(["OVERLAYS"]),
        hiddenIds: new Set(["a", "b"]),
        names: { a: "A2", "not-registered-yet": "Pending" },
      });
    });

    it("keeps renames for ids that are not registered yet", () => {
      // Load order is the opposite of the order/visibility loaders on purpose.
      // load runs from attachUI, which lands at the tail of the LayerControl
      // bundle — after some component bundles have registered and before others
      // have. HeatmapControl and MeasureControl register their layers in their
      // own constructor, so filtering names against the registry here dropped
      // their renames on the first attach and the user saw the component default
      // name after every reload. Stale-id cleanup lives in unregisterLayer
      // instead, the only call that knows a layer is gone for good rather than
      // merely not registered yet.
      seedStorage({ [CONST.STORAGE.NAMES_KEY]: { ghost: "Ghost", a: "A2" } });
      const p = makePersistence(["a", "b"]);

      expect(p.load().names).toEqual({ ghost: "Ghost", a: "A2" });
    });

    it("returns empty containers where storage has nothing", () => {
      expect(makePersistence(["a"]).load()).toEqual({
        order: null,
        foldedGroups: new Set(),
        hiddenIds: new Set(),
        names: {},
      });
    });

    it("tolerates a corrupt record of the wrong shape", () => {
      seedStorage({
        [CONST.STORAGE.ORDER_KEY]: "not-array",
        [CONST.STORAGE.VISIBILITY_KEY]: 42,
        [CONST.STORAGE.FOLD_KEY]: "OVERLAYS",
        [CONST.STORAGE.NAMES_KEY]: [],
      });
      const p = makePersistence(["a"]);

      expect(p.load()).toEqual({
        order: null,
        foldedGroups: new Set(),
        hiddenIds: new Set(),
        names: {},
      });
    });

    it("drops a hidden set with a non-string entry", () => {
      // A non-string entry fails the `every` check and discards the whole
      // record: keeping the valid subset would silently drop a layer the user
      // hid for the next reload, so failing to the default state is safer.
      seedStorage({ [CONST.STORAGE.VISIBILITY_KEY]: ["a", 123, "b", null] });
      expect(makePersistence(["a", "b", "c"]).load().hiddenIds).toEqual(new Set());
    });

    it("drops non-string values from names", () => {
      seedStorage({ [CONST.STORAGE.NAMES_KEY]: { a: "A2", b: 123, c: null } });
      expect(makePersistence(["a", "b", "c"]).load().names).toEqual({
        a: "A2",
      });
    });
  });

  // ── Write ───────────────────────────────────────────────────────

  describe("saveOrder", () => {
    it("debounces rapid calls into one write", () => {
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
      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0][1]).toEqual(["b", "a", "c"]);
      save.mockRestore();
      vi.useRealTimers();
    });
  });

  describe("saveHiddenIds", () => {
    it("debounces rapid calls into one write and serializes the set", () => {
      vi.useFakeTimers();
      const save = vi.spyOn(Storage, "save").mockImplementation(() => undefined);
      const p = makePersistence(["a", "b"]);
      p.saveHiddenIds(() => new Set(["a"]));
      p.saveHiddenIds(() => new Set(["a", "b"]));
      expect(save).not.toHaveBeenCalled();

      vi.advanceTimersByTime(CONST.SAVE_ORDER_DEBOUNCE_MS + 50);
      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0][1]).toEqual(["a", "b"]);
      save.mockRestore();
      vi.useRealTimers();
    });
  });

  describe("saveNames", () => {
    it("debounces rapid calls into one write", () => {
      vi.useFakeTimers();
      const save = vi.spyOn(Storage, "save").mockImplementation(() => undefined);
      const p = makePersistence(["a", "b"]);
      p.saveNames(() => ({ a: "A1" }));
      p.saveNames(() => ({ a: "A2", b: "B1" }));
      p.saveNames(() => ({ a: "A3", b: "B2" }));
      expect(save).not.toHaveBeenCalled();

      vi.advanceTimersByTime(CONST.SAVE_ORDER_DEBOUNCE_MS + 50);

      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0][1]).toEqual({ a: "A3", b: "B2" });
      save.mockRestore();
      vi.useRealTimers();
    });
  });

  describe("saveFoldedGroups", () => {
    it("saves synchronously", () => {
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

  describe("flushAll", () => {
    it("commits every pending dimension", () => {
      vi.useFakeTimers();
      const save = vi.spyOn(Storage, "save").mockImplementation(() => undefined);
      const p = makePersistence(["a", "b"]);
      p.saveOrder(() => ["a", "b"]);
      p.saveHiddenIds(() => new Set(["a"]));
      p.saveNames(() => ({ a: "A" }));

      p.flushAll();
      expect(save).toHaveBeenCalledTimes(3);
      expect(save).toHaveBeenCalledWith(
        CONST.STORAGE.ORDER_KEY,
        ["a", "b"],
        "LayerControl",
      );
      expect(save).toHaveBeenCalledWith(
        CONST.STORAGE.VISIBILITY_KEY,
        ["a"],
        "LayerControl",
      );
      expect(save).toHaveBeenCalledWith(
        CONST.STORAGE.NAMES_KEY,
        { a: "A" },
        "LayerControl",
      );

      // Each timer is consumed, so advancing writes nothing else.
      vi.advanceTimersByTime(CONST.SAVE_ORDER_DEBOUNCE_MS + 50);
      expect(save).toHaveBeenCalledTimes(3);
      save.mockRestore();
      vi.useRealTimers();
    });

    it("is a no-op when nothing is pending", () => {
      const save = vi.spyOn(Storage, "save").mockImplementation(() => undefined);
      const p = makePersistence(["a"]);
      p.flushAll();
      expect(save).not.toHaveBeenCalled();
      save.mockRestore();
      vi.useRealTimers();
    });
  });

  describe("destroy", () => {
    it("flushes every in-flight write rather than dropping it", () => {
      // Teardown used to cancel first, which made a later flush a no-op and
      // lost any change made inside the 100ms debounce window. Flush-then-cancel
      // removes the ordering dependency on the caller.
      vi.useFakeTimers();
      const save = vi.spyOn(Storage, "save").mockImplementation(() => undefined);
      const p = makePersistence(["a", "b"]);
      p.saveOrder(() => ["a", "b"]);
      p.saveHiddenIds(() => new Set(["a"]));
      p.saveNames(() => ({ a: "A" }));

      p.destroy();
      expect(save).toHaveBeenCalledTimes(3);
      vi.advanceTimersByTime(CONST.SAVE_ORDER_DEBOUNCE_MS + 50);
      expect(save).toHaveBeenCalledTimes(3);
      save.mockRestore();
      vi.useRealTimers();
    });

    it("is a no-op when no writes are pending", () => {
      const p = makePersistence(["a"]);
      expect(() => p.destroy()).not.toThrow();
    });
  });
});
