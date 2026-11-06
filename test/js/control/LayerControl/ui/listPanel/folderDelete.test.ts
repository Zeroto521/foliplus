import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#control/LayerControl/const.js";
import type { LayerController } from "#control/LayerControl/controller.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";
import { seedIntentMap } from "#control/LayerControl/ui/intent.js";
import { attachedPanel, findItem, initFixture } from "../fixture.js";

// The inline "delete folder" menu entry and the section
// header's "clean empty folders" button, plus the DOM ordering the header
// rewrite must preserve: the header stays adjacent to its rows.
describe("folder delete wiring", () => {
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
    ui.listPanel.foldedRoles = new Set();
    seedIntentMap(ui, "visible", {});
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const registerLayer = (id: string, name: string, role: string, folder?: string) => {
    manager.registerLayer({
      id,
      name,
      role: role as "overlay" | "base",
      ...(folder ? { folder } : {}),
      layer: { options: {}, eachLayer: vi.fn() },
    } as any);
  };

  const actionsFor = (item: HTMLElement) =>
    Array.from(item.querySelectorAll(".foliplus-layer-more-menu button")).map(
      b => (b as HTMLElement).dataset.action,
    );

  it("renders the delete-folder entry last for a row whose layer has a folder", () => {
    registerLayer("folder1", "Roads", "overlay", "My Folder");
    const item = findItem(ui, "folder1");
    ui.openMoreMenu(item);
    const actions = actionsFor(item);
    expect(actions).toContain(CONST.ACTION.DELETE_FOLDER);
    // The folder entry sits before the destructive delete-layer divider.
    expect(actions.indexOf(CONST.ACTION.DELETE_FOLDER)).toBeLessThan(
      actions.indexOf(CONST.ACTION.DELETE_LAYER),
    );
  });

  it("does not render the delete-folder entry for a root layer", () => {
    const item = findItem(ui, "overlay1");
    ui.openMoreMenu(item);
    expect(actionsFor(item)).not.toContain(CONST.ACTION.DELETE_FOLDER);
  });

  it("runs cleanEmptyFolders when the section header clean button is clicked", () => {
    manager.folderOrder = { version: 1, sections: { overlay: ["empty-1"] } };
    manager.ui?.reindexAfterMove?.();
    const cleanBtn = attachedPanel(ui).querySelector(
      `.${CONST.CLASSES.CLEAN_FOLDERS_BTN}[data-role="overlay"]`,
    ) as HTMLElement | null;
    expect(cleanBtn).not.toBeNull();
    const spy = vi.spyOn(manager, "cleanEmptyFolders");
    cleanBtn?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(spy).toHaveBeenCalledWith("overlay");
  });

  it("does not call cleanEmptyFolders for a clean button without data-role (defensive)", () => {
    manager.folderOrder = { version: 1, sections: { overlay: ["empty-1"] } };
    manager.ui?.reindexAfterMove?.();
    const spy = vi.spyOn(manager, "cleanEmptyFolders");
    // A hand-built clean button with no data-role (the renderer always writes
    // it, but the handler must not assume) — the click must not throw and must
    // not dispatch a cleanup for an unknown role.
    const btn = document.createElement("button");
    btn.className = CONST.CLASSES.CLEAN_FOLDERS_BTN;
    attachedPanel(ui).appendChild(btn);
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(spy).not.toHaveBeenCalled();
  });
  it("hides the clean button once the section has no empty folder key", () => {
    manager.folderOrder = { version: 1, sections: { overlay: [] } };
    manager.ui?.reindexAfterMove?.();
    const cleanBtn = attachedPanel(ui).querySelector(
      `.${CONST.CLASSES.CLEAN_FOLDERS_BTN}[data-role="overlay"]`,
    ) as HTMLElement | null;
    expect(cleanBtn).toBeNull();
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

  it("places the empty-section header after live rows and keeps its clean button", () => {
    // Overlay keeps only an empty folder key (no live overlay rows); base has a row.
    manager.unregisterLayer("overlay1");
    manager.unregisterLayer("overlay2");
    manager.folderOrder = { version: 1, sections: { overlay: ["empty-1"] } };
    manager.ui?.reindexAfterMove?.();
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
    // The empty overlay section's header trails the live base section.
    expect(kinds).toEqual(["header:base", "row:base1", "header:overlay"]);
    const cleanBtn = container.querySelector(
      `.${CONST.CLASSES.CLEAN_FOLDERS_BTN}[data-role="overlay"]`,
    ) as HTMLElement | null;
    expect(cleanBtn).not.toBeNull();
  });

  it("shows the clean button incrementally after the folder's last member is deleted (no rebuild)", () => {
    // Register a folder layer, then delete it. The delete freezes the folder
    // key, and LAYER_ROLE_COUNT_CHANGED → syncCleanButton must render the
    // clean button WITHOUT a full rebuild (reindexAfterMove is not called).
    registerLayer("folder1", "Roads", "overlay", "My Folder");
    expect(manager.deleteLayer("folder1")).toBe(true);
    const cleanBtn = attachedPanel(ui).querySelector(
      `.${CONST.CLASSES.CLEAN_FOLDERS_BTN}[data-role="overlay"]`,
    ) as HTMLElement | null;
    expect(cleanBtn).not.toBeNull();
  });

  it("removes the clean button when a layer rejoins the emptied folder (incremental)", () => {
    // Freeze an empty folder key, then re-register a member under the same
    // folder. LAYER_ROLE_COUNT_CHANGED → syncCleanButton must hide the button
    // without a full rebuild.
    manager.folderOrder = { version: 1, sections: { overlay: ["my folder"] } };
    manager.ui?.reindexAfterMove?.();
    expect(
      attachedPanel(ui).querySelector(
        `.${CONST.CLASSES.CLEAN_FOLDERS_BTN}[data-role="overlay"]`,
      ),
    ).not.toBeNull();
    registerLayer("folder1", "Roads", "overlay", "My Folder");
    expect(
      attachedPanel(ui).querySelector(
        `.${CONST.CLASSES.CLEAN_FOLDERS_BTN}[data-role="overlay"]`,
      ),
    ).toBeNull();
  });

  it("updates the clean button count in place without stacking a second button (incremental)", () => {
    // Seed two empty folder keys directly (no live members) and rebuild.
    manager.folderOrder = {
      version: 1,
      sections: { overlay: ["folder a", "folder b"] },
    };
    manager.ui?.reindexAfterMove?.();
    const before = attachedPanel(ui).querySelectorAll(
      `.${CONST.CLASSES.CLEAN_FOLDERS_BTN}[data-role="overlay"]`,
    );
    expect(before.length).toBe(1);
    expect((before[0] as HTMLElement).dataset.emptyCount).toBe("2");
    // Re-register a member into the first folder: its key stops being empty,
    // the event fires, and syncCleanButton must refresh the ONE existing
    // button's label/count to 1 — never appending a second button.
    registerLayer("folder1", "Roads", "overlay", "Folder A");
    const after = attachedPanel(ui).querySelectorAll(
      `.${CONST.CLASSES.CLEAN_FOLDERS_BTN}[data-role="overlay"]`,
    );
    expect(after.length).toBe(1);
    expect((after[0] as HTMLElement).dataset.emptyCount).toBe("1");
  });
});
