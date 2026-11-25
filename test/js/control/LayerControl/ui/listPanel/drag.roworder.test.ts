// test/js/control/LayerControl/ui/listPanel/drag.roworder.test.ts — registry-reorder row-order sync
import { initFixture } from "../fixture.js";
import { dragEvent, pinRect, rowOf } from "./drag.fixture.js";
import { describe, expect, it } from "vitest";
import * as CONST from "#control/LayerControl/const.js";
import {
  handleDragEnd,
  handleDragStart,
  handleDrop,
} from "#control/LayerControl/ui/listPanel/index.js";

const rootRows = (panel: HTMLElement) =>
  Array.from(panel.querySelectorAll<HTMLElement>(".foliplus-layer-item[data-layer-id]"))
    .map(el => el.getAttribute(CONST.DATA.LAYER_ID) ?? "")
    .filter(id => id.startsWith("root"));

const folderSeeded = () =>
  initFixture({
    seedLayout: {
      version: 2,
      folders: [{ key: "a", name: "a" }],
      order: { overlay: ["a", "layer:root1", "layer:root2"] },
      members: { a1: { role: "overlay", folder: "a" } },
    },
    data: [
      { id: "a1", name: "a1", role: "overlay" as const, folder: "a" },
      { id: "root1", name: "root1", role: "overlay" as const },
      { id: "root2", name: "root2", role: "overlay" as const },
    ],
  });

describe("drag row order follows the registry reorder (the stale row-order bug)", () => {
  it("moves a listed root layer's DOM row after a plain registry reorder", () => {
    const { ui } = folderSeeded();
    const panel = ui.uiContainer!;
    expect(rootRows(panel)).toEqual(["root1", "root2"]);
    // Drag root2 onto root1's top edge → lands before root1 (reorderLayer).
    pinRect(rowOf(ui, "root1"), 100, 36);
    handleDragStart(ui, dragEvent(rowOf(ui, "root2"), { effectAllowed: "" }));
    handleDrop(ui, dragEvent(rowOf(ui, "root1"), {}, 102));
    handleDragEnd(ui);
    expect(rootRows(panel)).toEqual(["root2", "root1"]);
    // The folder block key keeps its slot.
    expect(ui.c.folderLayoutView.order.overlay).toEqual([
      "a",
      "layer:root2",
      "layer:root1",
    ]);
  });

  it("keeps a folder key in place when the root entries reorder", () => {
    const { manager, ui } = folderSeeded();
    // bringToFront(root1) — the same commitReorder funnel.
    manager.bringLayerToFront("root2");
    expect(rootRows(ui.uiContainer!)).toEqual(["root2", "root1"]);
    expect(ui.c.folderLayoutView.order.overlay).toEqual([
      "a",
      "layer:root2",
      "layer:root1",
    ]);
  });

  it("leaves the order alone when nothing reorders", () => {
    const { manager, ui } = folderSeeded();
    const before = JSON.stringify(ui.c.folderLayoutView.order);
    manager.reorderLayer("root1", "root2"); // same-role, valid move
    // Still changes the order (the move is real) — but a no-op drag must not.
    const after = JSON.stringify(ui.c.folderLayoutView.order);
    expect(after).not.toBe(before);
  });
});
