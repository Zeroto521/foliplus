// paintDimension — the shared paint-dimension engine (the shared-engine skeleton).
//
// The engine is consumer-free until the fill/border adapters wire in,
// so this suite tests the three-layer shape and the apply skeleton against a
// mock adapter (a minimal PaintDimension) rather than the real channels. The
// mock adapter's fields are the seam the adapters will fill with the real ones;
// the engine's contract — resolve mode from displaySpec, dispatch apply to the
// hooks, rebuild the detail on a mode switch — is what this locks.
import { describe, expect, it, vi } from "vitest";
import { STYLE_MODE } from "#core/layer/index.js";
import {
  type PaintDimension,
  type PaintSubDimension,
  applyPaintToLayer,
  bindPaintDetail,
  bindPaintRow,
  buildPaintRow,
  renderPaintDetail,
} from "#control/LayerControl/ui/style/paintDimension.js";
import type { StyleBag, StyleFace } from "#control/LayerControl/ui/style/styleBag.js";

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

/** A mock PaintDimension adapter — the engine's seam. */
const makeDim = (overrides: Record<string, any> = {}): PaintDimension => {
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
    chrome: {
      selectClass: "test-fill-mode-select",
      rowClass: "test-fill-row",
      detailClass: "test-fill-detail",
      label: "Fill",
    },
    intentKeys: ["fillColor", "fillOpacity", "fillValue", "fillStyleMode"] as const,
    face: "fill" as StyleFace,
    gate: () => true,
    authorFace: <K extends keyof StyleBag>(_ui: any, _id: string, key: K) =>
      (key === "fillColor" ? "#aabbcc" : undefined) as StyleBag[K] | undefined,
    needsDerivation: () => false,
    displaySpec: (_ui: any, _id: string) => dim.__displaySpec(),
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
    derivedKey: (): keyof StyleBag => "fillColor",
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
    const detail = row.querySelector(".test-fill-detail")!;
    expect(detail.childElementCount).toBe(1);
    expect(detail.firstElementChild!.getAttribute("data-mode")).toBe("original");
  });

  it("renders a follow-fill option when the adapter exposes the mode", () => {
    const ui = makeUI();
    const dim = makeDim({ modes: () => [STYLE_MODE.FOLLOW_FILL, STYLE_MODE.SOLID] });
    const row = buildPaintRow(dim, ui, "overlay1");
    const select = row.querySelector("select")! as HTMLSelectElement;
    expect(Array.from(select.options).map(o => o.value)).toEqual([
      "followFill",
      "solid",
    ]);
  });

  it("basemap early-out without a basemap row still returns the shell", () => {
    const ui = makeUI();
    const dim = makeDim({
      isBasemap: () => true,
    });
    const row = buildPaintRow(dim, ui, "overlay1");
    expect(row).not.toBeNull();
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
    const detail = row.querySelector(".test-fill-detail")!;
    bindPaintRow(dim, ui, "overlay1", row);
    select.value = "solid";
    select.dispatchEvent(new Event("change"));
    expect(dim.writeMode).toHaveBeenCalledWith(ui, "overlay1", "solid");
    expect(detail.childElementCount).toBe(1);
    expect(detail.firstElementChild!.getAttribute("data-mode")).toBe("solid");
  });

  it("binds the active detail controls through the adapter's binder", () => {
    const ui = makeUI();
    const detailBinder = vi.fn();
    const dim = makeDim({ detailBinder: () => detailBinder });
    const detail = document.createElement("div");
    bindPaintDetail(dim, ui, "overlay1", detail, STYLE_MODE.SOLID);
    expect(detailBinder).toHaveBeenCalledWith(ui, "overlay1", detail);
  });

  it("no-ops when the block has no select", () => {
    const ui = makeUI();
    const dim = makeDim();
    const block = document.createElement("div");
    block.dataset.styleDim = "fill";
    const row = document.createElement("div");
    block.appendChild(row);
    document.body.appendChild(block);
    bindPaintRow(dim, ui, "overlay1", row);
    expect(dim.writeMode).not.toHaveBeenCalled();
    block.remove();
  });

  it("no-ops when the selected mode equals the current mode", () => {
    const ui = makeUI();
    const dim = makeDim();
    const row = buildPaintRow(dim, ui, "overlay1");
    const select = row.querySelector("select")! as HTMLSelectElement;
    bindPaintRow(dim, ui, "overlay1", row);
    select.value = "original"; // current mode
    select.dispatchEvent(new Event("change"));
    expect(dim.writeMode).not.toHaveBeenCalled();
  });

  it("skips the detail rebuild when the block has no detail slot", () => {
    const ui = makeUI();
    const dim = makeDim();
    const block = document.createElement("div");
    block.dataset.styleDim = "fill";
    const select = document.createElement("select");
    select.innerHTML = `<option value="original">original</option><option value="solid">solid</option>`;
    block.appendChild(select);
    const row = document.createElement("div");
    block.appendChild(row);
    document.body.appendChild(block);
    bindPaintRow(dim, ui, "overlay1", row);
    select.value = "solid";
    select.dispatchEvent(new Event("change"));
    expect(dim.writeMode).toHaveBeenCalledWith(ui, "overlay1", "solid");
    block.remove();
  });

  it("skips sub-input binding when the sub element is absent", () => {
    const ui = makeUI();
    const bindInput = vi.fn();
    const dim = makeDim({
      subs: [
        {
          key: "opacity",
          buildInput: () => {
            const el = document.createElement("div");
            el.dataset.sub = "opacity";
            return el;
          },
          bindInput,
          commit: () => {},
        },
      ],
      detailBuilder: () => () => [],
    });
    const detail = document.createElement("div");
    // No [data-sub=opacity] inside the detail → input is null.
    bindPaintDetail(dim, ui, "overlay1", detail, STYLE_MODE.SOLID);
    expect(bindInput).not.toHaveBeenCalled();
  });

  it("no-ops when the row is not inside a style block", () => {
    const ui = makeUI();
    const dim = makeDim();
    const row = document.createElement("div");
    bindPaintRow(dim, ui, "overlay1", row);
    expect(dim.writeMode).not.toHaveBeenCalled();
  });

  it("does not rebuild the detail when writeMode refuses the switch", () => {
    const ui = makeUI();
    const dim = makeDim({ writeMode: vi.fn(() => false) });
    const row = buildPaintRow(dim, ui, "overlay1");
    const select = row.querySelector("select")! as HTMLSelectElement;
    const detail = row.querySelector(".test-fill-detail")!;
    bindPaintRow(dim, ui, "overlay1", row);
    select.value = "solid";
    select.dispatchEvent(new Event("change"));
    expect(dim.writeMode).toHaveBeenCalledWith(ui, "overlay1", "solid");
    expect(detail.childElementCount).toBe(1);
    expect(detail.firstElementChild!.getAttribute("data-mode")).toBe("original");
  });

  it("binds the active detail controls through the adapter's binder", () => {
    const ui = makeUI();
    const detailBinder = vi.fn();
    const dim = makeDim({ detailBinder: () => detailBinder });
    const detail = document.createElement("div");
    bindPaintDetail(dim, ui, "overlay1", detail, STYLE_MODE.SOLID);
    expect(detailBinder).toHaveBeenCalledWith(ui, "overlay1", detail);
  });

  it("binds a sub-dimension input alongside the active detail", () => {
    const ui = makeUI();
    const bindInput = vi.fn();
    const dim = makeDim({
      subs: [
        {
          key: "opacity",
          buildInput: () => {
            const el = document.createElement("div");
            el.dataset.sub = "opacity";
            return el;
          },
          bindInput,
          commit: () => {},
        } satisfies PaintSubDimension,
      ],
      detailBuilder: (mode: string) => (_ui: any, _id: string) => {
        const el = document.createElement("div");
        el.dataset.mode = mode;
        const sub = document.createElement("div");
        sub.dataset.sub = "opacity";
        el.appendChild(sub);
        return [el];
      },
    });
    const row = buildPaintRow(dim, ui, "overlay1");
    bindPaintRow(dim, ui, "overlay1", row);
    expect(bindInput).toHaveBeenCalled();
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

  it("dispatches FOLLOW_FILL to the solid hook with an undefined base", () => {
    const ui = makeUI();
    const dim = makeDim({
      displaySpec: () => ({
        stored: STYLE_MODE.FOLLOW_FILL,
        declaredValue: false,
        colorIntent: false,
        valueIntent: false,
        carriesValue: true,
        supportsInherit: true,
      }),
    });
    applyPaintToLayer(dim, ui, "overlay1");
    expect(dim.applyHooks.solid).toHaveBeenCalledWith(ui, "overlay1", undefined);
  });

  it("dispatches SOLID with an undefined base when no derivation is owed", () => {
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
      needsDerivation: () => false,
    });
    applyPaintToLayer(dim, ui, "overlay1");
    expect(dim.applyHooks.solid).toHaveBeenCalledWith(ui, "overlay1", undefined);
  });

  it("falls through to the solid hook when VALUE is in the spec but no value is in force", () => {
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
      hasValue: () => false,
      needsDerivation: () => false,
    });
    applyPaintToLayer(dim, ui, "overlay1");
    expect(dim.applyHooks.value).not.toHaveBeenCalled();
    expect(dim.applyHooks.solid).toHaveBeenCalledWith(ui, "overlay1", undefined);
  });
});
