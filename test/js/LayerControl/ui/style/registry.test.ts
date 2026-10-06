// LayerControl style-panel dimension registry — contract tests.
//
// The registry is the discovery surface for per-layer dimensions. These
// tests cover the *surface*: descriptor shape, duplicate-key rejection,
// and the built-in `opacity` descriptor delegating gate/value/row to
// the existing helpers. Behaviour of the helpers themselves lives in
// ./style.test.ts — kept here is only what changes when the registry is
// involved.
//
// The registry is a module-scoped Map, so registering test dims has to
// happen exactly once per file to avoid collisions. That registration
// is at file scope below; every test after it can rely on the test dim
// being present.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayerController } from "#foliplus/LayerControl/controller.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { setIntent } from "#foliplus/LayerControl/ui/intent.js";
import { ANNOTATION_DIMENSION } from "#foliplus/LayerControl/ui/style/annotation.js";
import { BORDER_DIMENSION } from "#foliplus/LayerControl/ui/style/border.js";
import { DELEGATED_DIM_ORDER } from "#foliplus/LayerControl/ui/style/delegated.js";
import { FILL_DIMENSION } from "#foliplus/LayerControl/ui/style/fill.js";
import { OPACITY_DIMENSION } from "#foliplus/LayerControl/ui/style/opacity.js";
import {
  DIM_ORDER,
  LABEL_DIM_ORDER,
  gatedRows,
  getDimension,
  listDimensions,
  registerDimension,
  resetIntentKeys,
  writeIntentKeys,
} from "#foliplus/LayerControl/ui/style/registry.js";
import { ZOOM_RANGE_DIMENSION } from "#foliplus/LayerControl/ui/style/zoomRange.js";
import { initFixture, installLeafletGlobals } from "../fixture.js";

const TEST_DIM_KEY = "test.dim.registry";
const testDim = {
  key: TEST_DIM_KEY,
  gate: () => true,
  value: () => 42,
  row: () => document.createElement("div"),
};

// Register once per module graph. `opacity.ts` already ran this for the
// built-in dim at import time; this is the same contract for tests.
registerDimension(testDim);

describe("LayerControl style-panel dimension registry", () => {
  it("getDimension returns the built-in opacity descriptor", () => {
    expect(getDimension("opacity")).toBe(OPACITY_DIMENSION);
  });

  it("getDimension returns the annotation descriptor", () => {
    // The Label section's dimension: registered like every other built-in,
    // its `gate` IS `layerCanLabel` (what the ⋮ menu imports), and its
    // `value` hands back the resolved per-layer config.
    expect(getDimension("annotation")).toBe(ANNOTATION_DIMENSION);
    expect(ANNOTATION_DIMENSION.key).toBe("annotation");
    expect(
      ANNOTATION_DIMENSION.value(
        { c: { annotation: { getConfig: () => ({ show: true }) } } } as never,
        "x",
      ),
    ).toEqual({ show: true });
  });

  it("getDimension returns undefined for an unregistered key", () => {
    // Unknown dimensions degrade honestly — the panel treats them as
    // "this layer does not support this dimension" rather than erroring.
    expect(getDimension("not.a.dimension")).toBeUndefined();
  });

  it("listDimensions lists built-in and test dims in insertion order", () => {
    // Every built-in dim registers at module load (fill / border /
    // opacity / zoomRange, whichever order this test's import graph
    // happens to pull them in); test.dim.registry registers right
    // after, at file scope of this test. Insertion order among the
    // built-ins is not part of the registry contract — what is
    // contract is that the built-ins are present, and test.dim.registry
    // sits at the tail (the last registration this file performs).
    const keys = listDimensions().map(d => d.key);
    for (const k of ["fill", "border", "opacity", "zoomRange"]) {
      expect(keys, `missing built-in "${k}"`).toContain(k);
    }
    expect(keys.at(-1)).toBe(TEST_DIM_KEY);
  });

  it("DIM_ORDER + LABEL_DIM_ORDER cover every registered built-in key", () => {
    // Adding a dimension to the registry without adding it to a section
    // order makes it unreachable from the panel. This test fails loudly on
    // that drift: every key in either order must be registered, and every
    // registered built-in must appear in exactly one order (the sections
    // own their headings, so a key in both would render twice). Order
    // within a section is the display contract; listDimensions is insertion
    // order.
    const registered = listDimensions().map(d => d.key);
    const builtIn = registered.filter(k => k !== TEST_DIM_KEY);
    const ordered = [...DIM_ORDER, ...LABEL_DIM_ORDER];
    expect(new Set(ordered)).toEqual(new Set(builtIn));
    expect(ordered.length).toBe(new Set(ordered).size);
  });

  it("registerDimension throws on a duplicate key — the built-in opacity", () => {
    // A third-party component colliding with our built-in key, or a
    // duplicated import, must fail loudly rather than silently overwrite.
    expect(() =>
      registerDimension({
        key: "opacity",
        gate: () => false,
        value: () => undefined,
        row: () => document.createElement("div"),
      }),
    ).toThrow(/opacity.*already registered/);
  });

  it("registerDimension throws on a duplicate key — a second test.dim.registry", () => {
    expect(() => registerDimension(testDim)).toThrow(
      /test\.dim\.registry.*already registered/,
    );
  });
});

