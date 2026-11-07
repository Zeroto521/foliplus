// vitest — core/layer/folderStore invariants (design layer-folder-design.md DM 规则).
//
// Pure-domain tests: no registry, no controller, no DOM. The store is driven
// against synthetic LayerInfo shapes (it reads `id`, `role`, `folder` only).
import { describe, expect, it } from "vitest";
import { FolderStore, authorFolderId, hash64 } from "#core/layer/folderStore.js";
import type { LayerInfo } from "#core/layer/type.js";

/** Minimal LayerInfo shape — FolderStore.reconcile reads `id`, `role`,
 *  `folder`. */
function li(id: string, role: "base" | "overlay", folder?: string): LayerInfo {
  return { id, role, folder: folder ?? null } as LayerInfo;
}

describe("hash64", () => {
  it("is deterministic and 16-lowercase-hex", () => {
    const a = hash64("hello");
    expect(a).toBe(hash64("hello"));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("differs for different inputs", () => {
    expect(hash64("a")).not.toBe(hash64("b"));
    expect(hash64("")).not.toBe(hash64(" "));
  });
});

describe("authorFolderId", () => {
  it("is stable: same (role, name) always yields the same id", () => {
    const id = authorFolderId("overlay", "Roads");
    expect(authorFolderId("overlay", "Roads")).toBe(id);
  });

  it("collapses casefold + whitespace-fold + trim into one folder", () => {
    const a = authorFolderId("overlay", "Roads");
    expect(authorFolderId("overlay", "roads")).toBe(a);
    expect(authorFolderId("overlay", "  roads ")).toBe(a);
  });

  it("embeds the role: the same name in two roles is two folders", () => {
    expect(authorFolderId("overlay", "Basemap")).not.toBe(
      authorFolderId("base", "Basemap"),
    );
  });

  it("has the author-folder prefix and a 16-hex digest", () => {
    expect(authorFolderId("overlay", "Roads")).toMatch(/^author-folder:[0-9a-f]{16}$/);
  });
});

describe("FolderStore.reconcile", () => {
  it("derives author folders from entries and places their members", () => {
    const store = new FolderStore();
    store.reconcile([
      li("a", "overlay", "Roads"),
      li("b", "overlay", "Roads"),
      li("c", "overlay"),
    ]);
    expect(store.folderOf("a")).toBe(authorFolderId("overlay", "Roads"));
    expect(store.folderOf("b")).toBe(authorFolderId("overlay", "Roads"));
    expect(store.folderOf("c")).toBeNull();
    const folders = store.foldersOf("overlay");
    expect(folders).toHaveLength(1);
    expect(folders[0].name).toBe("roads");
    expect(folders[0].displayName).toBe("Roads");
    expect(folders[0].origin).toBe("author");
    expect(store.foldersOf("base")).toHaveLength(0);
  });

  it("sections folders by role: overlay and base never merge", () => {
    const store = new FolderStore();
    store.reconcile([li("a", "overlay", "Basemap"), li("b", "base", "Basemap")]);
    expect(store.foldersOf("overlay")).toHaveLength(1);
    expect(store.foldersOf("base")).toHaveLength(1);
    expect(store.folderOf("a")).toBe(authorFolderId("overlay", "Basemap"));
    expect(store.folderOf("b")).toBe(authorFolderId("base", "Basemap"));
  });

  it("drops a folder whose last member left (empty-folder freeze is folderOrder's)", () => {
    const store = new FolderStore();
    store.reconcile([li("a", "overlay", "Roads")]);
    expect(store.foldersOf("overlay")).toHaveLength(1);
    store.reconcile([li("a", "overlay")]);
    expect(store.foldersOf("overlay")).toHaveLength(0);
  });

  it("keeps first-seen order of folders", () => {
    const store = new FolderStore();
    store.reconcile([
      li("a", "overlay", "Zeta"),
      li("b", "overlay", "Alpha"),
      li("c", "overlay", "Zeta"),
    ]);
    expect(store.foldersOf("overlay").map(f => f.displayName)).toEqual([
      "Zeta",
      "Alpha",
    ]);
  });
});

describe("FolderStore override priority", () => {
  it("user override beats the author declaration", () => {
    const store = new FolderStore();
    store.reconcile([li("a", "overlay", "Roads")]);
    const target = authorFolderId("overlay", "Parks");
    store.setOverride("a", target);
    expect(store.folderOf("a")).toBe(target);
    expect(store.hasOverride("a")).toBe(true);
  });

  it("a null override (to Section root) beats the author declaration", () => {
    const store = new FolderStore();
    store.reconcile([li("a", "overlay", "Roads")]);
    store.setOverride("a", null);
    expect(store.folderOf("a")).toBeNull();
  });

  it("reset drops only the override; the author declaration shows through", () => {
    const store = new FolderStore();
    store.reconcile([li("a", "overlay", "Roads")]);
    store.setOverride("a", null);
    store.resetOverride("a");
    expect(store.folderOf("a")).toBe(authorFolderId("overlay", "Roads"));
    expect(store.hasOverride("a")).toBe(false);
  });

  it("an override works for a layer with no author declaration", () => {
    const store = new FolderStore();
    store.reconcile([li("a", "overlay")]);
    const target = authorFolderId("overlay", "Parks");
    store.setOverride("a", target);
    expect(store.folderOf("a")).toBe(target);
  });

  it("resetOverride on a never-overridden layer is a no-op", () => {
    const store = new FolderStore();
    store.reconcile([li("a", "overlay", "Roads")]);
    store.resetOverride("a");
    expect(store.folderOf("a")).toBe(authorFolderId("overlay", "Roads"));
  });
});
