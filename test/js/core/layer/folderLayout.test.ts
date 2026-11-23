// core/layer/folderLayout — the v2 folder-layout domain.
//
// These tests drive the pure layout functions (no DOM, no storage) and the
// storage round-trip through the manager. The single-source invariant is the
// thread: layout.members[layerId] is the ONLY assignment a layer carries once
// a layout exists, and the order keys are the ONLY block priority.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FOLDER_NAME_MAX,
  type FolderLayout,
  type LayerInfo,
  type LayerRole,
  createFolder,
  createFolderLayoutManager,
  deleteFolder,
  dropLayer,
  emptyFolderLayout,
  ensureFolderLayout,
  folderEntries,
  folderLayoutKey,
  folderNameLength,
  folderNameTooLong,
  folderOf,
  freezeRoleOrder,
  fullDisplayOrder,
  groupByFolder,
  isFolderLayout,
  mergeDeclaredFolders,
  moveFolder,
  moveLayerToFolder,
  moveLayerToRoot,
  moveLayerToRootAt,
  nextFolderDefaultName,
  normalizeFolderName,
  readFolderLayout,
  renameFolder,
  roleBlocks,
  roleOrder,
  rootLayerEntry,
  seedBlockOrder,
  writeFolderLayout,
} from "#core/layer/index.js";

/** A minimal fake map for the storage-key argument: the layout only reads
 *  `getContainer().id`, so a plain object suffices. */
const fakeMap = (id = "test-map"): { getContainer: () => { id: string } } => ({
  getContainer: () => ({ id }),
});

/** The production merge applied to an empty layout — the "first seed" case.
 *  The tests below drive `mergeDeclaredFolders`, the same function the
 *  manager's `seed()` calls, so a green here is a green about production. */
const seedFolderLayout = (entries: readonly LayerInfo[]): FolderLayout =>
  mergeDeclaredFolders(emptyFolderLayout(), entries);

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
    expect(layout.members.a).toEqual({ role: "overlay", folder: "roads" });
    expect(layout.members.b).toEqual({ role: "overlay", folder: "roads" });
    expect(layout.members.c).toEqual({ role: "base", folder: "water" });
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
  it("createFolder refuses same-role duplicates", () => {
    let layout = emptyFolderLayout();
    layout = createFolder(layout, "overlay", "Roads");
    layout = createFolder(layout, "overlay", "roads");
    expect(layout.folders).toHaveLength(1);
    expect(layout.order.overlay).toEqual(["roads"]);
  });

  it("createFolder allows the same key in different roles", () => {
    let layout = emptyFolderLayout();
    layout = createFolder(layout, "overlay", "Roads");
    layout = createFolder(layout, "base", "Roads");
    expect(layout.order.overlay).toEqual(["roads"]);
    expect(layout.order.base).toEqual(["roads"]);
    expect(layout.folders).toHaveLength(1);
  });

  it("createFolder with the registry appends after the folders the author declared", () => {
    // Author-declared folders live in `members`, not in `order`, so the role's
    // order starts empty. Without the registry the new key would be the only
    // listed block and would sort ahead of every existing folder.
    const entries = [
      entry("a", "overlay", "Roads", 0),
      entry("b", "overlay", "Water", 1),
    ];
    const layout = seedFolderLayout(entries);
    expect(layout.order.overlay).toBeUndefined();
    const created = createFolder(layout, "overlay", "Facilities", entries);
    expect(created.order.overlay).toEqual(["roads", "water", "facilities"]);
  });

  it("moveLayerToRootAt places the layer between two listed folder blocks", () => {
    const entries = [
      entry("a", "overlay", "Alpha", 0),
      entry("b", "overlay", "Beta", 1),
    ];
    let layout = seedFolderLayout(entries);
    layout = freezeRoleOrder(layout, "overlay", entries, "alpha");
    expect(layout.order.overlay).toEqual(["alpha", "beta"]);

    layout = moveLayerToRootAt(layout, "a", "overlay", "beta");

    // The layer is a block of its own, between the two folders — not appended
    // after every folder block.
    expect(layout.order.overlay).toEqual(["alpha", "layer:a", "beta"]);
    expect(layout.members.a).toEqual({ role: "overlay", folder: "" });
  });

  it("moveLayerToFolder drops the layer's root block entry", () => {
    const entries = [entry("a", "overlay", "Alpha", 0)];
    let layout = seedFolderLayout(entries);
    layout = moveLayerToRootAt(layout, "a", "overlay", null);
    expect(layout.order.overlay).toEqual(["layer:a"]);

    layout = moveLayerToFolder(layout, "a", "overlay", "Alpha");

    // The layer is a member now: keeping the root entry would render it twice.
    expect(layout.order.overlay).toEqual(["alpha"]);
    expect(layout.members.a).toEqual({ role: "overlay", folder: "alpha" });
  });

  it("dropLayer removes the layer's root block entry", () => {
    const entries = [entry("a", "overlay", "Alpha", 0)];
    let layout = seedFolderLayout(entries);
    layout = moveLayerToRootAt(layout, "a", "overlay", null);

    layout = dropLayer(layout, "a");

    expect(layout.order.overlay).toEqual([]);
    expect(layout.members.a).toBeUndefined();
  });

  it("createFolder without the registry keeps the plain append", () => {
    let layout = emptyFolderLayout();
    layout = createFolder(layout, "overlay", "Roads");
    layout = createFolder(layout, "overlay", "Water");
    expect(layout.order.overlay).toEqual(["roads", "water"]);
  });

  it("renameFolder rewrites only the display name, keeping the identity key and order in place", () => {
    let layout = emptyFolderLayout();
    layout = createFolder(layout, "overlay", "Roads");
    layout = createFolder(layout, "overlay", "Water");
    layout = renameFolder(layout, "overlay", "roads", "Streets");
    expect(layout.folders).toEqual([
      { key: "roads", name: "Streets" },
      { key: "water", name: "Water" },
    ]);
    expect(layout.order.overlay).toEqual(["roads", "water"]);
  });

  it("renameFolder leaves member keys untouched (the block stays put)", () => {
    let layout = seedFolderLayout([entry("a", "overlay", "Roads", 0)]);
    layout = createFolder(layout, "overlay", "Roads");
    layout = renameFolder(layout, "overlay", "roads", "Streets");
    expect(layout.members.a).toEqual({ role: "overlay", folder: "roads" });
  });

  it("renameFolder materialises a live-only folder when the key is listed but not in the directory", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      order: { overlay: ["roads"] },
    };
    // "roads" is listed (a live block) but has no directory entry: the rename
    // must materialise it rather than dropping the rename.
    const next = renameFolder(layout, "overlay", "roads", "Streets");
    expect(next.folders).toEqual([{ key: "roads", name: "Streets" }]);
    expect(next.order.overlay).toEqual(["roads"]);
  });

  it("deleteFolder promotes members to root and removes the key", () => {
    let layout = seedFolderLayout([entry("a", "overlay", "Roads", 0)]);
    layout = createFolder(layout, "overlay", "Roads");
    layout = deleteFolder(layout, "overlay", "roads");
    expect(layout.members.a).toEqual({ role: "overlay", folder: "" });
    expect(layout.folders).toEqual([]);
    expect(layout.order.overlay).toEqual([]);
  });

  it("deleteFolder leaves members in other roles untouched", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "roads", name: "Roads" }],
      order: { overlay: ["roads"], base: ["roads"] },
      members: {
        a: { role: "overlay", folder: "roads" },
        b: { role: "base", folder: "roads" },
      },
    };
    const next = deleteFolder(layout, "overlay", "roads");
    // The base member keeps its assignment; the overlay one is pinned to root.
    expect(next.members.a).toEqual({ role: "overlay", folder: "" });
    expect(next.members.b).toEqual({ role: "base", folder: "roads" });
    expect(next.order.overlay).toEqual([]);
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
      members: { a: { role: "overlay" as LayerRole, folder: "" } },
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

