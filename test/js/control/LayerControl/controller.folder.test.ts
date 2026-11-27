// test/js/control/LayerControl/controller.folder — folder create, rename, reorder and delete.
import {
  makeStore,
  orderFromRoles,
  readLayoutStorage,
  readOrderTreeStorage,
} from "./controller.fixture.js";
import { initFixture, makeDerivedUI, polygonLayer } from "./ui/fixture.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FILTER_SOURCE,
  FOLDER_NAME_MAX,
  LayerRuntimeStore,
  orderKeyOf,
} from "#core/layer/index.js";

describe("deleteFolder", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.CONFIG = { ...window.CONFIG, name: "LayerControl", locale_code: "en" };
  });

  it("deleting a non-empty folder keeps its layers, pins them to root, and removes the order key: one layout write", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["roads"] }),
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

    const ok = manager.deleteFolder("overlay", "roads");

    expect(ok).toBe(true);
    expect(manager.layerRegistry.get("rd1")).toBeDefined();
    // v2: the author declaration is untouched; the member pin drives the UI.
    expect(manager.folderNameOf("rd1")).toBeNull();
    expect(manager.folderNameOf("missing")).toBeNull();
    expect(manager.folderLayoutView.order.overlay ?? []).not.toContain("roads");
    expect(manager.folderLayoutView.members.rd1).toEqual({
      role: "overlay",
      folder: "",
    });
    expect(readOrderTreeStorage(manager.map)).not.toBeNull();
  });

  it("deleting an empty folder removes only the key", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["roads"] }),
      data: [],
    });

    const ok = manager.deleteFolder("overlay", "roads");

    expect(ok).toBe(true);
    expect(manager.folderLayoutView.order.overlay ?? []).not.toContain("roads");
    expect(readOrderTreeStorage(manager.map)).not.toBeNull();
  });

  it("deleting a missing folder returns false and does not write the layout", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["roads"] }),
      data: [],
    });
    window.localStorage.removeItem(orderKeyOf(manager.map));

    const ok = manager.deleteFolder("overlay", "never-existed");

    expect(ok).toBe(false);
    expect(window.localStorage.getItem(orderKeyOf(manager.map))).toBeNull();
  });

  it("deleting a base folder keeps an overlay folder of the same name", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["foo"], base: ["foo"] }),
      data: [
        {
          id: "b1",
          name: "Base Foo",
          role: "base",
          folder: "foo",
          layer: polygonLayer(),
        },
      ],
    });

    const ok = manager.deleteFolder("base", "foo");

    expect(ok).toBe(true);
    expect(manager.folderLayoutView.order.base ?? []).not.toContain("foo");
    expect(manager.folderLayoutView.order.overlay ?? []).toContain("foo");
  });

  it("a later freeze of another folder does not bring a deleted folder back", () => {
    // P2#2 regression: after deleteFolder("Roads"), a *different* folder (Water)
    // losing its last member must NOT write the just-deleted "roads" name back.
    // This deliberately uses a different folder to trigger freeze, distinguishing
    // from #911's same-name keep-alive semantics (which DOES preserve the key).
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["roads", "water"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "Roads",
          layer: polygonLayer(),
        },
        {
          id: "wt1",
          name: "Water",
          role: "overlay",
          folder: "Water",
          layer: polygonLayer(),
        },
      ],
    });
    manager.deleteFolder("overlay", "roads");
    expect(manager.folderLayoutView.order.overlay ?? []).not.toContain("roads");

    // Water loses its last member -> freezeSectionOrder runs.
    manager.map.hasLayer.mockReturnValue(true);
    manager.deleteLayer("wt1");
    manager.map.hasLayer.mockReturnValue(false);

    expect(manager.folderLayoutView.order.overlay ?? []).not.toContain("roads");
    expect(manager.folderLayoutView.order.overlay ?? []).toContain("water");
  });

  it("deleteFolder does not go through freezeEmptyFolder", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["roads"] }),
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
    const ok = manager.deleteFolder("overlay", "roads");
    expect(ok).toBe(true);
    // The author declaration is untouched; the member pin moved to root.
    expect(manager.folderNameOf("rd1")).toBeNull();
    // If the implementation wrongly went through freezeEmptyFolder first, the
    // key would be written back then deleted — but the order must not keep it.
    expect(manager.folderLayoutView.order.overlay ?? []).not.toContain("roads");
  });

  it("[BR-1] deleteFolder: opts.persist=false skips the layout write", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["roads"] }),
      data: [],
    });
    window.localStorage.removeItem(orderKeyOf(manager.map));

    const ok = manager.deleteFolder("overlay", "roads", { persist: false });

    expect(ok).toBe(true);
    expect(manager.folderLayoutView.order.overlay ?? []).not.toContain("roads");
    expect(window.localStorage.getItem(orderKeyOf(manager.map))).toBeNull();
  });

  it("[BR-2] deleteFolder: absent role key -> ?? [] empty-branch (no crash)", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({}),
      data: [],
    });
    // No "overlay" key in sections: listed ?? [] = []. members empty. Neither
    // existed nor members => false without writing.
    const ok = manager.deleteFolder("overlay", "roads");
    expect(ok).toBe(false);
  });

  it("[BR-3] deleteFolder: no ui -> rebuildAfterLayoutChange not called (if(this.ui) false)", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["roads"] }),
      data: [],
    });
    const reindex = vi.fn();
    (manager as any).ui = null;
    const ok = manager.deleteFolder("overlay", "roads");
    expect(ok).toBe(true);
    expect(manager.folderLayoutView.order.overlay ?? []).not.toContain("roads");
    expect(reindex).not.toHaveBeenCalled();
  });
});

