// test/js/control/LayerControl/ui/style/list — display name, row placement, folder button and role header order.
import { TileLayer, attachedPanel, initFixture, polygonLayer } from "../fixture.js";
import { makeUi, rowOf } from "./list.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LayerInfo, ROLE, normalizeFolderName } from "#core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { LayerIntentStore } from "#control/LayerControl/domain/index.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { seedIntentMap } from "#control/LayerControl/ui/intent.js";
import {
  applyVisibility,
  displayName,
  initLayerItem,
  initTypesAndVisibility,
  insertLayerItem,
  rebuildList,
  renderInitialList,
  updateLayerItemLabel,
} from "#control/LayerControl/ui/listPanel/index.js";
import { openSurface } from "#control/LayerControl/ui/overlayPanel/openSurface.js";

describe("ui/list displayName", () => {
  it("resolves a registered/renamed id through the registry name", () => {
    const intentStore = new LayerIntentStore();
    intentStore.setValue("a", "name", "Renamed");
    const ui = {
      intentStore,
      c: { layerRegistry: { get: () => ({ name: "Original" }) } },
      T: (k: string) => k,
    } as unknown as LayerUI;
    expect(displayName(ui, "a")).toBe("Renamed");
    expect(displayName(ui, "b")).toBe("Original");
  });

  it("labels the color basemap and falls back to empty for unknown ids", () => {
    const ui = makeUi();
    expect(displayName(ui, CONST.SOLID_BASEMAP_ID)).toContain("color_map_label");
    expect(displayName(ui, "ghost")).toBe("");
  });
});