describe("freezeRoleOrder", () => {
  it("materialises the block order from live members before a removal", () => {
    let layout = seedFolderLayout([
      entry("a", "overlay", "Roads", 0),
      entry("b", "overlay", null, 2),
    ]);
    layout = freezeRoleOrder(
      layout,
      "overlay",
      [
        entry("a", "overlay", "Roads", 0),
        entry("b", "overlay", null, 2),
      ] as LayerInfo[],
      "roads",
    );
    // The freeze preserves the unlisted root layer at its anchor position
    // instead of dropping it (single-source with seedBlockOrder).
    expect(layout.order.overlay).toEqual(["roads", "layer:b"]);
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
      members: { a: { role: "overlay", folder: "roads" } },
    };
    writeFolderLayout(layout, fakeMap());
    expect(window.localStorage.getItem(folderLayoutKey(fakeMap()))).not.toBeNull();
    expect(readFolderLayout(fakeMap())).toEqual(layout);
  });

  it("reads a corrupt layout as empty", () => {
    window.localStorage.setItem(
      folderLayoutKey(fakeMap()),
      JSON.stringify({ version: 1 }),
    );
    expect(readFolderLayout(fakeMap())).toEqual(emptyFolderLayout());
  });
});
describe("seed merge", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("a user root pin wins over the author declaration when seeding", () => {
    // Pre-existing layout pins layer "a" to root (folder: "").
    const existing: FolderLayout = {
      ...emptyFolderLayout(),
      order: { overlay: [] },
      members: { a: { role: "overlay", folder: "" } },
    };
    writeFolderLayout(existing, fakeMap());

    const manager = createFolderLayoutManager(fakeMap());
    const entryA = entry("a", "overlay", "Roads", 0);
    manager.seed([entryA]);

    // The user pin is untouched; the declaration does not sink the layer back.
    expect(manager.layout.members.a).toEqual({ role: "overlay", folder: "" });
    expect(manager.layout.folders).toEqual([]);
    expect(manager.layout.order.overlay ?? []).toEqual([]);
  });

  it("an existing member assignment wins over the author declaration when seeding", () => {
    // Pre-existing layout has layer "a" inside "roads" already.
    const existing: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "roads", name: "Roads" }],
      order: { overlay: ["roads"] },
      members: { a: { role: "overlay", folder: "roads" } },
    };
    writeFolderLayout(existing, fakeMap());

    const manager = createFolderLayoutManager(fakeMap());
    const entryA = entry("a", "overlay", "Water", 1);
    manager.seed([entryA]);

    // The existing assignment wins; the new declaration "water" is not applied.
    expect(manager.layout.members.a).toEqual({ role: "overlay", folder: "roads" });
    expect(manager.layout.folders).toEqual([{ key: "roads", name: "Roads" }]);
  });

  it("an unassigned layer receives its author declaration when seeding", () => {
    const manager = createFolderLayoutManager(fakeMap());
    const entryA = entry("a", "overlay", "Roads", 0);
    manager.seed([entryA]);

    expect(manager.layout.members.a).toEqual({ role: "overlay", folder: "roads" });
    expect(manager.layout.folders).toEqual([{ key: "roads", name: "Roads" }]);
  });
});

