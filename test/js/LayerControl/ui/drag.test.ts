import { describe, expect, it, vi } from "vitest";
import { HINT_DURATION } from "#core/hint.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import {
  handleDrop,
  showReorderBlockedHint,
  toggleFold,
} from "#foliplus/LayerControl/ui/drag.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
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
  return {
    uiContainer,
    foldedGroups: new Set<string>(),
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
      persistence: { schedule: vi.fn() } as any,
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

  describe("DOM order diverges from registry order", () => {
    /** Build a ui with 3 layers (A-B-C in registry) and DOM scrambled to C-A-B,
     *  with dataset.index simulating a stale reindexItems pass (DOM position). */
    const makeScrambledUi = () => {
      const layers: LayerInfo[] = [
        { id: "A", name: "A", isBase: false } as LayerInfo,
        { id: "B", name: "B", isBase: false } as LayerInfo,
        { id: "C", name: "C", isBase: false } as LayerInfo,
      ];
      const uiContainer = document.createElement("div");
      for (const id of ["C", "A", "B"]) {
        const row = document.createElement("div");
        row.className = CONST.CLASSES.LAYER_ITEM;
        row.setAttribute(CONST.DATA.LAYER_ID, id);
        row.dataset.index = "0";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = true;
        row.appendChild(box);
        uiContainer.appendChild(row);
      }
      // Simulate stale reindexItems: DOM position, not registry position.
      Array.from(
        uiContainer.querySelectorAll<HTMLElement>(`${CONST.SEL.LAYER_ITEM}`),
      ).forEach((row, i) => {
        row.dataset.index = String(i);
      });

      const reorder = vi.fn();
      const canReorderBetween = vi.fn(() => true);
      return {
        layers,
        ui: {
          uiContainer,
          foldedGroups: new Set<string>(),
          saveFoldState: vi.fn(),
          dragIdx: 0,
          lastDragOverItem: null,
          m: {
            layers,
            findLayer: vi.fn(() => ({ options: {} })),
            map: {
              hasLayer: vi.fn(() => true),
              removeLayer: vi.fn(),
              addLayer: vi.fn(),
              foliplus: { showHint: vi.fn() },
            },
            debouncedEnforce: vi.fn(),
            saveOrder: vi.fn(),
            enforceOrder: vi.fn(),
            canReorderBetween,
            moveLayer: vi.fn(() => true),
            layerRegistry: { indexOf: () => 0, reorder },
            persistence: { schedule: vi.fn() } as any,
          },
        } as unknown as LayerUI,
        reorder,
      };
    };

    it("handleDrop translates the target row's id to a registry index, not its DOM position", () => {
      const { ui, reorder } = makeScrambledUi();
      // DOM: C(0), A(1), B(2). Registry: [A(0), B(1), C(2)].
      // Drag A (registry 0) onto B (DOM position 2, dataset.index="2").
      const target = ui.uiContainer.querySelector<HTMLElement>(
        `[${CONST.DATA.LAYER_ID}="B"]`,
      )!;
      expect(target.dataset.index).toBe("2");
      (ui as unknown as { dragIdx: number }).dragIdx = 0; // A's registry index

      handleDrop(ui, dragEvent(target));

      // Old code: targetIdx = 2 (DOM position), reorder(0, 2) — wrong target.
      // New code: targetIdx = 1 (B's registry index), reorder(0, 1) — correct.
      expect(reorder).toHaveBeenCalledWith(0, 1);
    });
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

describe("showReorderBlockedHint", () => {
  it("hints once per cooldown window", () => {
    const showHint = vi.fn();
    const ui = {
      lastDragHintAt: 0,
      conf: { name: "LayerControl" },
      T: (k: string) => k,
      m: {
        map: { foliplus: { showHint } },
      },
    } as unknown as LayerUI;

    showReorderBlockedHint(ui);
    expect(showHint).toHaveBeenCalledTimes(1);
    expect(showHint).toHaveBeenCalledWith(
      "LayerControl",
      "reorder_group_only",
      HINT_DURATION.SHORT,
    );

    // A second attempt inside the cooldown window stays silent.
    showReorderBlockedHint(ui);
    expect(showHint).toHaveBeenCalledTimes(1);
  });
});
