import { describe, expect, it, vi } from "vitest";
import { HINT_DURATION } from "#core/hint.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import {
  handleDragEnd,
  handleDragLeave,
  handleDragOver,
  handleDragStart,
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
     *  with dataset.index carrying the stale DOM position the old positional
     *  lookup would have read. */
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
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = true;
        row.appendChild(box);
        uiContainer.appendChild(row);
      }
      // Stale offset: DOM position, not registry position.
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
          conf: { name: "LayerControl" },
          T: (key: string) => key,
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
        canReorderBetween,
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

    it("handleDragOver marks the row below when the id resolves past the drag index", () => {
      const { ui } = makeScrambledUi();
      // C sits at DOM position 0 while A is being dragged (registry 0): a
      // positional read would see targetIdx === dragIdx and paint nothing.
      // By id, C is registry 2, which is below the dragged row.
      (ui as unknown as { dragIdx: number }).dragIdx = 0;
      const rowC = ui.uiContainer.querySelector<HTMLElement>(
        `[${CONST.DATA.LAYER_ID}="C"]`,
      )!;
      expect(rowC.dataset.index).toBe("0");

      handleDragOver(ui, dragEvent(rowC));

      expect(rowC.classList.contains(CONST.CLASSES.DRAG_OVER_BOTTOM)).toBe(true);
      expect(rowC.classList.contains(CONST.CLASSES.DRAG_OVER_TOP)).toBe(false);
      expect(ui.lastDragOverItem).toBe(rowC);
    });

    it("handleDragOver marks the row above when the id resolves before the drag index", () => {
      const { ui } = makeScrambledUi();
      // A sits at DOM position 1, exactly where B (registry 1) is being
      // dragged: a positional read would see an equal index and paint nothing.
      // By id, A is registry 0, which is above.
      (ui as unknown as { dragIdx: number }).dragIdx = 1;
      const rowA = ui.uiContainer.querySelector<HTMLElement>(
        `[${CONST.DATA.LAYER_ID}="A"]`,
      )!;
      expect(rowA.dataset.index).toBe("1");

      handleDragOver(ui, dragEvent(rowA));

      expect(rowA.classList.contains(CONST.CLASSES.DRAG_OVER_TOP)).toBe(true);
      expect(rowA.classList.contains(CONST.CLASSES.DRAG_OVER_BOTTOM)).toBe(false);
    });

    it("handleDragOver blocks a forbidden move and clears the previous marker", () => {
      const { ui, canReorderBetween } = makeScrambledUi();
      canReorderBetween.mockReturnValue(false);
      const rows = Array.from(
        ui.uiContainer.querySelectorAll<HTMLElement>(CONST.SEL.LAYER_ITEM),
      );
      ui.lastDragOverItem = rows[0];
      rows[0].classList.add(CONST.CLASSES.DRAG_OVER_BOTTOM);

      const event = dragEvent(rows[1]);
      handleDragOver(ui, event);

      expect(canReorderBetween).toHaveBeenCalled();
      expect(rows[0].classList.contains(CONST.CLASSES.DRAG_OVER_BOTTOM)).toBe(false);
      expect(ui.lastDragOverItem).toBe(rows[1]);
      // A blocked move is remembered for the hint but paints no drop position.
      expect(rows[1].classList.contains(CONST.CLASSES.DRAG_OVER_TOP)).toBe(false);
      expect(rows[1].classList.contains(CONST.CLASSES.DRAG_OVER_BOTTOM)).toBe(false);
      expect(event.dataTransfer?.dropEffect).toBe("none");
    });

    it("handleDragOver ignores the color basemap row", () => {
      const { ui } = makeScrambledUi();
      (ui as unknown as { dragIdx: number }).dragIdx = 0;
      const color = document.createElement("div");
      color.className = `${CONST.CLASSES.LAYER_ITEM} ${CONST.CLASSES.COLOR_ITEM}`;
      ui.uiContainer.appendChild(color);

      const event = dragEvent(color);
      handleDragOver(ui, event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(color.classList.contains(CONST.CLASSES.DRAG_OVER_TOP)).toBe(false);
      expect(color.classList.contains(CONST.CLASSES.DRAG_OVER_BOTTOM)).toBe(false);
      expect(ui.lastDragOverItem).toBe(null);
    });

    it("handleDragOver does nothing until a drag is armed", () => {
      const { ui } = makeScrambledUi();
      (ui as unknown as { dragIdx: number | null }).dragIdx = null;
      const target = ui.uiContainer.querySelector<HTMLElement>(
        `[${CONST.DATA.LAYER_ID}="B"]`,
      )!;

      const event = dragEvent(target);
      handleDragOver(ui, event);

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(target.classList.contains(CONST.CLASSES.DRAG_OVER_BOTTOM)).toBe(false);
    });

    it("handleDrop refuses a blocked reorder and keeps the drag armed", () => {
      const { ui, reorder, canReorderBetween } = makeScrambledUi();
      canReorderBetween.mockReturnValue(false);
      const target = ui.uiContainer.querySelector<HTMLElement>(
        `[${CONST.DATA.LAYER_ID}="B"]`,
      )!;
      (ui as unknown as { dragIdx: number }).dragIdx = 0;

      handleDrop(ui, dragEvent(target));

      expect(canReorderBetween).toHaveBeenCalledWith(0, 1);
      expect(reorder).not.toHaveBeenCalled();
      expect((ui as unknown as { dragIdx: number | null }).dragIdx).toBe(0);
    });

    it("handleDrop relocates the dragged row before its target on a backward move", () => {
      const { ui, reorder } = makeScrambledUi();
      // Drag B (registry 1) onto A (registry 0). A sits at DOM position 1, so a
      // positional read would see targetIdx === dragIdx and bail without moving.
      // By id, A is registry 0: a real backward move, inserting before the target.
      (ui as unknown as { dragIdx: number }).dragIdx = 1;
      const target = ui.uiContainer.querySelector<HTMLElement>(
        `[${CONST.DATA.LAYER_ID}="A"]`,
      )!;

      handleDrop(ui, dragEvent(target));

      expect(reorder).toHaveBeenCalledWith(1, 0);
      expect((ui as unknown as { dragIdx: number | null }).dragIdx).toBe(null);
      expect(
        Array.from(
          ui.uiContainer.querySelectorAll<HTMLElement>(CONST.SEL.LAYER_ITEM),
        ).map(row => row.getAttribute(CONST.DATA.LAYER_ID)),
      ).toEqual(["C", "B", "A"]);
    });

    it("handleDrop aborts when the dragged row is missing from the panel", () => {
      const layers: LayerInfo[] = [
        { id: "A", name: "A", isBase: false } as LayerInfo,
        { id: "B", name: "B", isBase: false } as LayerInfo,
      ];
      const uiContainer = document.createElement("div");
      const rowB = document.createElement("div");
      rowB.className = CONST.CLASSES.LAYER_ITEM;
      rowB.setAttribute(CONST.DATA.LAYER_ID, "B");
      uiContainer.appendChild(rowB);
      const reorder = vi.fn();
      const ui = {
        uiContainer,
        conf: { name: "LayerControl" },
        T: (key: string) => key,
        dragIdx: 0,
        lastDragOverItem: null,
        m: {
          layers,
          canReorderBetween: vi.fn(() => true),
          enforceOrder: vi.fn(),
          saveOrder: vi.fn(),
          layerRegistry: { indexOf: () => 0, reorder },
        },
      } as unknown as LayerUI;

      handleDrop(ui, dragEvent(rowB));

      expect(reorder).toHaveBeenCalledWith(0, 1);
      // A has no row to relocate, so the drag is disarmed without ordering.
      expect((ui as unknown as { dragIdx: number | null }).dragIdx).toBe(null);
    });

    it("handleDrop disarms when the armed index is outside the registry", () => {
      const { ui, reorder } = makeScrambledUi();
      // A drop that arrives after the registry shrank leaves a stale armed
      // index behind; it must be cleared, not indexed into.
      (ui as unknown as { dragIdx: number }).dragIdx = 99;
      const target = ui.uiContainer.querySelector<HTMLElement>(
        `[${CONST.DATA.LAYER_ID}="B"]`,
      )!;

      handleDrop(ui, dragEvent(target));

      expect(reorder).not.toHaveBeenCalled();
      expect((ui as unknown as { dragIdx: number | null }).dragIdx).toBe(null);
    });

    it("handleDrop disarms when the armed index no longer names a layer", () => {
      const layers: LayerInfo[] = [
        { id: "A", name: "A", isBase: false } as LayerInfo,
        // Torn down between dragstart and drop: in range, no id.
        {} as LayerInfo,
      ];
      const uiContainer = document.createElement("div");
      const rowA = document.createElement("div");
      rowA.className = CONST.CLASSES.LAYER_ITEM;
      rowA.setAttribute(CONST.DATA.LAYER_ID, "A");
      uiContainer.appendChild(rowA);
      const reorder = vi.fn();
      const ui = {
        uiContainer,
        conf: { name: "LayerControl" },
        T: (key: string) => key,
        dragIdx: 1,
        lastDragOverItem: null,
        m: {
          layers,
          canReorderBetween: vi.fn(() => true),
          enforceOrder: vi.fn(),
          saveOrder: vi.fn(),
          layerRegistry: { indexOf: () => 0, reorder },
        },
      } as unknown as LayerUI;

      handleDrop(ui, dragEvent(rowA));

      // Nothing to relocate by id, so the drop is dropped without ordering.
      expect(reorder).not.toHaveBeenCalled();
      expect((ui as unknown as { dragIdx: number | null }).dragIdx).toBe(null);
    });

    it("handleDragStart ignores a row carrying no data-layer-id", () => {
      const { ui } = makeScrambledUi();
      const orphan = document.createElement("div");
      orphan.className = CONST.CLASSES.LAYER_ITEM;
      ui.uiContainer.appendChild(orphan);
      (ui as unknown as { dragIdx: number | null }).dragIdx = null;

      handleDragStart(ui, dragEvent(orphan));

      // No id, no registry index: the drag is never armed.
      expect((ui as unknown as { dragIdx: number | null }).dragIdx).toBe(null);
      expect(orphan.classList.contains(CONST.CLASSES.DRAGGING)).toBe(false);
    });

    it("handleDragOver and handleDrop ignore a row carrying no data-layer-id", () => {
      const { ui, reorder } = makeScrambledUi();
      const orphan = document.createElement("div");
      orphan.className = CONST.CLASSES.LAYER_ITEM;
      ui.uiContainer.appendChild(orphan);
      (ui as unknown as { dragIdx: number }).dragIdx = 0;

      handleDragOver(ui, dragEvent(orphan));
      handleDrop(ui, dragEvent(orphan));

      // The row names no layer, so neither handler acts on it: no marker is
      // painted and the drag stays armed for a row that does.
      expect(orphan.classList.contains(CONST.CLASSES.DRAG_OVER_TOP)).toBe(false);
      expect(orphan.classList.contains(CONST.CLASSES.DRAG_OVER_BOTTOM)).toBe(false);
      expect(ui.lastDragOverItem).toBe(null);
      expect(reorder).not.toHaveBeenCalled();
      expect((ui as unknown as { dragIdx: number }).dragIdx).toBe(0);
    });

    it("handleDragLeave clears the marker on the row being left", () => {
      const { ui } = makeScrambledUi();
      const row = ui.uiContainer.querySelector<HTMLElement>(
        `[${CONST.DATA.LAYER_ID}="A"]`,
      )!;
      row.classList.add(CONST.CLASSES.DRAG_OVER_TOP);

      handleDragLeave(ui, dragEvent(row));

      expect(row.classList.contains(CONST.CLASSES.DRAG_OVER_TOP)).toBe(false);
    });

    it("handleDragEnd disarms the drag and strips every marker", () => {
      const { ui } = makeScrambledUi();
      (ui as unknown as { dragIdx: number }).dragIdx = 0;
      const rows = Array.from(
        ui.uiContainer.querySelectorAll<HTMLElement>(CONST.SEL.LAYER_ITEM),
      );
      rows[0].classList.add(CONST.CLASSES.DRAGGING, CONST.CLASSES.DRAG_OVER_TOP);
      rows[1].classList.add(CONST.CLASSES.DRAG_OVER_BOTTOM);
      ui.lastDragOverItem = rows[0];

      handleDragEnd(ui);

      expect((ui as unknown as { dragIdx: number | null }).dragIdx).toBe(null);
      expect(ui.lastDragOverItem).toBe(null);
      rows.forEach(row => {
        expect(row.classList.contains(CONST.CLASSES.DRAGGING)).toBe(false);
        expect(row.classList.contains(CONST.CLASSES.DRAG_OVER_TOP)).toBe(false);
        expect(row.classList.contains(CONST.CLASSES.DRAG_OVER_BOTTOM)).toBe(false);
      });
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