describe("pure helper coverage", () => {
  it("isFolderLayout rejects non-array folders, bad order, bad members", () => {
    expect(isFolderLayout({ version: 2, folders: "x", order: {}, members: {} })).toBe(
      false,
    );
    expect(
      isFolderLayout({ version: 2, folders: [], order: { overlay: "x" }, members: {} }),
    ).toBe(false);
    expect(
      isFolderLayout({
        version: 2,
        folders: [],
        order: { overlay: [] },
        members: { a: { role: "x", folder: "f" } },
      }),
    ).toBe(false);
    expect(
      isFolderLayout({ version: 2, folders: [{ key: 1 }], order: {}, members: {} }),
    ).toBe(false);
    expect(
      isFolderLayout({
        version: 2,
        folders: [{ key: "a", name: 1 }],
        order: {},
        members: {},
      }),
    ).toBe(false);
    expect(
      isFolderLayout({ version: 2, folders: [], order: { overlay: [1] }, members: {} }),
    ).toBe(false);
    expect(
      isFolderLayout({
        version: 2,
        folders: [],
        order: {},
        members: { a: { role: "overlay", folder: 1 } },
      }),
    ).toBe(false);
    expect(
      isFolderLayout({
        version: 2,
        folders: [],
        order: {},
        members: { a: { role: "overlay" } },
      }),
    ).toBe(false);
  });

  it("groupByFolder groups only the role and respects the directory display name", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "roads", name: "Streets" }],
      order: {},
      members: { a: { role: "overlay", folder: "roads" } },
    };
    const entries = [
      entry("a", "overlay", null, 0),
      entry("b", "base", "Roads", 1),
    ] as LayerInfo[];
    const map = groupByFolder(entries, "overlay", layout);
    expect(map.has("roads")).toBe(true);
    expect(map.get("roads")!.displayName).toBe("Streets");
    expect(map.get("roads")!.members.map(m => m.id)).toEqual(["a"]);
  });

  it("groupByFolder collects every member of a folder into one block", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "roads", name: "Streets" }],
      order: {},
      members: {
        a: { role: "overlay", folder: "roads" },
        b: { role: "overlay", folder: "roads" },
      },
    };
    const entries = [
      entry("a", "overlay", null, 0),
      entry("b", "overlay", null, 1),
    ] as LayerInfo[];
    const map = groupByFolder(entries, "overlay", layout);
    expect(map.get("roads")!.members.map(m => m.id)).toEqual(["a", "b"]);
  });

  it("roleOrder lists listed keys first, then unlisted folders and roots merged by anchor", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "roads", name: "Roads" }],
      order: { overlay: ["roads"] },
      members: {
        a: { role: "overlay", folder: "roads" },
        b: { role: "overlay", folder: "" },
      },
    };
    const entries = [
      entry("a", "overlay", "Roads", 0),
      entry("b", "overlay", null, 1),
      entry("c", "overlay", "Water", 2),
    ] as LayerInfo[];
    const order = roleOrder("overlay", entries, layout);
    expect(order.map(e => e.id)).toEqual(["a", "b", "c"]);
  });

  it("unlisted author folders and root layers merge by registry anchor", () => {
    // A root layer registered BETWEEN two author-declared folders must sit
    // between their blocks. The two-segment order (all unlisted folders,
    // then all roots) would bucket both folders first regardless of
    // registration order — the author-declared-folder-order bug. The
    // merge-by-anchor order follows the registry index, so root2 (registered
    // at 2) lands between roads (anchor 1) and water (anchor 3).
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [
        { key: "roads", name: "Roads" },
        { key: "water", name: "Water" },
      ],
      // Author-declared folders live in members, NOT in order: the role's
      // order is empty until the user drags or freezes.
      order: {},
      members: {
        a: { role: "overlay", folder: "roads" },
        b: { role: "overlay", folder: "water" },
      },
    };
    const entries = [
      entry("root1", "overlay", null, 0),
      entry("a", "overlay", "Roads", 1),
      entry("root2", "overlay", null, 2),
      entry("b", "overlay", "Water", 3),
    ] as LayerInfo[];
    const order = roleOrder("overlay", entries, layout);
    // Registry anchor order: root1(0), roads(1), root2(2), water(3). The
    // folders are NOT bucketed before the roots.
    expect(order.map(e => e.id)).toEqual(["root1", "a", "root2", "b"]);
  });

  it("unlisted author folders registered before roots stay first by anchor", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "roads", name: "Roads" }],
      order: {},
      members: { a: { role: "overlay", folder: "roads" } },
    };
    const entries = [
      entry("a", "overlay", "Roads", 0),
      entry("root1", "overlay", null, 1),
    ] as LayerInfo[];
    const order = roleOrder("overlay", entries, layout);
    expect(order.map(e => e.id)).toEqual(["a", "root1"]);
  });

  it("unlisted author folders registered after roots stay last by anchor", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "roads", name: "Roads" }],
      order: {},
      members: { a: { role: "overlay", folder: "roads" } },
    };
    const entries = [
      entry("root1", "overlay", null, 0),
      entry("a", "overlay", "Roads", 1),
    ] as LayerInfo[];
    const order = roleOrder("overlay", entries, layout);
    expect(order.map(e => e.id)).toEqual(["root1", "a"]);
  });

  it("roleOrder skips a stale listed key that has no live members", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "roads", name: "Roads" }],
      // "water" is listed but no member declares it: a stale order key left
      // after the last member moved out. The block must be skipped.
      order: { overlay: ["water", "roads"] },
      members: { a: { role: "overlay", folder: "roads" } },
    };
    const entries = [entry("a", "overlay", null, 0)] as LayerInfo[];
    const order = roleOrder("overlay", entries, layout);
    expect(order.map(e => e.id)).toEqual(["a"]);
  });

  it("fullDisplayOrder composes both roles", () => {
    const layout = emptyFolderLayout();
    const entries = [
      entry("a", "overlay", null, 0),
      entry("b", "base", null, 1),
    ] as LayerInfo[];
    expect(fullDisplayOrder(entries, layout).map(e => e.id)).toEqual(["a", "b"]);
  });

  it("freezeRoleOrder appends an unlisted key when the frozen key is absent", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      order: { overlay: [] },
    };
    const entries = [entry("a", "overlay", "Roads", 0)] as LayerInfo[];
    const next = freezeRoleOrder(layout, "overlay", entries, "roads");
    expect(next.order.overlay).toEqual(["roads"]);
  });

  it("createFolder reuses an existing directory entry across roles", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "roads", name: "Roads" }],
      order: { base: ["roads"] },
    };
    const next = createFolder(layout, "overlay", "Roads");
    expect(next.order.overlay).toEqual(["roads"]);
    expect(next.folders).toEqual([{ key: "roads", name: "Roads" }]);
  });

  it("createFolder refuses a blank name and a same-role duplicate", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      order: { overlay: ["roads"] },
    };
    expect(createFolder(layout, "overlay", "   ")).toBe(layout);
    expect(createFolder(layout, "overlay", "roads")).toBe(layout);
  });

  it("seed keeps a single directory entry when two entries declare the same normalised folder name", () => {
    // Two different spellings normalise to the same key: the first-seen
    // spelling wins the display name and only one directory entry exists, but
    // both layers are members of that one folder (the byKey.has true arm).
    const layout = seedFolderLayout([
      entry("a", "overlay", "Roads", 0),
      entry("b", "overlay", "roads", 1),
    ]);
    expect(layout.folders).toEqual([{ key: "roads", name: "Roads" }]);
    expect(layout.members.a).toEqual({ role: "overlay", folder: "roads" });
    expect(layout.members.b).toEqual({ role: "overlay", folder: "roads" });
  });

  it("renameFolder is a no-op on a blank name or a missing key", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "roads", name: "Roads" }],
      order: { overlay: ["roads"] },
    };
    expect(renameFolder(layout, "overlay", "roads", "  ")).toBe(layout);
    expect(renameFolder(layout, "overlay", "missing", "X")).toBe(layout);
  });

  it("renameFolder to the folder's own normalised name rewrites the display name", () => {
    // The key is the identity, so "Roads" -> "roads" is a display-only change,
    // not a no-op: the user asked for that spelling.
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "roads", name: "Roads" }],
      order: { overlay: ["roads"] },
    };
    const next = renameFolder(layout, "overlay", "roads", "roads");
    expect(next.folders).toEqual([{ key: "roads", name: "roads" }]);
    expect(next.order.overlay).toEqual(["roads"]);
  });

  it("moveLayerToFolder and moveLayerToRoot update the assignment", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "roads", name: "Roads" }],
      order: { overlay: ["roads"] },
      members: { a: { role: "overlay", folder: "roads" } },
    };
    const toRoot = moveLayerToRoot(layout, "a", "overlay");
    expect(toRoot.members.a).toEqual({ role: "overlay", folder: "" });
    expect(moveLayerToRoot(toRoot, "a", "overlay")).toBe(toRoot);
    const toFolder = moveLayerToFolder(layout, "a", "overlay", "roads");
    expect(toFolder.members.a).toEqual({ role: "overlay", folder: "roads" });
  });

  it("moveLayerToFolder appends a new key to an empty role order", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "water", name: "Water" }],
      members: { a: { role: "base", folder: "water" } },
    };
    // base has no order entry yet: the move appends the key (?? [] + append arm).
    const next = moveLayerToFolder(layout, "a", "base", "water");
    expect(next.order.base).toEqual(["water"]);
    expect(next.members.a).toEqual({ role: "base", folder: "water" });
  });

  it("dropLayer removes the assignment and is a no-op for an unassigned layer", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      members: { a: { role: "overlay", folder: "roads" } },
    };
    expect(dropLayer(layout, "a")).toEqual({ ...emptyFolderLayout(), members: {} });
    expect(dropLayer(layout, "zzz")).toBe(layout);
  });
});

