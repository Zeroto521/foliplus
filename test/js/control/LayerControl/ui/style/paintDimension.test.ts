// paintDimension — the shared paint-dimension engine (S6.1 skeleton).
//
// The engine is consumer-free until S6.4/S6.5 wire the fill/border adapters,
// so this suite tests the three-layer shape and the apply skeleton against a
// mock adapter (a minimal PaintDimension) rather than the real channels. The
// mock adapter's fields are the seam S6.4/S6.5 will fill with the real ones;
// the engine's contract — resolve mode from displaySpec, dispatch apply to the
// hooks, rebuild the detail on a mode switch — is what this locks.
import { describe, expect, it, vi } from "vitest";
import {
  applyPaintToLayer,
  bindPaintRow,
  buildPaintRow,
  renderPaintDetail,
} from "#control/LayerControl/ui/style/paintDimension.js";
import { STYLE_MODE } from "#core/layer/index.js";

/** A minimal LayerUI duck — the engine only touches ui.c.map.getContainer()
 *  and ui.T() for the row, so a plain object satisfies it. */
const makeUI = () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return {
    c: {
      map: {
        getContainer: () => container,
        on: () => {},
        off: () => {},
      },
    },
    T: (key: string) => key,
  } as any;
};

/** A minimal overlay-registry duck for dropdownOverlay. */
const overlayDuck = {
  id: "paint",
  rank: 900,
  register: () => () => {},
};

/** A mock PaintDimension adapter — the engine's seam. */
const makeDim = (overrides: Record<string, any> = {}) => {
  const dim = {
    __stored: undefined as any,
    __displaySpec() {
      return {
        stored: this.__stored,
        declaredValue: false,
        colorIntent: false,
        valueIntent: false,
        carriesValue: true,
        supportsInherit: false,
      };
    },
    key: "fill",
    intentKeys: ["fillColor", "fillOpacity", "fillValue", "fillStyleMode"],
    face: "fill",
    gate: () => true,
    authorFace: (_ui: any, _id: string, key: string) =>
      key === "fillColor" ? "#aabbcc" : undefined,
    needsDerivation: () => false,
    displaySpec: (ui: any, id: string) => dim.__displaySpec(),
    modes: () => [STYLE_MODE.ORIGINAL, STYLE_MODE.SOLID, STYLE_MODE.VALUE],
    inherits: undefined,
    subs: [],
    detailBuilder: (mode: string) => (_ui: any, _id: string) => {
      const el = document.createElement("div");
      el.dataset.mode = mode;
      return [el];
    },
    detailBinder: () => (_ui: any, _id: string, _detail: HTMLElement) => {},
    applyHooks: {
      value: vi.fn(),
      original: vi.fn(),
      solid: vi.fn(),
    },
    hasValue: () => true,
    derivedKey: () => "fillColor",
    writeMode: vi.fn((_ui: any, _id: string, mode: string) => {
      dim.__stored = mode;
      return true;
    }),
    dispose: vi.fn(),
    ...overrides,
  };
  return dim;
};

describe("buildPaintRow", () => {
  it("renders a mode select with one option per mode and the active detail", () => {
    const ui = makeUI();
    const dim = makeDim();
    const row = buildPaintRow(dim, ui, "overlay1");
    const select = row.querySelector("select")! as HTMLSelectElement;
    expect(Array.from(select.options).map(o => o.value)).toEqual([
      "original",
      "solid",
      "value",
    ]);
    const detail = row.querySelector(".foliplus-style-fill-detail")!;
    expect(detail.childElementCount).toBe(1);
    expect(detail.firstElementChild!.getAttribute("data-mode")).toBe("original");
  });

  it("basemap early-out routes to the basemap row", () => {
    const ui = makeUI();
    const dim = makeDim({
      isBasemap: () => true,
      buildBasemapRow: (_ui: any, _id: string) => {
        const el = document.createElement("div");
        el.dataset.basemap = "1";
        return el;
      },
    });
    const row = buildPaintRow(dim, ui, "overlay1");
    expect(row.querySelector("[data-basemap='1']")).not.toBeNull();
    expect(row.querySelector("select")).toBeNull();
  });
});

describe("renderPaintDetail", () => {
  it("disposes then replaces the detail children", () => {
    const ui = makeUI();
    const dim = makeDim();
    const detail = document.createElement("div");
    detail.appendChild(document.createElement("span"));
    renderPaintDetail(dim, ui, "overlay1", detail, STYLE_MODE.SOLID);
    expect(dim.dispose).toHaveBeenCalledWith(ui);
    expect(detail.childElementCount).toBe(1);
    expect(detail.firstElementChild!.getAttribute("data-mode")).toBe("solid");
  });
});

describe("bindPaintRow", () => {
  it("writes the mode and rebuilds the detail on a select change", () => {
    const ui = makeUI();
    const dim = makeDim();
    const row = buildPaintRow(dim, ui, "overlay1");
    const select = row.querySelector("select")! as HTMLSelectElement;
    const detail = row.querySelector(".foliplus-style-fill-detail")!;
    bindPaintRow(dim, ui, "overlay1", row);
    select.value = "solid";
    select.dispatchEvent(new Event("change"));
    expect(dim.writeMode).toHaveBeenCalledWith(ui, "overlay1", "solid");
    expect(detail.childElementCount).toBe(1);
    expect(detail.firstElementChild!.getAttribute("data-mode")).toBe("solid");
  });
});

describe("applyPaintToLayer", () => {
  it("dispatches VALUE to the value hook when a value is in force", () => {
    const ui = makeUI();
    const dim = makeDim({
      displaySpec: () => ({
        stored: STYLE_MODE.VALUE,
        declaredValue: false,
        colorIntent: false,
        valueIntent: true,
        carriesValue: true,
        supportsInherit: false,
      }),
    });
    applyPaintToLayer(dim, ui, "overlay1");
    expect(dim.applyHooks.value).toHaveBeenCalledWith(ui, "overlay1");
  });

  it("dispatches ORIGINAL to the original hook", () => {
    const ui = makeUI();
    const dim = makeDim({
      displaySpec: () => ({
        stored: STYLE_MODE.ORIGINAL,
        declaredValue: false,
        colorIntent: false,
        valueIntent: false,
        carriesValue: true,
        supportsInherit: false,
      }),
    });
    applyPaintToLayer(dim, ui, "overlay1");
    expect(dim.applyHooks.original).toHaveBeenCalledWith(ui, "overlay1");
  });

  it("dispatches SOLID with a derived base when needsDerivation", () => {
    const ui = makeUI();
    const dim = makeDim({
      displaySpec: () => ({
        stored: STYLE_MODE.SOLID,
        declaredValue: false,
        colorIntent: false,
        valueIntent: false,
        carriesValue: true,
        supportsInherit: false,
      }),
      needsDerivation: () => true,
    });
    applyPaintToLayer(dim, ui, "overlay1");
    expect(dim.applyHooks.solid).toHaveBeenCalledWith(ui, "overlay1", "#aabbcc");
  });
});
