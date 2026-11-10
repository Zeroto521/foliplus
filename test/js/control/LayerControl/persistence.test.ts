import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FILL_MODE, isValueConfig } from "#core/layer/index.js";
import * as Storage from "#platform/storage.js";
import * as CONST from "#control/LayerControl/const.js";
import { LayerPersistence, RECORD_VERSION } from "#control/LayerControl/persistence.js";
import type { LayerPersistedRecord } from "#control/LayerControl/type.js";

const makePersistence = () => new LayerPersistence();

const emptyRecord = (): LayerPersistedRecord => ({
  version: RECORD_VERSION,
  order: null,
  removed: [],
  foldedRoles: [],
  renamedNames: {},
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

const lastRecord = (save: ReturnType<typeof spySave>): LayerPersistedRecord =>
  save.mock.calls.at(-1)![1] as LayerPersistedRecord;

describe("LayerPersistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useRealTimers();
    window.CONFIG = { ...window.CONFIG, name: "LayerControl" };
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
        foldedRoles: ["OVERLAYS"],
        renamedNames: { a: "A2" },
        layers: { a: { visible: false, overrides: ["visible"] } },
      });
      expect(makePersistence().load()).toEqual({
        version: RECORD_VERSION,
        order: ["a", "b"],
        removed: [],
        foldedRoles: ["OVERLAYS"],
        renamedNames: { a: "A2" },
        layers: { a: { visible: false, overrides: ["visible"] } },
      });
    });

    it("round-trips every section the record declares", () => {
      // Forward-compat guard: parseRecord must copy through every section of
      // LayerPersistedRecord, because the write rebuilds the record through it.
      // Add a dimension to the type and forget the parser, and this test fails
      // on the new field — the silent-loss case has no other visible symptom.
      const ids = ["a", "b"];
      const record: LayerPersistedRecord = {
        version: RECORD_VERSION,
        order: ids,
        removed: [],
        foldedRoles: ["OVERLAYS"],
        renamedNames: { a: "A2" },
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

    it("drops a v2 record's legacy label segment (dual-key removal)", () => {
      // RECORD_VERSION 2 → 3 moved the label config into
      // `layers[id].label`. The legacy top-level `annotations` segment
      // is no longer read — a v2-only entry is dropped as invalid, and the
      // version is re-stamped as the current shape in the loaded record.
      seedStorage({
        version: 2,
        annotations: { a: { show: true, field: "name", format: "auto" } },
      });

      const rec = makePersistence().load();
      expect(rec.version).toBe(RECORD_VERSION);
      expect("annotations" in rec).toBe(false);
      expect(rec.layers).toEqual({});
    });

    it("drops a v3 record's fold state and re-stamps the current version on write", () => {
      // RECORD_VERSION 3 → 4 renamed `foldedGroups` to `foldedRoles`. There is
      // deliberately no compatibility read: the old segment is ignored (fold
      // state lost) while every other field survives, and the next write
      // stamps the current version.
      seedStorage({
        version: 3,
        order: ["a"],
        foldedGroups: ["OVERLAYS"],
        renamedNames: { a: "A2" },
      });

      const rec = makePersistence().load();
      expect(rec.version).toBe(RECORD_VERSION);
      expect(rec.order).toEqual(["a"]);
      expect(rec.renamedNames).toEqual({ a: "A2" });
      expect(rec.foldedRoles).toEqual([]);

      vi.useFakeTimers();
      const save = spySave();
      const p = makePersistence();
      p.schedule({ order: () => ["a"] });
      vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);

      expect(lastRecord(save).version).toBe(RECORD_VERSION);
      expect(lastRecord(save).foldedRoles).toEqual([]);
      save.mockRestore();
      vi.useRealTimers();
    });

    it("keeps the current key and drops the legacy segment (dual-key removal)", () => {
      // The legacy segment passes through no longer — `layers[id].label`
      // is the only label key, and the reader (the label seed) reads it.
      seedStorage({
        version: RECORD_VERSION,
        annotations: { both: { show: false, field: "old" } },
        layers: {
          // An label-only entry — empty `overrides` survives parse.
          both: { overrides: [], label: { show: true, field: "new" } },
        },
      });

      const rec = makePersistence().load();
      expect(rec.layers.both).toEqual({
        overrides: [],
        label: { show: true, field: "new" },
      });
      expect("annotations" in rec).toBe(false);
    });

    it("drops a v4 record's annotation key and re-stamps v5 on write (4 → 5)", () => {
      // RECORD_VERSION 4 → 5 renamed `layers[id].annotation` to
      // `layers[id].label`. There is deliberately no compatibility read:
      // the old key is ignored (label config dropped) while every other
      // field survives, and the next write stamps v5.
      seedStorage({
        version: 4,
        order: ["a"],
        renamedNames: { a: "A2" },
        layers: {
          a: { overrides: [], annotation: { show: true, field: "name" } },
        },
      });

      const rec = makePersistence().load();
      expect(rec.version).toBe(RECORD_VERSION);
      expect(rec.order).toEqual(["a"]);
      expect(rec.renamedNames).toEqual({ a: "A2" });
      expect(rec.layers).toEqual({});

      vi.useFakeTimers();
      const save = spySave();
      const p = makePersistence();
      p.schedule({ order: () => ["a"] });
      vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);

      const written = lastRecord(save);
      expect(written.version).toBe(RECORD_VERSION);
      expect(written.layers).toEqual({});
      save.mockRestore();
      vi.useRealTimers();
    });

    it("prunes a deleted id from the label segment on read", () => {
      // Deletion is not migration: the write side drops the ids it records
      // as removed, and the read side does the same — so a record written
      // before either prune still loads without resurrecting the config.
      seedStorage({
        removed: ["gone"],
        layers: {
          gone: { overrides: [], label: { show: true } },
          kept: { overrides: [], label: { show: false } },
        },
      });

      const rec = makePersistence().load();
      expect(rec.layers).toEqual({
        kept: { overrides: [], label: { show: false } },
      });
    });

    it("keeps ids that are not registered yet", () => {
      // load() runs from LayerUI.attachUI, which lands before HeatmapControl and
      // MeasureControl register in their own constructor. Pruning against the
      // registry here would drop their order position and label config on the
      // very first attach, so the record comes back whole: the order is replayed
      // when the id registers (LayerController.replaySavedOrder) and only
      // deleteLayer prunes an id that is actually gone.
      seedStorage({
        order: ["a", "ghost", "b", "gone"],
      });

      expect(makePersistence().load().order).toEqual(["a", "ghost", "b", "gone"]);
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

    it("drops non-string values from names and bad role ids from fold state", () => {
      seedStorage({
        renamedNames: { a: "A2", b: 123, c: null },
        foldedRoles: ["OVERLAYS", 7],
      });
      const p = makePersistence();

      expect(p.load().renamedNames).toEqual({ a: "A2" });
      expect(p.load().foldedRoles).toEqual([]);
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

    it("drops label configs that are not plain objects", () => {
      // Arrays pass the typeof object check, so they are excluded explicitly --
      // a corrupted record must not leak into the config as a valid object.
      // The label config rides `layers[id].label`, so a non-object
      // value drops the whole layer entry (no overrides, no label).
      seedStorage({
        layers: {
          a: {
            overrides: [],
            label: { show: true, field: "name", format: "auto" },
          },
          b: { overrides: [], label: null },
          c: { overrides: [], label: "not-object" },
          d: { overrides: [], label: ["array"] },
        },
      });
      const p = makePersistence();

      expect(p.load().layers).toEqual({
        a: { overrides: [], label: { show: true, field: "name", format: "auto" } },
      });
    });

    it("expands short hex label color to #rrggbb", () => {
      // The label color is the label paint and also goes through the
      // style panel's <input type=color>, so the same expansion applies as
      // to layers' fill/border: #rgb on disk becomes #rrggbb on read. Long
      // hex (either case) is left alone — normalizeHexColor only expands the
      // short form.
      seedStorage({
        layers: {
          a: {
            overrides: [],
            label: { show: true, field: "n", format: "auto", color: "#fff" },
          },
          b: {
            overrides: [],
            label: { show: true, field: "n", format: "auto", color: "#ABC" },
          },
          c: {
            overrides: [],
            label: { show: true, field: "n", format: "auto", color: "#ff0000" },
          },
          d: {
            overrides: [],
            label: { show: true, field: "n", format: "auto", color: "#FF0000" },
          },
        },
      });
      const layers = makePersistence().load().layers;
      expect(layers.a?.label).toEqual({
        show: true,
        field: "n",
        format: "auto",
        color: "#ffffff",
      });
      expect(layers.b?.label).toEqual({
        show: true,
        field: "n",
        format: "auto",
        color: "#aabbcc",
      });
      expect(layers.c?.label).toEqual({
        show: true,
        field: "n",
        format: "auto",
        color: "#ff0000",
      });
      expect(layers.d?.label).toEqual({
        show: true,
        field: "n",
        format: "auto",
        color: "#FF0000",
      });
    });

    it("leaves a non-hex label color alone", () => {
      // The label config has no isHexColor gate (unlike layers), so
      // values the UI would not have written still round-trip unchanged —
      // the write side is equally permissive, and both consumers (canvas
      // fillStyle, color input) tolerate a bad value by falling back to
      // their default.
      seedStorage({
        layers: {
          a: {
            overrides: [],
            label: { show: true, field: "n", format: "auto", color: "red" },
          },
          b: {
            overrides: [],
            label: { show: true, field: "n", format: "auto", color: "#ffff" },
          },
          c: {
            overrides: [],
            label: { show: true, field: "n", format: "auto", color: "123" },
          },
          d: {
            overrides: [],
            label: { show: true, field: "n", format: "auto", color: 42 },
          },
          e: {
            overrides: [],
            label: { show: true, field: "n", format: "auto", color: null },
          },
          f: { overrides: [], label: { show: true, field: "n", format: "auto" } },
        },
      });
      const layers = makePersistence().load().layers;
      expect(layers.a?.label).toEqual({
        show: true,
        field: "n",
        format: "auto",
        color: "red",
      });
      expect(layers.b?.label).toEqual({
        show: true,
        field: "n",
        format: "auto",
        color: "#ffff",
      });
      expect(layers.c?.label).toEqual({
        show: true,
        field: "n",
        format: "auto",
        color: "123",
      });
      expect(layers.d?.label).toEqual({
        show: true,
        field: "n",
        format: "auto",
        color: 42,
      });
      expect(layers.e?.label).toEqual({
        show: true,
        field: "n",
        format: "auto",
        color: null,
      });
      expect(layers.f?.label).toEqual({ show: true, field: "n", format: "auto" });
    });

    it("passes unknown label fields through (future dims, e.g. position)", () => {
      // The label parse is shape-tolerant on purpose: a field the running
      // code does not know yet (label position, …) rides the same record and
      // survives a round-trip, so a future reader finds it where the writer
      // left it. Field rules live in `coerceAnnotationFields`, not here.
      seedStorage({
        layers: {
          b: {
            overrides: [],
            label: { show: false, field: "n", position: "center" },
          },
        },
      });
      const rec = makePersistence().load();
      expect(rec.layers.b?.label).toMatchObject({ position: "center" });
    });
  });

  describe("fillValue / fillMode", () => {
    it("rejects the pre-rename fillMode literal (no compatibility migration)", () => {
      // The stored mode spelling changed ("ramp" → "value"), but the lead
      // chose to drop the migration branch entirely: a pre-rename record
      // reads with the mode treated as absent (no mode claim), and the value
      // config alone stays valid for the next write.
      seedStorage({
        version: RECORD_VERSION,
        layers: {
          a: {
            fillMode: "ramp",
            fillValue: {
              field: "price",
              method: "quantile",
              classes: 5,
              scheme: "Reds",
            },
            overrides: ["fillValue", "fillMode"],
          },
        },
      });
      const loaded = makePersistence().load().layers.a;
      // The mode segment is dropped (absent), so the mode falls back to the
      // derived "solid" default rather than claiming the renamed "value".
      // parseFillValue keeps the kindless shape (kind: undefined for numeric),
      // and the invalid mode marker is dropped from overrides with it.
      expect(loaded).toEqual({
        fillValue: {
          kind: undefined,
          field: "price",
          method: "quantile",
          classes: 5,
          scheme: "Reds",
        },
        overrides: ["fillValue"],
      });
    });

    it("accepts both mode literals", () => {
      for (const mode of ["solid", "value"] as const) {
        seedStorage({
          version: RECORD_VERSION,
          layers: { a: { fillMode: mode, overrides: ["fillMode"] } },
        });
        expect(makePersistence().load().layers.a).toEqual({
          fillMode: mode,
          overrides: ["fillMode"],
        });
      }
    });

    it("rejects a pre-rename mode literal on a bare fillMode record", () => {
      seedStorage({
        version: RECORD_VERSION,
        layers: { a: { fillMode: "ramp", overrides: ["fillMode"] } },
      });
      // The renamed "value" is the only value-mode literal now; "ramp" reads
      // as an invalid mode (absent), so the record keeps no mode claim.
      // With the only marker invalid, the layer state has no overrides and no
      // label, so parseLayerState returns null — the layer reads absent.
      expect(makePersistence().load().layers.a).toBeUndefined();
    });

    it("never writes the old literal back", () => {
      // The write path stamps only "value" (or the derived solid) — "ramp" is
      // not a legal literal anymore, so no code path may emit it. The last
      // assertion checks the serialized record, so a field-level pass can't be
      // faked by some branch re-stamping "ramp" elsewhere in the record.
      seedStorage({
        version: RECORD_VERSION,
        layers: { a: { fillMode: "value", overrides: ["fillMode"] } },
      });
      const loaded = makePersistence().load();
      expect(loaded.layers.a?.fillMode).toBe("value");

      vi.useFakeTimers();
      const save = spySave();
      const p = makePersistence();
      p.schedule({ layers: () => loaded.layers as never });
      p.flushAll();

      expect(lastRecord(save).layers.a?.fillMode).toBe("value");
      expect(JSON.stringify(lastRecord(save))).not.toContain('"ramp"');
      save.mockRestore();
      vi.useRealTimers();
    });

    it("keeps a whitespace-padded field name verbatim", () => {
      // "  price  " is a different GeoJSON property from "price" (RFC 7946
      // section 3.2 with RFC 8259 section 4), so trimming it on read would
      // miss every feature after a reload — or read the other column when both
      // spellings exist. The reader checks for non-whitespace and stores the
      // key as it came.
      seedStorage({
        version: RECORD_VERSION,
        layers: {
          a: {
            fillValue: {
              field: "  price  ",
              method: "equal",
              classes: 3,
              scheme: "Reds",
            },
            overrides: ["fillValue"],
          },
        },
      });
      expect(makePersistence().load().layers.a).toEqual({
        fillValue: { field: "  price  ", method: "equal", classes: 3, scheme: "Reds" },
        overrides: ["fillValue"],
      });
    });

    it("carries a whitespace-padded field through the next write", () => {
      // The reader's verbatim key must reach storage untouched, or the next
      // reload would ask for a column that does not exist. The write rebuilds
      // the whole record from what storage holds, so the read-time key is what
      // the record is judged on.
      seedStorage({
        version: RECORD_VERSION,
        layers: {
          a: {
            fillValue: {
              field: "  price  ",
              method: "equal",
              classes: 3,
              scheme: "Reds",
            },
            overrides: ["fillValue"],
          },
        },
      });
      vi.useFakeTimers();
      const save = spySave();
      const p = makePersistence();
      p.schedule({ order: () => ["a"] });

      vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);

      expect(lastRecord(save).layers.a?.fillValue?.field).toBe("  price  ");
      save.mockRestore();
      vi.useRealTimers();
    });

    it("strips an explicit numeric kind — absence is the same config", () => {
      // "numeric" is the default, so persisting it would add no information.
      // The reader drops it on the way in and the stored record keeps reading
      // "kindless = numeric", which is what an older writer produced.
      seedStorage({
        version: RECORD_VERSION,
        layers: {
          a: {
            fillValue: {
              kind: "numeric",
              field: "price",
              method: "equal",
              classes: 3,
              scheme: "Reds",
            },
            overrides: ["fillValue"],
          },
        },
      });
      const loaded = makePersistence().load().layers.a;
      expect(loaded).toEqual({
        fillValue: { field: "price", method: "equal", classes: 3, scheme: "Reds" },
        overrides: ["fillValue"],
      });
      expect(loaded!.fillValue!.kind).toBeUndefined();
    });

    it("drops a ramp whose kind this client cannot build", () => {
      // The categorical mode is a later batch. A record that asks for it (or
      // for any non-numeric spelling) must be dropped whole rather than
      // painted as a numeric ramp over category values.
      for (const kind of ["categorical", "linear", "", "NUMERIC", 5, null]) {
        seedStorage({
          version: RECORD_VERSION,
          layers: {
            a: {
              fillValue: {
                kind,
                field: "price",
                method: "equal",
                classes: 3,
                scheme: "Reds",
              },
              overrides: ["fillValue"],
            },
          },
        });
        expect(makePersistence().load().layers.a, JSON.stringify(kind)).toBeUndefined();
      }
    });

    it("drops a ramp config that misses a string field", () => {
      const bads = [
        { field: "", method: "equal", classes: 3, scheme: "Reds" },
        { field: "   ", method: "equal", classes: 3, scheme: "Reds" },
        { field: "price", method: "", classes: 3, scheme: "Reds" },
        { field: "price", method: "equal", classes: 3, scheme: "" },
        { method: "equal", classes: 3, scheme: "Reds" },
      ];
      for (const bad of bads) {
        seedStorage({
          version: RECORD_VERSION,
          layers: { a: { fillValue: bad, overrides: ["fillValue"] } },
        });
        // The marker has no surviving value, so the layer entry is dropped
        // rather than kept as an empty object.
        expect(makePersistence().load().layers.a, JSON.stringify(bad)).toBeUndefined();
      }
    });

    it("drops a class count outside the 2-9 bounds or that is not whole", () => {
      for (const classes of [1, 10, 0, -2, 3.5, Number.NaN]) {
        seedStorage({
          version: RECORD_VERSION,
          layers: {
            a: {
              fillValue: { field: "price", method: "equal", classes, scheme: "Reds" },
              overrides: ["fillValue"],
            },
          },
        });
        expect(makePersistence().load().layers.a, `classes=${classes}`).toBeUndefined();
      }
    });

    it("drops a ramp config that is not a plain object", () => {
      for (const bad of [null, undefined, "Reds", 7, [], [1, 2, 3]]) {
        seedStorage({
          version: RECORD_VERSION,
          layers: { a: { fillValue: bad, overrides: ["fillValue"] } },
        });
        expect(makePersistence().load().layers.a, JSON.stringify(bad)).toBeUndefined();
      }
    });

    it("accepts exactly the records the live validator accepts", () => {
      // The panel and the storage path must agree on what a ramp record is:
      // a record one accepts and the other drops would vanish on the next
      // reload, and one the panel rejects would never be offered in the
      // first place. `parseFillValue` delegates to the same predicate the
      // live intent write runs through, so the table is the contract.
      const cases: Array<[boolean, unknown]> = [
        [true, { field: "price", method: "equal", classes: 3, scheme: "Reds" }],
        [
          true,
          {
            field: "price",
            method: "quantile",
            classes: 9,
            scheme: "Reds",
            kind: "numeric",
          },
        ],
        [false, { field: "", method: "equal", classes: 3, scheme: "Reds" }],
        [false, { field: "   ", method: "equal", classes: 3, scheme: "Reds" }],
        [false, { field: "price", method: "", classes: 3, scheme: "Reds" }],
        [false, { field: "price", method: "equal", classes: 3, scheme: "" }],
        [false, { field: "price", method: "equal", classes: 1, scheme: "Reds" }],
        [false, { field: "price", method: "equal", classes: 10, scheme: "Reds" }],
        [false, { field: "price", method: "equal", classes: 3.5, scheme: "Reds" }],
        [false, { field: "price", method: "equal", scheme: "Reds" }],
        [false, { field: "price", method: "equal", classes: 3 }],
        [false, { field: "price", method: "equal", classes: 3, kind: "other" }],
        [false, "Reds"],
        [false, [1, 2, 3]],
        [false, null],
      ];
      for (const [ok, config] of cases) {
        expect(isValueConfig(config), JSON.stringify(config)).toBe(ok);
        seedStorage({
          version: RECORD_VERSION,
          layers: { a: { fillValue: config, overrides: ["fillValue"] } },
        });
        const loaded = makePersistence().load();
        expect(
          loaded !== null && loaded.layers.a !== undefined,
          JSON.stringify(config),
        ).toBe(ok);
      }
    });

    it("drops a fillMode that is not one of the three literals", () => {
      for (const bad of [
        "RAMP",
        "linear",
        // The mode's pre-release spelling: the option is a stored choice now,
        // and a record from a build that offered it must not load as one.
        "feature",
        "",
        1,
        null,
        undefined,
        {},
      ]) {
        seedStorage({
          version: RECORD_VERSION,
          layers: { a: { fillMode: bad, overrides: ["fillMode"] } },
        });
        expect(makePersistence().load().layers.a, JSON.stringify(bad)).toBeUndefined();
      }
    });

    it("keeps the original-colors mode as a stored choice", () => {
      seedStorage({
        version: RECORD_VERSION,
        layers: { a: { fillMode: "original", overrides: ["fillMode"] } },
      });
      expect(makePersistence().load().layers.a).toEqual({
        fillMode: "original",
        overrides: ["fillMode"],
      });
    });

    it("parses each override independently — a bad ramp keeps the mode", () => {
      seedStorage({
        version: RECORD_VERSION,
        layers: {
          a: {
            fillMode: "value",
            fillValue: { field: "", method: "equal", classes: 3, scheme: "Reds" },
            fillOpacity: 0.5,
            overrides: ["fillMode", "fillValue", "fillOpacity"],
          },
        },
      });
      // Only the provenance markers whose value survives are kept, in the
      // declaration order of PARSE_OVERRIDE.
      expect(makePersistence().load().layers.a).toEqual({
        fillMode: "value",
        fillOpacity: 0.5,
        overrides: ["fillOpacity", "fillMode"],
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
        foldedRoles: ["OVERLAYS"],
        renamedNames: { a: "A2" },
        layers: { a: { visible: false, overrides: ["visible"] } },
      });
      expect(makePersistence().load()).toEqual({
        version: RECORD_VERSION,
        order: ["a", "b"],
        removed: [],
        foldedRoles: ["OVERLAYS"],
        renamedNames: { a: "A2" },
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
          foldedRoles: ["OVERLAYS"],
          renamedNames: { a: "A2" },
          layers: { a: { visible: false, overrides: ["visible"] } },
        });
        expect(makePersistence().load().version).toBe(RECORD_VERSION);
      }
      seedStorage({
        order: ["a", "b"],
        foldedRoles: ["OVERLAYS"],
        renamedNames: { a: "A2" },
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
        foldedRoles: ["OVERLAYS"],
        renamedNames: { a: "A2" },
        layers: { a: { visible: false, overrides: ["visible"] } },
      });
      const p = makePersistence();
      p.schedule({ order: () => ["b", "a"] });

      vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);

      expect(lastRecord(save)).toEqual({
        version: RECORD_VERSION,
        order: ["b", "a"],
        removed: [],
        foldedRoles: ["OVERLAYS"],
        renamedNames: { a: "A2" },
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
      // a, b, d and e claim a choice the record cannot honor, so they are
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

    it("keeps the icon color the user set, with provenance", () => {
      // The icon color rides the same value-plus-provenance rule as the
      // border/fill dimensions: only a value WITH an override is a user
      // choice; a bare iconColor is an author default and stays untouched.
      seedStorage({
        layers: {
          a: { iconColor: "#ff0000", overrides: ["iconColor"] },
          b: { iconColor: "#12abef", overrides: ["iconColor"] },
        },
      });
      expect(makePersistence().load().layers).toEqual({
        a: { iconColor: "#ff0000", overrides: ["iconColor"] },
        b: { iconColor: "#12abef", overrides: ["iconColor"] },
      });
    });

    it("drops an invalid icon color that the swatch could not display", () => {
      // line 195 mode: isHexColor false -> null (corrupt entry must not leak).
      seedStorage({
        layers: {
          a: { iconColor: "red", overrides: ["iconColor"] },
          b: { iconColor: "#1234567", overrides: ["iconColor"] },
          c: { iconColor: "#fff", overrides: ["iconColor"] },
        },
      });
      expect(makePersistence().load().layers).toEqual({
        c: { iconColor: "#ffffff", overrides: ["iconColor"] },
      });
    });

    it("keeps the glyph opacity the user set, with provenance", () => {
      // The opacity rides the same value-plus-provenance rule as the color:
      // only a value WITH an override is a user choice.
      seedStorage({
        layers: {
          a: { iconColorOpacity: 40, overrides: ["iconColorOpacity"] },
          b: { iconColorOpacity: 100, overrides: ["iconColorOpacity"] },
        },
      });
      expect(makePersistence().load().layers).toEqual({
        a: { iconColorOpacity: 40, overrides: ["iconColorOpacity"] },
        b: { iconColorOpacity: 100, overrides: ["iconColorOpacity"] },
      });
    });

    it("drops an invalid glyph opacity that the number field could not display", () => {
      // line 195 arm: out-of-range / non-integer / non-number -> null.
      seedStorage({
        layers: {
          a: { iconColorOpacity: 150, overrides: ["iconColorOpacity"] },
          b: { iconColorOpacity: -5, overrides: ["iconColorOpacity"] },
          c: { iconColorOpacity: 50.5, overrides: ["iconColorOpacity"] },
          d: { iconColorOpacity: "40", overrides: ["iconColorOpacity"] },
          e: { iconColorOpacity: NaN, overrides: ["iconColorOpacity"] },
        },
      });
      expect(makePersistence().load().layers).toEqual({});
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

    it("keeps sizes inside the shared bounds, rounding, and drops the rest", () => {
      // A corrupt entry must not silently resize the layer: out of bounds and
      // non-numeric values are dropped with their provenance marker, and a
      // fractional value is rounded because the field steps by one.
      seedStorage({
        layers: {
          a: { size: 30, overrides: ["size"] },
          b: { size: 30.6, overrides: ["size"] },
          c: { size: 1, overrides: ["size"] },
          d: { size: 64, overrides: ["size"] },
          e: { size: 0, overrides: ["size"] },
          f: { size: -5, overrides: ["size"] },
          g: { size: 65, overrides: ["size"] },
          h: { size: "30", overrides: ["size"] },
          // JSON.stringify turns a non-finite value into null on disk, so these
          // two exercise the non-number branch: either way they cannot resize.
          i: { size: NaN, overrides: ["size"] },
          j: { size: Infinity, overrides: ["size"] },
          k: { size: { px: 30 }, overrides: ["size"] },
          l: { size: 30, borderColor: "#abcdef", overrides: ["size", "borderColor"] },
        },
      });
      expect(makePersistence().load().layers).toEqual({
        a: { size: 30, overrides: ["size"] },
        b: { size: 31, overrides: ["size"] },
        c: { size: 1, overrides: ["size"] },
        d: { size: 64, overrides: ["size"] },
        // Provenance is recorded in the dimension registry's own order, not the
        // seeded one.
        l: { size: 30, borderColor: "#abcdef", overrides: ["borderColor", "size"] },
      });
    });

    it("restores an icon override and drops a malformed one", () => {
      seedStorage({
        layers: {
          a: { icon: { kind: "glyph", value: "map-pin" }, overrides: ["icon"] },
          b: { icon: { kind: "glyph", value: 42 }, overrides: ["icon"] },
          c: { icon: { kind: "ramp" }, overrides: ["icon"] },
          d: { icon: "map-pin", overrides: ["icon"] },
          e: { icon: null, overrides: ["icon"] },
          f: { icon: { kind: "glyph", value: "star" }, overrides: ["icon", "icon"] },
        },
      });
      expect(makePersistence().load().layers).toEqual({
        a: { icon: { kind: "glyph", value: "map-pin" }, overrides: ["icon"] },
        f: { icon: { kind: "glyph", value: "star" }, overrides: ["icon"] },
      });
    });

    it("restores an icon by-value config and drops a malformed one", () => {
      const good = {
        kind: "numeric",
        field: "count",
        method: "equal",
        classes: 3,
        glyphs: ["circle", "square", "diamond"],
      };
      const goodCat = {
        kind: "category",
        field: "kind",
        glyphs: ["circle", "square"],
      };
      seedStorage({
        layers: {
          a: {
            iconValue: good,
            iconMode: "byValue",
            overrides: ["iconValue", "iconMode"],
          },
          b: {
            iconValue: { ...good, classes: 1 },
            iconMode: "byValue",
            overrides: ["iconValue", "iconMode"],
          },
          c: {
            iconValue: goodCat,
            iconMode: "byValue",
            overrides: ["iconValue", "iconMode"],
          },
          d: {
            iconValue: { ...good, glyphs: ["circle"] },
            iconMode: "byValue",
            overrides: ["iconValue", "iconMode"],
          },
          e: {
            iconValue: "nope",
            iconMode: "byValue",
            overrides: ["iconValue", "iconMode"],
          },
          f: {
            iconMode: "byValue",
            overrides: ["iconMode"],
          },
        },
      });
      expect(makePersistence().load().layers).toEqual({
        a: {
          iconValue: good,
          iconMode: "byValue",
          overrides: ["iconValue", "iconMode"],
        },
        c: {
          iconValue: goodCat,
          iconMode: "byValue",
          overrides: ["iconValue", "iconMode"],
        },
        // b/d/e carry a malformed iconValue (dropped) but a valid iconMode
        // (kept) — each override key validates independently.
        b: { iconMode: "byValue", overrides: ["iconMode"] },
        d: { iconMode: "byValue", overrides: ["iconMode"] },
        e: { iconMode: "byValue", overrides: ["iconMode"] },
        f: { iconMode: "byValue", overrides: ["iconMode"] },
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
      p.schedule({ foldedRoles: () => ["OVERLAYS"] });
      p.schedule({ renamedNames: () => ({ a: "A" }) });

      vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);

      // Four schedules, one write: there is a single timer for the whole
      // record, so no dimension needs its own debounce bookkeeping. The
      // legacy `annotations` segment no longer exists.
      expect(save).toHaveBeenCalledTimes(1);
      expect(lastRecord(save)).toEqual({
        version: RECORD_VERSION,
        order: ["a", "b"],
        removed: [],
        foldedRoles: ["OVERLAYS"],
        renamedNames: { a: "A" },
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
        foldedRoles: ["OVERLAYS"],
        renamedNames: { a: "A" },
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
        foldedRoles: ["OVERLAYS"],
        renamedNames: { a: "A" },
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
        foldedRoles: [],
        renamedNames: {},
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
      p.schedule({ layers: () => layers as Record<string, any> });

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
  describe("folderOrder persistence", () => {
    it("round-trips a valid folder order", () => {
      seedStorage({
        version: RECORD_VERSION,
        folderOrder: { version: 1, sections: { overlay: ["a", "b"], base: ["c"] } },
      });
      expect(makePersistence().load().folderOrder).toEqual({
        version: 1,
        sections: { overlay: ["a", "b"], base: ["c"] },
      });
    });

    it("drops a folder order whose version is not 1", () => {
      seedStorage({
        version: RECORD_VERSION,
        folderOrder: { version: 2, sections: { overlay: ["a"] } },
      });
      expect(makePersistence().load().folderOrder).toBeUndefined();
    });

    it("drops a folder order whose sections are not an object", () => {
      for (const sections of [null, "overlay", ["a"], 42]) {
        seedStorage({ version: RECORD_VERSION, folderOrder: { version: 1, sections } });
        expect(
          makePersistence().load().folderOrder,
          JSON.stringify(sections),
        ).toBeUndefined();
      }
    });

    it("drops a folder order that names a section other than overlay/base", () => {
      seedStorage({
        version: RECORD_VERSION,
        folderOrder: { version: 1, sections: { middle: ["a"] } },
      });
      expect(makePersistence().load().folderOrder).toBeUndefined();
    });

    it("drops a folder order whose section values are not string arrays", () => {
      for (const names of ["a", [1, 2], [null], ["a", 2], {}]) {
        seedStorage({
          version: RECORD_VERSION,
          folderOrder: { version: 1, sections: { overlay: names } },
        });
        expect(
          makePersistence().load().folderOrder,
          JSON.stringify(names),
        ).toBeUndefined();
      }
    });

    it("drops a folder order that is not an object", () => {
      for (const bad of [null, undefined, "order", 7, ["a"]]) {
        seedStorage({ version: RECORD_VERSION, folderOrder: bad });
        expect(
          makePersistence().load().folderOrder,
          JSON.stringify(bad),
        ).toBeUndefined();
      }
    });

    it("leaves an old archive without a folder order field alone", () => {
      seedStorage({ version: RECORD_VERSION, order: ["a"] });
      expect(makePersistence().load().folderOrder).toBeUndefined();
    });

    it("does not invent an empty folder order when the live state is null", () => {
      // mergeFields must not produce folderOrder: [] from an empty live state:
      // the getter returns null (no order yet), and the write lands null, not
      // an empty sections object that would look like a freeze.
      vi.useFakeTimers();
      const save = spySave();
      const p = makePersistence();
      p.schedule({ folderOrder: () => null });
      vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);
      expect(lastRecord(save).folderOrder).toBeNull();
      save.mockRestore();
      vi.useRealTimers();
    });

    it("passes a stored folder order through a write that never schedules it", () => {
      seedStorage({
        version: RECORD_VERSION,
        folderOrder: { version: 1, sections: { overlay: ["a"] } },
      });
      vi.useFakeTimers();
      const save = spySave();
      const p = makePersistence();
      p.schedule({ order: () => ["a"] });
      vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);
      expect(lastRecord(save).folderOrder).toEqual({
        version: 1,
        sections: { overlay: ["a"] },
      });
      save.mockRestore();
      vi.useRealTimers();
    });
  });
});

describe("borderStyleMode value domain", () => {
  // The border mode is a closed domain (solid / value / original). The parser
  // must keep a legal literal and drop anything else — a corrupt stored value
  // cannot leak a broken border mode through provenance.
  it("accepts solid / value / original borderStyleMode literals", () => {
    for (const mode of [
      FILL_MODE.SOLID,
      FILL_MODE.VALUE,
      FILL_MODE.ORIGINAL,
    ] as const) {
      seedStorage({
        version: RECORD_VERSION,
        layers: { a: { borderStyleMode: mode, overrides: ["borderStyleMode"] } },
      });
      expect(makePersistence().load().layers.a).toEqual({
        borderStyleMode: mode,
        overrides: ["borderStyleMode"],
      });
    }
  });

  it("drops a borderStyleMode outside the domain rather than leaking it", () => {
    // The parser returns null for a bad literal and the marker is dropped
    // with it; with only that marker invalid the layer has no overrides and
    // reads absent — same contract as the fillMode "ramp" case.
    seedStorage({
      version: RECORD_VERSION,
      layers: { a: { borderStyleMode: "ramp", overrides: ["borderStyleMode"] } },
    });
    expect(makePersistence().load().layers.a).toBeUndefined();
  });
});

describe("borderValue parse", () => {
  // The border's value config rides the same parseFillValue path as the
  // fill's (one predicate, one shape) — but the PARSE_OVERRIDE key is its
  // own arrow, so a borderValue record must be exercised on its own to
  // prove the key is wired. The fillValue suite owns the shared validator's
  // edge cases; this block proves the border key dispatches to it.
  it("keeps a legal numeric borderValue record", () => {
    seedStorage({
      version: RECORD_VERSION,
      layers: {
        a: {
          borderValue: {
            field: "count",
            method: "quantile",
            classes: 5,
            scheme: "Reds",
          },
          overrides: ["borderValue"],
        },
      },
    });
    const loaded = makePersistence().load().layers.a;
    expect(loaded).toEqual({
      borderValue: {
        kind: undefined,
        field: "count",
        method: "quantile",
        classes: 5,
        scheme: "Reds",
      },
      overrides: ["borderValue"],
    });
  });

  it("drops a borderValue outside the shared validator's domain", () => {
    for (const bad of [
      { field: "", method: "equal", classes: 3, scheme: "Reds" },
      { field: "count", method: "equal", classes: 1, scheme: "Reds" },
      { field: "count", method: "equal", classes: 3, scheme: "" },
      "Reds",
      null,
    ]) {
      seedStorage({
        version: RECORD_VERSION,
        layers: { a: { borderValue: bad, overrides: ["borderValue"] } },
      });
      expect(makePersistence().load().layers.a, JSON.stringify(bad)).toBeUndefined();
    }
  });
});