describe("manager lifecycle", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("set then flush persists, reload re-reads, isEmpty reflects the state", () => {
    const manager = createFolderLayoutManager(fakeMap());
    expect(manager.isEmpty()).toBe(true);
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "roads", name: "Roads" }],
      order: { overlay: ["roads"] },
      members: { a: { role: "overlay", folder: "roads" } },
    };
    manager.set(layout);
    expect(manager.isEmpty()).toBe(false);
    manager.flush();
    expect(window.localStorage.getItem(folderLayoutKey(fakeMap()))).not.toBeNull();
    const fresh = createFolderLayoutManager(fakeMap());
    expect(fresh.layout.members.a).toEqual({ role: "overlay", folder: "roads" });
    fresh.reload();
    expect(fresh.layout.order.overlay).toEqual(["roads"]);
  });

  it("set debounces the write and flush forces it", () => {
    vi.useFakeTimers();
    const manager = createFolderLayoutManager(fakeMap());
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      members: { a: { role: "overlay", folder: "roads" } },
    };
    manager.set(layout);
    expect(window.localStorage.getItem(folderLayoutKey(fakeMap()))).toBeNull();
    vi.advanceTimersByTime(200);
    expect(window.localStorage.getItem(folderLayoutKey(fakeMap()))).not.toBeNull();
  });
});

