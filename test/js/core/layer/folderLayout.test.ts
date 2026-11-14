// core/layer/folderLayout — the v2 folder-layout domain.
//
// These tests drive the pure layout functions (no DOM, no storage) and the
// storage round-trip through the manager. The single-source invariant is the
// thread: layout.members[layerId] is the ONLY assignment a layer carries once
// a layout exists, and the order keys are the ONLY block priority.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FolderLayout,
  LAYOUT_DOC_KEY,
  type LayerInfo,
  type LayerRole,
  createFolder,
  deleteFolder,
  dropLayer,
  emptyFolderLayout,
  folderOf,
  freezeSectionOrder,
  isFolderLayout,
  normalizeFolderName,
  readFolderLayout,
  renameFolder,
  seedFolderLayout,
  writeFolderLayout,
} from "#core/layer/index.js";

const entry = (
  id: string,
  role: LayerRole,
  folder?: string | null,
  idx = 0,
): LayerInfo =>
  ({
    id,
    name: id,
    role,
    folder: folder ?? null,
    registeredAt: idx,
    layer: null,
    kind: "custom" as const,
    carrier: {} as never,
    paneName: null,
    paneSpecs: [],
    iconSvg: null,
    type: null,
  }) as LayerInfo;

describe("normalizeFolderName", () => {
  it("folds NFC, whitespace and case", () => {
    expect(normalizeFolderName("  Roads	Roads  ")).toBe("roads roads");
    expect(normalizeFolderName("ROADS")).toBe("roads");
    expect(normalizeFolderName("  roads ")).toBe("roads");
  });
});

describe("seedFolderLayout", () => {
  it("builds folders and members from declarations", () => {
    const layout = seedFolderLayout([
      entry("a", "overlay", "Roads", 0),
      entry("b", "overlay", "roads", 1),
      entry("c", "base", "Water", 2),
    ]);
    expect(layout.folders).toEqual([
      { key: "roads", name: "Roads" },
      { key: "water", name: "Water" },
    ]);
    expect(layout.members.a).toEqual({ section: "overlay", folder: "roads" });
    expect(layout.members.b).toEqual({ section: "overlay", folder: "roads" });
    expect(layout.members.c).toEqual({ section: "base", folder: "water" });
    // The seed never writes an order: declarations do not force a block order.
    expect(layout.order).toEqual({});
  });

  it("keeps the first-seen display spelling", () => {
    const layout = seedFolderLayout([
      entry("a", "overlay", "Roads", 0),
      entry("b", "overlay", "ROADS", 1),
    ]);
    expect(layout.folders).toEqual([{ key: "roads", name: "Roads" }]);
  });
});

describe("createFolder / renameFolder / deleteFolder", () => {
  it("createFolder refuses same-section duplicates", () => {
    let layout = emptyFolderLayout();
    layout = createFolder(layout, "overlay", "Roads");
    layout = createFolder(layout, "overlay", "roads");
    expect(layout.folders).toHaveLength(1);
    expect(layout.order.overlay).toEqual(["roads"]);
  });

  it("createFolder allows the same key in different sections", () => {
    let layout = emptyFolderLayout();
    layout = createFolder(layout, "overlay", "Roads");
    layout = createFolder(layout, "base", "Roads");
    expect(layout.order.overlay).toEqual(["roads"]);
    expect(layout.order.base).toEqual(["roads"]);
    expect(layout.folders).toHaveLength(1);
  });

  it("renameFolder rewrites only the display name, keeping the identity key and order in place", () => {
    let layout = emptyFolderLayout();
    layout = createFolder(layout, "overlay", "Roads");
    layout = createFolder(layout, "overlay", "Water");
    layout = renameFolder(layout, "overlay", "Roads", "Streets");
    expect(layout.folders).toEqual([
      { key: "roads", name: "Streets" },
      { key: "water", name: "Water" },
    ]);
    expect(layout.order.overlay).toEqual(["roads", "water"]);
  });

  it("renameFolder leaves member keys untouched (the block stays put)", () => {
    let layout = seedFolderLayout([entry("a", "overlay", "Roads", 0)]);
    layout = createFolder(layout, "overlay", "Roads");
    layout = renameFolder(layout, "overlay", "Roads", "Streets");
    expect(layout.members.a).toEqual({ section: "overlay", folder: "roads" });
  });

  it("deleteFolder promotes members to root and removes the key", () => {
    let layout = seedFolderLayout([entry("a", "overlay", "Roads", 0)]);
    layout = createFolder(layout, "overlay", "Roads");
    layout = deleteFolder(layout, "overlay", "Roads");
    expect(layout.members.a).toEqual({ section: "overlay", folder: "" });
    expect(layout.folders).toEqual([]);
    expect(layout.order.overlay).toEqual([]);
  });
});

