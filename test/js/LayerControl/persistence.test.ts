import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import { LayerPersistence } from "#foliplus/LayerControl/persistence.js";
import type { PersistedRecord } from "#foliplus/LayerControl/persistence.js";
import * as Storage from "#common/storage.js";

const makeRegistry = (ids: string[]) =>
  ({
    layers: ids.map(id => ({ id })),
    get: id => (ids.includes(id) ? { id } : null),
  }) as any;

const makePersistence = (ids: string[]) => new LayerPersistence(makeRegistry(ids));

const emptyRecord = (): PersistedRecord => ({
  order: null,
  foldedGroups: [],
  renamedNames: {},
  annotations: {},
  layers: {},
});

/** Seed localStorage with a raw record, so load() is exercised against corrupt
 *  shapes as well as well-formed ones. */
const seedStorage = (record: unknown) => {
  window.localStorage.setItem(CONST.STORAGE.KEY, JSON.stringify(record));
};

/** Spy `Storage.save` so a test can count writes without touching localStorage
 *  -- the record under assertion is then the one handed to the spy. */
const spySave = () => vi.spyOn(Storage, "save").mockImplementation(() => true);

const lastRecord = (save: ReturnType<typeof spySave>): PersistedRecord =>
  save.mock.calls.at(-1)![1] as PersistedRecord;

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
    it("loads every dimension from one record", () => {
      seedStorage({
        order: ["a", "b"],
        foldedGroups: ["OVERLAYS"],
        renamedNames: { a: "A2" },
        annotations: { a: { show: true, field: "name", format: "auto" } },
        layers: { a: { visible: false, overrides: ["visible"] } },
      });
      expect(makePersistence(["a", "b", "c"]).load()).toEqual({
        order: ["a", "b"],
        foldedGroups: ["OVERLAYS"],
        renamedNames: { a: "A2" },
        annotations: { a: { show: true, field: "name", format: "auto" } },
        layers: { a: { visible: false, overrides: ["visible"] } },
      });
    });

    it("round-trips every section the record declares", () => {
      // Forward-compat guard: parseRecord must copy through every section of
      // PersistedRecord, because the write rebuilds the record through it.
      // Add a dimension to the type and forget the parser, and this test fails
      // on the new field — the silent-loss case has no other visible symptom.
      const ids = ["a", "b"];
      const record: PersistedRecord = {
        order: ids,
        foldedGroups: ["OVERLAYS"],
        renamedNames: { a: "A2" },
        annotations: { a: { show: true, field: "name", format: "auto" } },
        layers: {
          a: {
            visible: false,
            opacity: 0.4,
            zoomRange: [3, 12],
            overrides: ["visible", "opacity", "zoomRange"],
          },
          b: { visible: true, overrides: ["visible"] },
        },
      };
      seedStorage(record);
      expect(makePersistence(ids).load()).toEqual(record);
    });

    it("drops unknown ids from order and annotation config", () => {
      // Order is rebuilt on every save, so a stale id is skipped when it is
      // applied. Annotations are a pure decoration, so nothing loses work if a
      // stale id is dropped here.
      seedStorage({
        order: ["a", "ghost", "b", "gone"],
        annotations: {
          a: { show: true, field: "name", format: "auto" },
          ghost: { show: true, field: "x", format: "int" },
        },
      });
      const p = makePersistence(["a", "b", "c"]);

      expect(p.load().order).toEqual(["a", "b"]);
      expect(p.load().annotations).toEqual({
        a: { show: true, field: "name", format: "auto" },
      });
    });

    it("keeps intent and renames for ids that are not registered yet", () => {
      // attachUI lands before HeatmapControl and MeasureControl register in
      // their own constructor, so filtering here dropped their entries and the
      // layer came back on the map after every reload. Stale-id cleanup stays
      // with the applyUserState sweep, which runs after the late registrations.
      seedStorage({
        layers: { a: { visible: false, overrides: ["visible"] } },
        renamedNames: { ghost: "Ghost", a: "A2" },
      });
      const p = makePersistence(["a", "b"]);

      expect(p.load().layers).toEqual({
        a: { visible: false, overrides: ["visible"] },
      });
      expect(p.load().renamedNames).toEqual({ ghost: "Ghost", a: "A2" });
    });

    it("returns empty containers where storage has nothing", () => {
      expect(makePersistence(["a"]).load()).toEqual(emptyRecord());
    });

    it("tolerates a corrupt record of the wrong shape", () => {
      seedStorage("not-json-object");
      expect(makePersistence(["a"]).load()).toEqual(emptyRecord());

      seedStorage([42]);
      expect(makePersistence(["a"]).load()).toEqual(emptyRecord());
    });

    it("drops order when it holds a non-string entry", () => {
      // A non-string entry fails the check and discards the whole dimension:
      // keeping a partial order would silently re-order the layers the user
      // arranged, so failing to the declared order is safer.
      seedStorage({ order: ["a", 123, "b", null] });
      expect(makePersistence(["a", "b"]).load().order).toEqual(null);
    });

    it("drops non-string values from names and bad groups from fold state", () => {
      seedStorage({
        renamedNames: { a: "A2", b: 123, c: null },
        foldedGroups: ["OVERLAYS", 7],
      });
      const p = makePersistence(["a", "b", "c"]);

      expect(p.load().renamedNames).toEqual({ a: "A2" });
      expect(p.load().foldedGroups).toEqual([]);
    });

    it("drops annotation entries that are not plain objects", () => {
      // Arrays pass the typeof object check, so they are excluded explicitly --
      // a corrupted record must not leak into the config as a valid object.
      seedStorage({
        annotations: {
          a: { show: true, field: "name", format: "auto" },
          ghost: { show: true, field: "x", format: "int" },
          b: null,
          c: "not-object",
          d: ["array"],
        },
      });
      const p = makePersistence(["a", "b", "c"]);

      expect(p.load().annotations).toEqual({
        a: { show: true, field: "name", format: "auto" },
      });
    });
  });

  // ── Provenance ──────────────────────────────────────────────────

  describe("layers (overrides)", () => {
    it("restores each dimension the user set, with its provenance", () => {
      seedStorage({
        layers: {
          a: { visible: false, overrides: ["visible"] },
          b: { visible: true, overrides: ["visible"] },
          c: { opacity: 0.5, overrides: ["opacity"] },
          d: { zoomRange: [3, 12], overrides: ["zoomRange"] },
          e: {
            visible: false,
            opacity: 0.4,
            zoomRange: [4, 10],
            overrides: ["visible", "opacity", "zoomRange"],
          },
        },
      });
      expect(makePersistence(["a", "b", "c", "d", "e"]).load().layers).toEqual({
        a: { visible: false, overrides: ["visible"] },
        b: { visible: true, overrides: ["visible"] },
        c: { opacity: 0.5, overrides: ["opacity"] },
        d: { zoomRange: [3, 12], overrides: ["zoomRange"] },
        e: {
          visible: false,
          opacity: 0.4,
          zoomRange: [4, 10],
          overrides: ["visible", "opacity", "zoomRange"],
        },
      });
    });

    it("drops zoom ranges that are not two finite numbers in order", () => {
      seedStorage({
        layers: {
          a: { zoomRange: [12, 3], overrides: ["zoomRange"] },
          b: { zoomRange: [3], overrides: ["zoomRange"] },
          c: { zoomRange: [3, "12"], overrides: ["zoomRange"] },
          d: { zoomRange: [NaN, 12], overrides: ["zoomRange"] },
          e: { zoomRange: { min: 3, max: 12 }, overrides: ["zoomRange"] },
          f: { zoomRange: [0, 24], overrides: ["zoomRange"] },
          g: { zoomRange: [7, 7], overrides: ["zoomRange"] },
        },
      });
      expect(
        makePersistence(["a", "b", "c", "d", "e", "f", "g"]).load().layers,
      ).toEqual({
        // The low end is allowed to equal the high end: a layer shown at one
        // zoom level only.
        f: { zoomRange: [0, 24], overrides: ["zoomRange"] },
        g: { zoomRange: [7, 7], overrides: ["zoomRange"] },
      });
    });

    it("drops a value that has no provenance", () => {
      // `visible: false` with an empty overrides list is a value the record
      // itself says was never chosen, so it is dropped: keeping it would hide a
      // layer the user never touched. An author's declared min_zoom / max_zoom
      // reaches the record the same way — as a value with no provenance — so the
      // declaration must never masquerade as a user's drag.
      seedStorage({
        layers: {
          a: { visible: false, overrides: [] },
          b: { visible: false },
          c: { opacity: 0.3 },
          d: { zoomRange: [3, 12], overrides: [] },
          e: { zoomRange: [3, 12] },
        },
      });
      expect(makePersistence(["a", "b", "c", "d", "e"]).load().layers).toEqual({});
    });

    it("drops an override that has no valid value", () => {
      seedStorage({
        layers: {
          a: { overrides: ["visible"] },
          b: { visible: "yes", overrides: ["visible"] },
          c: { opacity: 0.5, overrides: ["opacity"] },
          d: { overrides: ["zoomRange"] },
          e: { zoomRange: [12, 3], overrides: ["zoomRange"] },
        },
      });
      // a, b, d and e claim a choice the record cannot honour, so they are
      // dropped entirely; c keeps its value and its provenance.
      expect(makePersistence(["a", "b", "c", "d", "e"]).load().layers).toEqual({
        c: { opacity: 0.5, overrides: ["opacity"] },
      });
    });

    it("drops opacity values outside the valid range", () => {
      seedStorage({
        layers: {
          a: { opacity: 2, overrides: ["opacity"] },
          b: { opacity: -0.1, overrides: ["opacity"] },
          c: { opacity: "high", overrides: ["opacity"] },
          d: { opacity: 0.5, overrides: ["opacity"] },
          e: { opacity: NaN, overrides: ["opacity"] },
        },
      });
      expect(makePersistence(["a", "b", "c", "d", "e"]).load().layers).toEqual({
        d: { opacity: 0.5, overrides: ["opacity"] },
      });
    });

    it("drops an entry that loses every dimension to validation", () => {
      // One bad dimension must not sink the good one: a and b survive, c does
      // not, so the record cannot keep provenance for a value it lost.
      seedStorage({
        layers: {
          a: { visible: false, opacity: 2, overrides: ["visible", "opacity"] },
          b: { visible: true, opacity: 0.4, overrides: ["visible", "opacity"] },
          c: { opacity: 2, overrides: ["opacity"] },
        },
      });
      expect(makePersistence(["a", "b", "c"]).load().layers).toEqual({
        a: { visible: false, overrides: ["visible"] },
        b: { visible: true, opacity: 0.4, overrides: ["visible", "opacity"] },
      });
    });

    it("deduplicates a repeated override", () => {
      seedStorage({
        layers: { a: { visible: false, overrides: ["visible", "visible", "opacity"] } },
      });
      expect(makePersistence(["a"]).load().layers).toEqual({
        a: { visible: false, overrides: ["visible"] },
      });
    });

    it("keeps declarations and derived state out of the record", () => {
      // A zoom range is intent only after the user has moved the handles: with
      // provenance the value is kept, without it (the author's declaration) it
      // is discarded, and an override with no valid value drops the whole entry.
      // The record has no top-level place for a policy either, which is what
      // keeps a policy from being able to write over a user's intent.
      seedStorage({
        zoomRange: { min: 3, max: 12 },
        effectiveShown: { a: false },
        layers: {
          a: {
            visible: false,
            overrides: ["visible"],
            zoomRange: { min: 3, max: 12 },
          },
          b: { zoomRange: [3, 12], overrides: [] },
          c: { visible: false, overrides: ["zoomRange"] },
        },
      });
      const record = makePersistence(["a", "b", "c"]).load();

      expect(record.layers.a).toEqual({ visible: false, overrides: ["visible"] });
      expect(record.layers.b).toBeUndefined();
      expect(record.layers.c).toBeUndefined();
      expect((record as Record<string, unknown>).zoomRange).toBeUndefined();
      expect((record as Record<string, unknown>).effectiveShown).toBeUndefined();
    });

    it("drops a layer entry that is not an object", () => {
      seedStorage({ layers: { a: ["array"], b: null, c: "text" } });
      expect(makePersistence(["a", "b", "c"]).load().layers).toEqual({});
    });
  });

  describe("loadOrder", () => {
    it("loads the order dimension and drops unknown ids", () => {
      seedStorage({ order: ["a", "ghost", "b", "gone"] });
      expect(makePersistence(["a", "b", "c"]).loadOrder()).toEqual(["a", "b"]);
    });

    it("returns null on missing or corrupt data", () => {
      expect(makePersistence(["a"]).loadOrder()).toEqual(null);
      seedStorage({ order: "not-array" });
      expect(makePersistence(["a"]).loadOrder()).toEqual(null);
      seedStorage({ order: ["a", 123] });
      expect(makePersistence(["a", "b"]).loadOrder()).toEqual(null);
    });

    it("reads the record key once", () => {
      // The whole point of the narrow read: LayerManager needs order and only
      // order at construction time, so it must not return the rest of the
      // record either. One key is read either way.
      const keys: string[] = [];
      const spy = vi.spyOn(Storage, "load").mockImplementation((key: unknown) => {
        keys.push(String(key));
        return undefined;
      });
      makePersistence(["a"]).loadOrder();
      spy.mockRestore();
      expect(keys).toEqual([CONST.STORAGE.KEY]);
    });
  });

  // ── Write ───────────────────────────────────────────────────────

  describe("schedule", () => {
    it("debounces rapid writes into one record of the last state", () => {
      vi.useFakeTimers();
      const save = spySave();
      const p = makePersistence(["a", "b"]);
      p.schedule({ order: () => ["a", "b"] });
      p.schedule({ order: () => ["b", "a"] });
      p.schedule({ order: () => ["b", "a", "c"] });
      expect(save).not.toHaveBeenCalled();

      vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);

      // The last getter wins -- it reads the live order, not the order at the
      // first call of the batch.
      expect(save).toHaveBeenCalledTimes(1);
      expect(lastRecord(save).order).toEqual(["b", "a", "c"]);
      save.mockRestore();
      vi.useRealTimers();
    });

    it("merges dimensions scheduled separately into one record", () => {
      vi.useFakeTimers();
      const save = spySave();
      const p = makePersistence(["a", "b"]);
      p.schedule({ order: () => ["a", "b"] });
      p.schedule({
        layers: () => ({ a: { visible: false, overrides: ["visible"] } }),
      });
      p.schedule({ foldedGroups: () => ["OVERLAYS"] });
      p.schedule({ renamedNames: () => ({ a: "A" }) });
      p.schedule({
        annotations: () => ({ a: { show: true, field: "n", format: "auto" } }),
      });

      vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);

      // Five schedules, one write: there is a single timer for the whole
      // record, so no dimension needs its own debounce bookkeeping.
      expect(save).toHaveBeenCalledTimes(1);
      expect(lastRecord(save)).toEqual({
        order: ["a", "b"],
        foldedGroups: ["OVERLAYS"],
        renamedNames: { a: "A" },
        annotations: { a: { show: true, field: "n", format: "auto" } },
        layers: { a: { visible: false, overrides: ["visible"] } },
      });
      save.mockRestore();
      vi.useRealTimers();
    });

    it("leaves a dimension alone when it is not scheduled", () => {
      // One record means one write must not be able to reset a dimension the
      // caller never touched -- a reorder used to live in its own key, so this
      // is what keeps it that way.
      seedStorage({
        order: ["a", "b"],
        foldedGroups: ["OVERLAYS"],
        renamedNames: { a: "A" },
        annotations: { a: { show: true, field: "n", format: "auto" } },
        layers: { a: { visible: false, overrides: ["visible"] } },
      });
      vi.useFakeTimers();
      const save = spySave();
      const p = makePersistence(["a", "b"]);
      p.schedule({ order: () => ["b", "a"] });

      vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);

      expect(lastRecord(save)).toEqual({
        order: ["b", "a"],
        foldedGroups: ["OVERLAYS"],
        renamedNames: { a: "A" },
        annotations: { a: { show: true, field: "n", format: "auto" } },
        layers: { a: { visible: false, overrides: ["visible"] } },
      });
      save.mockRestore();
      vi.useRealTimers();
    });

    it("writes the whole record to the single key", () => {
      vi.useFakeTimers();
      const save = spySave();
      const p = makePersistence(["a"]);
      p.schedule({ layers: () => ({ a: { visible: false, overrides: ["visible"] } }) });

      vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);

      expect(save).toHaveBeenCalledWith(
        CONST.STORAGE.KEY,
        expect.anything(),
        "LayerControl",
      );
      save.mockRestore();
      vi.useRealTimers();
    });

    it("is a no-op when nothing is scheduled", () => {
      const save = spySave();
      const p = makePersistence(["a"]);
      p.flushAll();
      expect(save).not.toHaveBeenCalled();
      save.mockRestore();
      vi.useRealTimers();
    });
  });

  describe("flushAll", () => {
    it("commits the pending record immediately", () => {
      vi.useFakeTimers();
      const save = spySave();
      const p = makePersistence(["a", "b"]);
      p.schedule({ order: () => ["a", "b"] });
      p.schedule({
        layers: () => ({ a: { visible: false, overrides: ["visible"] } }),
      });

      p.flushAll();
      expect(save).toHaveBeenCalledTimes(1);
      expect(lastRecord(save)).toEqual({
        order: ["a", "b"],
        foldedGroups: [],
        renamedNames: {},
        annotations: {},
        layers: { a: { visible: false, overrides: ["visible"] } },
      });

      // The write is consumed, so advancing writes nothing else.
      vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);
      expect(save).toHaveBeenCalledTimes(1);
      save.mockRestore();
      vi.useRealTimers();
    });

    it("rebuilds the record at flush time, not at schedule time", () => {
      vi.useFakeTimers();
      const save = spySave();
      const layers: Record<string, unknown> = {
        a: { visible: false, overrides: ["visible"] },
      };
      const p = makePersistence(["a"]);
      p.schedule({ layers: () => layers });

      layers.a = { visible: true, overrides: ["visible"] };
      p.flushAll();
      expect(lastRecord(save).layers).toEqual({
        a: { visible: true, overrides: ["visible"] },
      });
      save.mockRestore();
      vi.useRealTimers();
    });
  });

  describe("destroy", () => {
    it("flushes the pending write rather than dropping it", () => {
      // Teardown used to cancel first, which made a later flush a no-op and
      // lost any change made inside the debounce window. Flush-then-cancel
      // removes the ordering dependency on the caller.
      vi.useFakeTimers();
      const save = spySave();
      const p = makePersistence(["a", "b"]);
      p.schedule({ order: () => ["a", "b"] });
      p.schedule({
        layers: () => ({ a: { visible: false, overrides: ["visible"] } }),
      });

      p.destroy();
      expect(save).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);
      expect(save).toHaveBeenCalledTimes(1);
      save.mockRestore();
      vi.useRealTimers();
    });

    it("is a no-op when no writes are pending", () => {
      const p = makePersistence(["a"]);
      expect(() => p.destroy()).not.toThrow();
    });
  });
});