describe("LayerControl style-panel dimension registry — writeIntentKeys", () => {
  let ui: LayerUI;
  let schedule: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    installLeafletGlobals();
    const fixture = initFixture({
      data: [
        {
          id: "overlay1",
          name: "Overlay",
          group: "overlay",
          layer: { options: {}, setZIndex: vi.fn(), getBounds: vi.fn() },
        },
      ],
    });
    ui = fixture.ui;
    schedule = vi.fn();
    ui.c.persistence = { schedule } as never;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("skips undefined values and saves only when something was written", () => {
    expect(
      writeIntentKeys(ui, "overlay1", [
        ["opacity", undefined],
        ["visible", undefined],
      ]),
    ).toBe(false);
    expect(schedule).not.toHaveBeenCalled();

    expect(
      writeIntentKeys(ui, "overlay1", [
        ["opacity", undefined],
        ["opacity", 0.4],
      ]),
    ).toBe(true);
    expect(ui.intentStore.get("overlay1", "opacity")).toBe(0.4);
    expect(ui.intentStore.isUserSet("overlay1", "opacity")).toBe(true);
    expect(schedule).toHaveBeenCalled();
  });

  it("returns false when the writes array is empty", () => {
    expect(writeIntentKeys(ui, "overlay1", [])).toBe(false);
    expect(schedule).not.toHaveBeenCalled();
  });
});