describe("coverage edges", () => {
  it("isFolderLayout rejects a non-object order, a non-object member value, and a non-object folder", () => {
    expect(isFolderLayout({ version: 2, folders: [], order: null, members: {} })).toBe(
      false,
    );
    expect(isFolderLayout({ version: 2, folders: [], order: {}, members: null })).toBe(
      false,
    );
    expect(
      isFolderLayout({ version: 2, folders: [null], order: {}, members: {} }),
    ).toBe(false);
    expect(
      isFolderLayout({ version: 2, folders: [], order: {}, members: { a: null } }),
    ).toBe(false);
  });

  it("freezeRoleOrder appends a folder key that no entry declares", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      order: { overlay: ["water"] },
    };
    const entries = [entry("a", "overlay", null, 0)] as LayerInfo[];
    const next = freezeRoleOrder(layout, "overlay", entries, "roads");
    // The freeze keeps the unlisted root layer too, at its anchor slot.
    expect(next.order.overlay).toEqual(["water", "layer:a", "roads"]);
  });

  it("roleOrder sorts multiple unlisted folders by their anchor", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      order: { overlay: [] },
    };
    const entries = [
      entry("a", "overlay", "Water", 0),
      entry("b", "overlay", "Roads", 1),
    ] as LayerInfo[];
    const order = roleOrder("overlay", entries, layout);
    // "water" anchor 0, "roads" anchor 1.
    expect(order.map(e => e.id)).toEqual(["a", "b"]);
  });

  it("renameFolder rejects a name that collides with another directory key", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [
        { key: "roads", name: "Roads" },
        { key: "water", name: "Water" },
      ],
      order: { overlay: ["roads"] },
    };
    expect(renameFolder(layout, "overlay", "roads", "water")).toBe(layout);
  });

  it("moveLayerToFolder is a no-op on a blank folder key", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      members: { a: { role: "overlay", folder: "roads" } },
    };
    expect(moveLayerToFolder(layout, "a", "overlay", "   ")).toBe(layout);
  });

  it("seed skips an entry without an author folder", () => {
    const manager = createFolderLayoutManager(fakeMap());
    manager.seed([entry("a", "overlay", null, 0)]);
    expect(manager.layout.members).toEqual({});
    expect(manager.layout.folders).toEqual([]);
  });

  it("freezeRoleOrder sorts multiple unlisted folders by anchor", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      order: { overlay: [] },
      members: {
        a: { role: "overlay", folder: "water" },
        b: { role: "overlay", folder: "roads" },
      },
    };
    const entries = [
      entry("a", "overlay", null, 0),
      entry("b", "overlay", null, 1),
    ] as LayerInfo[];
    const next = freezeRoleOrder(layout, "overlay", entries, "extra");
    // Both water and roads are unlisted; the sort orders by anchor.
    expect(next.order.overlay).toEqual(["water", "roads", "extra"]);
  });

  it("ensureFolderLayout returns the per-map singleton", () => {
    const api: { other: number; folderLayout?: unknown } = { other: 1 };
    const map = { foliplus: api, getContainer: () => ({ id: "test-map" }) };
    const first = ensureFolderLayout(map);
    expect(ensureFolderLayout(map)).toBe(first);
    expect(map.foliplus.folderLayout).toBe(first);
  });
});

