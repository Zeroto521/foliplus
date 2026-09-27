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
import * as CONST from "#foliplus/LayerControl/const.js";
import type { LayerManager } from "#foliplus/LayerControl/manager.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { OPACITY_DIMENSION } from "#foliplus/LayerControl/ui/style/opacity.js";
import {
  getDimension,
  listDimensions,
  registerDimension,
} from "#foliplus/LayerControl/ui/style/registry.js";
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

  it("getDimension returns undefined for an unregistered key", () => {
    // Unknown dimensions degrade honestly — the panel treats them as
    // "this layer does not support this dimension" rather than erroring.
    expect(getDimension("not.a.dimension")).toBeUndefined();
  });

  it("listDimensions lists built-in and test dims in insertion order", () => {
    // opacity is registered at module load; test.dim.registry right
    // after, at file scope. Order is insertion order.
    expect(listDimensions().map(d => d.key)).toEqual(["opacity", TEST_DIM_KEY]);
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

describe("LayerControl style-panel dimension registry — opacity descriptor", () => {
  let manager: LayerManager;
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
          isBase: false,
          layer: overlayLayer,
        },
        {
          id: "base1",
          name: "OSM",
          isBase: true,
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
    vi.spyOn(ui.m, "surfaceFor").mockReturnValue({
      capabilities,
      paneNames: [],
      geometryType: () => "polygon",
    } as unknown as ReturnType<typeof ui.m.surfaceFor>);
  };

  it('declares key = "opacity"', () => {
    expect(OPACITY_DIMENSION.key).toBe("opacity");
  });

  it("gate is the pure capability check: true when capabilities.opacity !== 'none'", () => {
    // Invariant (§43.9, first-class from day one): gate is exactly
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
    ui.opacityMap.overlay1 = 0.3;
    expect(OPACITY_DIMENSION.value(ui, "overlay1")).toBe(0.3);
  });
});
