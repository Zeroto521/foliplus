// test/js/control/LayerControl/ui/style/list.guard — row-order and tree-connector guards.
import { initFixture } from "../fixture.js";
import { describe, expect, it, vi } from "vitest";
import { type LayerInfo } from "#core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import {
  renderLayerItem,
  syncRowOrder,
} from "#control/LayerControl/ui/listPanel/index.js";
import { emptyFolderKeys } from "#control/LayerControl/ui/listPanel/list.js";

describe("ui/list row-order and tree-connector guards", () => {
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

  const makeTreeRow = (attrs: Record<string, string>) => {
    const row = document.createElement("div");
    row.className = CONST.CLASSES.LAYER_ITEM;
    for (const [k, v] of Object.entries(attrs)) row.setAttribute(k, v);
    const tree = document.createElement("span");
    tree.className = CONST.CLASSES.FOLD_TREE;
    row.appendChild(tree);
    return row;
  };

  it("syncRowOrder tolerates rows missing from the panel (row-found guards)", () => {
    // The row-found guards: a folder/member/layer row absent from the DOM must not
    // derail the reorder — it is simply skipped. Remove one of each and re-sync.
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads", "root"] }),
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
        { id: "root1", name: "Root", role: "overlay", layer: polygonLayer() },
      ],
    });
    const panel = ui.uiContainer!;
    const folderRow = panel.querySelector(
      `.${CONST.CLASSES.FOLDER_ROW}[${CONST.DATA.FOLDER_KEY}="roads"]`,
    );
    const rd2Row = panel.querySelector(`[${CONST.DATA.LAYER_ID}="rd2"]`);
    const rootRow = panel.querySelector(`[${CONST.DATA.LAYER_ID}="root1"]`);
    folderRow?.remove();
    rd2Row?.remove();
    rootRow?.remove();
    expect(() => syncRowOrder(ui)).not.toThrow();
  });

  it("refreshTreeConnectors skips a tree row whose id is missing from the registry", () => {
    // A LAYER_ITEM row carrying a tree guide but no registered layer: the id->info
    // lookup fails and the row is skipped rather than dereferencing undefined.
    const { ui } = initFixture({ data: [] });
    const ghost = makeTreeRow({ "data-layer-id": "ghost" });
    ui.uiContainer!.appendChild(ghost);
    expect(() => syncRowOrder(ui)).not.toThrow();
  });

  it("refreshTreeConnectors skips a tree row with no layer id", () => {
    // The id-falsy arm: a tree row without data-layer-id reads no registry entry.
    const { ui } = initFixture({ data: [] });
    const noId = makeTreeRow({});
    ui.uiContainer!.appendChild(noId);
    expect(() => syncRowOrder(ui)).not.toThrow();
  });

  it("refreshTreeConnectors treats a root layer row as not-a-member", () => {
    // A root layer (no folder) renders no tree guide in practice, but a synthetic
    // tree row for a root layer must not crash: folderOf is null and the row is skipped.
    const { ui } = initFixture({
      data: [{ id: "root1", name: "Root", role: "overlay", layer: polygonLayer() }],
    });
    const rootTree = makeTreeRow({ "data-layer-id": "root1" });
    ui.uiContainer!.appendChild(rootTree);
    expect(() => syncRowOrder(ui)).not.toThrow();
  });

  it("refreshTreeConnectors skips a tree row whose folder block is unknown", () => {
    // A layer whose folder key is not in the layout: folderOf returns the key but the
    // block map has no such block — the connector logic treats it as not-a-member.
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "orphan",
          name: "Orphan",
          role: "overlay",
          folder: "ghost",
          layer: polygonLayer(),
        },
      ],
    });
    const orphanTree = makeTreeRow({ "data-layer-id": "orphan" });
    ui.uiContainer!.appendChild(orphanTree);
    expect(() => syncRowOrder(ui)).not.toThrow();
  });

  it("renderLayerItem treats a layer with an unknown folder as not-a-member", () => {
    // memberInfo: folderOf resolves a key (the layer's own folder) but the layer is
    // not in the registry list groupByFolder walks, so no block exists — the layer
    // renders as a non-member row, not a folder member.
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
    // The orphan is NOT in ui.c.layers (only rd1 is registered), so folderOf resolves
    // "ghost" but groupByFolder never builds a "ghost" block.
    const orphan: LayerInfo = {
      id: "orphan",
      name: "Orphan",
      role: "overlay",
      folder: "ghost",
      layer: polygonLayer(),
    } as LayerInfo;
    let row: HTMLElement | null = null;
    expect(() => {
      row = renderLayerItem(ui, orphan);
    }).not.toThrow();
    expect(row).not.toBeNull();
    // The rail has no tree guide: the orphan is not a member of any block.
    expect(row!.querySelector(`.${CONST.CLASSES.FOLD_TREE}`)).toBeNull();
  });

  it("renderLayerItem leaves the type-icon column empty for a layer with no iconSvg", () => {
    // Direct branch: `if (layerInfo.iconSvg)` takes the falsy path when the
    // layer carries no custom icon (the registry only fills iconSvg from an
    // explicit opts.iconSvg). The column must stay empty, not hold a stale
    // or placeholder glyph.
    const { ui } = initFixture({ data: [] });
    const bare: LayerInfo = {
      id: "bare",
      name: "Bare",
      role: "overlay",
      folder: "",
      iconSvg: null,
      layer: polygonLayer(),
    } as LayerInfo;
    let row: HTMLElement | null = null;
    expect(() => {
      row = renderLayerItem(ui, bare);
    }).not.toThrow();
    expect(row).not.toBeNull();
    const icon = row!.querySelector(`.${CONST.CLASSES.TYPE_ICON_COL}`);
    expect(icon).not.toBeNull();
    expect(icon!.innerHTML).toBe("");
  });
});

describe("ui/list coverage gaps (#1282)", () => {
  it("emptyFolderKeys falls back to an empty order when the role has no order key", () => {
    // The role's block order may be absent (a role with no blocks yet): the
    // candidate scan must fall back to [] instead of throwing on undefined.
    const layout = {
      version: 2,
      folders: [],
      order: { base: [] },
      members: {},
    };
    const ui = {
      c: {
        folderView: layout,
        layers: [],
        layerRegistry: { get: () => undefined },
      },
    } as unknown as LayerUI;
    expect(emptyFolderKeys(ui, "overlay")).toEqual([]);
  });

  it("renderLayerItem fills the type-icon column from a layer's iconSvg", () => {
    // The direct branch: a layer carrying a custom iconSvg (from an explicit
    // opts.iconSvg) paints that SVG into the type-icon column.
    const { ui } = initFixture({ data: [] });
    const custom: LayerInfo = {
      id: "custom",
      name: "Custom",
      role: "overlay",
      folder: "",
      iconSvg:
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'><path d='M0 0h1v1H0z'/></svg>",
      layer: { options: {}, eachLayer: vi.fn() },
    } as LayerInfo;
    let row: HTMLElement | null = null;
    expect(() => {
      row = renderLayerItem(ui, custom);
    }).not.toThrow();
    expect(row).not.toBeNull();
    const icon = row!.querySelector(`.${CONST.CLASSES.TYPE_ICON_COL}`);
    expect(icon).not.toBeNull();
    expect(icon!.innerHTML).toContain("<svg");
  });
});