describe("seed merge manager edges", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("seed skips creating a directory entry when the key already exists", () => {
    // A pre-existing directory entry (from an earlier session) with a new
    // unassigned layer declaring the same folder: the byKey.has arm must
    // skip re-creating the entry and only assign the member.
    const existing: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "roads", name: "Roads" }],
      order: { overlay: ["roads"] },
      members: {},
    };
    writeFolderLayout(existing, fakeMap());
    const manager = createFolderLayoutManager(fakeMap());
    manager.seed([entry("a", "overlay", "Roads", 0)]);
    expect(manager.layout.folders).toEqual([{ key: "roads", name: "Roads" }]);
    expect(manager.layout.members.a).toEqual({ role: "overlay", folder: "roads" });
  });

  it("renameFolder reads the hasOld order key through a missing role order", () => {
    // No order entry for the role: the ?? [] arm resolves hasOld to false
    // when the key is neither in the directory nor listed.
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [],
      order: {},
    };
    expect(renameFolder(layout, "overlay", "missing", "X")).toBe(layout);
  });

  it("deleteFolder reads the role order through a missing role order", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "roads", name: "Roads" }],
      order: {},
      members: { a: { role: "overlay", folder: "roads" } },
    };
    const next = deleteFolder(layout, "overlay", "roads");
    expect(next.members.a).toEqual({ role: "overlay", folder: "" });
    expect(next.order.overlay ?? []).toEqual([]);
  });
});

describe("moveFolder — no-op guards", () => {
  const layout: FolderLayout = {
    ...emptyFolderLayout(),
    folders: [
      { key: "roads", name: "Roads" },
      { key: "water", name: "Water" },
    ],
    order: { overlay: ["roads", "water"] },
    members: {},
  };

  it("returns the same layout when the key is its own target", () => {
    // A drag that outlived a re-render can arm and target the same block.
    expect(moveFolder(layout, "overlay", "roads", "roads", true)).toBe(layout);
  });

  it("returns the same layout when a key is not listed in the role", () => {
    // A drag that outlived a rename or a delete cannot corrupt the order.
    expect(moveFolder(layout, "overlay", "ghost", "roads", true)).toBe(layout);
    expect(moveFolder(layout, "overlay", "roads", "ghost", true)).toBe(layout);
  });

  it("moves a listed block before or after its target", () => {
    expect(
      moveFolder(layout, "overlay", "water", "roads", false).order.overlay,
    ).toEqual(["water", "roads"]);
    expect(moveFolder(layout, "overlay", "roads", "water", true).order.overlay).toEqual(
      ["water", "roads"],
    );
  });
});