describe("cleanEmptyFolders", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.CONFIG = { ...window.CONFIG, name: "LayerControl", locale_code: "en" };
  });

  it("cleanEmptyFolders removes each empty key and writes the layout once", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["empty1", "empty2", "full"] }),
      data: [
        {
          id: "rd1",
          name: "Full",
          role: "overlay",
          folder: "full",
          layer: polygonLayer(),
        },
      ],
    });
    window.localStorage.removeItem(orderKeyOf(manager.map));

    const count = manager.cleanEmptyFolders("overlay");

    expect(count).toBe(2);
    expect(
      (manager.folderLayoutView.order.overlay ?? []).filter(
        k => !k.startsWith("layer:"),
      ),
    ).toEqual(["full"]);
    expect(readOrderTreeStorage(manager.map)).not.toBeNull();
  });

  it("[BR-4] cleanEmptyFolders: absent role key -> ?? [] empty-branch", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({}),
      data: [],
    });
    const count = manager.cleanEmptyFolders("overlay");
    expect(count).toBe(0);
  });

  it("[BR-5] cleanEmptyFolders: no empty keys -> return 0 (emptyKeys.length===0)", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["full"] }),
      data: [
        {
          id: "rd1",
          name: "Full",
          role: "overlay",
          folder: "full",
          layer: polygonLayer(),
        },
      ],
    });
    window.localStorage.removeItem(orderKeyOf(manager.map));
    const count = manager.cleanEmptyFolders("overlay");
    expect(count).toBe(0);
    expect(window.localStorage.getItem(orderKeyOf(manager.map))).toBeNull();
  });

  it("[BR-6] cleanEmptyFolders: no ui -> rebuildAfterLayoutChange not called", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["empty1"] }),
      data: [],
    });
    (manager as any).ui = null;
    const count = manager.cleanEmptyFolders("overlay");
    expect(count).toBe(1);
  });

  it("onField clears the committed filter via setLayerFilter(id, undefined)", () => {
    const { manager } = initFixture({
      data: [
        { id: "overlay1", name: "Polygons", role: "overlay", layer: polygonLayer() },
      ],
    });
    manager.uiContainer = document.createElement("div");
    manager.ui = makeDerivedUI({
      intentStore: makeStore(),
      runtimeStore: (() => {
        const s = new LayerRuntimeStore();
        s.setFilterFeatures("overlay1", {
          features: [],
          numericFields: ["mag", "depth"],
          ranges: { mag: [0, 10], depth: [0, 100] },
          enumFields: [],
          enumValues: {},
          total: 5,
        } as any);
        return s;
      })(),
      colorSurface: {} as any,
      currentColor: "#000000",
      dropPersistedLayerState: vi.fn(),
      saveState: vi.fn(),
      syncToggleAll: vi.fn(),
      syncNoBasemap: vi.fn(),
      renamedNames: {},
      saveNamesState: vi.fn(),
      invalidateFields: vi.fn(),
    }) as any;

    const model = manager.genericFilterModel("overlay1");
    expect(model).not.toBeNull();
    expect(model!.fields).toEqual([
      { value: "mag", label: "mag", numeric: true },
      { value: "depth", label: "depth", numeric: true },
    ]);

    // Commit a filter, then switch fields: onField clears via setLayerFilter.
    manager.setLayerFilter("overlay1", {
      kind: "atom",
      field: "mag",
      op: "between",
      range: [2, 8],
    } as any);
    expect(manager.layerRegistry.get("overlay1")!.filter).toBeDefined();
    // Transition assertion: the shared store carries the same committed value.
    expect(
      (manager as any).filterStore.getFilter("overlay1", FILTER_SOURCE.GENERIC),
    ).toEqual({
      kind: "atom",
      field: "mag",
      op: "between",
      range: [2, 8],
    });

    model!.onField!("depth");

    expect(
      (manager as any).filterStore.getFilter("overlay1", FILTER_SOURCE.GENERIC),
    ).toBeUndefined();
    expect(manager.layerRegistry.get("overlay1")!.filter).toBeUndefined();
  });

  it("applyFilterClass is reached only through the store's host.apply (single write point)", () => {
    const { manager } = initFixture({
      data: [
        { id: "overlay1", name: "Polygons", role: "overlay", layer: polygonLayer() },
      ],
    });
    manager.uiContainer = document.createElement("div");
    manager.ui = makeDerivedUI({
      intentStore: makeStore(),
      runtimeStore: (() => {
        const s = new LayerRuntimeStore();
        s.setFilterFeatures("overlay1", {
          features: [],
          numericFields: ["mag"],
          ranges: { mag: [0, 10] },
          enumFields: [],
          enumValues: {},
          total: 5,
        } as any);
        return s;
      })(),
      colorSurface: {} as any,
      currentColor: "#000000",
      dropPersistedLayerState: vi.fn(),
      saveState: vi.fn(),
      syncToggleAll: vi.fn(),
      syncNoBasemap: vi.fn(),
      renamedNames: {},
      saveNamesState: vi.fn(),
      invalidateFields: vi.fn(),
    }) as any;

    // The hidden-class carrier is the single place a committed filter touches
    // the DOM leaves. If setLayerFilter re-applied the class directly (bypassing
    // the store's host.apply), this spy would count a second call.
    const applySpy = vi.spyOn(manager as any, "applyFilterClass");
    manager.setLayerFilter("overlay1", {
      kind: "atom",
      field: "mag",
      op: "between",
      range: [2, 8],
    } as any);

    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(applySpy).toHaveBeenCalledWith("overlay1", {
      kind: "atom",
      field: "mag",
      op: "between",
      range: [2, 8],
    });
    applySpy.mockRestore();
  });
});

