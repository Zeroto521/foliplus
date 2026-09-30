// IntentStore — unit surface + serialization-compatibility (COMPARE.md).
//
// PR① acceptance: toPersisted vs old buildLayerStates field-by-field,
// loadFromPersisted vs parseLayerState + PARSE_OVERRIDE, overrides array ↔
// Set round-trip. Values and behaviour must match the pre-store twin.
import { describe, expect, it, vi } from "vitest";
import { IntentStore } from "#foliplus/LayerControl/ui/intentStore.js";
import type {
  LayerOverride,
  PersistedLayerState,
} from "#foliplus/LayerControl/type.js";

const ann = (over: Record<string, unknown> = {}) =>
  ({
    show: true,
    field: "name",
    color: "#333333",
    size: 12,
    format: "plain",
    collide: true,
    ...over,
  }) as never;

describe("IntentStore — get/set/clear/mark/unmark", () => {
  it("set writes the value and marks provenance for override keys", () => {
    const store = new IntentStore();
    store.set("a", "fillColor", "#ff0000");
    expect(store.get("a", "fillColor")).toBe("#ff0000");
    expect(store.isUserSet("a", "fillColor")).toBe(true);
  });

  it("set on name/annotation does not mark provenance", () => {
    const store = new IntentStore();
    store.set("a", "name", "Renamed");
    store.set("a", "annotation", ann());
    expect(store.get("a", "name")).toBe("Renamed");
    expect(store.get("a", "annotation")).toEqual(ann());
    expect(store.dumpProvenance()).toEqual({});
  });

  it("clear drops the value and unmarks provenance together", () => {
    const store = new IntentStore();
    store.set("a", "fillColor", "#ff0000");
    store.clear("a", "fillColor");
    expect(store.get("a", "fillColor")).toBeUndefined();
    expect(store.isUserSet("a", "fillColor")).toBe(false);
    expect(store.dumpProvenance()).toEqual({});
  });

  it("setValue is a half-write (no mark) — setIntent compat", () => {
    const store = new IntentStore();
    store.setValue("a", "visible", true);
    expect(store.get("a", "visible")).toBe(true);
    expect(store.isUserSet("a", "visible")).toBe(false);
  });

  it("mark refuses a dimension with no live value", () => {
    const store = new IntentStore();
    expect(store.mark("a", "opacity")).toBe(false);
    expect(store.isUserSet("a", "opacity")).toBe(false);
  });

  it("mark is idempotent and keeps insertion order", () => {
    const store = new IntentStore();
    store.setValue("a", "fillColor", "#f00");
    store.setValue("a", "fillOpacity", 0.5);
    expect(store.mark("a", "fillColor")).toBe(true);
    expect(store.mark("a", "fillOpacity")).toBe(true);
    expect(store.mark("a", "fillColor")).toBe(true);
    expect(store.dumpProvenance().a).toEqual(["fillColor", "fillOpacity"]);
  });

  it("unmark drops one marker and collapses an empty row", () => {
    const store = new IntentStore();
    store.set("a", "opacity", 0.3);
    store.unmark("a", "opacity");
    // value remains; provenance gone — Reset of one dim, value half via clear
    expect(store.get("a", "opacity")).toBe(0.3);
    expect(store.isUserSet("a", "opacity")).toBe(false);

    store.clear("a", "opacity");
    expect(store.ids()).toEqual([]);
  });

  it("dropRow clears style dims + provenance but keeps name/annotation", () => {
    const store = new IntentStore();
    store.set("a", "visible", false);
    store.set("a", "fillColor", "#0f0");
    store.set("a", "name", "Keep");
    store.set("a", "annotation", ann());
    store.dropRow("a");
    expect(store.get("a", "visible")).toBeUndefined();
    expect(store.get("a", "fillColor")).toBeUndefined();
    expect(store.get("a", "name")).toBe("Keep");
    expect(store.get("a", "annotation")).toEqual(ann());
    expect(store.dumpProvenance()).toEqual({});
  });

  it("hasLive treats 0 / empty string as live", () => {
    const store = new IntentStore();
    store.setValue("a", "fillOpacity", 0);
    store.setValue("a", "fillColor", "");
    expect(store.hasLive("a", "fillOpacity")).toBe(true);
    expect(store.hasLive("a", "fillColor")).toBe(true);
    expect(store.hasLive("a", "opacity")).toBe(false);
  });
});