describe("new signature: roleBlocks / seedBlockOrder / name length", () => {
  it("folderNameLength folds NFC, collapses whitespace, trims, counts code points", () => {
    // NFC: an e + combining acute normalises to a single e-acute code point.
    expect(folderNameLength("e\u0301")).toBe(1);
    // Whitespace collapse + trim, same as the panel's normalisation.
    expect(folderNameLength("  Roads\tRoads  ")).toBe(11);
    // A non-BMP surrogate pair is one code point, not two UTF-16 units.
    expect(folderNameLength("\u{1F600}")).toBe(1);
    expect(folderNameLength("")).toBe(0);
  });

  it("folderNameTooLong is the single cap decision point", () => {
    const atMax = "a".repeat(FOLDER_NAME_MAX);
    expect(folderNameTooLong(atMax)).toBe(false);
    expect(folderNameTooLong(`${atMax}b`)).toBe(true);
  });

  it("a root layer's block entry never collides with a folder key", () => {
    // The encoding itself is internal; what the API promises is that a root
    // layer's entry is distinguishable from a folder key, and that the folder
    // view filters it out.
    const rootEntry = rootLayerEntry("a");
    expect(rootEntry).not.toBe("a");
    expect(folderEntries(["roads", rootEntry, "water"])).toEqual(["roads", "water"]);
    expect(folderEntries([])).toEqual([]);
  });

  it("roleBlocks honours a listed root-layer entry (info present)", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      order: { overlay: ["layer:a"] },
    };
    const entries = [entry("a", "overlay", null, 0)] as LayerInfo[];
    const blocks = roleBlocks("overlay", entries, layout);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ kind: "layer", info: entries[0] });
  });

  it("roleBlocks skips a stale listed root-layer entry (no live info)", () => {
    // A "layer:<id>" entry whose id is not in the registry: the block has no
    // info to paint, so the pass skips it instead of emitting a null layer.
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      order: { overlay: ["layer:ghost"] },
    };
    // Empty registry: no unlisted root layer is pushed in the tail pass either.
    expect(roleBlocks("overlay", [], layout)).toEqual([]);
  });

  it("roleBlocks pushes an unlisted root layer and skips a listed one", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      order: { overlay: ["layer:a"] },
    };
    const entries = [
      entry("a", "overlay", null, 0),
      entry("b", "overlay", null, 1),
    ] as LayerInfo[];
    const blocks = roleBlocks("overlay", entries, layout);
    // a is listed (pushed in the listed pass), b is unlisted (pushed in the tail).
    expect(blocks.map(b => (b.kind === "layer" ? b.info.id : b.key))).toEqual([
      "a",
      "b",
    ]);
    expect(blocks[0]).toEqual({ kind: "layer", info: entries[0] });
    expect(blocks[1]).toEqual({ kind: "layer", info: entries[1] });
  });

  it("moveFolder no-ops on a missing role order (the ?? [] arm)", () => {
    // No order entry for the role: listed resolves to [] via the ?? arm, and
    // the key is not in an empty list, so the move is rejected.
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "roads", name: "Roads" }],
      order: {},
      members: {},
    };
    expect(moveFolder(layout, "overlay", "roads", "water", true)).toBe(layout);
  });

  it("moveFolder no-ops when the target is not listed (key is listed)", () => {
    // The guard's second operand: a drag whose TARGET outlived a delete. The
    // key itself is still listed, so only the target arm rejects the move.
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "roads", name: "Roads" }],
      order: { overlay: ["roads"] },
      members: {},
    };
    expect(moveFolder(layout, "overlay", "roads", "ghost", true)).toBe(layout);
  });

  it("seedBlockOrder maps folder and layer blocks to their order entries", () => {
    const folderLayout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "roads", name: "Roads" }],
      order: { overlay: ["roads"] },
      members: { a: { role: "overlay", folder: "roads" } },
    };
    const entries = [entry("a", "overlay", "Roads", 0)] as LayerInfo[];
    expect(seedBlockOrder(folderLayout, "overlay", entries)).toEqual(["roads"]);

    const rootLayout: FolderLayout = {
      ...emptyFolderLayout(),
      order: { overlay: ["layer:b"] },
    };
    const rootEntries = [entry("b", "overlay", null, 0)] as LayerInfo[];
    expect(seedBlockOrder(rootLayout, "overlay", rootEntries)).toEqual(["layer:b"]);
  });
  it("renameFolder accepts a member-only folder key (hasOld via members)", () => {
    // hasOld reads the member map when the key is neither in the directory
    // nor listed in any role order: a live member reference is still a
    // real folder. The members arm is the third hasOld source.
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [],
      order: {},
      members: { a: { role: "overlay", folder: "roads" } },
    };
    const next = renameFolder(layout, "overlay", "roads", "Streets");
    expect(next).not.toBe(layout);
    expect(next.folders).toEqual([{ key: "roads", name: "Streets" }]);
  });

  it("nextFolderDefaultName finds the first free candidate past a dense run", () => {
    // The loop bound is taken.size+2, so there are taken.size+1 candidates
    // but only taken.size taken values: at least one is ALWAYS free. The
    // @260 `return base` fallback is therefore unreachable by construction.
    // This pins the free-candidate arm: with {new folder..new folder 5}
    // taken, the loop (n=2..7) skips 2..5 and lands on 6.
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [
        { key: "new folder", name: "new folder" },
        { key: "new folder 2", name: "new folder 2" },
        { key: "new folder 3", name: "new folder 3" },
        { key: "new folder 4", name: "new folder 4" },
        { key: "new folder 5", name: "new folder 5" },
      ],
      order: {
        overlay: [
          "new folder",
          "new folder 2",
          "new folder 3",
          "new folder 4",
          "new folder 5",
        ],
      },
      members: {},
    };
    expect(nextFolderDefaultName(layout, "overlay", "new folder")).toBe("new folder 6");
  });
  it("nextFolderDefaultName picks the first free candidate when the base is taken", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "new folder", name: "new folder" }],
      order: { overlay: ["new folder"] },
      members: {},
    };
    expect(nextFolderDefaultName(layout, "overlay", "new folder")).toBe("new folder 2");
  });

  it("nextFolderDefaultName returns the base untouched when it is not taken", () => {
    // The early-out: base is free, so no suffix search runs (@246 true arm).
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "other", name: "Other" }],
      order: { overlay: ["other"] },
      members: {},
    };
    expect(nextFolderDefaultName(layout, "overlay", "new folder")).toBe("new folder");
  });

  it("nextFolderDefaultName counts a member-only folder in the taken set", () => {
    // The @233 members arm: a folder referenced only by a live member (not in
    // the directory or any role order) is still a taken key, so a base that
    // matches it gets a suffix.
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [],
      order: {},
      members: { a: { role: "overlay", folder: "roads" } },
    };
    expect(nextFolderDefaultName(layout, "overlay", "roads")).toBe("roads 2");
  });

  it("nextFolderDefaultName truncates the stem so the suffix still fits the cap", () => {
    // A base already at the length cap cannot take a " 2" suffix verbatim: the
    // candidate would be rejected by createFolder as too-long, and the new
    // folder would silently never appear. The stem is cut to leave room for
    // the suffix, so the returned name is always a legal folder name.
    const base = "a".repeat(FOLDER_NAME_MAX);
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: base, name: base }],
      order: { overlay: [base] },
      members: {},
    };
    const next = nextFolderDefaultName(layout, "overlay", base);
    expect(next).not.toBe(base);
    expect(folderNameLength(next)).toBeLessThanOrEqual(FOLDER_NAME_MAX);
    expect(folderNameTooLong(next)).toBe(false);
    expect(next.endsWith(" 2")).toBe(true);
  });

  it("nextFolderDefaultName ignores members of a different role", () => {
    // The @233 false arm: a member whose role does not match is not a taken
    // key for this role, so the base stays free.
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "new folder", name: "new folder" }],
      order: { overlay: ["new folder"] },
      members: { a: { role: "base", folder: "basemap" } },
    };
    expect(nextFolderDefaultName(layout, "overlay", "new folder")).toBe("new folder 2");
  });
});

