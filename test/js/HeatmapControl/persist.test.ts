import { describe, expect, it, vi } from "vitest";
import { CLASS_COUNT, METHOD } from "#core/classify.js";
import * as CONST from "#foliplus/HeatmapControl/const.js";
import { BORDER_WEIGHT } from "#common/form.js";
import { makeManager } from "./fixture.js";

describe("HeatmapManager — versioned persisted config", () => {
  const KEY = CONST.STORAGE.KEY;

  describe("saveConfig — writes the version stamp", () => {
    it("includes version alongside every other persisted field", () => {
      const m = makeManager();
      m.selectedLayerId = "layer_abc";
      m.agg = CONST.AGG.SUM;
      m.method = METHOD.QUANTILE;
      m.scheme = "Blues";
      m.numClasses = 4;
      m.borderWeight = 2;
      m.borderColor = "#ff0000";
      m.labelShow = true;
      m.labelFormat = "comma";
      m.field = "price";

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
          expect.stringContaining("failed to remove data"),
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
      expect(m.agg).toBe("sum");
      expect(m.method).toBe("jenks");
      expect(m.scheme).toBe("Reds");
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

  describe("saved records are validated at the boundary", () => {
    // loadRecord is a static assertion, not a check: a record from an older
    // build, a hand-edited one, or one from a future version holds whatever
    // it likes. A bad field must keep the default instead of reaching the
    // classifier (which used to re-mean an unknown method as equal) or chroma
    // (whose throw used to abort the panel on load).
    const store = (record: unknown) =>
      window.localStorage.setItem(KEY, JSON.stringify(record));

    it("drops a method the classifier does not implement", () => {
      const m = makeManager();
      const before = m.method;
      store({ method: "bogus", agg: "sum", scheme: "Reds" });
      const loaded = m.loadSavedConfig()!;
      expect(loaded.method).toBeUndefined();
      // The neighbouring fields are unaffected by one bad one.
      expect(loaded.agg).toBe("sum");
      expect(loaded.scheme).toBe("Reds");
      m.applySavedConfig(loaded);
      expect(m.method).toBe(before);
    });

    it("rejects a padded or differently-cased method", () => {
      // A method is a protocol token, so padding and case are meaningful.
      const m = makeManager();
      store({ method: " equal " });
      expect(m.loadSavedConfig()!.method).toBeUndefined();
      store({ method: "EQUAL" });
      expect(m.loadSavedConfig()!.method).toBeUndefined();
      store({ method: "equal" });
      expect(m.loadSavedConfig()!.method).toBe("equal");
    });

    it("drops an unknown aggregation and a non-integer class count", () => {
      const m = makeManager();
      store({ agg: "median", numClasses: 3.5, scheme: "Reds" });
      const loaded = m.loadSavedConfig()!;
      expect(loaded.agg).toBeUndefined();
      expect(loaded.numClasses).toBeUndefined();
      expect(loaded.scheme).toBe("Reds");
    });

    it("clamps an out-of-range class count and keeps a null layerId", () => {
      const m = makeManager();
      store({ numClasses: 99, layerId: null });
      const loaded = m.loadSavedConfig()!;
      expect(loaded.numClasses).toBe(CLASS_COUNT.MAX);
      // null means "the user cleared the selection", so it is preserved
      // rather than treated as an absent field.
      expect(loaded.layerId).toBeNull();
    });

    it("drops a version stamp that is not a positive integer", () => {
      // Absent means "legacy record - the fields are the source of truth";
      // present-but-invalid is not a version at all.
      const m = makeManager();
      store({ version: 0, agg: "sum" });
      expect(m.loadSavedConfig()!.version).toBeUndefined();
      expect(m.loadSavedConfig()!.agg).toBe("sum");
      store({ version: 1.5 });
      expect(m.loadSavedConfig()!.version).toBeUndefined();
      store({ version: "3" });
      expect(m.loadSavedConfig()!.version).toBeUndefined();
    });

    it("clamps a border weight the way the live setter does", () => {
      // The panel offers BORDER_WEIGHT, so a record must not enter the
      // manager through a wider gate than the UI itself provides.
      const m = makeManager();
      store({ borderWeight: -4 });
      expect(m.loadSavedConfig()!.borderWeight).toBe(BORDER_WEIGHT.MIN);
      store({ borderWeight: 99 });
      expect(m.loadSavedConfig()!.borderWeight).toBe(BORDER_WEIGHT.MAX);
    });

    it("drops a label format outside the NumberStyle union", () => {
      const m = makeManager();
      store({ labelFormat: "currency" });
      expect(m.loadSavedConfig()!.labelFormat).toBeUndefined();
    });

    it("ignores a non-object record and leaves the one-shot guard alone", () => {
      const m = makeManager();
      store([1, 2, 3]);
      expect(m.loadSavedConfig()).toBeNull();
      m.applySavedConfig([1, 2, 3] as never);
      expect(m.hasScanned).toBe(false);
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
      expect(m.agg).toBe("max");
      expect(m.method).toBe("equal");
      expect(m.scheme).toBe("Greens");
      expect(m.numClasses).toBe(5);
      expect(m.borderWeight).toBe(3);
      expect(m.borderColor).toBe("#00ff00");
      expect(m.labelShow).toBe(true);
      expect(m.labelFormat).toBe("percent");
      expect(m.field).toBe("qty");
    });

    it("clamps numClasses to valid range", () => {
      const m = makeManager();
      m.applySavedConfig({ numClasses: 99 });
      expect(m.numClasses).toBe(CLASS_COUNT.MAX);

      m.applySavedConfig({ numClasses: 0 });
      expect(m.numClasses).toBe(CLASS_COUNT.MIN);
    });

    it("applies only present fields, keeps defaults for missing", () => {
      const m = makeManager();
      m.agg = "custom_agg";
      m.applySavedConfig({ agg: "sum" });
      expect(m.agg).toBe("sum");
      expect(m.method).toBe("jenks");
      expect(m.scheme).toBe("Reds");
    });

    it("sets selectedLayerId to null when layerId is missing", () => {
      const m = makeManager();
      m.selectedLayerId = "old_layer";
      m.applySavedConfig({});
      expect(m.selectedLayerId).toBeNull();
    });

    it("keeps an empty field as the auto sentinel on an old record", () => {
      // Records written before the placeholder removal store "" for "no
      // explicit pick". The empty string must survive the save/load round
      // trip and leave the manager in auto mode instead of a real field.
      const m = makeManager();
      m.selectedLayerId = "layer_abc";
      m.field = "";
      m.saveConfig();
      const stored = JSON.parse(window.localStorage.getItem(KEY)!);
      expect(stored.field).toBe("");
      const m2 = makeManager();
      m2.applySavedConfig(m.loadSavedConfig()!);
      expect(m2.field).toBe("");
    });

    it("stores an explicit field pick as the real name", () => {
      const m = makeManager();
      m.field = "price";
      m.saveConfig();
      const stored = JSON.parse(window.localStorage.getItem(KEY)!);
      expect(stored.field).toBe("price");
      const m2 = makeManager();
      m2.applySavedConfig(m.loadSavedConfig()!);
      expect(m2.field).toBe("price");
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
      m.agg = CONST.AGG.AVG;
      m.scheme = "Greens";
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
      m1.agg = "avg";
      m1.method = "heads";
      m1.scheme = "Viridis";
      m1.numClasses = 3;
      m1.borderWeight = 0.5;
      m1.borderColor = "#111111";
      m1.labelShow = true;
      m1.field = "value";
      m1.saveConfig();

      const stored = JSON.parse(window.localStorage.getItem(KEY)!);
      expect(stored.version).toBe(CONST.RECORD_VERSION);

      const m2 = makeManager();
      const loaded = m2.loadSavedConfig();
      expect(loaded).toEqual(stored);
      m2.applySavedConfig(loaded!);
      expect(m2.selectedLayerId).toBe("r1");
      expect(m2.agg).toBe("avg");
      expect(m2.method).toBe("heads");
      expect(m2.scheme).toBe("Viridis");
      expect(m2.numClasses).toBe(3);
      expect(m2.borderWeight).toBe(0.5);
      expect(m2.borderColor).toBe("#111111");
      expect(m2.labelShow).toBe(true);
      expect(m2.field).toBe("value");
    });

    it("preserves falsy values (false / 0) through save → load → apply", () => {
      const m1 = makeManager();
      m1.labelShow = false;
      m1.borderWeight = 0;
      m1.saveConfig();

      const m2 = makeManager();
      const loaded = m2.loadSavedConfig();
      expect(loaded).not.toBeNull();
      m2.applySavedConfig(loaded!);

      expect(m2.labelShow).toBe(false);
      expect(m2.borderWeight).toBe(0);
    });
  });
});

describe("HeatmapManager — persisted per-source filters", () => {
  const KEY = CONST.STORAGE.KEY;
  const atom = {
    kind: "atom" as const,
    field: "magnitude",
    op: "between" as const,
    range: [2, 4] as [number, number],
  };

  it("saves each source filter and restores the map on load/apply", () => {
    const m1 = makeManager();
    m1.selectedLayerId = "layer_a";
    m1.layerFilters.set("layer_a", atom);
    m1.layerFilters.set("layer_b", { ...atom, field: "weight" });
    m1.saveConfig();

    const stored = JSON.parse(window.localStorage.getItem(KEY)!);
    expect(stored.filters).toEqual({
      layer_a: atom,
      layer_b: { ...atom, field: "weight" },
    });

    const m2 = makeManager();
    m2.applySavedConfig(m2.loadSavedConfig()!);
    expect(m2.layerFilters.get("layer_a")).toEqual(atom);
    expect(m2.layerFilters.get("layer_b")).toEqual({
      ...atom,
      field: "weight",
    });
  });

  it("omits the filters field when no source is filtered", () => {
    const m = makeManager();
    m.saveConfig();
    const stored = JSON.parse(window.localStorage.getItem(KEY)!);
    expect(stored.filters).toBeUndefined();
  });

  it("drops malformed persisted filters rather than applying them", () => {
    const m = makeManager();
    m.applySavedConfig({
      filters: {
        ok: atom,
        badOp: { kind: "atom", field: "x", op: "nope" },
        badRange: { kind: "atom", field: "x", op: "between", range: [5, 1] },
        notObject: 7,
      },
    } as never);
    expect(Array.from(m.layerFilters.keys())).toEqual(["ok"]);
  });

  it("restores a filter AST that the first render then revalidates", () => {
    const m = makeManager();
    m.applySavedConfig({
      layerId: "layer_a",
      filters: { layer_a: atom },
    } as never);
    // The parser keeps the AST intact; the render-time revalidation clamps
    // or drops it against the rebuilt snapshot (pinned in filter.test.ts).
    expect(m.layerFilters.get("layer_a")).toEqual(atom);
  });
});