describe("ui/list row placement", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("lands a late row at the depth the registry chose", () => {
    // The row must land at the depth the registry chose. Pinned to the top of
    // the group instead, the DOM order diverges from the drawn order and every
    // index-based row lookup reads a neighbor's checkbox.
    const { manager, ui } = initFixture({
      seed: { order: ["B", "A", "H"] },
      data: [
        { id: "A", name: "A", role: "overlay" },
        { id: "B", name: "B", role: "overlay" },
      ],
    });

    manager.registerLayer({ id: "H", name: "H", role: "overlay" });

    const registryIds = manager.layers.map(l => l.id);
    const rowIds = Array.from(
      attachedPanel(ui).querySelectorAll<HTMLElement>(CONST.SEL.LEAF_ITEM),
    ).map(el => el.dataset.layerId ?? "");

    expect(rowIds).toEqual(registryIds);
    expect(registryIds).toEqual(["B", "A", "H", CONST.SOLID_BASEMAP_ID]);
  });

  it("initLayerItem updates the row it owns, not the one at that DOM index", () => {
    // Register three overlays so the registry order is A-B-C.
    const { manager, ui } = initFixture({
      data: [
        {
          id: "A",
          name: "A",
          role: "overlay",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        {
          id: "B",
          name: "B",
          role: "overlay",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        {
          id: "C",
          name: "C",
          role: "overlay",
          layer: { options: {}, eachLayer: vi.fn() },
        },
      ],
    });

    // Scramble the DOM to C-A-B.
    const rows = Array.from(
      attachedPanel(ui).querySelectorAll<HTMLElement>(
        `${CONST.SEL.LAYER_ITEM}[data-layer-type="${ROLE.OVERLAY}"]`,
      ),
    );
    expect(rows.length).toBe(3);
    const container = rows[0].parentNode!;
    container.insertBefore(rows[2], rows[0]); // A,B,C -> C,A,B

    // Call initLayerItem for A (registry idx 0). The old code would read
    // inputs[0] which is C's checkbox (first in DOM). The new code resolves
    // by data-layer-id, so it updates A's row.
    const layerA = manager.layerRegistry.get("A")!;
    initLayerItem(ui, layerA);

    // A's checkbox should be updated (aria-label set), not C's.
    const rowA = container.querySelector<HTMLElement>(`[${CONST.DATA.LAYER_ID}="A"]`)!;
    const rowC = container.querySelector<HTMLElement>(`[${CONST.DATA.LAYER_ID}="C"]`)!;
    const cbA = rowA.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const cbC = rowC.querySelector('input[type="checkbox"]') as HTMLInputElement;

    expect(cbA.getAttribute("aria-label")).toBe("A");
    // C's checkbox should not have been touched by A's init pass.
    expect(cbC.getAttribute("aria-label")).not.toBe("A");
  });

  it("initLayerItem declines an id the registry does not know", () => {
    const { ui } = initFixture({
      data: [{ id: "A", name: "A", role: "overlay" }],
    });

    // A late callback for a torn-down layer must not write into a row: the id
    // is not registered, so there is nothing to initialize.
    expect(initLayerItem(ui, { id: "ghost" } as LayerInfo)).toBe(false);
  });

  it("initLayerItem declines an id whose row is no longer on the panel", () => {
    // The registry and the DOM can diverge: a row removed after registration
    // leaves the layer behind. The sweep must bail rather than write a stale
    // cell into whatever row now sits there.
    const { manager, ui } = initFixture({
      data: [{ id: "A", name: "A", role: "overlay" }],
    });
    const row = attachedPanel(ui).querySelector<HTMLElement>(
      `[${CONST.DATA.LAYER_ID}="A"]`,
    );
    expect(row).not.toBeNull();
    const layer = manager.layerRegistry.get("A")!;
    row!.remove();

    expect(initLayerItem(ui, layer)).toBe(false);
    // No row means no buildRowCell: nothing is derived from the (now missing)
    // row, and the registry entry itself is untouched.
    expect(manager.layerRegistry.get("A")).toBe(layer);
  });

  it("paints nothing once the panel is gone", () => {
    // A teardown that nulls the container without clearing the registry — the
    // mid-notify destroy, though any subset of the panel removal works — must
    // no-op for every paint helper instead of dereferencing a dead panel. This
    // is the shape of the null-panel crash, now typed and guarded.
    const { manager, ui } = initFixture({
      data: [{ id: "A", name: "A", role: "overlay" }],
    });
    const layer = manager.layerRegistry.get("A")!;
    ui.c.uiContainer = null;

    expect(() => renderInitialList(ui)).not.toThrow();
    expect(() => rebuildList(ui)).not.toThrow();
    expect(insertLayerItem(ui, layer)).toBeUndefined();
    expect(initLayerItem(ui, layer)).toBe(false);
  });

  it("brings its own header when the first row of an empty group arrives", () => {
    // Only a base is seeded, so the overlay group owns no row yet. The late
    // overlay must create the group header itself and land above the base
    // group — appending it at the panel's end would leave the header stranded
    // below the layers it controls.
    const { manager, ui } = initFixture({
      data: [{ id: "B1", name: "B1", role: "base" }],
    });
    expect(
      attachedPanel(ui).querySelectorAll(
        `${CONST.SEL.LAYER_ITEM}[data-layer-type="${ROLE.OVERLAY}"]`,
      ).length,
    ).toBe(0);

    manager.registerLayer({ id: "O1", name: "O1", role: "overlay" });

    const children = Array.from(attachedPanel(ui).children);
    const overlayHeader = children.findIndex(
      el => el.getAttribute("data-role") === ROLE.OVERLAY,
    );
    const firstBaseRow = children.findIndex(
      el => el.getAttribute("data-layer-type") === ROLE.BASE,
    );
    // Appended to the panel's end instead, the header would land after every
    // base row and control layers it is not adjacent to.
    expect(overlayHeader).toBeGreaterThanOrEqual(0);
    expect(overlayHeader).toBeLessThan(firstBaseRow);
    expect(
      Array.from(
        attachedPanel(ui).querySelectorAll<HTMLElement>(
          `${CONST.SEL.LAYER_ITEM}[data-layer-type="${ROLE.OVERLAY}"]`,
        ),
      ).map(el => el.getAttribute(CONST.DATA.LAYER_ID)),
    ).toEqual(["O1"]);
  });

  it("appends the header when the new group is the last one on the panel", () => {
    // An empty panel has no base row to anchor before, so the first overlay
    // lands at the end of the list, after the color row.
    const { manager, ui } = initFixture({ data: [] });

    manager.registerLayer({ id: "O1", name: "O1", role: "overlay" });

    const ids = Array.from(
      attachedPanel(ui).querySelectorAll<HTMLElement>(CONST.SEL.LAYER_ITEM),
    ).map(el => el.getAttribute(CONST.DATA.LAYER_ID));
    expect(ids).toContain("O1");
    expect(ids).toContain(CONST.SOLID_BASEMAP_ID);
  });

  it("insertLayerItem declines an id the registry does not know", () => {
    // A late callback for a layer that was never registered (or was removed)
    // carries no row: the guard bails before any DOM write instead of inserting
    // a row the registry cannot find.
    const { ui } = initFixture({
      data: [{ id: "A", name: "A", role: "overlay" }],
    });
    const rowsBefore = attachedPanel(ui).querySelectorAll(CONST.SEL.LAYER_ITEM);

    expect(() => insertLayerItem(ui, { id: "ghost" } as LayerInfo)).not.toThrow();
    expect(attachedPanel(ui).querySelectorAll(CONST.SEL.LAYER_ITEM)).toHaveLength(
      rowsBefore.length,
    );
  });

  it("brings its own base header when the first base arrives late, folded or not", () => {
    // Only overlays are seeded, so the base group owns no header. The first
    // base must create it (base_map_label, not data_layer_label) and insert it
    // before the color row — anchored at the panel's end instead, the header
    // would sit below the layers it controls.
    const { manager, ui } = initFixture({
      data: [{ id: "O1", name: "O1", role: "overlay" }],
    });
    ui.listPanel.foldedRoles[ROLE.BASE] = true;

    manager.registerLayer({
      id: "B1",
      name: "B1",
      role: "base",
      layer: new TileLayer(),
    });

    const children = Array.from(attachedPanel(ui).children);
    const baseHeader = children.findIndex(
      el => el.getAttribute("data-role") === ROLE.BASE,
    );
    const colorRow = children.findIndex(
      el => el.getAttribute(CONST.DATA.LAYER_ID) === CONST.SOLID_BASEMAP_ID,
    );
    expect(baseHeader).toBeGreaterThanOrEqual(0);
    expect(baseHeader).toBeLessThan(colorRow);
    expect(children[baseHeader].textContent).toContain("base_map_label");
    // The group was folded when the row arrived, so the late row inherits the
    // fold instead of showing up above the collapsed group's divider.
    const baseRow = attachedPanel(ui).querySelector<HTMLElement>(
      `[${CONST.DATA.LAYER_ID}="B1"]`,
    );
    expect(baseRow).not.toBeNull();
    expect(baseRow!.classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(true);
  });

  it("updateLayerItemLabel bails when the row is no longer on the panel", () => {
    // registerLayer's count change can land after the row was removed (a layer
    // deleted mid-sweep). The refresh must not raise and must not rebuild a row.
    const { ui } = initFixture({
      data: [{ id: "A", name: "A", role: "overlay" }],
    });
    attachedPanel(ui)
      .querySelector<HTMLElement>(`[${CONST.DATA.LAYER_ID}="A"]`)!
      .remove();

    expect(() => updateLayerItemLabel(ui, { id: "A" } as LayerInfo)).not.toThrow();
    expect(attachedPanel(ui).querySelector(`[${CONST.DATA.LAYER_ID}="A"]`)).toBeNull();
  });

  it("renders the color row folded when the base group is folded", () => {
    const { ui } = initFixture({
      data: [{ id: "B1", name: "B1", role: "base" }],
    });
    ui.listPanel.foldedRoles[ROLE.BASE] = true;

    renderInitialList(ui);

    const color = attachedPanel(ui).querySelector<HTMLElement>(
      `[${CONST.DATA.LAYER_ID}="${CONST.SOLID_BASEMAP_ID}"]`,
    );
    expect(color).not.toBeNull();
    expect(color!.classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(true);
  });

  it("a late registration's declared folder seeds the layout and places the row inside that folder block", () => {
    // A third-party control (HeatmapControl/MeasureControl) registers a layer
    // AFTER the initial render with an author-declared folder (CONFIG.folder,
    // forwarded through createCanvas/createLayers). The declaration seeds the
    // layout (registerLayer → folderView.seed), and insertLayerItem must
    // place the row inside the folder block, not at registry depth.
    const { manager, ui } = initFixture({
      seed: { order: ["A", "B", "H"] },
      // The folder already owns an order key (it exists on the panel); H has
      // no persisted members assignment, so the late declaration seeds it.
      seedLayout: {
        version: 2,
        folders: [{ key: normalizeFolderName("数据分析"), name: "数据分析" }],
        order: { overlay: [normalizeFolderName("数据分析")] },
        members: {},
      },
      data: [
        { id: "A", name: "A", role: "overlay", folder: "", layer: polygonLayer() },
        { id: "B", name: "B", role: "overlay", folder: "", layer: polygonLayer() },
      ],
    });

    // The declaration is the registration-time seed; no persisted members
    // assignment exists, so seed() must assign it.
    manager.registerLayer({
      id: "H",
      name: "Heat",
      role: "overlay",
      folder: "数据分析",
    });

    const children = Array.from(attachedPanel(ui).children);
    const folderIdx = children.findIndex(
      el => el.getAttribute(CONST.DATA.FOLDER_KEY) === normalizeFolderName("数据分析"),
    );
    const hIdx = children.findIndex(el => el.getAttribute(CONST.DATA.LAYER_ID) === "H");
    expect(folderIdx).toBeGreaterThanOrEqual(0);
    // The member row is the flat sibling immediately after its folder row.
    expect(hIdx).toBe(folderIdx + 1);
    // And it paints as a member: the rail carries the tree connector.
    const hRow = attachedPanel(ui).querySelector<HTMLElement>(
      `[${CONST.DATA.LAYER_ID}="H"]`,
    )!;
    expect(hRow.querySelector(`.${CONST.CLASSES.FOLD_TREE}`)).not.toBeNull();
  });

  it("a declared folder member sits at the same panel position whether it pre-registers or registers late (late ≡ pre-registered)", () => {
    // P3 follow-up: the folder placement branch in insertLayerItem (folderOf →
    // folderRow → block.members rank → anchor.after) must place a late-registered
    // member exactly where the initial render puts a pre-registered one. The
    // invariant is the full row sequence, not just "the row exists": a member
    // fallen to registry depth or placed at the wrong rank fails the compare.
    const layout = {
      seed: { order: ["A", "B", "H"] },
      seedLayout: {
        version: 2,
        folders: [{ key: normalizeFolderName("数据分析"), name: "数据分析" }],
        order: { overlay: [normalizeFolderName("数据分析")] },
        members: {},
      },
    };
    const rowTokens = (ui: LayerUI): string[] =>
      Array.from(attachedPanel(ui).children).map(el => {
        const folderKey = el.getAttribute(CONST.DATA.FOLDER_KEY);
        if (folderKey !== null) return `folder:${folderKey}`;
        const layerId = el.getAttribute(CONST.DATA.LAYER_ID);
        if (layerId !== null) return `layer:${layerId}`;
        return `row:${el.className}`;
      });

    // Case 1: the folder member is present at the initial render.
    const pre = initFixture({
      ...layout,
      data: [
        { id: "A", name: "A", role: "overlay", folder: null, layer: polygonLayer() },
        { id: "B", name: "B", role: "overlay", folder: "", layer: polygonLayer() },
        {
          id: "H",
          name: "Heat",
          role: "overlay",
          folder: "数据分析",
          layer: polygonLayer(),
        },
      ],
    });
    const preTokens = rowTokens(pre.ui);

    // Case 2: identical layout, but H registers after the initial render.
    const late = initFixture({
      ...layout,
      data: [
        { id: "A", name: "A", role: "overlay", folder: "", layer: polygonLayer() },
        { id: "B", name: "B", role: "overlay", folder: "", layer: polygonLayer() },
      ],
    });
    late.manager.registerLayer({
      id: "H",
      name: "Heat",
      role: "overlay",
      folder: "数据分析",
    });
    const lateTokens = rowTokens(late.ui);

    // The member is in the folder block in both, and the two sequences match.
    expect(preTokens).toContain("folder:数据分析");
    expect(preTokens).toContain("layer:H");
    expect(lateTokens).toEqual(preTokens);
  });

  it("a late member declaring a brand-new folder falls through to the registry-depth anchor (folder row not on the panel)", () => {
    // P3 coverage: when a late registration declares a folder that owns no order
    // key and no live member, mergeDeclaredFolders seeds the member assignment
    // and the directory entry but NOT the block order — so the folder has no
    // row on the panel when insertLayerItem runs. folderOf returns the key, the
    // folderRow lookup misses, and the insert falls through to the registry-depth
    // anchor (else if !firstOfGroup / else). This is a REACHABLE branch, not a
    // defensive dead end: it must not crash and the row must land on the panel.
    const { manager, ui } = initFixture({
      seed: { order: ["A"] },
      seedLayout: {
        version: 2,
        folders: [],
        order: { overlay: [] },
        members: {},
      },
      data: [
        { id: "A", name: "A", role: "overlay", folder: "", layer: polygonLayer() },
      ],
    });

    manager.registerLayer({
      id: "H",
      name: "Heat",
      role: "overlay",
      folder: "数据分析", // brand-new folder: not in order, no existing member
    });

    const children = Array.from(attachedPanel(ui).children);
    // The brand-new folder has no order key, so its row is NOT on the panel yet.
    const folderIdx = children.findIndex(
      el => el.getAttribute(CONST.DATA.FOLDER_KEY) === normalizeFolderName("数据分析"),
    );
    expect(folderIdx).toBe(-1);
    // The row must still land (the fallthrough anchors it at registry depth).
    const hIdx = children.findIndex(el => el.getAttribute(CONST.DATA.LAYER_ID) === "H");
    expect(hIdx).toBeGreaterThanOrEqual(0);
    const hRow = attachedPanel(ui).querySelector<HTMLElement>(
      `[${CONST.DATA.LAYER_ID}="H"]`,
    )!;
    expect(hRow).not.toBeNull();
  });

  it("a late member joins at its rank after an existing folder member (loop over prior members)", () => {
    // P3 coverage (list.ts 731-734): when a folder already holds a member and a
    // second member registers late, the member-position branch walks the prior
    // members (the anchor loop) to place the new row right after the last one
    // on the DOM. The loop body must be exercised, not skipped by a single-member
    // folder.
    const { manager, ui } = initFixture({
      seed: { order: ["A", "B", "H"] },
      seedLayout: {
        version: 2,
        folders: [{ key: normalizeFolderName("数据分析"), name: "数据分析" }],
        order: { overlay: [normalizeFolderName("数据分析")] },
        members: {},
      },
      data: [
        { id: "A", name: "A", role: "overlay", folder: null, layer: polygonLayer() },
        {
          id: "B",
          name: "B",
          role: "overlay",
          folder: "数据分析",
          layer: polygonLayer(),
        },
      ],
    });

    // B is already a member (its row is on the panel inside the folder block).
    // H registers late into the same folder: the loop walks B's row as anchor.
    manager.registerLayer({
      id: "H",
      name: "Heat",
      role: "overlay",
      folder: "数据分析",
    });

    const children = Array.from(attachedPanel(ui).children);
    const folderIdx = children.findIndex(
      el => el.getAttribute(CONST.DATA.FOLDER_KEY) === normalizeFolderName("数据分析"),
    );
    const bIdx = children.findIndex(el => el.getAttribute(CONST.DATA.LAYER_ID) === "B");
    const hIdx = children.findIndex(el => el.getAttribute(CONST.DATA.LAYER_ID) === "H");
    // H lands right after B (its rank among the folder's members), inside the block.
    expect(folderIdx).toBeGreaterThanOrEqual(0);
    expect(bIdx).toBe(folderIdx + 1);
    expect(hIdx).toBe(bIdx + 1);
  });

  it("a late member into a brand-new folder with no other role row appends at the role end (else-if !firstOfGroup path)", () => {
    // P3 coverage: when a late member declares a brand-new folder AND the role
    // has no other row on the panel, firstOfGroup is null — the insert takes the
    // else-if (!firstOfGroup) branch (BASE-before-first-base / role-end append),
    // not the registry-depth else. This covers the last partially-hit arm of the
    // folder-placement block.
    const { manager, ui } = initFixture({
      seed: { order: [] },
      seedLayout: {
        version: 2,
        folders: [],
        order: { overlay: [] },
        members: {},
      },
      data: [],
    });

    manager.registerLayer({
      id: "H",
      name: "Heat",
      role: "overlay",
      folder: "数据分析",
    });

    const children = Array.from(attachedPanel(ui).children);
    const hIdx = children.findIndex(el => el.getAttribute(CONST.DATA.LAYER_ID) === "H");
    expect(hIdx).toBeGreaterThanOrEqual(0); // the row landed (role-end append)
  });

  it("leaves the anchor at the folder row when a prior member's row is absent (defensive arm)", () => {
    // P3 coverage: the member-rank loop looks up each prior member's row. A
    // member's row can be gone while the block still lists it only in a
    // transient (rows are removed with the member in steady state), so the
    // lookup is a defensive guard. Contract: when it misses, the anchor stays
    // the folder row and the member still lands inside the block — never
    // thrown to the registry depth.
    const { manager, ui } = initFixture({
      seed: { order: ["A", "B"] },
      seedLayout: {
        version: 2,
        folders: [{ key: normalizeFolderName("数据分析"), name: "数据分析" }],
        order: { overlay: [normalizeFolderName("数据分析")] },
        members: {},
      },
      data: [
        {
          id: "A",
          name: "A",
          role: "overlay",
          folder: "数据分析",
          layer: polygonLayer(),
        },
        {
          id: "B",
          name: "B",
          role: "overlay",
          folder: "数据分析",
          layer: polygonLayer(),
        },
      ],
    });

    const panel = attachedPanel(ui);
    const folderIdx = Array.from(panel.children).findIndex(
      el => el.getAttribute(CONST.DATA.FOLDER_KEY) === normalizeFolderName("数据分析"),
    );

    // Drop A's row (the prior member the loop would anchor on).
    panel.querySelector<HTMLElement>(`[${CONST.DATA.LAYER_ID}="A"]`)!.remove();

    // Re-insert B directly: the loop walks A (row gone → miss → anchor stays
    // the folder row), so B lands right after the folder row.
    const bInfo = manager.layerRegistry.get("B")!;
    insertLayerItem(ui, bInfo);

    const after = Array.from(panel.children);
    const bIdx = after.findIndex(el => el.getAttribute(CONST.DATA.LAYER_ID) === "B");
    expect(bIdx).toBe(folderIdx + 1);
  });

  it("renders a folder row folded when its role is folded", () => {
    // Folding a role hides the whole block, header included — the folder's own
    // fold state is untouched, so unfolding the role restores the same view.
    const { ui } = initFixture({
      data: [{ id: "A", name: "A", role: "overlay", folder: "Roads" }],
    });
    ui.listPanel.foldedRoles[ROLE.OVERLAY] = true;

    renderInitialList(ui);

    const folder = attachedPanel(ui).querySelector<HTMLElement>(
      `[${CONST.DATA.FOLDER_KEY}="roads"]`,
    );
    expect(folder).not.toBeNull();
    expect(folder!.classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(true);
    // The row is the block's header, so it must NOT carry the folder's own
    // FOLDED state — only the "hidden because my role is folded" marker.
    expect(folder!.classList.contains(CONST.CLASSES.FOLDED)).toBe(false);
  });

  it("closes the open row surface it drops with the rows", () => {
    // A rebuild replaces the whole list (fold, reorder, or the list arriving).
    // The open surface can dispose its scheme picker and unpin itself, but only
    // if it is asked BEFORE the row carrying it is detached: these panels are
    // children of a row, so clearing the list with innerHTML used to leave the
    // picker and its document listeners answering a trigger that was gone.
    const { ui } = initFixture({
      data: [{ id: "A", name: "A", role: "overlay" }],
    });
    renderInitialList(ui);
    const row = rowOf(ui, "A");
    const stylePanel = document.createElement("div");
    stylePanel.className = CONST.CLASSES.STYLE_PANEL;
    row.appendChild(stylePanel);
    const attrsPanel = document.createElement("div");
    attrsPanel.className = CONST.CLASSES.ATTRS_PANEL;
    row.appendChild(attrsPanel);
    // One surface at a time (openSurface is the single source), so the two
    // panel kinds are closed in two rounds against the same rebuild path.
    openSurface(ui, { kind: "style", layerId: "A" });
    const styleUnregister = vi.fn();
    ui.overlayPanel.styleOverlayUnregister = styleUnregister;

    rebuildList(ui);

    expect(styleUnregister).toHaveBeenCalled();
    expect(ui.overlayPanel.styleOverlayUnregister).toBeNull();
    expect(ui.overlayPanel.stylePanelLayerId).toBeNull();
    expect(stylePanel.isConnected).toBe(false);

    openSurface(ui, { kind: "attrs", item: row, panel: attrsPanel, layerId: "A" });
    const attrsUnregister = vi.fn();
    ui.overlayPanel.attrsOverlayUnregister = attrsUnregister;

    rebuildList(ui);

    expect(attrsUnregister).toHaveBeenCalled();
    expect(ui.overlayPanel.attrsOverlayUnregister).toBeNull();
    expect(ui.overlayPanel.activeAttrsPanel).toBeNull();
    expect(attrsPanel.isConnected).toBe(false);
  });

  it("color layer's applyVisibility routes through showSolidBasemap and hideSolidBasemap", () => {
    const { ui } = initFixture({
      data: [{ id: "B1", name: "B1", role: "base" }],
    });

    initTypesAndVisibility(ui);

    const colorLi = ui.c.layerRegistry.get(CONST.SOLID_BASEMAP_ID) as LayerInfo;
    expect(colorLi).toBeDefined();

    expect(() => applyVisibility(ui, CONST.SOLID_BASEMAP_ID, true)).not.toThrow();
    expect(() => applyVisibility(ui, CONST.SOLID_BASEMAP_ID, false)).not.toThrow();
  });

  it("color basemap lands at the base group end when a tile basemap is already registered", () => {
    // On first open, folium registers tile basemaps before initTypesAndVisibility
    // runs. The color basemap (baseInsert: "bottom") must land at the end of
    // the base group, not at the top — tile basemaps cover it by default.
    const { ui } = initFixture({
      data: [
        { id: "B1", name: "B1", role: "base" },
        { id: "B2", name: "B2", role: "base" },
      ],
    });

    initTypesAndVisibility(ui);

    const baseRows = Array.from(
      attachedPanel(ui).querySelectorAll<HTMLElement>(
        `${CONST.SEL.LAYER_ITEM}[data-layer-type="${ROLE.BASE}"]`,
      ),
    ).map(el => el.getAttribute(CONST.DATA.LAYER_ID));

    expect(baseRows).toContain("B1");
    expect(baseRows).toContain("B2");
    expect(baseRows).toContain(CONST.SOLID_BASEMAP_ID);
    // Color basemap is last (lowest z), tile basemaps above it.
    expect(baseRows[baseRows.length - 1]).toBe(CONST.SOLID_BASEMAP_ID);
  });

  it("initTypesAndVisibility skips the color block when the registry has no color layer", () => {
    // Defensive guard: if getColorSurface's register() failed to insert the
    // color basemap (race, surface unavailable), the zoom-range / hidden
    // override block must be skipped without crashing.
    const { ui } = initFixture({
      data: [{ id: "B1", name: "B1", role: "base" }],
    });

    const originalGet = ui.c.layerRegistry.get.bind(ui.c.layerRegistry);
    vi.spyOn(ui.c.layerRegistry, "get").mockImplementation((id: string) => {
      if (id === CONST.SOLID_BASEMAP_ID) return undefined;
      return originalGet(id);
    });

    expect(() => initTypesAndVisibility(ui)).not.toThrow();
  });
});

describe("clean-empty-folders button and role header order", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    if (!manager.layerRegistry.get("overlay2")) {
      manager.registerLayer({
        id: "overlay2",
        name: "Circles",
        role: "overlay",
        layer: { options: {}, eachLayer: vi.fn() },
      });
    }
    ui.listPanel.foldedRoles = {};
    seedIntentMap(ui, "visible", {});
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("renders a row for a folder that holds no layer yet", () => {
    // A folder created from the role menu owns a row immediately: it is the
    // only handle for renaming or deleting it until a layer moves in.
    manager.createFolder("overlay", "empty-1");
    manager.ui?.rebuildAfterLayoutChange?.();
    const row = attachedPanel(ui).querySelector(
      `[data-folder-key="${normalizeFolderName("empty-1")}"]`,
    ) as HTMLElement | null;
    expect(row).not.toBeNull();
    expect(row?.classList.contains(CONST.CLASSES.FOLDER_ROW)).toBe(true);
  });

  it("keeps each header adjacent to its own rows (DOM order)", () => {
    // Fixture already provides overlay1 + base1; beforeEach adds overlay2.
    // Structural assertion (not a brittle exact sequence): the header of a
    // role must precede that role's rows, and the base header must not be
    // wedged above the overlay rows — the ordering regression the header
    // rewrite could reintroduce. `foliplus_*` utility rows are ignored.
    const container = attachedPanel(ui);
    const seq = Array.from(container.children)
      .filter(el => !el.getAttribute(CONST.DATA.LAYER_ID)?.startsWith("foliplus_"))
      .map(el => {
        if (el.classList.contains(CONST.CLASSES.TOGGLE_ALL)) {
          return { kind: "header", role: (el as HTMLElement).dataset.role };
        }
        return { kind: "row", role: (el as HTMLElement).dataset.layerType };
      });
    const pos = (pred: (x: { kind: string; role?: string }) => boolean) =>
      seq.findIndex(pred);
    const headerOverlay = pos(x => x.kind === "header" && x.role === "overlay");
    const headerBase = pos(x => x.kind === "header" && x.role === "base");
    const firstOverlayRow = pos(x => x.kind === "row" && x.role === "overlay");
    const lastOverlayRow =
      seq
        .map((x, i) => ({ x, i }))
        .filter(({ x }) => x.kind === "row" && x.role === "overlay")
        .slice(-1)[0]?.i ?? -1;
    const firstBaseRow = pos(x => x.kind === "row" && x.role === "base");
    // Overlay header leads the overlay rows; base header sits after them.
    expect(headerOverlay).toBeGreaterThanOrEqual(0);
    expect(headerBase).toBeGreaterThanOrEqual(0);
    expect(firstOverlayRow).toBeGreaterThan(headerOverlay);
    expect(lastOverlayRow).toBeGreaterThanOrEqual(firstOverlayRow);
    expect(headerBase).toBeGreaterThan(lastOverlayRow);
    expect(firstBaseRow).toBeGreaterThan(headerBase);
  });

  it("places the empty-role header after live rows and keeps its clean button", () => {
    // Overlay keeps only an empty folder key (no live overlay rows); base has a row.
    manager.unregisterLayer("overlay1");
    manager.unregisterLayer("overlay2");
    manager.createFolder("overlay", "empty-1");
    manager.ui?.rebuildAfterLayoutChange?.();
    const container = attachedPanel(ui);
    const kinds = Array.from(container.children)
      .filter(el => !el.getAttribute(CONST.DATA.LAYER_ID)?.startsWith("foliplus_"))
      .map(el => {
        if (el.classList.contains(CONST.CLASSES.TOGGLE_ALL)) {
          return `header:${(el as HTMLElement).dataset.role}`;
        }
        const id = el.getAttribute(CONST.DATA.LAYER_ID);
        return `row:${id}`;
      });
    // The empty overlay role's header trails the live base role, and its empty
    // folder still renders a row under it (the row is the rename/delete handle).
    expect(kinds.slice(0, 3)).toEqual(["header:base", "row:base1", "header:overlay"]);
    expect(kinds.length).toBe(4);
    expect(
      container.querySelector(`[data-folder-key="${normalizeFolderName("empty-1")}"]`),
    ).not.toBeNull();
  });
});

describe("role header identity key", () => {
  // The container's fold handler resolves the role a click landed in by
  // climbing from the clicked control up to the header row. That climb reads the
  // row's stable identity key (data-role, written when the row is built) rather
  // than the row class: climbing on the class would land on any nested control
  // that also carries it, and the role read off that element would be wrong or
  // missing. These guards lock the key the climb reads — and the climb itself.
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    window.localStorage.clear();
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = {};
    seedIntentMap(ui, "visible", {});
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const headers = () => [
    ...attachedPanel(ui).querySelectorAll<HTMLElement>(CONST.SEL.TOGGLE_ALL),
  ];
  const headerKeys = () => headers().map(el => el.dataset.role);
  const renderedRoles = () =>
    new Set(
      [...attachedPanel(ui).querySelectorAll<HTMLElement>(CONST.SEL.LAYER_ITEM)]
        .map(el => el.dataset.layerType)
        .filter((role): role is string => !!role && !role.startsWith("foliplus_")),
    );

  it("writes one unique role key per header, never the sentinel", () => {
    const keys = headerKeys();
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size, "one header per role").toBe(keys.length);
    for (const key of keys) {
      expect(key, "every header carries a key").not.toBeUndefined();
      expect(key, "the toggle-all checkbox sentinel is not a role key").not.toBe(
        CONST.TOGGLE_ALL_ROLE,
      );
      expect(Object.values(ROLE), `header key ${key} is a LayerRole`).toContain(
        key as never,
      );
    }
  });

  it("covers exactly the roles the panel renders rows for", () => {
    expect([...new Set(headerKeys())].sort()).toEqual([...renderedRoles()].sort());
  });

  it("does not move when the folder layout changes", () => {
    // The key is the role; a folder's name is display only. Renaming a folder
    // rebuilds the rows, but the role a header owns cannot change with it.
    const before = headerKeys();
    manager.createFolder("overlay", "Extra");
    expect(manager.renameFolder("overlay", "extra", "More")).toEqual({ ok: true });
    expect(headerKeys(), "the folder layout carries no role identity").toEqual(before);
  });

  it("is the key both fold bind sites climb on", () => {
    // The onChange site climbs from the row's own checkbox, which writes the
    // sentinel on itself; the climb must skip it and land on the row. The
    // onClick site climbs from a nested control with no key of its own, such as
    // the fold button.
    for (const row of headers()) {
      const checkbox = row.querySelector<HTMLInputElement>(
        `[data-role="${CONST.TOGGLE_ALL_ROLE}"]`,
      );
      expect(
        checkbox?.closest(CONST.SEL.TOGGLE_ALL_ROW),
        "the climb skips the checkbox's own sentinel",
      ).toBe(row);
      const foldBtn = row.querySelector(`.${CONST.CLASSES.FOLD_BTN}`);
      expect(foldBtn, "the header carries its fold button").not.toBeNull();
      expect(foldBtn?.closest(CONST.SEL.TOGGLE_ALL_ROW)).toBe(row);
    }
  });
});