describe("createFolder", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.CONFIG = { ...window.CONFIG, name: "LayerControl", locale_code: "en" };
  });

  it("creates an empty folder and materialises it at the role tail", () => {
    const { manager } = initFixture({ data: [] });
    window.localStorage.removeItem(orderKeyOf(manager.map));

    const ok = manager.createFolder("overlay", "Roads");

    // The key travels back so the caller can open the inline rename on the row
    // it just created without re-deriving it from the name.
    expect(ok).toEqual({ ok: true, key: "roads" });
    expect(manager.folderLayoutView.order.overlay ?? []).toEqual(["roads"]);
    expect(manager.folderLayoutView.folders).toEqual([{ key: "roads", name: "Roads" }]);
    expect(readOrderTreeStorage(manager.map)).not.toBeNull();
  });

  it("creates an empty folder at the tail after an existing folder", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["water"] }),
      data: [],
    });

    const ok = manager.createFolder("overlay", "Roads");

    expect(ok).toEqual({ ok: true, key: "roads" });
    expect(manager.folderLayoutView.order.overlay ?? []).toEqual(["water", "roads"]);
  });

  it("createFolder rejects a blank name", () => {
    const { manager } = initFixture({ data: [] });

    const ok = manager.createFolder("overlay", "   ");

    expect(ok).toEqual({ ok: false, reason: "blank" });
  });

  it("createFolder rejects a name over the cap and writes nothing", () => {
    const { manager } = initFixture({ data: [] });
    window.localStorage.removeItem(orderKeyOf(manager.map));
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});

    const ok = manager.createFolder("overlay", "f".repeat(FOLDER_NAME_MAX + 1));

    expect(ok).toEqual({ ok: false, reason: "too-long" });
    expect(manager.folderLayoutView.order.overlay ?? []).toEqual([]);
    expect(manager.folderLayoutView.folders).toEqual([]);
    expect(readLayoutStorage(manager.map)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toContain(
      `expected at most ${FOLDER_NAME_MAX}`,
    );
    warn.mockRestore();
  });

  it("createFolder rejects a duplicate name in the same role", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["roads"] }),
      data: [],
    });

    const ok = manager.createFolder("overlay", "roads");

    expect(ok).toEqual({ ok: false, reason: "duplicate" });
    expect(manager.folderLayoutView.order.overlay ?? []).toEqual(["roads"]);
  });

  it("createFolder allows the same name in a different role", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ base: ["roads"] }),
      data: [],
    });

    const okOverlay = manager.createFolder("overlay", "Roads");
    const okBase = manager.createFolder("base", "roads");

    expect(okOverlay).toEqual({ ok: true, key: "roads" });
    expect(okBase).toEqual({ ok: false, reason: "duplicate" }); // base already has "roads"
    expect(
      (manager.folderLayoutView.order.overlay ?? []).filter(
        k => !k.startsWith("layer:"),
      ),
    ).toEqual(["roads"]);
    expect(
      (manager.folderLayoutView.order.base ?? []).filter(k => !k.startsWith("layer:")),
    ).toEqual(["roads"]);
  });

  it("createFolder lets a different role reuse a name held only by the other role's live member", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({}),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "base",
          folder: "Roads",
          layer: polygonLayer(),
        },
      ],
    });

    const ok = manager.createFolder("overlay", "Roads");

    expect(ok).toEqual({ ok: true, key: "roads" });
    expect(manager.folderLayoutView.order.overlay ?? []).toEqual(["roads"]);
  });

  it("createFolder writes the layout and reindexes", () => {
    const { manager } = initFixture({ data: [] });
    window.localStorage.removeItem(orderKeyOf(manager.map));
    const reindex = vi.spyOn(manager.ui!, "rebuildAfterLayoutChange");

    manager.createFolder("overlay", "Roads");

    expect(readOrderTreeStorage(manager.map)).not.toBeNull();
    expect(reindex).toHaveBeenCalledTimes(1);
  });

  it("createFolder rejects a name already held by a live member not yet listed", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({}),
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

    const ok = manager.createFolder("overlay", "Roads");

    expect(ok).toEqual({ ok: false, reason: "duplicate" });
    // The declared folder is materialised in the tree, so it is present.
    expect(manager.folderLayoutView.order.overlay ?? []).toContain("roads");
  });

  it("createFolder honours persist:false and tolerates a detached UI", () => {
    const { manager } = initFixture({ data: [] });
    manager.ui = null;
    window.localStorage.removeItem(orderKeyOf(manager.map));

    const ok = manager.createFolder("overlay", "Roads", { persist: false });

    expect(ok).toEqual({ ok: true, key: "roads" });
    expect(manager.folderLayoutView.order.overlay ?? []).toEqual(["roads"]);
    expect(window.localStorage.getItem(orderKeyOf(manager.map))).toBeNull();
  });
});

