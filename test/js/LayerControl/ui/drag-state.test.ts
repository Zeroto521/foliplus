import { describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import { handleDrop, toggleFold } from "#foliplus/LayerControl/ui/drag.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { saveFoldState } from "#foliplus/LayerControl/ui/state.js";
import type { LayerInfo } from "#foliplus/core/layer/index.js";
import { initFixture } from "./fixture.js";

const makeUi = (
  opts: {
    layers?: LayerInfo[];
    containers?: string[];
  } = {},
): LayerUI => {
  const uiContainer = document.createElement("div");
  for (const id of opts.containers ?? []) {
    const row = document.createElement("div");
    row.className = CONST.CLASSES.LAYER_ITEM;
    row.setAttribute(CONST.DATA.LAYER_ID, id);
    row.dataset.index = "0";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.dataset.index = "0";
    box.checked = true;
    row.appendChild(box);
    uiContainer.appendChild(row);
  }
  const folded = new Set<string>();
  return {
    uiContainer,
    foldedGroups: folded,
    saveFoldState: vi.fn(),
    m: {
      layers: opts.layers ?? [],
      findLayer: vi.fn(() => ({ options: {} })),
      map: {
        hasLayer: vi.fn(() => true),
        removeLayer: vi.fn(),
        addLayer: vi.fn(),
      },
      debouncedEnforce: vi.fn(),
      saveOrder: vi.fn(),
      moveLayer: vi.fn(() => true),
      layerRegistry: { indexOf: () => 0 },
      persistence: { saveFoldedGroups: vi.fn() },
    },
  } as unknown as LayerUI;
};

const dragEvent = (target: HTMLElement): DragEvent => {
  const dataTransfer = { dropEffect: "", effectAllowed: "" };
  return {
    target,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer,
  } as unknown as DragEvent;
};

describe("ui/drag", () => {
  it("toggleFold flips the group and persists fold state", () => {
    const { ui } = initFixture();
    const before = ui.foldedGroups.has(CONST.GROUP.OVERLAY);
    toggleFold(ui, CONST.GROUP.OVERLAY);
    expect(ui.foldedGroups.has(CONST.GROUP.OVERLAY)).toBe(!before);
    toggleFold(ui, CONST.GROUP.OVERLAY);
    expect(ui.foldedGroups.has(CONST.GROUP.OVERLAY)).toBe(before);
  });

  it("handleDrop is a no-op when no dragIdx is armed", () => {
    const ui = makeUi({ containers: ["a", "b"] });
    (ui as unknown as { dragIdx: number | null }).dragIdx = null;
    const row = ui.uiContainer.querySelector<HTMLElement>(
      `[${CONST.DATA.LAYER_ID}="b"]`,
    )!;
    expect(() => handleDrop(ui, dragEvent(row))).not.toThrow();
  });
});

describe("LayerUI.deselectAllBaseMaps", () => {
  it("unchecks every base row except the excluded registry index", () => {
    const { ui, manager } = initFixture();
    manager.registerLayer({
      id: "base2",
      name: "Sat",
      isBase: true,
      layer: { options: {}, eachLayer: vi.fn() } as unknown as L.Layer,
      paneName: "tilePane",
    });
    const baseIdx = ui.m.layers.findIndex(li => li.id === "base1");
    expect(baseIdx).toBeGreaterThanOrEqual(0);
    ui.deselectAllBaseMaps(baseIdx);

    const boxes = Array.from(
      ui.uiContainer.querySelectorAll<HTMLInputElement>(
        `${CONST.SEL.LAYER_ITEM}[data-layer-type="${CONST.GROUP.BASE}"] input[type="checkbox"]`,
      ),
    );
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    // The excluded base keeps its checkbox; the other base is cleared.
    const checked = boxes.filter(b => b.checked).length;
    expect(checked).toBe(1);
  });
});

describe("ui/state saveFoldState", () => {
  it("writes the folded set through persistence", () => {
    const save = vi.fn();
    const ui = {
      foldedGroups: new Set(["overlay"]),
      m: { persistence: { saveFoldedGroups: save } },
    } as unknown as LayerUI;
    saveFoldState(ui);
    expect(save).toHaveBeenCalledWith(ui.foldedGroups);
  });
});
