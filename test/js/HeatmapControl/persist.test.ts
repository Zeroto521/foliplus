import { describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/HeatmapControl/const.js";
import { HeatmapManager } from "#foliplus/HeatmapControl/manager.js";
import { makeManager } from "./fixture.js";

describe("HeatmapManager — versioned persisted config", () => {
  const KEY = CONST.STORAGE.KEY;

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

    it("saves null layerId when no layer selected", () => {
      const m = makeManager();
      m.selectedLayerId = null;
      m.saveConfig();
      const stored = JSON.parse(window.localStorage.getItem(KEY)!);
      expect(stored.layerId).toBeNull();
    });
  });

  describe("clearSavedConfig", () => {
    it("removes the storage key", () => {
      const m = makeManager();
      window.localStorage.setItem(KEY, JSON.stringify({ agg: "sum" }));
      expect(window.localStorage.getItem(KEY)).not.toBeNull();
      m.clearSavedConfig();
      expect(window.localStorage.getItem(KEY)).toBeNull();
    });

    it("does not throw when key does not exist", () => {
      const m = makeManager();
      expect(() => m.clearSavedConfig()).not.toThrow();
    });

    it("swallows removeItem errors and logs a warning", () => {
      const warn = vi.fn();
      vi.spyOn(console, "warn").mockImplementation(warn);
      const m = makeManager();
      // MockStorage exposes removeItem on its prototype; spy there so the
      // manager's `window.localStorage.removeItem(...)` call is intercepted.
      const proto = Object.getPrototypeOf(window.localStorage);
      const removeItem = vi.spyOn(proto, "removeItem").mockImplementation(() => {
        throw new Error("quota");
      });
      try {
        expect(() => m.clearSavedConfig()).not.toThrow();
        expect(removeItem).toHaveBeenCalledWith(KEY);
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining("failed to clear saved data"),
          expect.any(Error),
        );
      } finally {
        removeItem.mockRestore();
        vi.restoreAllMocks();
      }
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

    it("clamps numClasses to valid range", () => {
      const m = makeManager();
      m.applySavedConfig({ numClasses: 99 });
      expect(m.numClasses).toBe(CONST.CLASS_COUNT.MAX);

      m.applySavedConfig({ numClasses: 0 });
      expect(m.numClasses).toBe(CONST.CLASS_COUNT.MIN);
    });

    it("applies only present fields, keeps defaults for missing", () => {
      const m = makeManager();
      m.currentAgg = "custom_agg";
      m.applySavedConfig({ agg: "sum" });
      expect(m.currentAgg).toBe("sum");
      expect(m.currentMethod).toBe("jenks");
      expect(m.currentScheme).toBe("Reds");
    });

    it("sets selectedLayerId to null when layerId is missing", () => {
      const m = makeManager();
      m.selectedLayerId = "old_layer";
      m.applySavedConfig({});
      expect(m.selectedLayerId).toBeNull();
    });

    it("ignores undefined borderWeight, keeps current value", () => {
      const m = makeManager();
      m.borderWeight = 2.5;
      m.applySavedConfig({});
      expect(m.borderWeight).toBe(2.5);
    });
  });

  describe("flush — teardown safety", () => {
    it("writes the pending config on flush, and is idempotent", () => {
      const m = makeManager();
      m.selectedLayerId = "layer_x";
      m.currentAgg = CONST.AGG.AVG;
      m.currentScheme = "Greens";
      m.numClasses = 5;
      m.saveConfig(); // schedule a write — flush below lands it

      m.flush();

      const stored = JSON.parse(window.localStorage.getItem(KEY)!);
      expect(stored.layerId).toBe("layer_x");
      expect(stored.agg).toBe("avg");
      expect(stored.scheme).toBe("Greens");
      expect(stored.numClasses).toBe(5);
      expect(stored.version).toBe(CONST.RECORD_VERSION);

      // A second flush must not double-write or drop fields — the timer is
      // already cleared by the first flush, so the second call is a no-op.
      const before = window.localStorage.getItem(KEY);
      m.flush();
      expect(window.localStorage.getItem(KEY)).toBe(before);
    });

    it("flush is a no-op when nothing has been scheduled", () => {
      // Conditional-flush semantic: a teardown that has nothing pending must
      // not rewrite the record. Storage stays untouched.
      const m = makeManager();
      m.selectedLayerId = "layer_x";
      m.flush();
      expect(window.localStorage.getItem(KEY)).toBeNull();
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

    it("preserves falsy values (false / 0) through save → load → apply", () => {
      const m1 = makeManager();
      m1.currentLabelShow = false;
      m1.borderWeight = 0;
      m1.saveConfig();

      const m2 = makeManager();
      const loaded = m2.loadSavedConfig();
      expect(loaded).not.toBeNull();
      m2.applySavedConfig(loaded!);

      expect(m2.currentLabelShow).toBe(false);
      expect(m2.borderWeight).toBe(0);
    });
  });
});
