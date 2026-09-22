import { beforeEach, describe, expect, it, vi } from "vitest";
import { HISTORY, MODE, RECORD_VERSION } from "#foliplus/SearchControl/const.js";
import { loadHistory, saveHistory } from "#foliplus/SearchControl/logic.js";
import type { SearchHistoryEntry } from "#foliplus/SearchControl/type.js";

describe("SearchControl history — versioned envelope", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

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

  describe("flush — teardown safety", () => {
    it("a final write made right before the in-memory array is dropped survives", () => {
      // Mirror of SearchControl.destroy(): write the current history first, then
      // reset the in-memory array. If the order flips the last search before
      // unmount is lost.
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
      saveHistory([]); // destroy() drops the in-memory array after the last write

      const stored = JSON.parse(window.localStorage.getItem(HISTORY.STORAGE_KEY)!);
      expect(stored.version).toBe(RECORD_VERSION);
      expect(Array.isArray(stored.entries)).toBe(true);
      expect(stored.entries).toEqual([]);
    });
  });
});