describe("IntentStore — overrides array ↔ Set round-trip", () => {
  const cases: LayerOverride[][] = [
    [],
    ["visible"],
    ["fillColor", "fillOpacity"],
    ["opacity", "zoomRange", "borderColor", "borderWeight"],
    ["visible", "fillColor", "borderColor", "opacity", "zoomRange"],
  ];

  for (const arr of cases) {
    it(`round-trips [${arr.join(", ")}]`, () => {
      const store = new IntentStore();
      store.seedProvenance("x", arr);
      expect(store.dumpProvenance().x ?? []).toEqual(arr);
      // back through toPersisted and loadFromPersisted
      const row: PersistedLayerState = { overrides: [...arr] };
      for (const ov of arr) {
        (row as Record<string, unknown>)[ov] = sampleValue(ov);
      }
      const store2 = new IntentStore();
      store2.loadFromPersisted({ layers: { x: row } });
      expect(store2.dumpProvenance().x ?? []).toEqual(arr);
    });
  }

  it("array → Set de-duplicates while keeping first-seen order", () => {
    const store = new IntentStore();
    store.seedProvenance("x", ["opacity", "visible", "opacity"]);
    expect(store.dumpProvenance().x).toEqual(["opacity", "visible"]);
  });
});

function sampleValue(ov: LayerOverride): unknown {
  switch (ov) {
    case "visible":
      return true;
    case "fillColor":
      return "#ff0000";
    case "fillOpacity":
      return 0.4;
    case "borderColor":
      return "#00ff00";
    case "borderWeight":
      return 2;
    case "opacity":
      return 0.7;
    case "zoomRange":
      return [3, 12];
  }
}

describe("IntentStore — toPersisted ↔ buildLayerStates field-level", () => {
  it("writes each declared override under its own key with LIVE guard", () => {
    const store = new IntentStore();
    store.setValue("a", "fillColor", "#abcdef");
    store.setValue("a", "fillOpacity", 0.25);
    store.mark("a", "fillColor");
    store.mark("a", "fillOpacity");
    // value present but not marked → not written
    store.setValue("a", "opacity", 0.9);
    // marker present but value not LIVE → filtered from toPersisted
    store.setValue("b", "borderWeight", "3" as never);
    store.seedProvenance("b", ["borderWeight"]);

    const out = store.toPersisted();
    expect(out.a).toEqual({
      overrides: ["fillColor", "fillOpacity"],
      fillColor: "#abcdef",
      fillOpacity: 0.25,
    });
    expect(out.b).toBeUndefined();
  });

  it("annotation rider joins even with empty overrides; live map wins over seed", () => {
    const store = new IntentStore();
    store.setValue("a", "annotation", ann({ field: "seed" }));
    store.setValue("a", "name", "Renamed");
    const live = { a: ann({ field: "live" }) };
    const out = store.toPersisted(live);
    expect(out.a).toEqual({
      overrides: [],
      annotation: ann({ field: "live" }),
    });
  });

  it("skips a row that has neither live declared overrides nor annotation", () => {
    const store = new IntentStore();
    store.setValue("a", "name", "OnlyName");
    const out = store.toPersisted();
    expect(out).toEqual({});
  });

  it("preserves provenance insertion order in the overrides array", () => {
    const store = new IntentStore();
    store.setValue("a", "opacity", 0.1);
    store.setValue("a", "visible", true);
    store.setValue("a", "zoomRange", [1, 5]);
    store.mark("a", "opacity");
    store.mark("a", "visible");
    store.mark("a", "zoomRange");
    expect(store.toPersisted().a.overrides).toEqual([
      "opacity",
      "visible",
      "zoomRange",
    ]);
  });
});

describe("IntentStore — loadFromPersisted ↔ parseLayerState + PARSE_OVERRIDE", () => {
  it("loads values only for overrides with live values (marker+value together)", () => {
    const store = new IntentStore();
    store.loadFromPersisted({
      renamedNames: { a: "Renamed" },
      annotations: { a: ann({ field: "legacy" }), b: ann() },
      layers: {
        a: {
          overrides: ["visible", "fillColor"],
          visible: true,
          // fillColor listed but missing → still seeded as marker? parseLayerState
          // drops such a marker; this asserts the load half for a well-formed entry.
          fillColor: "#123456",
          annotation: ann({ field: "new" }),
        },
      },
    });
    expect(store.get("a", "name")).toBe("Renamed");
    expect(store.get("a", "annotation")).toEqual(ann({ field: "new" }));
    expect(store.get("a", "visible")).toBe(true);
    expect(store.get("a", "fillColor")).toBe("#123456");
    expect(store.dumpProvenance().a).toEqual(["visible", "fillColor"]);
    // legacy annotation for b (no layers entry)
    expect(store.get("b", "annotation")).toEqual(ann());
    expect(store.dumpProvenance().b).toBeUndefined();
  });

  it("drops a value whose LIVE check fails even when the marker is present", () => {
    const store = new IntentStore();
    store.loadFromPersisted({
      layers: {
        a: {
          overrides: ["opacity", "visible"],
          opacity: "not-a-number" as never,
          visible: true,
        },
      },
    });
    expect(store.get("a", "opacity")).toBeUndefined();
    expect(store.get("a", "visible")).toBe(true);
    // parseLayerState would have dropped the opacity marker already; a
    // well-formed PersistedLayerState never holds this combination. If it
    // does, we still keep the marker (seedProvenance trusts the array) but
    // never restore a non-live value — matching old loadPersistedState.
    expect(store.dumpProvenance().a).toEqual(["opacity", "visible"]);
  });

  it("empty source clears the store", () => {
    const store = new IntentStore();
    store.set("a", "visible", true);
    store.loadFromPersisted({});
    expect(store.ids()).toEqual([]);
  });
});