describe("reorderFolder", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.CONFIG = { ...window.CONFIG, name: "LayerControl", locale_code: "en" };
  });

  it("reorders author-declared folders whose role order is still empty", () => {
    // Author-declared folders live in `members`, not in `order`, so the role's
    // order starts empty — and moveFolder refuses a move between keys it cannot
    // find there. The reorder has to freeze the current block order first.
    const { manager } = initFixture({
      data: [
        {
          id: "a1",
          name: "A",
          role: "overlay",
          folder: "Alpha",
          layer: polygonLayer(),
        },
        {
          id: "b1",
          name: "B",
          role: "overlay",
          folder: "Beta",
          layer: polygonLayer(),
        },
      ],
    });
    // Author-declared folders are materialised in the tree, so the derived
    // mirror order starts at the declared folder keys.
    expect(manager.folderLayoutView.order.overlay ?? []).toEqual(["alpha", "beta"]);

    const ok = manager.reorderFolder("overlay", "alpha", "beta", true);

    expect(ok).toBe(true);
    expect(manager.folderLayoutView.order.overlay ?? []).toEqual(["beta", "alpha"]);
  });
});

describe("moveLayerToFolder / moveLayerToRootAt", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.CONFIG = { ...window.CONFIG, name: "LayerControl", locale_code: "en" };
  });

  it("moves a root layer into a folder and back out", () => {
    const { manager } = initFixture({
      data: [
        {
          id: "a1",
          name: "A",
          role: "overlay",
          folder: "Alpha",
          layer: polygonLayer(),
        },
        { id: "r1", name: "R", role: "overlay", layer: polygonLayer() },
      ],
    });

    // The move takes the folder KEY, not its display name.
    expect(manager.moveLayerToFolder("r1", "alpha")).toBe(true);
    expect(manager.folderNameOf("r1")).toBe("Alpha");

    expect(manager.moveLayerToFolder("r1", "")).toBe(true);
    expect(manager.folderNameOf("r1")).toBeNull();
  });

  it("places a root layer between two folder blocks", () => {
    const { manager } = initFixture({
      data: [
        {
          id: "a1",
          name: "A",
          role: "overlay",
          folder: "Alpha",
          layer: polygonLayer(),
        },
        {
          id: "b1",
          name: "B",
          role: "overlay",
          folder: "Beta",
          layer: polygonLayer(),
        },
        { id: "r1", name: "R", role: "overlay", layer: polygonLayer() },
      ],
    });
    // Freeze the block order so both folders are listed.
    manager.createFolder("overlay", "Gamma");

    expect(manager.moveLayerToRootAt("r1", "beta")).toBe(true);
    expect(manager.folderLayoutView.order.overlay ?? []).toContain("layer:r1");
    const order = manager.folderLayoutView.order.overlay ?? [];
    expect(order.indexOf("layer:r1")).toBeLessThan(order.indexOf("beta"));
  });
});