describe("LayerControl style-panel dimension registry — resetIntentKeys", () => {
  let ui: LayerUI;
  let schedule: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    installLeafletGlobals();
    const fixture = initFixture({
      data: [
        {
          id: "overlay1",
          name: "Overlay",
          group: "overlay",
          layer: { options: {}, setZIndex: vi.fn(), getBounds: vi.fn() },
        },
      ],
    });
    ui = fixture.ui;
    schedule = vi.fn();
    ui.c.persistence = { schedule } as never;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("clears listed keys, saves, and returns true", () => {
    ui.intentStore.set("overlay1", "fillColor", "#ff0000");
    ui.intentStore.set("overlay1", "fillOpacity", 0.5);
    expect(resetIntentKeys(ui, "overlay1", ["fillColor", "fillOpacity"])).toBe(true);
    expect(ui.intentStore.get("overlay1", "fillColor")).toBeUndefined();
    expect(ui.intentStore.get("overlay1", "fillOpacity")).toBeUndefined();
    expect(ui.intentStore.isUserSet("overlay1", "fillColor")).toBe(false);
    expect(schedule).toHaveBeenCalled();
  });

  it("returns false and does not save when keys is empty", () => {
    expect(resetIntentKeys(ui, "overlay1", [])).toBe(false);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("clears a missing key without throwing", () => {
    expect(resetIntentKeys(ui, "overlay1", ["opacity"])).toBe(true);
    expect(ui.intentStore.get("overlay1", "opacity")).toBeUndefined();
  });
});

describe("LayerControl style-panel dimension registry — gatedRows", () => {
  let manager: LayerController;
  let ui: LayerUI;

  const overlayLayer = {
    options: {},
    setZIndex: vi.fn(),
    eachLayer: vi.fn(),
    getBounds: vi.fn(() => ({
      isValid: () => true,
      getSouthWest: () => ({ lat: 0, lng: 0 }),
      getNorthEast: () => ({ lat: 1, lng: 1 }),
    })),
  };

  beforeEach(() => {
    installLeafletGlobals();
    ({ manager, ui } = initFixture({
      data: [
        { id: "overlay1", name: "Overlay", group: "overlay", layer: overlayLayer },
      ],
    }));
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  // fill / stroke declare "native" | "none"; opacity / zoomRange accept
  // "native" | "pane" | "none". The gates read them accordingly: fill and
  // border check `=== "native"`, the rest `!== "none"`.
  const mockSurfaceFor = (capabilities: Record<string, string>) => {
    vi.spyOn(ui.c, "surfaceFor").mockReturnValue({
      capabilities,
      paneNames: [],
      geometryType: () => "polygon",
    } as unknown as ReturnType<typeof ui.c.surfaceFor>);
  };

  it("collects the descriptors whose gate passes, in the caller's declared order", () => {
    // One gate pass, caller-declared order: the annotation panel passes
    // DIM_ORDER / LABEL_DIM_ORDER, the delegated drawer its own slice.
    mockSurfaceFor({
      fill: "native",
      stroke: "native",
      opacity: "pane",
      zoomRange: "pane",
      annotation: "none",
    });
    const rows = gatedRows(ui, "overlay1", DIM_ORDER);
    expect(rows.map(d => d.key)).toEqual(["fill", "border", "opacity", "zoomRange"]);
  });

  it("skips dimensions whose gate declines", () => {
    mockSurfaceFor({
      fill: "none",
      stroke: "none",
      opacity: "pane",
      zoomRange: "none",
      annotation: "none",
    });
    const rows = gatedRows(ui, "overlay1", DIM_ORDER);
    expect(rows.map(d => d.key)).toEqual(["opacity"]);
  });

  it("returns an empty array when no gate passes", () => {
    mockSurfaceFor({
      fill: "none",
      stroke: "none",
      opacity: "none",
      zoomRange: "none",
      annotation: "none",
    });
    expect(gatedRows(ui, "overlay1", DIM_ORDER)).toEqual([]);
  });

  it("delegated slice equals panel sweep minus the vector-only dims", () => {
    // Single implementation, two consumers. The delegated drawer's sweep
    // (DELEGATED_DIM_ORDER) must return exactly the rows the annotation
    // panel's Layer sweep (DIM_ORDER) renders for the same keys — the old
    // hand-rolled `if (key === "fill" || key === "border") continue` loop,
    // expressed as one gate pass. This equivalence is what the sink pins.
    mockSurfaceFor({
      fill: "native",
      stroke: "native",
      opacity: "pane",
      zoomRange: "pane",
      annotation: "none",
    });
    const layerRows = gatedRows(ui, "overlay1", DIM_ORDER);
    const delegatedRows = gatedRows(ui, "overlay1", DELEGATED_DIM_ORDER);
    const expected = layerRows.filter(d => d.key !== "fill" && d.key !== "border");
    expect(delegatedRows).toEqual(expected);
    expect(delegatedRows.map(d => d.key)).toEqual(["opacity", "zoomRange"]);
  });

  it("DELEGATED_DIM_ORDER is DIM_ORDER minus fill and border", () => {
    // Pinned so a future edit to the constant cannot silently widen the
    // delegated sweep past the vector-only rows.
    expect([...DELEGATED_DIM_ORDER]).toEqual(["opacity", "zoomRange"]);
    expect([...DELEGATED_DIM_ORDER]).toEqual(
      [...DIM_ORDER].filter(k => k !== "fill" && k !== "border"),
    );
  });
});

describe("LayerControl style-panel dimension registry — opacity descriptor", () => {
  let manager: LayerController;
  let ui: LayerUI;

  const overlayLayer = {
    options: {},
    setZIndex: vi.fn(),
    eachLayer: vi.fn(),
    getBounds: vi.fn(() => ({
      isValid: () => true,
      getSouthWest: () => ({ lat: 0, lng: 0 }),
      getNorthEast: () => ({ lat: 1, lng: 1 }),
    })),
  };

  const initWithOverlay = () => {
    installLeafletGlobals();
    return initFixture({
      data: [
        {
          id: "overlay1",
          name: "Overlay",
          group: "overlay",
          layer: overlayLayer,
        },
        {
          id: "base1",
          name: "OSM",
          group: "base",
          layer: { options: {}, setZIndex: vi.fn() } as never,
          paneName: "tilePane",
        },
      ],
    });
  };

  beforeEach(() => {
    ({ manager, ui } = initWithOverlay());
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  const mockSurfaceFor = (capabilities: { opacity: string; zoomRange: string }) => {
    vi.spyOn(ui.c, "surfaceFor").mockReturnValue({
      capabilities,
      paneNames: [],
      geometryType: () => "polygon",
    } as unknown as ReturnType<typeof ui.c.surfaceFor>);
  };

  it('declares key = "opacity"', () => {
    expect(OPACITY_DIMENSION.key).toBe("opacity");
  });

  it("gate is the pure capability check: true when capabilities.opacity !== 'none'", () => {
    // Invariant (first-class from day one): gate is exactly
    // `capabilities.{dim} !== "none"`. No carrier probes, no
    // `isColorBasemap`, no canvas/styleSetters exclusion — those belong
    // to capability derivation at the surface, not the gate.
    mockSurfaceFor({ opacity: "native", zoomRange: "pane" });
    expect(OPACITY_DIMENSION.gate(ui, "overlay1")).toBe(true);
  });

  it("gate declines when the surface declares 'none'", () => {
    mockSurfaceFor({ opacity: "none", zoomRange: "none" });
    expect(OPACITY_DIMENSION.gate(ui, "overlay1")).toBe(false);
  });

  it("gate declines when the layer is not in the registry", () => {
    // `layerCanOpacity` guards against a missing layer; the descriptor
    // must not silently widen that guard.
    expect(OPACITY_DIMENSION.gate(ui, "not-registered")).toBe(false);
  });

  it("value returns undefined for a layer not in the registry", () => {
    expect(OPACITY_DIMENSION.value(ui, "not-registered")).toBeUndefined();
  });

  it("value returns the user's stored override when one exists", () => {
    setIntent(ui, "overlay1", "opacity", 0.3);
    expect(OPACITY_DIMENSION.value(ui, "overlay1")).toBe(0.3);
  });

  it("write marks provenance for opacity < 1", () => {
    const schedule = vi.fn();
    ui.c.persistence = { schedule } as never;
    vi.spyOn(ui.c, "surfaceFor").mockReturnValue({
      capabilities: { opacity: "pane" },
      paneNames: [],
      panes: [],
    } as never);
    OPACITY_DIMENSION.write!(ui, "overlay1", 0.45);
    expect(ui.intentStore.get("overlay1", "opacity")).toBe(0.45);
    expect(ui.intentStore.isUserSet("overlay1", "opacity")).toBe(true);
  });

  it("write with opacity === 1 clears the override (does not mark)", () => {
    const schedule = vi.fn();
    ui.c.persistence = { schedule } as never;
    vi.spyOn(ui.c, "surfaceFor").mockReturnValue({
      capabilities: { opacity: "pane" },
      paneNames: [],
      panes: [],
    } as never);
    OPACITY_DIMENSION.write!(ui, "overlay1", 0.45);
    OPACITY_DIMENSION.write!(ui, "overlay1", 1);
    expect(ui.intentStore.get("overlay1", "opacity")).toBeUndefined();
    expect(ui.intentStore.isUserSet("overlay1", "opacity")).toBe(false);
  });

  it("write ignores a non-number patch", () => {
    const schedule = vi.fn();
    ui.c.persistence = { schedule } as never;
    OPACITY_DIMENSION.write!(ui, "overlay1", {
      opacity: 0.4,
    } as never);
    OPACITY_DIMENSION.write!(ui, "overlay1", "0.5" as never);
    OPACITY_DIMENSION.write!(ui, "overlay1", null as never);
    OPACITY_DIMENSION.write!(ui, "overlay1", undefined as never);
    expect(ui.intentStore.get("overlay1", "opacity")).toBeUndefined();
    expect(ui.intentStore.isUserSet("overlay1", "opacity")).toBe(false);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("reset clears opacity override", () => {
    const schedule = vi.fn();
    ui.c.persistence = { schedule } as never;
    vi.spyOn(ui.c, "surfaceFor").mockReturnValue({
      capabilities: { opacity: "pane" },
      paneNames: [],
      panes: [],
    } as never);
    OPACITY_DIMENSION.write!(ui, "overlay1", 0.2);
    OPACITY_DIMENSION.reset!(ui, "overlay1");
    expect(ui.intentStore.get("overlay1", "opacity")).toBeUndefined();
  });

  it("valueSource is none/author/user across the three states", () => {
    vi.spyOn(ui.c, "surfaceFor").mockReturnValue({
      capabilities: { opacity: "pane" },
      paneNames: [],
      panes: [],
    } as never);
    expect(OPACITY_DIMENSION.valueSource!(ui, "not-registered")).toBe("none");
    expect(OPACITY_DIMENSION.valueSource!(ui, "overlay1")).toBe("author");
    OPACITY_DIMENSION.write!(ui, "overlay1", 0.3);
    expect(OPACITY_DIMENSION.valueSource!(ui, "overlay1")).toBe("user");
  });
});

describe("LayerControl style-panel dimension registry — fill descriptor", () => {
  let manager: LayerController;
  let ui: LayerUI;

  const overlayLayer = {
    options: {},
    setZIndex: vi.fn(),
    eachLayer: vi.fn(),
    getBounds: vi.fn(() => ({
      isValid: () => true,
      getSouthWest: () => ({ lat: 0, lng: 0 }),
      getNorthEast: () => ({ lat: 1, lng: 1 }),
    })),
  };

  beforeEach(() => {
    installLeafletGlobals();
    ({ manager, ui } = initFixture({
      data: [
        { id: "overlay1", name: "Overlay", group: "overlay", layer: overlayLayer },
      ],
    }));
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("value returns undefined for a layer not in the registry", () => {
    expect(FILL_DIMENSION.value(ui, "not-registered")).toBeUndefined();
  });

  it("value returns the user's stored override when one exists", () => {
    setIntent(ui, "overlay1", "fillColor", "#ff0000");
    setIntent(ui, "overlay1", "fillOpacity", 0.5);
    expect(FILL_DIMENSION.value(ui, "overlay1")).toEqual({
      color: "#ff0000",
      opacity: 0.5,
    });
  });

  it("value falls back to the authored value when no override is set", () => {
    expect(FILL_DIMENSION.value(ui, "overlay1")).toEqual({
      color: "#3388ff",
      opacity: null,
    });
  });

  it("valueSource is none when the gate rejects the layer", () => {
    expect(FILL_DIMENSION.valueSource!(ui, "not-registered")).toBe("none");
  });

  it("valueSource is author when the user has not set either slot", () => {
    vi.spyOn(ui.c, "surfaceFor").mockReturnValue({
      capabilities: { fill: "native" },
    } as never);
    expect(FILL_DIMENSION.valueSource!(ui, "overlay1")).toBe("author");
  });

  it("valueSource is user once provenance marks a fill slot", () => {
    vi.spyOn(ui.c, "surfaceFor").mockReturnValue({
      capabilities: { fill: "native" },
    } as never);
    ui.intentStore.set("overlay1", "fillColor", "#ff0000");
    expect(FILL_DIMENSION.valueSource!(ui, "overlay1")).toBe("user");
  });

  it("write persists the patch through IntentStore and marks provenance", () => {
    const schedule = vi.fn();
    ui.c.persistence = { schedule } as never;
    FILL_DIMENSION.write!(ui, "overlay1", {
      color: "#00ff00",
      opacity: 0.4,
    });
    expect(ui.intentStore.get("overlay1", "fillColor")).toBe("#00ff00");
    expect(ui.intentStore.get("overlay1", "fillOpacity")).toBe(0.4);
    expect(ui.intentStore.isUserSet("overlay1", "fillColor")).toBe(true);
    expect(ui.intentStore.isUserSet("overlay1", "fillOpacity")).toBe(true);
    expect(schedule).toHaveBeenCalled();
  });

  it("write with a partial patch leaves the other slot untouched", () => {
    ui.intentStore.set("overlay1", "fillColor", "#ff0000");
    FILL_DIMENSION.write!(ui, "overlay1", { opacity: 0.2 });
    expect(ui.intentStore.get("overlay1", "fillColor")).toBe("#ff0000");
    expect(ui.intentStore.get("overlay1", "fillOpacity")).toBe(0.2);
  });

  it("write with an empty patch is a no-op", () => {
    const schedule = vi.fn();
    ui.c.persistence = { schedule } as never;
    FILL_DIMENSION.write!(ui, "overlay1", {});
    expect(ui.intentStore.dumpProvenance()).toEqual({});
    expect(schedule).not.toHaveBeenCalled();
  });

  it("reset clears both fill slots and their provenance", () => {
    const schedule = vi.fn();
    ui.c.persistence = { schedule } as never;
    FILL_DIMENSION.write!(ui, "overlay1", {
      color: "#ff0000",
      opacity: 0.5,
    });
    FILL_DIMENSION.reset!(ui, "overlay1");
    expect(ui.intentStore.get("overlay1", "fillColor")).toBeUndefined();
    expect(ui.intentStore.get("overlay1", "fillOpacity")).toBeUndefined();
    expect(ui.intentStore.isUserSet("overlay1", "fillColor")).toBe(false);
    expect(ui.intentStore.isUserSet("overlay1", "fillOpacity")).toBe(false);
  });
});

describe("LayerControl style-panel dimension registry — border descriptor", () => {
  let manager: LayerController;
  let ui: LayerUI;

  const overlayLayer = {
    options: {},
    setZIndex: vi.fn(),
    eachLayer: vi.fn(),
    getBounds: vi.fn(() => ({
      isValid: () => true,
      getSouthWest: () => ({ lat: 0, lng: 0 }),
      getNorthEast: () => ({ lat: 1, lng: 1 }),
    })),
  };

  beforeEach(() => {
    installLeafletGlobals();
    ({ manager, ui } = initFixture({
      data: [
        { id: "overlay1", name: "Overlay", group: "overlay", layer: overlayLayer },
      ],
    }));
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("value returns undefined for a layer not in the registry", () => {
    expect(BORDER_DIMENSION.value(ui, "not-registered")).toBeUndefined();
  });

  it("value returns the user's stored override when one exists", () => {
    setIntent(ui, "overlay1", "borderColor", "#ff0000");
    setIntent(ui, "overlay1", "borderWeight", 3);
    expect(BORDER_DIMENSION.value(ui, "overlay1")).toEqual({
      color: "#ff0000",
      weight: 3,
    });
  });

  it("value falls back to the authored value when no override is set", () => {
    expect(BORDER_DIMENSION.value(ui, "overlay1")).toEqual({
      color: "#3388ff",
      weight: 1,
    });
  });

  it("valueSource is none when the gate rejects the layer", () => {
    expect(BORDER_DIMENSION.valueSource!(ui, "not-registered")).toBe("none");
  });

  it("valueSource is author when the user has not set either slot", () => {
    vi.spyOn(ui.c, "surfaceFor").mockReturnValue({
      capabilities: { stroke: "native" },
    } as never);
    expect(BORDER_DIMENSION.valueSource!(ui, "overlay1")).toBe("author");
  });

  it("valueSource is user once provenance marks a border slot", () => {
    vi.spyOn(ui.c, "surfaceFor").mockReturnValue({
      capabilities: { stroke: "native" },
    } as never);
    ui.intentStore.set("overlay1", "borderWeight", 2);
    expect(BORDER_DIMENSION.valueSource!(ui, "overlay1")).toBe("user");
  });

  it("write persists the patch through IntentStore and marks provenance", () => {
    const schedule = vi.fn();
    ui.c.persistence = { schedule } as never;
    BORDER_DIMENSION.write!(ui, "overlay1", {
      color: "#00ff00",
      weight: 4,
    });
    expect(ui.intentStore.get("overlay1", "borderColor")).toBe("#00ff00");
    expect(ui.intentStore.get("overlay1", "borderWeight")).toBe(4);
    expect(ui.intentStore.isUserSet("overlay1", "borderColor")).toBe(true);
    expect(ui.intentStore.isUserSet("overlay1", "borderWeight")).toBe(true);
    expect(schedule).toHaveBeenCalled();
  });

  it("write with an empty patch is a no-op", () => {
    const schedule = vi.fn();
    ui.c.persistence = { schedule } as never;
    BORDER_DIMENSION.write!(ui, "overlay1", {});
    expect(ui.intentStore.dumpProvenance()).toEqual({});
    expect(schedule).not.toHaveBeenCalled();
  });

  it("reset clears both border slots and their provenance", () => {
    const schedule = vi.fn();
    ui.c.persistence = { schedule } as never;
    BORDER_DIMENSION.write!(ui, "overlay1", {
      color: "#ff0000",
      weight: 3,
    });
    BORDER_DIMENSION.reset!(ui, "overlay1");
    expect(ui.intentStore.get("overlay1", "borderColor")).toBeUndefined();
    expect(ui.intentStore.get("overlay1", "borderWeight")).toBeUndefined();
    expect(ui.intentStore.isUserSet("overlay1", "borderColor")).toBe(false);
  });
});

describe("LayerControl style-panel dimension registry — zoomRange descriptor", () => {
  let manager: LayerController;
  let ui: LayerUI;

  const overlayLayer = {
    options: {},
    setZIndex: vi.fn(),
    eachLayer: vi.fn(),
    getBounds: vi.fn(() => ({
      isValid: () => true,
      getSouthWest: () => ({ lat: 0, lng: 0 }),
      getNorthEast: () => ({ lat: 1, lng: 1 }),
    })),
  };

  beforeEach(() => {
    installLeafletGlobals();
    ({ manager, ui } = initFixture({
      data: [
        { id: "overlay1", name: "Overlay", group: "overlay", layer: overlayLayer },
      ],
    }));
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("value returns undefined for a layer not in the registry", () => {
    expect(ZOOM_RANGE_DIMENSION.value(ui, "not-registered")).toBeUndefined();
  });

  it("value returns the user's stored override when one exists", () => {
    setIntent(ui, "overlay1", "zoomRange", [5, 10]);
    const v = ZOOM_RANGE_DIMENSION.value(ui, "overlay1");
    expect(v).toBeDefined();
    expect(v!.min).toBeGreaterThanOrEqual(5);
    expect(v!.max).toBeLessThanOrEqual(10);
  });

  it("value falls back to the author's bounds when no override is set", () => {
    const v = ZOOM_RANGE_DIMENSION.value(ui, "overlay1");
    expect(v).toBeDefined();
    expect(v).toHaveProperty("min");
    expect(v).toHaveProperty("max");
    expect(v!.min).toBeLessThanOrEqual(v!.max);
  });

  it("write with {min,max} persists the range and marks provenance", () => {
    const schedule = vi.fn();
    ui.c.persistence = { schedule } as never;
    vi.spyOn(ui.c, "surfaceFor").mockReturnValue({
      capabilities: { zoomRange: "pane" },
      paneNames: [],
      panes: [],
    } as never);
    ZOOM_RANGE_DIMENSION.write!(ui, "overlay1", { min: 2, max: 8 });
    expect(ui.intentStore.get("overlay1", "zoomRange")).toEqual([2, 8]);
    expect(ui.intentStore.isUserSet("overlay1", "zoomRange")).toBe(true);
  });

  it("write with empty patch commits an already-written live preview", () => {
    const schedule = vi.fn();
    ui.c.persistence = { schedule } as never;
    vi.spyOn(ui.c, "surfaceFor").mockReturnValue({
      capabilities: { zoomRange: "pane" },
      paneNames: [],
      panes: [],
    } as never);
    ui.intentStore.setValue("overlay1", "zoomRange", [4, 9]);
    ZOOM_RANGE_DIMENSION.write!(ui, "overlay1", {});
    expect(ui.intentStore.get("overlay1", "zoomRange")).toEqual([4, 9]);
    expect(ui.intentStore.isUserSet("overlay1", "zoomRange")).toBe(true);
  });

  it("write with empty patch and no stored value is a no-op", () => {
    const schedule = vi.fn();
    ui.c.persistence = { schedule } as never;
    ZOOM_RANGE_DIMENSION.write!(ui, "overlay1", {});
    expect(schedule).not.toHaveBeenCalled();
    expect(ui.intentStore.isUserSet("overlay1", "zoomRange")).toBe(false);
  });

  it("reset clears the zoomRange override", () => {
    const schedule = vi.fn();
    ui.c.persistence = { schedule } as never;
    vi.spyOn(ui.c, "surfaceFor").mockReturnValue({
      capabilities: { zoomRange: "pane" },
      paneNames: [],
      panes: [],
    } as never);
    ZOOM_RANGE_DIMENSION.write!(ui, "overlay1", { min: 1, max: 5 });
    ZOOM_RANGE_DIMENSION.reset!(ui, "overlay1");
    expect(ui.intentStore.get("overlay1", "zoomRange")).toBeUndefined();
  });

  it("valueSource is none/author/user across the three states", () => {
    vi.spyOn(ui.c, "surfaceFor").mockReturnValue({
      capabilities: { zoomRange: "pane" },
      paneNames: [],
      panes: [],
    } as never);
    expect(ZOOM_RANGE_DIMENSION.valueSource!(ui, "not-registered")).toBe("none");
    expect(ZOOM_RANGE_DIMENSION.valueSource!(ui, "overlay1")).toBe("author");
    ZOOM_RANGE_DIMENSION.write!(ui, "overlay1", { min: 3, max: 6 });
    expect(ZOOM_RANGE_DIMENSION.valueSource!(ui, "overlay1")).toBe("user");
  });
});