describe("IntentStore — disk-shape equality with the old twin", () => {
  /** Reimplementation of the old buildLayerStates value/provenance rules
   *  against a plain intents+provenance pair — the pre-store mirror. */
  const oldBuild = (
    intents: Record<string, Record<string, unknown>>,
    provenance: Record<string, string[]>,
    annotations: Record<string, unknown>,
  ) => {
    const LIVE: Record<string, (v: unknown) => boolean> = {
      visible: v => typeof v === "boolean",
      fillColor: v => typeof v === "string",
      fillOpacity: v => typeof v === "number",
      borderColor: v => typeof v === "string",
      borderWeight: v => typeof v === "number",
      opacity: v => typeof v === "number",
      zoomRange: v => Array.isArray(v),
    };
    const states: Record<string, PersistedLayerState> = {};
    const ids = new Set([
      ...Object.keys(provenance),
      ...Object.keys(annotations),
      ...Object.keys(intents),
    ]);
    for (const id of ids) {
      const declared = (provenance[id] ?? []).filter(o => LIVE[o]?.(intents[id]?.[o]));
      const annotation = annotations[id];
      if (declared.length === 0 && !annotation) continue;
      const state: PersistedLayerState = { overrides: declared };
      for (const o of declared) {
        const value = intents[id]?.[o];
        if (LIVE[o](value)) {
          (state as Record<string, unknown>)[o] = value;
        }
      }
      if (annotation) (state as { annotation?: unknown }).annotation = annotation;
      states[id] = state;
    }
    return states;
  };

  const scenarios = [
    {
      name: "visible only",
      intents: { a: { visible: false } },
      provenance: { a: ["visible"] },
      annotations: {},
    },
    {
      name: "style bundle + name rider",
      intents: {
        a: {
          visible: true,
          fillColor: "#ff0000",
          fillOpacity: 0.2,
          borderColor: "#00ff00",
          borderWeight: 3,
          opacity: 0.8,
          zoomRange: [2, 10],
          name: "N",
        },
      },
      provenance: {
        a: [
          "visible",
          "fillColor",
          "fillOpacity",
          "borderColor",
          "borderWeight",
          "opacity",
          "zoomRange",
        ],
      },
      annotations: {},
    },
    {
      name: "annotation-only row",
      intents: {},
      provenance: {},
      annotations: { a: ann() },
    },
    {
      name: "marker with missing value filtered",
      intents: { a: { visible: true } },
      provenance: { a: ["visible", "opacity"] },
      annotations: {},
    },
    {
      name: "value without marker not written",
      intents: { a: { visible: true, opacity: 0.5 } },
      provenance: { a: ["visible"] },
      annotations: {},
    },
    {
      name: "legacy + new annotation (new wins)",
      intents: { a: { annotation: ann({ field: "new" }) } },
      provenance: {},
      annotations: { a: ann({ field: "legacy" }) },
    },
    {
      name: "multi-layer mix",
      intents: {
        a: { visible: false },
        b: { name: "B" },
        c: { fillOpacity: 0 },
      },
      provenance: { a: ["visible"], c: ["fillOpacity"] },
      annotations: { d: ann() },
    },
  ];

  for (const sc of scenarios) {
    it(`toPersisted matches old buildLayerStates — ${sc.name}`, () => {
      const store = new IntentStore();
      // seed values then provenance (old twin)
      for (const [id, intent] of Object.entries(sc.intents)) {
        for (const [k, v] of Object.entries(intent)) {
          if (v !== undefined) store.setValue(id, k as never, v as never);
        }
      }
      for (const [id, ov] of Object.entries(sc.provenance)) {
        store.seedProvenance(id, ov as LayerOverride[]);
      }
      // annotation seed lives on the store for the old intents side; the
      // live map is the annotations arg (old buildLayerStates input).
      const liveAnn = sc.annotations as Record<string, never>;
      const viaStore = store.toPersisted(liveAnn);
      const viaOld = oldBuild(sc.intents, sc.provenance, liveAnn);
      expect(viaStore).toEqual(viaOld);
    });
  }
});