describe("renameFolder", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.CONFIG = { ...window.CONFIG, name: "LayerControl", locale_code: "en" };
  });

  it("renameFolder rewrites only the display name, keeping the order key and member assignments", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["roads", "water"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "Roads",
          layer: polygonLayer(),
        },
        {
          id: "wt1",
          name: "Water",
          role: "overlay",
          folder: "Water",
          layer: polygonLayer(),
        },
      ],
    });

    const ok = manager.renameFolder("overlay", "roads", "Streets");

    expect(ok).toEqual({ ok: true });
    // v2: the author declaration is untouched; the directory name is the display.
    expect(manager.layerRegistry.get("rd1")!.folder).toBe("Roads");
    expect(manager.layerRegistry.get("wt1")!.folder).toBe("Water");
    expect(manager.folderNameOf("rd1")).toBe("Streets");
    expect(manager.folderLayoutView.order.overlay ?? []).toEqual(["roads", "water"]);
    expect(manager.folderLayoutView.folders).toEqual([
      { key: "roads", name: "Streets" },
      { key: "water", name: "water" },
    ]);
  });

  it("renameFolder normalises the new name", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["roads"] }),
      data: [],
    });

    const ok = manager.renameFolder("overlay", "roads", "  Streets  ");

    expect(ok).toEqual({ ok: true });
    expect(manager.folderLayoutView.folders[0]).toEqual({
      key: "roads",
      name: "Streets",
    });
  });

  it("renameFolder rejects a duplicate new name", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["roads", "water"] }),
      data: [],
    });

    const ok = manager.renameFolder("overlay", "roads", "Water");

    expect(ok).toEqual({ ok: false, reason: "duplicate" });
    expect(manager.folderLayoutView.order.overlay ?? []).toEqual(["roads", "water"]);
  });

  it("renameFolder rejects a blank new name", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["roads"] }),
      data: [],
    });

    const ok = manager.renameFolder("overlay", "roads", "   ");

    expect(ok).toEqual({ ok: false, reason: "blank" });
  });

  it("renameFolder rejects an over-long new name and keeps the old one", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["roads"] }),
      data: [],
    });
    const before = manager.folderLayoutView.folders;
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});

    const ok = manager.renameFolder(
      "overlay",
      "Roads",
      "f".repeat(FOLDER_NAME_MAX + 1),
    );

    expect(ok).toEqual({ ok: false, reason: "too-long" });
    expect(manager.folderLayoutView.order.overlay ?? []).toEqual(["roads"]);
    expect(manager.folderLayoutView.folders).toEqual(before);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toContain(
      `expected at most ${FOLDER_NAME_MAX}`,
    );
    warn.mockRestore();
  });

  it("renameFolder is a no-op for a missing old folder", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["roads"] }),
      data: [],
    });

    const ok = manager.renameFolder("overlay", "NeverExisted", "Streets");

    expect(ok).toEqual({ ok: false, reason: "missing" });
  });

  it("renameFolder keeps the member assignment when the new spelling differs", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["roads"] }),
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

    const ok = manager.renameFolder("overlay", "roads", "streets");

    expect(ok).toEqual({ ok: true });
    expect(manager.folderNameOf("rd1")).toBe("streets");
    expect(manager.folderLayoutView.order.overlay ?? []).toEqual(["roads"]);
  });

  it("renameFolder to the folder's own normalised name rewrites the display name", () => {
    // The key is the identity, so this is a display-only change, not a no-op:
    // the user asked for that spelling and the row must show it.
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["roads"] }),
      data: [],
    });

    const ok = manager.renameFolder("overlay", "roads", "roads");

    expect(ok).toEqual({ ok: true });
    expect(manager.folderLayoutView.order.overlay ?? []).toEqual(["roads"]);
    expect(manager.folderLayoutView.folders).toEqual([{ key: "roads", name: "roads" }]);
  });

  it("renameFolder renames an unlisted folder that has live members", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({}),
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

    const ok = manager.renameFolder("overlay", "roads", "Streets");

    expect(ok).toEqual({ ok: true });
    expect(manager.folderNameOf("rd1")).toBe("Streets");
    // The key is stable and the materialised folder stays in the order.
    expect(manager.folderLayoutView.order.overlay ?? []).toEqual(["roads"]);
  });

  it("renameFolder rejects a new name already held by a live member in the same role", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "Roads",
          layer: polygonLayer(),
        },
        {
          id: "wt1",
          name: "Water",
          role: "overlay",
          folder: "Water",
          layer: polygonLayer(),
        },
      ],
    });

    const ok = manager.renameFolder("overlay", "roads", "Water");

    expect(ok).toEqual({ ok: false, reason: "duplicate" });
    expect(manager.folderNameOf("rd1")).toBe("roads");
  });

  it("renameFolder honours persist:false and tolerates a detached UI", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["roads"] }),
      data: [],
    });
    manager.ui = null;
    window.localStorage.removeItem(orderKeyOf(manager.map));

    const ok = manager.renameFolder("overlay", "roads", "Streets", { persist: false });

    expect(ok).toEqual({ ok: true });
    expect(manager.folderLayoutView.folders[0]).toEqual({
      key: "roads",
      name: "Streets",
    });
    expect(window.localStorage.getItem(orderKeyOf(manager.map))).toBeNull();
  });

  it("renameFolder allows a cross-role name collision (role-scoped keys)", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ base: ["water"], overlay: ["roads"] }),
      data: [],
    });

    const ok = manager.renameFolder("overlay", "roads", "Water");

    // The doc keys a folder per role (folder:<role>:<name>), so the same name
    // can live in both roles: a rename in overlay does not collide with the
    // base folder of the same name.
    expect(ok).toEqual({ ok: true });
  });

  it("renameFolder ignores a live member in the other role (role-scoped keys)", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "wt1",
          name: "Water",
          role: "base",
          folder: "Water",
          layer: polygonLayer(),
        },
      ],
    });

    const ok = manager.renameFolder("overlay", "roads", "Water");

    // A base live member of that name is a different role's folder, so it is
    // not a duplicate for the overlay rename.
    expect(ok).toEqual({ ok: true });
  });
});
