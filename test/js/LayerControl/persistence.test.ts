import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import {
  LayerPersistence,
  RECORD_VERSION,
} from "#foliplus/LayerControl/persistence.js";
import type { PersistedRecord } from "#foliplus/LayerControl/persistence.js";
import * as Storage from "#common/storage.js";

const makePersistence = () => new LayerPersistence();

const emptyRecord = (): PersistedRecord => ({
  version: RECORD_VERSION,
  order: null,
  removed: [],
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

/** Spy `Storage.saveRecord` so a test can count writes without touching localStorage
 *  -- the record under assertion is then the one handed to the spy. */
const spySave = () => vi.spyOn(Storage, "saveRecord").mockImplementation(() => true);

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

  describe("loadRecord", () => {
    it("loads every dimension from one record", () => {
      seedStorage({
        version: RECORD_VERSION,
        order: ["a", "b"],
        foldedGroups: ["OVERLAYS"],
        renamedNames: { a: "A2" },
        annotations: { a: { show: true, field: "name", format: "auto" } },
        layers: { a: { visible: false, overrides: ["visible"] } },
      });
      expect(makePersistence().load()).toEqual({
        version: RECORD_VERSION,
        order: ["a", "b"],
        removed: [],
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
        version: RECORD_VERSION,
        order: ids,
        removed: [],
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
      expect(makePersistence().load()).toEqual(record);
    });

    it("keeps ids that are not registered yet", () => {
      // load() runs from LayerUI.attachUI, which lands before HeatmapControl and
      // MeasureControl register in their own constructor. Pruning against the
      // registry here would drop their order position and label config on the
      // very first attach, so the record comes back whole: the order is replayed
      // when the id registers (LayerManager.replaySavedOrder) and only
      // deleteLayer prunes an id that is actually gone.
      seedStorage({
        order: ["a", "ghost", "b", "gone"],
        annotations: {
          a: { show: true, field: "name", format: "auto" },
          ghost: { show: true, field: "x", format: "int" },
        },
      });

      expect(makePersistence().load().order).toEqual(["a", "ghost", "b", "gone"]);
      expect(makePersistence().load().annotations).toEqual({
        a: { show: true, field: "name", format: "auto" },
        ghost: { show: true, field: "x", format: "int" },
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
      const p = makePersistence();

      expect(p.load().layers).toEqual({
        a: { visible: false, overrides: ["visible"] },
      });
      expect(p.load().renamedNames).toEqual({ ghost: "Ghost", a: "A2" });
    });

    it("returns empty containers where storage has nothing", () => {
      expect(makePersistence().load()).toEqual(emptyRecord());
    });

    it("tolerates a corrupt record of the wrong shape", () => {
      seedStorage("not-json-object");
      expect(makePersistence().load()).toEqual(emptyRecord());

      seedStorage([42]);
      expect(makePersistence().load()).toEqual(emptyRecord());
    });

    it("drops order when it holds a non-string entry", () => {
      // A non-string entry fails the check and discards the whole dimension:
      // keeping a partial order would silently re-order the layers the user
      // arranged, so failing to the declared order is safer.
      seedStorage({ order: ["a", 123, "b", null] });
      expect(makePersistence().load().order).toEqual(null);
    });

    it("drops non-string values from names and bad groups from fold state", () => {
      seedStorage({
        renamedNames: { a: "A2", b: 123, c: null },
        foldedGroups: ["OVERLAYS", 7],
      });
      const p = makePersistence();

      expect(p.load().renamedNames).toEqual({ a: "A2" });
      expect(p.load().foldedGroups).toEqual([]);
    });

    it("keeps removed ids in the order they were deleted", () => {
      // One-way bookkeeping: nothing ever prunes this list, so the ids come
      // back exactly as stored and the registration entry point refuses each.
      seedStorage({ removed: ["a", "c", "b"] });
      expect(makePersistence().load().removed).toEqual(["a", "c", "b"]);
    });

    it("drops removed when it holds a non-string entry", () => {
      // Same tolerance as order: a bad entry fails the check and discards the
      // whole dimension, so a corrupted value cannot read back as a deletion.
      seedStorage({ removed: ["a", 7, null] });
      expect(makePersistence().load().removed).toEqual([]);
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
      const p = makePersistence();

      expect(p.load().annotations).toEqual({
        a: { show: true, field: "name", format: "auto" },
        ghost: { show: true, field: "x", format: "int" },
      });
    });

    it("expands short hex annotation color to #rrggbb", () => {
      // The annotation color is the label paint and also goes through the
      // style panel's <input type=color>, so the same expansion applies as
      // to layers' fill/border: #rgb on disk becomes #rrggbb on read. Long
      // hex (either case) is left alone — normalizeHexColor only expands the
      // short form.
      seedStorage({
        annotations: {
          a: { show: true, field: "n", format: "auto", color: "#fff" },
          b: { show: true, field: "n", format: "auto", color: "#ABC" },
          c: { show: true, field: "n", format: "auto", color: "#ff0000" },
          d: { show: true, field: "n", format: "auto", color: "#FF0000" },
        },
      });
      expect(makePersistence().load().annotations).toEqual({
        a: { show: true, field: "n", format: "auto", color: "#ffffff" },
        b: { show: true, field: "n", format: "auto", color: "#aabbcc" },
        c: { show: true, field: "n", format: "auto", color: "#ff0000" },
        d: { show: true, field: "n", format: "auto", color: "#FF0000" },
      });
    });

    it("leaves a non-hex annotation color alone", () => {
      // The annotations section has no isHexColor gate (unlike layers), so
      // values the UI would not have written still round-trip unchanged —
      // the write side is equally permissive, and both consumers (canvas
      // fillStyle, color input) tolerate a bad value by falling back to
      // their default.
      seedStorage({
        annotations: {
          a: { show: true, field: "n", format: "auto", color: "red" },
          b: { show: true, field: "n", format: "auto", color: "#ffff" },
          c: { show: true, field: "n", format: "auto", color: "123" },
          d: { show: true, field: "n", format: "auto", color: 42 },
          e: { show: true, field: "n", format: "auto", color: null },
          f: { show: true, field: "n", format: "auto" },
        },
      });
      expect(makePersistence().load().annotations).toEqual({
        a: { show: true, field: "n", format: "auto", color: "red" },
        b: { show: true, field: "n", format: "auto", color: "#ffff" },
        c: { show: true, field: "n", format: "auto", color: "123" },
        d: { show: true, field: "n", format: "auto", color: 42 },
        e: { show: true, field: "n", format: "auto", color: null },
        f: { show: true, field: "n", format: "auto" },
      });
    });
  });

  // ── Version ─────────────────────────────────────────────────────

  describe("version", () => {
    it("reads a legacy record (no version) with all six dimensions intact", () => {
      // Old records have no version field at all. parseRecord must leave
      // them alone — every dimension still parses, and version falls back
      // to RECORD_VERSION so the next write stamps the record up to date
      // without any migration step.
      seedStorage({
        order: ["a", "b"],
        foldedGroups: ["OVERLAYS"],
        renamedNames: { a: "A2" },
        annotations: { a: { show: true, field: "name", format: "auto" } },
        layers: { a: { visible: false, overrides: ["visible"] } },
      });
      expect(makePersistence().load()).toEqual({
        version: RECORD_VERSION,
        order: ["a", "b"],
        removed: [],
        foldedGroups: ["OVERLAYS"],
        renamedNames: { a: "A2" },
        annotations: { a: { show: true, field: "name", format: "auto" } },
        layers: { a: { visible: false, overrides: ["visible"] } },
      });
    });

    it("keeps every dimension when the stored version is missing or unknown", () => {
      // Same per-segment tolerance as every other field: a mismatch on
      // version drops only the version segment, not the rest of the
      // record. A record from an older build is exactly this shape.
      for (const version of [undefined, "2020-01-01", 42, null]) {
        seedStorage({
          version,
          order: ["a", "b"],
          foldedGroups: ["OVERLAYS"],
          renamedNames: { a: "A2" },
          annotations: { a: { show: true, field: "name", format: "auto" } },
          layers: { a: { visible: false, overrides: ["visible"] } },
        });
        expect(makePersistence().load().version).toBe(RECORD_VERSION);
      }
      seedStorage({
        order: ["a", "b"],
        foldedGroups: ["OVERLAYS"],
        renamedNames: { a: "A2" },
        annotations: { a: { show: true, field: "name", format: "auto" } },
        layers: { a: { visible: false, overrides: ["visible"] } },
      });
      expect(makePersistence().load().version).toBe(RECORD_VERSION);
    });

    it("writes every record with the current version", () => {
      // mergeFields stamps RECORD_VERSION unconditionally, so a scheduled
      // write always carries the current shape marker — the write path
      // that brings a legacy record up to date.
      vi.useFakeTimers();
      const save = spySave();
      const p = makePersistence();
      p.schedule({ order: () => ["a", "b"] });

      vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);

      expect(lastRecord(save).version).toBe(RECORD_VERSION);
      save.mockRestore();
      vi.useRealTimers();
    });

    it("writes the current version when the stored record is missing or stale", () => {
      // The write path is what actually moves a legacy record forward:
      // the stored version (absent or an older value) does not survive the
      // rebuild, the current one does.
      vi.useFakeTimers();
      const save = spySave();
      seedStorage({
        version: 0,
        order: ["a", "b"],
        foldedGroups: ["OVERLAYS"],
        renamedNames: { a: "A2" },
        annotations: { a: { show: true, field: "name", format: "auto" } },
        layers: { a: { visible: false, overrides: ["visible"] } },
      });
      const p = makePersistence();
      p.schedule({ order: () => ["b", "a"] });

      vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);

      expect(lastRecord(save)).toEqual({
        version: RECORD_VERSION,
        order: ["b", "a"],
        removed: [],
        foldedGroups: ["OVERLAYS"],
        renamedNames: { a: "A2" },
        annotations: { a: { show: true, field: "name", format: "auto" } },
        layers: { a: { visible: false, overrides: ["visible"] } },
      });
      save.mockRestore();
      vi.useRealTimers();
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
      expect(makePersistence().load().layers).toEqual({
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
      expect(makePersistence().load().layers).toEqual({
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
      // declaration must never masquerade as a user's drag. The border axes
      // ride the same rule: an authored stroke with no provenance must stay a
      // declaration, never a user choice.
      seedStorage({
        layers: {
          a: { visible: false, overrides: [] },
          b: { visible: false },
          c: { opacity: 0.3 },
          d: { zoomRange: [3, 12], overrides: [] },
          e: { zoomRange: [3, 12] },
          f: { borderColor: "#ff0000" },
          g: { borderWeight: 3, overrides: [] },
          h: { borderColor: "#ff0000", overrides: [] },
          i: { borderWeight: 3 },
        },
      });
      expect(makePersistence().load().layers).toEqual({});
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
      expect(makePersistence().load().layers).toEqual({
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
      expect(makePersistence().load().layers).toEqual({
        d: { opacity: 0.5, overrides: ["opacity"] },
      });
    });

    it("restores a border color and width with their provenance", () => {
      // The border dimensions ride the same value-plus-provenance rule as the
      // rest: a stored stroke without an override is an author default, and
      // reading it back as a user choice would repaint a layer nobody touched.
      seedStorage({
        layers: {
          a: { borderColor: "#ff0000", overrides: ["borderColor"] },
          b: { borderWeight: 3.5, overrides: ["borderWeight"] },
          c: {
            borderColor: "#00ff00",
            borderWeight: 6,
            overrides: ["borderColor", "borderWeight"],
          },
        },
      });
      expect(makePersistence().load().layers).toEqual({
        a: { borderColor: "#ff0000", overrides: ["borderColor"] },
        b: { borderWeight: 3.5, overrides: ["borderWeight"] },
        c: {
          borderColor: "#00ff00",
          borderWeight: 6,
          overrides: ["borderColor", "borderWeight"],
        },
      });
    });

    it("keeps the fill color and opacity the user set, with provenance", () => {
      seedStorage({
        layers: {
          a: { fillColor: "#ff0000", overrides: ["fillColor"] },
          b: { fillOpacity: 0.4, overrides: ["fillOpacity"] },
          c: {
            fillColor: "#00ff00",
            fillOpacity: 0.6,
            overrides: ["fillColor", "fillOpacity"],
          },
        },
      });
      expect(makePersistence().load().layers).toEqual({
        a: { fillColor: "#ff0000", overrides: ["fillColor"] },
        b: { fillOpacity: 0.4, overrides: ["fillOpacity"] },
        c: {
          fillColor: "#00ff00",
          fillOpacity: 0.6,
          overrides: ["fillColor", "fillOpacity"],
        },
      });
    });

    it("drops border values the UI could not display", () => {
      // A corrupt entry must not leak into <input type=color> nor ask for a
      // width outside the shared bounds: both validators fail closed, and a
      // dimension that loses its value drops its provenance with it. c and d
      // are 4 and 5 hex digits — legal-looking, but no input type=color accepts
      // anything but 3 or 6.
      seedStorage({
        layers: {
          a: { borderColor: "red", overrides: ["borderColor"] },
          b: { borderColor: "#1234567", overrides: ["borderColor"] },
          c: { borderColor: "#aabb", overrides: ["borderColor"] },
          d: { borderColor: "#aaabb", overrides: ["borderColor"] },
          e: { borderColor: 42, overrides: ["borderColor"] },
          f: { borderColor: "#a1b", overrides: ["borderColor"] },
          g: { borderWeight: 99, overrides: ["borderWeight"] },
          h: { borderWeight: -1, overrides: ["borderWeight"] },
          i: { borderWeight: NaN, overrides: ["borderWeight"] },
          j: { borderWeight: "3", overrides: ["borderWeight"] },
          k: { borderWeight: 0.5, overrides: ["borderWeight"] },
          l: { borderWeight: 10, overrides: ["borderWeight"] },
        },
      });
      expect(makePersistence().load().layers).toEqual({
        // #a1b is a valid short hex, so it survives — expanded to #rrggbb,
        // which is what <input type=color> accepts.
        f: { borderColor: "#aa11bb", overrides: ["borderColor"] },
        k: { borderWeight: 0.5, overrides: ["borderWeight"] },
        // The upper bound is inclusive: the field's own max.
        l: { borderWeight: 10, overrides: ["borderWeight"] },
      });
    });

    it("drops fill colors that are not #rgb or #rrggbb hex", () => {
      seedStorage({
        layers: {
          a: { fillColor: "red", overrides: ["fillColor"] },
          b: { fillColor: "#ff00", overrides: ["fillColor"] },
          c: { fillColor: 42, overrides: ["fillColor"] },
          d: { fillColor: "#123456", overrides: ["fillColor"] },
          e: { fillColor: "#fff", overrides: ["fillColor"] },
        },
      });
      // a, b and c cannot feed <input type=color>; d and e are valid hex, and
      // e is short-form — read back in its expanded form.
      expect(makePersistence().load().layers).toEqual({
        d: { fillColor: "#123456", overrides: ["fillColor"] },
        e: { fillColor: "#ffffff", overrides: ["fillColor"] },
      });
    });

    it("expands #rgb to #rrggbb on fill and border, so #fff and #ffffff round-trip equal", () => {
      // <input type=color> only accepts #rrggbb, and Python-authored defaults are
      // frequently short hex. The panel must see the long form regardless of the
      // shape on disk, so the two spellings collapse to the same stored value.
      seedStorage({
        layers: {
          a: { fillColor: "#f00", overrides: ["fillColor"] },
          b: { borderColor: "#0f0", overrides: ["borderColor"] },
          c: {
            fillColor: "#f0f",
            borderColor: "#00f",
            overrides: ["fillColor", "borderColor"],
          },
        },
      });
      expect(makePersistence().load().layers).toEqual({
        a: { fillColor: "#ff0000", overrides: ["fillColor"] },
        b: { borderColor: "#00ff00", overrides: ["borderColor"] },
        c: {
          fillColor: "#ff00ff",
          borderColor: "#0000ff",
          overrides: ["fillColor", "borderColor"],
        },
      });
    });

    it("drops fill opacities outside the valid range", () => {
      seedStorage({
        layers: {
          a: { fillOpacity: 2, overrides: ["fillOpacity"] },
          b: { fillOpacity: -0.1, overrides: ["fillOpacity"] },
          c: { fillOpacity: "high", overrides: ["fillOpacity"] },
          d: { fillOpacity: NaN, overrides: ["fillOpacity"] },
          e: { fillOpacity: 0.5, overrides: ["fillOpacity"] },
        },
      });
      expect(makePersistence().load().layers).toEqual({
        e: { fillOpacity: 0.5, overrides: ["fillOpacity"] },
      });
    });

    it("drops a fill override whose value fails validation", () => {
      seedStorage({
        layers: {
          a: { fillColor: "not-a-color", overrides: ["fillColor"] },
          b: {
            fillColor: "#abcdef",
            fillOpacity: 3,
            overrides: ["fillColor", "fillOpacity"],
          },
          c: { visible: false, fillColor: "x", overrides: ["visible", "fillColor"] },
        },
      });
      expect(makePersistence().load().layers).toEqual({
        b: { fillColor: "#abcdef", overrides: ["fillColor"] },
        c: { visible: false, overrides: ["visible"] },
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
      expect(makePersistence().load().layers).toEqual({
        a: { visible: false, overrides: ["visible"] },
        b: { visible: true, opacity: 0.4, overrides: ["visible", "opacity"] },
      });
    });

    it("deduplicates a repeated override", () => {
      seedStorage({
        layers: { a: { visible: false, overrides: ["visible", "visible", "opacity"] } },
      });
      expect(makePersistence().load().layers).toEqual({
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
      const record = makePersistence().load();

      expect(record.layers.a).toEqual({ visible: false, overrides: ["visible"] });
      expect(record.layers.b).toBeUndefined();
      expect(record.layers.c).toBeUndefined();
      expect((record as Record<string, unknown>).zoomRange).toBeUndefined();
      expect((record as Record<string, unknown>).effectiveShown).toBeUndefined();
    });

    it("drops a layer entry that is not an object", () => {
      seedStorage({ layers: { a: ["array"], b: null, c: "text" } });
      expect(makePersistence().load().layers).toEqual({});
    });
  });

  // ── Write ───────────────────────────────────────────────────────

  describe("schedule", () => {
    it("debounces rapid writes into one record of the last state", () => {
      vi.useFakeTimers();
      const save = spySave();
      const p = makePersistence();
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
      const p = makePersistence();
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
        version: RECORD_VERSION,
        order: ["a", "b"],
        removed: [],
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
      const p = makePersistence();
      p.schedule({ order: () => ["b", "a"] });

      vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);

      expect(lastRecord(save)).toEqual({
        version: RECORD_VERSION,
        order: ["b", "a"],
        removed: [],
        foldedGroups: ["OVERLAYS"],
        renamedNames: { a: "A" },
        annotations: { a: { show: true, field: "n", format: "auto" } },
        layers: { a: { visible: false, overrides: ["visible"] } },
      });
      save.mockRestore();
      vi.useRealTimers();
    });

    it("writes the removed ids on the shared timer", () => {
      // `removed` joins the record as one more dimension on the same single
      // debounce, so a deletion never needs its own writer to land.
      vi.useFakeTimers();
      const save = spySave();
      const p = makePersistence();
      p.schedule({ removed: () => ["a", "b"] });

      vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);

      expect(lastRecord(save).removed).toEqual(["a", "b"]);
      save.mockRestore();
      vi.useRealTimers();
    });

    it("carries removed through a write that never schedules it", () => {
      // The list is one-way: an unrelated save must not be able to drop a
      // deletion, or the layer would come back on the next reload.
      seedStorage({ removed: ["a"] });
      vi.useFakeTimers();
      const save = spySave();
      const p = makePersistence();
      p.schedule({ order: () => ["x"] });
      p.flushAll();

      expect(lastRecord(save).removed).toEqual(["a"]);
      save.mockRestore();
      vi.useRealTimers();
    });

    it("writes the whole record to the single key", () => {
      vi.useFakeTimers();
      const save = spySave();
      const p = makePersistence();
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

    it("leaves a short-hex color on disk expanded after a write that never touches layers", () => {
      // `schedule` re-reads what storage holds and merges only the dimensions
      // the caller scheduled, so a write that touches only the order still
      // round-trips the layer record. The record is parsed on the way in,
      // which is where short hex becomes long hex — so a write that never
      // touches layers still re-stamps disk with the normalized colors. This
      // is the write-side half of the normalization guarantee: read is where
      // the change happens, and every later write carries the normalized form
      // forward rather than regressing it.
      seedStorage({
        layers: {
          a: {
            fillColor: "#f00",
            borderColor: "#0f0",
            overrides: ["fillColor", "borderColor"],
          },
        },
      });
      vi.useFakeTimers();
      const save = spySave();
      const p = makePersistence();
      p.schedule({ order: () => ["a"] });

      vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);

      expect(lastRecord(save).layers.a).toEqual({
        fillColor: "#ff0000",
        borderColor: "#00ff00",
        overrides: ["fillColor", "borderColor"],
      });
      save.mockRestore();
      vi.useRealTimers();
    });

    it("is a no-op when nothing is scheduled", () => {
      const save = spySave();
      const p = makePersistence();
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
      const p = makePersistence();
      p.schedule({ order: () => ["a", "b"] });
      p.schedule({
        layers: () => ({ a: { visible: false, overrides: ["visible"] } }),
      });

      p.flushAll();
      expect(save).toHaveBeenCalledTimes(1);
      expect(lastRecord(save)).toEqual({
        version: RECORD_VERSION,
        order: ["a", "b"],
        removed: [],
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
      const p = makePersistence();
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
      const p = makePersistence();
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
      const p = makePersistence();
      expect(() => p.destroy()).not.toThrow();
    });
  });
});
