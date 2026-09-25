import { describe, expect, it, vi } from "vitest";
import { HISTORY, MODE, RECORD_VERSION } from "#foliplus/SearchControl/const.js";
import {
  flushHistory,
  loadHistory,
  saveHistory,
} from "#foliplus/SearchControl/logic/history.js";
import type { SearchHistoryEntry } from "#foliplus/SearchControl/type.js";

describe("SearchControl history — versioned envelope", () => {
  describe("saveHistory — writes { version, entries }", () => {
    it("wraps the entries in a versioned record", () => {
      const entries: SearchHistoryEntry[] = [
        {
          query: "Paris",
          type: MODE.ADDR,
          coordDisplay: "",
          addrDisplay: "Paris, France",
          lng: 0,
          lat: 48.85,
          ts: 1000,
          count: 1,
        },
      ];
      saveHistory(entries);
      const stored = JSON.parse(window.localStorage.getItem(HISTORY.STORAGE_KEY)!);
      expect(stored.version).toBe(RECORD_VERSION);
      expect(stored.entries).toEqual(entries);
    });

    it("writes an empty envelope for an empty history (still carries version)", () => {
      saveHistory([]);
      const stored = JSON.parse(window.localStorage.getItem(HISTORY.STORAGE_KEY)!);
      expect(stored.version).toBe(RECORD_VERSION);
      expect(stored.entries).toEqual([]);
    });
  });

  describe("loadHistory — envelope + legacy bare array + corrupt", () => {
    it("reads the new { version, entries } envelope", () => {
      const entries: SearchHistoryEntry[] = [
        {
          query: "Paris",
          type: MODE.ADDR,
          coordDisplay: "",
          addrDisplay: "Paris",
          lng: 0,
          lat: 48.85,
          ts: 1000,
          count: 1,
        },
      ];
      window.localStorage.setItem(
        HISTORY.STORAGE_KEY,
        JSON.stringify({ version: RECORD_VERSION, entries }),
      );
      expect(loadHistory()).toEqual(entries);
    });

    it("accepts an older/unknown version value without migrating", () => {
      const entries: SearchHistoryEntry[] = [
        {
          query: "Paris",
          type: MODE.ADDR,
          coordDisplay: "",
          addrDisplay: "Paris",
          lng: 0,
          lat: 48.85,
          ts: 1000,
          count: 1,
        },
      ];
      window.localStorage.setItem(
        HISTORY.STORAGE_KEY,
        JSON.stringify({ version: 999, entries }),
      );
      expect(loadHistory()).toEqual(entries);
    });

    it("reads the legacy bare-array shape and still runs the row migration", () => {
      // Pre-envelope shape: bare array of partial entries, exactly what
      // loadHistoryRows migrates today — the envelope reader must not change
      // that path.
      window.localStorage.setItem(
        HISTORY.STORAGE_KEY,
        JSON.stringify([
          { type: MODE.ADDR, addrDisplay: "Paris", lng: 0, lat: 0, ts: 1000 },
        ]),
      );
      const [entry] = loadHistory();
      expect(entry.query).toBe("");
      expect(entry.type).toBe(MODE.ADDR);
      expect(entry.addrDisplay).toBe("Paris");
      expect(entry.coordDisplay).toBe("");
      expect(entry.lng).toBe(0);
      expect(entry.lat).toBe(0);
      expect(entry.ts).toBe(1000);
      expect(entry.count).toBe(1);
    });

    it("returns [] for a corrupt envelope (entries missing)", () => {
      window.localStorage.setItem(
        HISTORY.STORAGE_KEY,
        JSON.stringify({ version: RECORD_VERSION }),
      );
      expect(loadHistory()).toEqual([]);
    });

    it("returns [] for an envelope whose entries is not an array", () => {
      window.localStorage.setItem(
        HISTORY.STORAGE_KEY,
        JSON.stringify({ version: RECORD_VERSION, entries: { not: "array" } }),
      );
      expect(loadHistory()).toEqual([]);
    });

    it("returns [] for a plain non-array value", () => {
      window.localStorage.setItem(HISTORY.STORAGE_KEY, JSON.stringify("string"));
      expect(loadHistory()).toEqual([]);
    });

    it("returns [] for malformed JSON (falls through to empty history)", () => {
      window.localStorage.setItem(HISTORY.STORAGE_KEY, "not-json");
      expect(loadHistory()).toEqual([]);
    });

    it("returns [] when storage is empty", () => {
      expect(loadHistory()).toEqual([]);
    });
  });

  describe("round-trip", () => {
    it("save then load returns the same entries (envelope is transparent)", () => {
      const entries: SearchHistoryEntry[] = [
        {
          query: "Paris",
          type: MODE.ADDR,
          coordDisplay: "",
          addrDisplay: "Paris",
          lng: 0,
          lat: 48.85,
          ts: 1000,
          count: 1,
        },
      ];
      saveHistory(entries);
      expect(loadHistory()).toEqual(entries);
    });

    it("an old bare-array record is transparently re-wrapped on the next save", () => {
      window.localStorage.setItem(
        HISTORY.STORAGE_KEY,
        JSON.stringify([
          { type: MODE.ADDR, addrDisplay: "Paris", lng: 0, lat: 0, ts: 1000 },
        ]),
      );
      // Read: legacy shape is unwrapped, then re-persisted as the new envelope.
      const loaded = loadHistory();
      saveHistory(loaded);
      const stored = JSON.parse(window.localStorage.getItem(HISTORY.STORAGE_KEY)!);
      expect(stored.version).toBe(RECORD_VERSION);
      expect(Array.isArray(stored.entries)).toBe(true);
      expect(stored.entries).toHaveLength(1);
    });
  });

  describe("flushHistory — teardown safety", () => {
    it("entries survive the destroy() flush→reset sequence", () => {
      // Mirrors SearchControl.destroy(): flushHistory() writes the current
      // history before the in-memory array is reset. With debounceMs=0 the
      // write is already durable at saveHistory time, so flushHistory is a
      // no-op safety net — but the flush-before-reset order is the convention
      // that keeps this teardown safe if the debounce window ever changes.
      const entries: SearchHistoryEntry[] = [
        {
          query: "Paris",
          type: MODE.ADDR,
          coordDisplay: "121.4700, 31.2300",
          addrDisplay: "Paris",
          lng: 121.47,
          lat: 31.23,
          ts: 2000,
          count: 1,
        },
      ];

      saveHistory(entries);
      flushHistory();

      const stored = JSON.parse(window.localStorage.getItem(HISTORY.STORAGE_KEY)!);
      expect(stored.version).toBe(RECORD_VERSION);
      expect(Array.isArray(stored.entries)).toBe(true);
      expect(stored.entries).toEqual(entries);
    });

    it("is a no-op when nothing is pending since the last write", () => {
      // Conditional-flush semantic: flush only writes when a schedule() is
      // pending. A teardown that has nothing to save must not rewrite the
      // record — the disk copy stays untouched, so a later reset of memory
      // state cannot leak through a stale flush.
      const entries: SearchHistoryEntry[] = [
        {
          query: "Tokyo",
          type: MODE.ADDR,
          coordDisplay: "",
          addrDisplay: "Tokyo",
          lng: 139.69,
          lat: 35.68,
          ts: 1000,
          count: 1,
        },
      ];
      saveHistory(entries);
      flushHistory();
      const afterFirst = window.localStorage.getItem(HISTORY.STORAGE_KEY);
      flushHistory();
      expect(window.localStorage.getItem(HISTORY.STORAGE_KEY)).toBe(afterFirst);
    });
  });
describe("loadHistory / saveHistory — legacy bare-array rows", () => {
  /** Rows a post-scoped build writes, under the per-map key. */
  const scopedRows = [
    { type: MODE.ADDR, addrDisplay: "Scoped", lng: 1.0, lat: 50.0 },
  ];

  /** Write partial entries as an older version would have stored them. */
  const store = (entries: object[]): void => {
    localStorage.setItem(HISTORY.STORAGE_KEY, JSON.stringify(entries));
  };

  it("fills defaults for fields older versions never wrote", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1234567);
    store([{ type: MODE.ADDR, addrDisplay: "Paris", lng: 0, lat: 0 }]);
    const [entry] = loadHistory();
    expect(entry).toEqual({
      query: "",
      type: MODE.ADDR,
      coordDisplay: "",
      addrDisplay: "Paris",
      lng: 0,
      lat: 0,
      ts: 1234567,
      count: 1,
    });
  });

  it("leaves the display fields empty when a coord entry has no label", () => {
    store([{ query: "120, 32", type: MODE.COORD, ts: 1000 }]);
    const [entry] = loadHistory();
    expect(entry.query).toBe("120,32");
    expect(entry.coordDisplay).toBe("");
    expect(entry.addrDisplay).toBe("");
  });

  it("falls back to the older entry's display when the newest one is empty", () => {
    store([
      {
        query: "120,32",
        type: MODE.COORD,
        coordDisplay: "120.000000, 32.000000",
        ts: 500,
      },
      { query: "120,32", type: MODE.COORD, coordDisplay: "", ts: 900 },
    ]);
    const [entry] = loadHistory();
    expect(entry.coordDisplay).toBe("120.000000, 32.000000");
    expect(entry.count).toBe(2);
  });

  it("drops null and non-object rows instead of crashing", () => {
    store([null, "text", 42, { type: MODE.ADDR, ts: 1000 }]);
    const [entry] = loadHistory();
    expect(entry).toEqual({
      query: "",
      type: MODE.ADDR,
      coordDisplay: "",
      addrDisplay: "",
      lng: 0,
      lat: 0,
      ts: 1000,
      count: 1,
    });
  });

  it("downgrades a row with no usable fields to a defaulted addr entry", () => {
    store([{}]);
    const [entry] = loadHistory();
    expect(entry).toEqual({
      query: "",
      type: MODE.ADDR,
      coordDisplay: "",
      addrDisplay: "",
      lng: 0,
      lat: 0,
      ts: expect.any(Number),
      count: 1,
    });
  });

  it("loads empty array when nothing is stored", () => {
    const entries = loadHistory();
    expect(entries).toEqual([]);
  });

  it("loads entries from localStorage", () => {
    const entries: SearchHistoryEntry[] = [
      {
        query: "Paris",
        type: "addr",
        coordDisplay: "121.4700, 31.2300",
        addrDisplay: "Paris",
        lng: 2.3,
        lat: 48.8,
        ts: 1000,
        count: 1,
      },
      {
        query: "121.47,31.23",
        type: "coord",
        coordDisplay: "121.4700, 31.2300",
        addrDisplay: "",
        lng: 121.47,
        lat: 31.23,
        ts: 2000,
        count: 1,
      },
    ];
    saveHistory(entries);
    expect(loadHistory()).toEqual(entries);
  });

  it("returns empty array for corrupt data", () => {
    localStorage.setItem(HISTORY.STORAGE_KEY, "not json");
    expect(loadHistory()).toEqual([]);
  });

  it("reads history from the scoped key only", () => {
    store(scopedRows);
    const otherRows = [{ type: MODE.ADDR, addrDisplay: "Other", lng: 9, lat: 9 }];
    localStorage.setItem("foliplus_search_map-other", JSON.stringify(otherRows));
    expect(loadHistory().map(e => e.addrDisplay)).toEqual(
      scopedRows.map(r => r.addrDisplay),
    );
  });

  it("keeps history separate per map container", () => {
    const rowsA = [scopedRows[0]];
    const rowsB = [{ type: MODE.ADDR, addrDisplay: "Tokyo", lng: 0, lat: 0 }];
    localStorage.setItem("foliplus_search_map-a", JSON.stringify(rowsA));
    localStorage.setItem("foliplus_search_map-b", JSON.stringify(rowsB));
    // The container id feeds the scoped key directly; a second map must not
    // inherit the first map's row.
    Object.defineProperty(HISTORY, "STORAGE_KEY", { value: "foliplus_search_map-a" });
    const mapA = loadHistory();
    expect(mapA.map(e => e.addrDisplay)).toEqual(["Scoped"]);
    Object.defineProperty(HISTORY, "STORAGE_KEY", { value: "foliplus_search_map-b" });
    const mapB = loadHistory();
    expect(mapB.map(e => e.addrDisplay)).toEqual(["Tokyo"]);
    // map-a's store survives map-b's read.
    expect(JSON.parse(localStorage.getItem("foliplus_search_map-a")!).length).toBe(1);
  });

  it("returns empty array for non-array data", () => {
    localStorage.setItem(HISTORY.STORAGE_KEY, '"string"');
    expect(loadHistory()).toEqual([]);
  });

  it("migrates old entries with label field to new format", () => {
    localStorage.setItem(
      HISTORY.STORAGE_KEY,
      JSON.stringify([
        {
          query: "Paris",
          type: "addr",
          label: "Paris, France",
          lng: 2.3,
          lat: 48.8,
          ts: 1000,
        },
        {
          query: "121.47,31.23",
          type: "coord",
          label: "121.4700, 31.2300",
          lng: 121.47,
          lat: 31.23,
          ts: 2000,
        },
      ]),
    );
    const loaded = loadHistory();
    expect(loaded).toHaveLength(2);
    expect(loaded[0].query).toBe("Paris");
    expect(loaded[0].addrDisplay).toBe("Paris, France");
    expect(loaded[0].coordDisplay).toBe("");
    expect(loaded[0].count).toBe(1);
    expect(loaded[1].query).toBe("121.47,31.23");
    expect(loaded[1].coordDisplay).toBe("121.4700, 31.2300");
    expect(loaded[1].addrDisplay).toBe("");
    expect(loaded[1].count).toBe(1);
  });

  it("saves an empty array when history is cleared", () => {
    const entries: SearchHistoryEntry[] = [
      {
        query: "A",
        type: "addr",
        coordDisplay: "",
        addrDisplay: "A",
        lng: 0,
        lat: 0,
        ts: 1,
        count: 1,
      },
    ];
    saveHistory(entries);
    expect(loadHistory()).toHaveLength(1);
    saveHistory([]);
    expect(loadHistory()).toEqual([]);
  });

  it("collapses legacy coord duplicates that a raw-input key created", () => {
    // Before the fix the history key was the raw input, so whitespace or a
    // full-width comma produced two entries that display identically.
    localStorage.setItem(
      HISTORY.STORAGE_KEY,
      JSON.stringify([
        {
          query: "120, 32",
          type: "coord",
          coordDisplay: "120.000000, 32.000000",
          addrDisplay: "",
          lng: 120,
          lat: 32,
          ts: 111,
          count: 1,
        },
        {
          query: "120，32",
          type: "coord",
          coordDisplay: "120.000000, 32.000000",
          addrDisplay: "",
          lng: 120,
          lat: 32,
          ts: 222,
          count: 1,
        },
        {
          query: "120,32",
          type: "coord",
          coordDisplay: "120.000000, 32.000000",
          addrDisplay: "Hangzhou, China",
          lng: 120,
          lat: 32,
          ts: 333,
          count: 2,
        },
      ]),
    );
    const loaded = loadHistory();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].query).toBe("120,32");
    expect(loaded[0].count).toBe(4);
    // Empty display fields fall back to an older entry's value
    expect(loaded[0].addrDisplay).toBe("Hangzhou, China");
    expect(loaded[0].coordDisplay).toBe("120.000000, 32.000000");
  });

  it("canonicalizes a legacy coord key only when it parses as coordinates", () => {
    localStorage.setItem(
      HISTORY.STORAGE_KEY,
      JSON.stringify([
        {
          query: "121.47 , 31.23",
          type: "coord",
          coordDisplay: "",
          addrDisplay: "",
          lng: 121.47,
          lat: 31.23,
          ts: 1,
          count: 1,
        },
        {
          query: "Paris",
          type: "addr",
          coordDisplay: "",
          addrDisplay: "Paris, France",
          lng: 2.3,
          lat: 48.8,
          ts: 2,
          count: 1,
        },
      ]),
    );
    const loaded = loadHistory();
    expect(loaded).toHaveLength(2);
    expect(loaded[0].query).toBe("121.47,31.23");
    // Address queries are never rewritten
    expect(loaded.find(e => e.type === "addr")?.query).toBe("Paris");
  });

  it("does not collapse out-of-range coord keys that fail to validate", () => {
    // Out-of-range values pass parseCoord's shape check but fail range validation,
    // so their keys stay as typed and distinct entries stay distinct.
    localStorage.setItem(
      HISTORY.STORAGE_KEY,
      JSON.stringify([
        {
          query: "200,32",
          type: "coord",
          coordDisplay: "1.000000, 1.000000",
          addrDisplay: "",
          lng: 1,
          lat: 1,
          ts: 1,
          count: 1,
        },
        {
          query: "999,32",
          type: "coord",
          coordDisplay: "2.000000, 2.000000",
          addrDisplay: "",
          lng: 2,
          lat: 2,
          ts: 2,
          count: 1,
        },
      ]),
    );
    const loaded = loadHistory();
    expect(loaded).toHaveLength(2);
    // Stored in insertion order, as loadHistory preserves it
    expect(loaded.map(e => e.lng)).toEqual([1, 2]);
    // Keys that fail to parse are never rewritten
    expect(loaded.map(e => e.query)).toEqual(["200,32", "999,32"]);
  });

  it("does not collapse a coord and an addr entry that share a key string", () => {
    localStorage.setItem(
      HISTORY.STORAGE_KEY,
      JSON.stringify([
        {
          query: "120,32",
          type: "coord",
          coordDisplay: "120.000000, 32.000000",
          addrDisplay: "",
          lng: 120,
          lat: 32,
          ts: 1,
          count: 1,
        },
        {
          query: "120,32",
          type: "addr",
          coordDisplay: "120.000000, 32.000000",
          addrDisplay: "Somewhere",
          lng: 120,
          lat: 32,
          ts: 2,
          count: 1,
        },
      ]),
    );
    const loaded = loadHistory();
    expect(loaded).toHaveLength(2);
    expect(loaded.filter(e => e.type === "coord")).toHaveLength(1);
    expect(loaded.filter(e => e.type === "addr")).toHaveLength(1);
  });

  it("keeps the newest-first order for non-duplicate entries", () => {
    const entries: SearchHistoryEntry[] = [
      {
        query: "Paris",
        type: "addr",
        coordDisplay: "",
        addrDisplay: "Paris",
        lng: 0,
        lat: 0,
        ts: 1,
        count: 1,
      },
      {
        query: "Berlin",
        type: "addr",
        coordDisplay: "",
        addrDisplay: "Berlin",
        lng: 0,
        lat: 0,
        ts: 2,
        count: 1,
      },
    ];
    saveHistory(entries);
    expect(loadHistory()).toEqual(entries);
  });
});

});