describe("folderOf", () => {
  it("reads the member assignment (single source), not the declaration", () => {
    const layout = seedFolderLayout([entry("a", "overlay", "Roads", 0)]);
    // The layer declared Roads; the layout member reflects it.
    expect(folderOf(layout, entry("a", "overlay", "Roads", 0))).toBe("roads");
    // A materialised root pin wins over the declaration.
    const pinned = {
      ...layout,
      members: { a: { section: "overlay" as LayerRole, folder: "" } },
    };
    expect(folderOf(pinned, entry("a", "overlay", "Roads", 0))).toBeNull();
  });
});

describe("dropLayer", () => {
  it("removes the member but keeps the order key (the automatic freeze)", () => {
    let layout = seedFolderLayout([entry("a", "overlay", "Roads", 0)]);
    layout = createFolder(layout, "overlay", "Roads");
    layout = dropLayer(layout, "a");
    expect(layout.members.a).toBeUndefined();
    expect(layout.order.overlay).toEqual(["roads"]);
  });
});

describe("freezeSectionOrder", () => {
  it("materialises the block order from live members before a removal", () => {
    let layout = seedFolderLayout([
      entry("a", "overlay", "Roads", 0),
      entry("b", "overlay", null, 2),
    ]);
    layout = freezeSectionOrder(
      layout,
      "overlay",
      [
        entry("a", "overlay", "Roads", 0),
        entry("b", "overlay", null, 2),
      ] as LayerInfo[],
      "roads",
    );
    expect(layout.order.overlay).toEqual(["roads"]);
  });
});

describe("isFolderLayout", () => {
  it("accepts a well-formed v2 layout", () => {
    expect(isFolderLayout(emptyFolderLayout())).toBe(true);
    expect(
      isFolderLayout({
        version: 2,
        folders: [],
        order: { overlay: ["a"] },
        members: {},
      }),
    ).toBe(true);
  });

  it("rejects corrupt payloads", () => {
    expect(isFolderLayout(null)).toBe(false);
    expect(isFolderLayout({ version: 1, folders: [], order: {}, members: {} })).toBe(
      false,
    );
    expect(
      isFolderLayout({
        version: 2,
        folders: [],
        order: { middle: ["a"] },
        members: {},
      }),
    ).toBe(false);
    expect(
      isFolderLayout({ version: 2, folders: [{ key: 1 }], order: {}, members: {} }),
    ).toBe(false);
  });
});

describe("storage round-trip", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("writeFolderLayout then readFolderLayout round-trips", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "roads", name: "Roads" }],
      order: { overlay: ["roads"] },
      members: { a: { section: "overlay", folder: "roads" } },
    };
    writeFolderLayout(layout);
    expect(window.localStorage.getItem(LAYOUT_DOC_KEY)).not.toBeNull();
    expect(readFolderLayout()).toEqual(layout);
  });

  it("reads a corrupt layout as empty", () => {
    window.localStorage.setItem(LAYOUT_DOC_KEY, JSON.stringify({ version: 1 }));
    expect(readFolderLayout()).toEqual(emptyFolderLayout());
  });
});
