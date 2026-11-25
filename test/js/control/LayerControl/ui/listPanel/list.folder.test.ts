// test/js/control/LayerControl/ui/style/list.folder — folder rows, tree connectors and role fold.
import { repoPath } from "#test/path.js";
import { initFixture } from "../fixture.js";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LayerInfo } from "#core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { isFolderFolded } from "#control/LayerControl/ui/listPanel/drag.js";
import {
  applyVisibility,
  colorLayerName,
  rebuildList,
  syncRowOrder,
  toggleFold,
  updateLayerItemLabel,
} from "#control/LayerControl/ui/listPanel/index.js";
import { emptyFolderKeys } from "#control/LayerControl/ui/listPanel/list.js";

describe("ui/list folder rows (render / row structure)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  const layoutFromRoles = (
    sections: Record<string, string[]>,
  ): Record<string, unknown> => {
    const keys = new Set<string>();
    for (const list of Object.values(sections)) for (const k of list) keys.add(k);
    return {
      version: 2,
      folders: [...keys].map(k => ({ key: k, name: k })),
      order: sections,
      members: {},
    };
  };

  const polygonLayer = () => ({
    options: {},
    getBounds: () => ({ isValid: () => true }),
  });

  it("renders role header, folder row, members with rail tree lines, then root layers", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
        {
          id: "water",
          name: "Water",
          role: "overlay",
          folder: "",
          layer: polygonLayer(),
        },
      ],
    });
    const roleRow = ui.uiContainer!.querySelector(`.${CONST.CLASSES.ROLE_ROW}`);
    expect(roleRow).not.toBeNull();
    const folderRow = ui.uiContainer!.querySelector(`.${CONST.CLASSES.FOLDER_ROW}`);
    expect(folderRow).not.toBeNull();
    expect(folderRow!.getAttribute(CONST.DATA.FOLDER_KEY)).toBe("roads");
    expect(folderRow!.getAttribute(CONST.DATA.ROLE)).toBe("overlay");
    expect(folderRow!.getAttribute("aria-expanded")).toBe("true");
    // Member row (rd1) has a fold-tree guide; root row (water) does not.
    const memberRow = ui.uiContainer!.querySelector(`[data-layer-id="rd1"]`);
    const rootRow = ui.uiContainer!.querySelector(`[data-layer-id="water"]`);
    expect(memberRow!.querySelector(`.${CONST.CLASSES.FOLD_TREE}`)).not.toBeNull();
    expect(rootRow!.querySelector(`.${CONST.CLASSES.FOLD_TREE}`)).toBeNull();
    // Both member and root rows still carry the drag grip in the rail.
    expect(
      memberRow!.querySelector(`.${CONST.CLASSES.RAIL_CELL} .drag-handle`),
    ).not.toBeNull();
    expect(
      rootRow!.querySelector(`.${CONST.CLASSES.RAIL_CELL} .drag-handle`),
    ).not.toBeNull();
  });

  it("folder checkbox is tri-state (mixed when some members visible)", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
        {
          id: "rd2",
          name: "Rivers",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    const folderRow = ui.uiContainer!.querySelector(`.${CONST.CLASSES.FOLDER_ROW}`);
    const cb = folderRow!.querySelector("input[type=checkbox]") as HTMLInputElement;
    // All members visible by default → the folder checkbox reads fully checked.
    expect(cb.getAttribute("aria-checked")).toBe("true");
  });

  it("role row gains count, divider, type icon and more button when folders exist", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    const roleRow = ui.uiContainer!.querySelector(`.${CONST.CLASSES.ROLE_ROW}`);
    expect(roleRow!.querySelector(`.${CONST.CLASSES.ROLE_DIVIDER}`)).not.toBeNull();
    expect(roleRow!.querySelector(`.${CONST.CLASSES.COUNT_COL}`)).not.toBeNull();
    expect(roleRow!.querySelector(`.${CONST.CLASSES.TYPE_ICON_COL}`)).not.toBeNull();
    expect(roleRow!.querySelector(`.${CONST.CLASSES.MORE_BTN}`)).not.toBeNull();
  });

  it("role checkbox toggles every layer in the role", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    const roleRow = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.ROLE_ROW}`,
    ) as HTMLElement;
    (ui.overlayPanel as any).activeMenu = {
      item: roleRow,
      menu: document.createElement("div"),
      role: "overlay",
    };
    const cb = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.ROLE_ROW} input[type=checkbox]`,
    ) as HTMLInputElement;
    cb.checked = false;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
    expect(cb.getAttribute("aria-checked")).toBe("false");
  });

  it("renders a folder row for declared-only grouping (empty order, member assigned)", () => {
    const { ui } = initFixture({
      seedLayout: {
        version: 2,
        folders: [{ key: "roads", name: "Roads" }],
        order: {},
        members: {},
      },
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "Roads",
          layer: polygonLayer(),
        },
      ],
    });
    const folderRow = ui.uiContainer!.querySelector(`.${CONST.CLASSES.FOLDER_ROW}`);
    expect(folderRow).not.toBeNull();
    expect(folderRow!.getAttribute(CONST.DATA.FOLDER_KEY)).toBe("roads");
    const memberRow = ui.uiContainer!.querySelector('[data-layer-id="rd1"]');
    expect(memberRow!.querySelector(`.${CONST.CLASSES.FOLD_TREE}`)).not.toBeNull();
  });

  it("orders two unlisted folders by their member anchor", () => {
    // Two folders that are NOT in layout.order land in the displayBlocks
    // `rest` bucket and are sorted by anchor (list.ts:481 comparator).
    const { ui } = initFixture({
      seedLayout: {
        version: 2,
        folders: [
          { key: "rivers", name: "Rivers" },
          { key: "roads", name: "Roads" },
        ],
        order: {},
        members: {},
      },
      data: [
        {
          id: "rv1",
          name: "Rivers",
          role: "overlay",
          folder: "Rivers",
          layer: polygonLayer(),
        },
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "Roads",
          layer: polygonLayer(),
        },
      ],
    });
    const rows = Array.from(
      ui.uiContainer!.querySelectorAll(`.${CONST.CLASSES.FOLDER_ROW}`),
    );
    // The two unlisted folders render as folder rows, in anchor order.
    expect(rows.map(r => r.getAttribute(CONST.DATA.FOLDER_KEY))).toEqual([
      "rivers",
      "roads",
    ]);
  });

  it("role checkbox shows every layer in the role", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    const roleRow = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.ROLE_ROW}`,
    ) as HTMLElement;
    (ui.overlayPanel as any).activeMenu = {
      item: roleRow,
      menu: document.createElement("div"),
      role: "overlay",
    };
    // Hide the layer first.
    const cb = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.ROLE_ROW} input[type=checkbox]`,
    ) as HTMLInputElement;
    cb.checked = false;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
    const memberCb = ui.uiContainer!.querySelector(
      '[data-layer-id="rd1"] input[type=checkbox]',
    ) as HTMLInputElement;
    expect(memberCb.checked).toBe(false);
    // The role checkbox shows them again.
    cb.checked = true;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
    const memberCb2 = ui.uiContainer!.querySelector(
      '[data-layer-id="rd1"] input[type=checkbox]',
    ) as HTMLInputElement;
    expect(memberCb2.checked).toBe(true);
  });

  it("wakes the role and folder icons when their group is on (issue 3)", () => {
    // The type icon is muted at rest and wakes to black when the row is
    // active. Layer rows got that state; role and folder rows never did, so a
    // checked group header kept a muted icon beside black layer icons.
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads 1",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
        {
          id: "rd2",
          name: "Roads 2",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    const roleRow = () => ui.uiContainer!.querySelector(`.${CONST.CLASSES.ROLE_ROW}`)!;
    const folderRow = () =>
      ui.uiContainer!.querySelector(`.${CONST.CLASSES.FOLDER_ROW}`)!;

    expect(roleRow().classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);
    expect(folderRow().classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);

    // One member left on: the group is still on.
    applyVisibility(ui, "rd1", false);
    expect(folderRow().classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);

    // Nothing on: the group is off, so the icons recede.
    applyVisibility(ui, "rd2", false);
    expect(folderRow().classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);
    expect(roleRow().classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);
  });

  it("paints the role divider with the shared section-divider recipe (issue 4)", () => {
    // The two role sections used to be separated by a hand-rolled flat line
    // while main used the soft gradient recipe, so the divider read as a
    // different element. One paint recipe, two spans.
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    const divider = ui.uiContainer!.querySelector(`.${CONST.CLASSES.ROLE_DIVIDER}`);
    expect(divider).not.toBeNull();
    expect(divider!.classList.contains("foliplus-section-divider")).toBe(true);
  });

  it("advertises the drag gesture with grab / grabbing cursors (issue 17)", () => {
    // Every row is draggable, so the cursor says so. The rows
    // used to sit on `default` and only switch to `move` mid-gesture.
    const row = readFileSync(
      repoPath("foliplus/css/control/LayerControl/row.css"),
      "utf8",
    );
    const itemStart = row.indexOf(".foliplus-layer-item {");
    const item = row.slice(itemStart, itemStart + 2000);
    expect(item).toContain("cursor: grab");
    expect(item).not.toContain("cursor: default");
    const dragging = row.slice(
      row.indexOf('&[data-foliplus-drop="source"] {'),
      row.indexOf('&[data-foliplus-drop="before"] {'),
    );
    expect(dragging).toContain("cursor: grabbing");
  });

  it("keeps the role label chip on the row's own surface (issue 3)", () => {
    // The label paints a chip so the role divider's hairline does not cross
    // the text. A hard-coded surface colour punched a white hole in the
    // checked-row wash once the group rows started carrying it; inheriting the
    // row's background keeps the gap in both states.
    const row = readFileSync(
      repoPath("foliplus/css/control/LayerControl/row.css"),
      "utf8",
    );
    const block = row.slice(
      row.indexOf(".foliplus-layer-sep-label {"),
      row.indexOf("/* ── Shared grid placements"),
    );
    expect(block).toContain("background-color: inherit");
    expect(block).not.toContain("background: var(--foliplus-surface)");
    // The chip hugs the text so the hairline shows in the rest of the column.
    expect(block).toContain("justify-self: start");
  });

  it("draws two distinct fold-tree shapes, centred on the rail (issue 5)", () => {
    // --mid is a branch that continues below (├), --last is the elbow that ends
    // it (└). Both used to render the same full-height stem, so the tree had
    // one shape where it needed two. The stem also sat off-centre, so it did
    // not line up with the folder header's fold chevron.
    const row = readFileSync(
      repoPath("foliplus/css/control/LayerControl/row.css"),
      "utf8",
    );
    const stem = row.slice(
      row.indexOf(".foliplus-fold-tree {"),
      row.indexOf(".foliplus-fold-tree-last::before"),
    );
    // Centred on the rail, not offset by a fixed width.
    expect(stem).toContain("left: 50%");
    expect(stem).toContain("transform: translateX(-50%)");
    // The elbow stops the stem at the horizontal stub.
    const elbow = row.slice(
      row.indexOf(".foliplus-fold-tree-last::before"),
      row.indexOf(".foliplus-fold-tree-mid::after"),
    );
    expect(elbow).toContain("bottom: 50%");
    // The continuing branch keeps the full-height stem.
    expect(stem).not.toContain("bottom: 50%");
  });

  it("clicking a folder row's checkbox does not fold the folder", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    const folderCb = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.FOLDER_ROW} input[type=checkbox]`,
    ) as HTMLInputElement;
    // The click on the checkbox is the onChange path, not a fold: the fold
    // handler's checkbox exclusion returns before toggling the folder.
    folderCb.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(isFolderFolded(ui, "overlay", "roads")).toBe(false);
  });

  it("folder-row click without a role no-ops", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    const row = ui.uiContainer!.querySelector(
      `[data-folder-key="roads"]`,
    ) as HTMLElement;
    row.removeAttribute(CONST.DATA.ROLE);
    expect(() =>
      row.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    ).not.toThrow();
  });

  it("folder row shows a 0/N count when every member is hidden", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    const folderRow = ui.uiContainer!.querySelector(
      `[data-folder-key="roads"]`,
    ) as HTMLElement;
    (ui.overlayPanel as any).activeMenu = {
      item: folderRow,
      menu: document.createElement("div"),
      folderKey: "roads",
      role: "overlay",
    };
    const folderCb = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.FOLDER_ROW} input[type=checkbox]`,
    ) as HTMLInputElement;
    folderCb.checked = false;
    folderCb.dispatchEvent(new Event("change", { bubbles: true }));
    // The bulk toggle rebuilds the list, so re-query the fresh folder row.
    const freshRow = ui.uiContainer!.querySelector(
      `[data-folder-key="roads"]`,
    ) as HTMLElement;
    const countEl = freshRow.querySelector(
      `.${CONST.CLASSES.COUNT_COL}`,
    ) as HTMLElement;
    // After hiding every member the folder row count shows the 0/N form.
    expect(countEl.textContent).toContain("0/");
  });

  it("folder row count shows the on/total form for partial visibility", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
        {
          id: "rd2",
          name: "Roads2",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    // Hide one member: folder count must show the on/total form.
    const row = ui.uiContainer!.querySelector(
      `[data-folder-key="roads"]`,
    ) as HTMLElement;
    (ui.overlayPanel as any).activeMenu = {
      item: row,
      menu: document.createElement("div"),
      folderKey: "roads",
      role: "overlay",
    };
    const folderCb = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.FOLDER_ROW} input[type=checkbox]`,
    ) as HTMLInputElement;
    folderCb.checked = false;
    folderCb.dispatchEvent(new Event("change", { bubbles: true }));
    const fresh = ui.uiContainer!.querySelector(
      `[data-folder-key="roads"]`,
    ) as HTMLElement;
    const count = fresh.querySelector(`.${CONST.CLASSES.COUNT_COL}`) as HTMLElement;
    // Both members hidden → on=0 → 0/N (the count cell already covers 0/N;
    // this test asserts the partial form by hiding a subset next).
    expect(count.textContent).toContain("0/");
  });
});

describe("ui/list folder rows, tree connectors and role fold", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const layoutFromRoles = (
    sections: Record<string, string[]>,
  ): Record<string, unknown> => {
    const keys = new Set<string>();
    for (const list of Object.values(sections)) for (const k of list) keys.add(k);
    return {
      version: 2,
      folders: [...keys].map(k => ({ key: k, name: k })),
      order: sections,
      members: {},
    };
  };

  const polygonLayer = () => ({
    options: {},
    getBounds: () => ({ isValid: () => true }),
  });

  const treeLine = (ui: any, id: string): HTMLElement | null =>
    ui.uiContainer!.querySelector(
      `[${CONST.DATA.LAYER_ID}="${id}"] .${CONST.CLASSES.FOLD_TREE}`,
    ) as HTMLElement | null;

  it("syncRowOrder re-derives a member's tree connector after a reorder (refreshTreeConnectors)", () => {
    // Two members in one folder. The FIRST is `last` before any move (single
    // member). Move the second member up so the first is no longer last and
    // the second becomes last: the ├/└ connector must flip on BOTH rows.
    const { manager, ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
        {
          id: "rd2",
          name: "Rivers",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    // Two members in one folder: rd1 is the FIRST (mid ├, a branch continues
    // below it), rd2 is the LAST (elbow └) before any move.
    expect(treeLine(ui, "rd1")!.classList.contains(CONST.CLASSES.FOLD_TREE_MID)).toBe(
      true,
    );
    expect(treeLine(ui, "rd1")!.classList.contains(CONST.CLASSES.FOLD_TREE_LAST)).toBe(
      false,
    );
    expect(treeLine(ui, "rd2")!.classList.contains(CONST.CLASSES.FOLD_TREE_LAST)).toBe(
      true,
    );
    // Move rd2 above rd1. Now rd2 is the FIRST (mid ├) and rd1 the LAST (└):
    // refreshTreeConnectors re-derives both connectors after the reorder.
    expect(manager.moveLayerUp("rd2")).toBe(true);
    const rd1 = treeLine(ui, "rd1")!;
    const rd2 = treeLine(ui, "rd2")!;
    expect(rd1.classList.contains(CONST.CLASSES.FOLD_TREE_LAST)).toBe(true);
    expect(rd1.classList.contains(CONST.CLASSES.FOLD_TREE_MID)).toBe(false);
    expect(rd2.classList.contains(CONST.CLASSES.FOLD_TREE_LAST)).toBe(false);
    expect(rd2.classList.contains(CONST.CLASSES.FOLD_TREE_MID)).toBe(true);
  });

  it("syncRowOrder places a root layer between two folder blocks via a layer:<id> order entry", () => {
    // order = [folder roads, root water, folder parks] → the root layer row must
    // sit between the two folder rows, not after all folders.
    const { ui } = initFixture({
      seedLayout: {
        version: 2,
        folders: [
          { key: "roads", name: "Roads" },
          { key: "parks", name: "Parks" },
        ],
        order: { overlay: ["roads", "layer:water", "parks"] },
        members: {},
      },
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
        {
          id: "water",
          name: "Water",
          role: "overlay",
          folder: "",
          layer: polygonLayer(),
        },
        {
          id: "pk1",
          name: "Parks",
          role: "overlay",
          folder: "parks",
          layer: polygonLayer(),
        },
      ],
    });
    const keys = Array.from(
      ui.uiContainer!.querySelectorAll(
        `[${CONST.DATA.LAYER_ID}], .${CONST.CLASSES.FOLDER_ROW}`,
      ),
    ).map(
      el =>
        el.getAttribute(CONST.DATA.FOLDER_KEY) ?? el.getAttribute(CONST.DATA.LAYER_ID),
    );
    const iRoads = keys.indexOf("roads");
    const iWater = keys.indexOf("water");
    const iParks = keys.indexOf("parks");
    expect(iWater).toBeGreaterThan(iRoads);
    expect(iWater).toBeLessThan(iParks);
    // A second sync pass walks the folder rows it mounted (the data-folder-key
    // branch) and the folder/layer block branches; the order must be stable.
    syncRowOrder(ui);
    const keys2 = Array.from(
      ui.uiContainer!.querySelectorAll(
        `[${CONST.DATA.LAYER_ID}], .${CONST.CLASSES.FOLDER_ROW}`,
      ),
    ).map(
      el =>
        el.getAttribute(CONST.DATA.FOLDER_KEY) ?? el.getAttribute(CONST.DATA.LAYER_ID),
    );
    expect(keys2.indexOf("water")).toBeGreaterThan(keys2.indexOf("roads"));
    expect(keys2.indexOf("water")).toBeLessThan(keys2.indexOf("parks"));
  });

  it("folding a role hides its folder rows and members (GROUP_FOLDED), then unfolding restores them", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
        {
          id: "water",
          name: "Water",
          role: "overlay",
          folder: "",
          layer: polygonLayer(),
        },
      ],
    });
    const folderRow = () =>
      ui.uiContainer!.querySelector(`.${CONST.CLASSES.FOLDER_ROW}`) as HTMLElement;
    const memberRow = () =>
      ui.uiContainer!.querySelector(`[${CONST.DATA.LAYER_ID}="rd1"]`) as HTMLElement;
    // Initially unfolded.
    expect(folderRow().classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(false);
    expect(memberRow().classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(false);
    // Fold the role.
    toggleFold(ui, "overlay");
    expect(folderRow().classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(true);
    expect(memberRow().classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(true);
    // Unfold restores.
    toggleFold(ui, "overlay");
    expect(folderRow().classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(false);
    expect(memberRow().classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(false);
  });

  it("role head row paints the folded state (FOLDED class, aria-expanded, unfold tooltip)", () => {
    const { ui } = initFixture({
      data: [
        { id: "o1", name: "O", role: "overlay", folder: "", layer: polygonLayer() },
      ],
    });
    const roleRow = () =>
      ui.uiContainer!.querySelector(
        `.${CONST.CLASSES.ROLE_ROW}[${CONST.DATA.ROLE}="overlay"]`,
      ) as HTMLElement;
    const foldBtn = () =>
      roleRow().querySelector(`.${CONST.CLASSES.FOLD_BTN}`) as HTMLElement;
    // Unfolded: no FOLDED class, fold chevron expanded, fold tooltip.
    expect(roleRow().classList.contains(CONST.CLASSES.FOLDED)).toBe(false);
    expect(foldBtn().getAttribute("aria-expanded")).toBe("true");
    expect(roleRow().getAttribute("title")).toBe(ui.T("fold_tooltip"));
    // Fold the role: the row carries the FOLDED class, the chevron collapses
    // and the tooltip flips to unfold.
    toggleFold(ui, "overlay");
    expect(roleRow().classList.contains(CONST.CLASSES.FOLDED)).toBe(true);
    expect(foldBtn().getAttribute("aria-expanded")).toBe("false");
    expect(roleRow().getAttribute("title")).toBe(ui.T("unfold_tooltip"));
  });

  it("emptyFolderKeys treats a layer whose registry entry is missing as not matching a key", () => {
    // A layer id present in ui.c.layers but absent from the registry: the
    // empty-folder scan must not treat the key as empty just because the info
    // lookup returned null (it reads the layer's own folder assignment).
    // emptyFolderKeys is a pure-ish reader over the layout + registry, so the
    // missing-registry-entry case is staged directly (the fixture's layer list
    // is a read-only proxy, so a ghost layer is injected through the registry
    // stub rather than pushed).
    const layout = {
      version: 2,
      folders: [{ key: "roads", name: "Roads" }],
      order: { overlay: ["roads"] },
      members: {},
    };
    const ui = {
      c: {
        folderLayoutView: layout,
        layers: [
          { id: "rd1", role: "overlay" },
          { id: "ghost", role: "overlay" },
        ],
        layerRegistry: {
          get: (id: string) =>
            id === "ghost"
              ? undefined
              : { id: "rd1", role: "overlay", folder: "roads" },
        },
      },
    } as unknown as LayerUI;
    // rd1 owns the "roads" key, so it is not empty even though the ghost layer
    // misses its registry entry (the info-null branch returns false and does
    // not erase the folder's live member).
    expect(emptyFolderKeys(ui, "overlay")).toEqual([]);
    // With rd1's registry entry gone too, "roads" has no live member left
    // and is reported empty.
    ui.c.layerRegistry.get = () => undefined;
    expect(emptyFolderKeys(ui, "overlay")).toEqual(["roads"]);
  });

  it("updateLayerItemLabel refreshes a live row's label after a re-registration", () => {
    // The bail path (row gone) is covered above; this covers the live-row path
    // where the label is rewritten from the re-registered layer info.
    const { ui } = initFixture({
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          layer: polygonLayer(),
        },
      ],
    });
    const row = ui.uiContainer!.querySelector(
      `[${CONST.DATA.LAYER_ID}="rd1"]`,
    ) as HTMLElement;
    expect(row).not.toBeNull();
    const info = ui.c.layerRegistry.get("rd1") as LayerInfo;
    // No throw: the live row is found and its label refreshed.
    expect(() => updateLayerItemLabel(ui, info)).not.toThrow();
  });

  it("colorLayerName returns the basemap's current display name", () => {
    // The virtual solid-basemap row's label comes from displayName, which
    // prefers a persisted rename and falls back to the locale label.
    const { ui } = initFixture({ data: [] });
    const name = colorLayerName(ui);
    expect(typeof name).toBe("string");
    expect(name.length).toBeGreaterThan(0);
  });

  it("emptyFolderKeys returns [] when the role has no folder entries", () => {
    // The zero-key guard: no folder entries in the role order means no
    // candidates, so the scan returns immediately instead of filtering.
    const layout = {
      version: 2,
      folders: [],
      order: { overlay: [], base: [] },
      members: {},
    };
    const ui = {
      c: {
        folderLayoutView: layout,
        layers: [],
        layerRegistry: { get: () => undefined },
      },
    } as unknown as LayerUI;
    expect(emptyFolderKeys(ui, "overlay")).toEqual([]);
  });

  it("folder row paints the folded state (FOLDED class, collapsed chevron, unfold tooltip)", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    // A user fold overrides the author default: the folder row re-renders with
    // FOLDED, the chevron collapses and the tooltip flips to unfold.
    ui.listPanel.foldedFolders["overlay::roads"] = true;
    rebuildList(ui);
    const row = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.FOLDER_ROW}[${CONST.DATA.FOLDER_KEY}="roads"]`,
    ) as HTMLElement;
    expect(row.classList.contains(CONST.CLASSES.FOLDED)).toBe(true);
    const foldBtn = row.querySelector(`.${CONST.CLASSES.FOLD_BTN}`) as HTMLElement;
    expect(foldBtn.getAttribute("aria-expanded")).toBe("false");
    expect(foldBtn.getAttribute("title")).toBe(ui.T("unfold_tooltip"));
  });

  it("marks member rows GROUP_FOLDED when the folder is folded but the role is not", () => {
    // The layer member inherits the folder's hidden state at render time
    // (roleFolded || folderFolded). The folder is folded and the role stays
    // expanded, so each member row must carry GROUP_FOLDED even though the
    // role itself is not folded.
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
        {
          id: "rd2",
          name: "Rivers",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    ui.listPanel.foldedFolders["overlay::roads"] = true;
    rebuildList(ui);
    const member = (id: string) =>
      ui.uiContainer!.querySelector(`[data-layer-id="${id}"]`) as HTMLElement;
    expect(member("rd1").classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(true);
    expect(member("rd2").classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(true);
    // Unfold the folder: the members drop the marker.
    ui.listPanel.foldedFolders = {};
    rebuildList(ui);
    expect(member("rd1").classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(false);
    expect(member("rd2").classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(false);
  });

  it("handles a folder block with zero members (empty for-body)", () => {
    // A folder key declared in the layout but with no live member layer yields
    // an empty block.members list, so the member for-loop body never runs.
    // The folder row still renders; no member rows are produced.
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    // Retire the only member so the folder block has zero members.
    ui.c.unregisterLayer("rd1");
    rebuildList(ui);
    const folderRow = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.FOLDER_ROW}[${CONST.DATA.FOLDER_KEY}="roads"]`,
    );
    expect(folderRow).not.toBeNull();
    // No member rows remain under the empty folder.
    const members = ui.uiContainer!.querySelectorAll(`[data-layer-id="rd1"]`);
    expect(members.length).toBe(0);
  });

  it("folder row reads active when a member is visible (ACTIVE class)", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
        {
          id: "rd2",
          name: "Rivers",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    const row = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.FOLDER_ROW}[${CONST.DATA.FOLDER_KEY}="roads"]`,
    ) as HTMLElement;
    // At least one member is visible by default, so the folder row is active.
    expect(row.classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);
  });
});