describe("folder drag across root rows (P1 #1289)", () => {
  // A clean localStorage layout: no order, no members. The author declares the
  // folder; root1/root2 are unassigned roots. The folder's member sits between
  // the two roots by registration order.
  const entries = [
    entry("root1", "overlay", null, 0),
    entry("a", "overlay", "Roads", 1),
    entry("root2", "overlay", null, 2),
  ] as LayerInfo[];

  it("seeds the folder between the two root rows", () => {
    const seeded = seedFolderLayout(entries);
    expect(seeded.members.a).toEqual({ role: "overlay", folder: "roads" });
    expect(seeded.order).toEqual({});
    const blocks = roleBlocks("overlay", entries, seeded);
    expect(blocks.map(b => (b.kind === "folder" ? b.key : b.info.id))).toEqual([
      "root1",
      "roads",
      "root2",
    ]);
  });

  it("places a dragged folder before a root row (order and render agree)", () => {
    const seeded = seedFolderLayout(entries);
    const frozen = freezeRoleOrder(seeded, "overlay", entries, "roads");
    // The freeze materialises the block order from the merge-by-anchor result:
    // the folder sits between the two roots, not after both.
    expect(frozen.order.overlay).toEqual(["layer:root1", "roads", "layer:root2"]);
    // The render order must agree with the persisted order.
    const blocks = roleBlocks("overlay", entries, frozen);
    expect(blocks.map(b => (b.kind === "folder" ? b.key : b.info.id))).toEqual([
      "root1",
      "roads",
      "root2",
    ]);
    // Moving the folder before root2's row keeps both roots around it.
    const moved = moveFolder(frozen, "overlay", "roads", "layer:root2", false);
    expect(moved.order.overlay).toEqual(["layer:root1", "roads", "layer:root2"]);
  });

  it("places a dragged folder after a root row without pushing the other root to the tail", () => {
    const seeded = seedFolderLayout(entries);
    const frozen = freezeRoleOrder(seeded, "overlay", entries, "roads");
    const moved = moveFolder(frozen, "overlay", "roads", "layer:root2", true);
    expect(moved.order.overlay).toEqual(["layer:root1", "layer:root2", "roads"]);
  });

  it("moveFolder accepts a root-layer entry as target when it is listed", () => {
    const seeded = seedFolderLayout(entries);
    const frozen = freezeRoleOrder(seeded, "overlay", entries, "roads");
    // The target is a root-layer entry (not a folder key); the guard must not
    // reject it once the freeze lists it.
    const moved = moveFolder(frozen, "overlay", "roads", "layer:root2", false);
    expect(moved).not.toBe(frozen);
  });
});
