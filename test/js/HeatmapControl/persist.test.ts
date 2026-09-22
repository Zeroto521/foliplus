import { beforeEach, describe, expect, it } from "vitest";
import * as CONST from "#foliplus/HeatmapControl/const.js";
import { HeatmapManager } from "#foliplus/HeatmapControl/manager.js";
import { makeManager } from "./fixture.js";

describe("HeatmapManager — versioned persisted config", () => {
  const KEY = CONST.STORAGE.KEY;

  beforeEach(() => {
    window.localStorage.clear();
  });

  describe("saveConfig — writes the version stamp", () => {
    it("includes version alongside every other persisted field", () => {
      const m = makeManager();
      m.selectedLayerId = "layer_abc";
      m.currentAgg = CONST.AGG.SUM;
      m.currentMethod = CONST.METHOD.QUANTILE;
      m.currentScheme = "Blues";
      m.numClasses = 4;
      m.borderWeight = 2;
      m.borderColor = "#ff0000";
      m.currentLabelShow = true;
      m.currentLabelFormat = "comma";
      m.currentField = "price";

      m.saveConfig();

      const stored = JSON.parse(window.localStorage.getItem(KEY)!);
      expect(stored.version).toBe(CONST.RECORD_VERSION);
      expect(stored.layerId).toBe("layer_abc");
      expect(stored.agg).toBe("sum");
      expect(stored.numClasses).toBe(4);
    });
  });

  describe("loadSavedConfig — tolerant of missing/older version", () => {
    it("returns null when nothing is stored", () => {
      expect(makeManager().loadSavedConfig()).toBeNull();
    });

    it("returns the new-format record with its version intact", () => {
      const m = makeManager();
      const cfg = {
        version: CONST.RECORD_VERSION,
        layerId: "x",
        agg: "sum",
        method: "jenks",
      };
      window.localStorage.setItem(KEY, JSON.stringify(cfg));
      expect(m.loadSavedConfig()).toEqual(cfg);
    });

    it("returns a legacy record without a version unchanged (no migration)", () => {
      const m = makeManager();
      const legacy = { layerId: "x", agg: "sum", method: "jenks", scheme: "Reds" };
      window.localStorage.setItem(KEY, JSON.stringify(legacy));
      expect(m.loadSavedConfig()).toEqual(legacy);
      // version is absent on the legacy record — applySavedConfig must still
      // apply every field to the manager's state.
      m.applySavedConfig(legacy as Parameters<typeof m.applySavedConfig>[0]);
      expect(m.selectedLayerId).toBe("x");
      expect(m.currentAgg).toBe("sum");
      expect(m.currentMethod).toBe("jenks");
      expect(m.currentScheme).toBe("Reds");
    });

    it("returns a record with an older/unknown version value unchanged", () => {
      const m = makeManager();
      const cfg = { version: 999, layerId: "x", agg: "sum" };
      window.localStorage.setItem(KEY, JSON.stringify(cfg));
      expect(m.loadSavedConfig()).toEqual(cfg);
    });

    it("returns null for corrupted JSON", () => {
      const m = makeManager();
      window.localStorage.setItem(KEY, "not-json");
      expect(m.loadSavedConfig()).toBeNull();
    });
  });

  describe("applySavedConfig on a legacy record", () => {
    it("applies every field when version is missing, and keeps manager defaults otherwise", () => {
      const m = makeManager();
      m.applySavedConfig({
        layerId: "layer_xyz",
        agg: "max",
        method: "equal",
        scheme: "Greens",
        numClasses: 5,
        borderWeight: 3,
        borderColor: "#00ff00",
        labelShow: true,
        labelFormat: "percent",
        field: "properties.qty",
      } as Parameters<typeof m.applySavedConfig>[0]);
      expect(m.selectedLayerId).toBe("layer_xyz");
      expect(m.currentAgg).toBe("max");
      expect(m.currentMethod).toBe("equal");
      expect(m.currentScheme).toBe("Greens");
      expect(m.numClasses).toBe(5);
      expect(m.borderWeight).toBe(3);
      expect(m.borderColor).toBe("#00ff00");
      expect(m.currentLabelShow).toBe(true);
      expect(m.currentLabelFormat).toBe("percent");
      expect(m.currentField).toBe("qty");
    });
  });

  describe("flush — teardown safety", () => {
    it("writes the current config on flush, and is idempotent", () => {
      const m = makeManager();
      m.selectedLayerId = "layer_x";
      m.currentAgg = CONST.AGG.AVG;
      m.currentScheme = "Greens";
      m.numClasses = 5;

      m.flush();

      const stored = JSON.parse(window.localStorage.getItem(KEY)!);
      expect(stored.layerId).toBe("layer_x");
      expect(stored.agg).toBe("avg");
      expect(stored.scheme).toBe("Greens");
      expect(stored.numClasses).toBe(5);
      expect(stored.version).toBe(CONST.RECORD_VERSION);

      // A second flush must not double-write or drop fields.
      const before = window.localStorage.getItem(KEY);
      m.flush();
      expect(window.localStorage.getItem(KEY)).toBe(before);
    });
  });

  describe("round-trip", () => {
    it("save → load → apply preserves every field (version travels with the record)", () => {
      const m1 = makeManager();
      m1.selectedLayerId = "r1";
      m1.currentAgg = "avg";
      m1.currentMethod = "heads";
      m1.currentScheme = "Viridis";
      m1.numClasses = 3;
      m1.borderWeight = 0.5;
      m1.borderColor = "#111111";
      m1.currentLabelShow = true;
      m1.currentField = "value";
      m1.saveConfig();

      const stored = JSON.parse(window.localStorage.getItem(KEY)!);
      expect(stored.version).toBe(CONST.RECORD_VERSION);

      const m2 = makeManager();
      const loaded = m2.loadSavedConfig();
      expect(loaded).toEqual(stored);
      m2.applySavedConfig(loaded!);
      expect(m2.selectedLayerId).toBe("r1");
      expect(m2.currentAgg).toBe("avg");
      expect(m2.currentMethod).toBe("heads");
      expect(m2.currentScheme).toBe("Viridis");
      expect(m2.numClasses).toBe(3);
      expect(m2.borderWeight).toBe(0.5);
      expect(m2.borderColor).toBe("#111111");
      expect(m2.currentLabelShow).toBe(true);
      expect(m2.currentField).toBe("value");
    });
  });
});
