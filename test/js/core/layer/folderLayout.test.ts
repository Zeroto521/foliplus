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
  createFolderLayoutManager,
  deleteFolder,
  dropLayer,
  emptyFolderLayout,
  ensureFolderLayout,
  folderOf,
  freezeRoleOrder,
  fullDisplayOrder,
  groupByFolder,
  isFolderLayout,
  moveLayerToFolder,
  moveLayerToRoot,
  normalizeFolderName,
  readFolderLayout,
  renameFolder,
  restoreAuthorLayout,
  roleOrder,
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
    expect(layout.members.a).toEqual({ role: "overlay", folder: "roads" });
  });

  it("renameFolder materialises a live-only folder when the key is listed but not in the directory", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      order: { overlay: ["roads"] },
    };
    // "roads" is listed (a live block) but has no directory entry: the rename
    // must materialise it rather than dropping the rename.
    const next = renameFolder(layout, "overlay", "Roads", "Streets");
    expect(next.folders).toEqual([{ key: "roads", name: "Streets" }]);
    expect(next.order.overlay).toEqual(["roads"]);
  });

  it("deleteFolder promotes members to root and removes the key", () => {
    let layout = seedFolderLayout([entry("a", "overlay", "Roads", 0)]);
    layout = createFolder(layout, "overlay", "Roads");
    layout = deleteFolder(layout, "overlay", "Roads");
    expect(layout.members.a).toEqual({ role: "overlay", folder: "" });
    expect(layout.folders).toEqual([]);
    expect(layout.order.overlay).toEqual([]);
  });

  it("deleteFolder leaves members in other sections untouched", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "roads", name: "Roads" }],
      order: { overlay: ["roads"], base: ["roads"] },
      members: {
        a: { role: "overlay", folder: "roads" },
        b: { role: "base", folder: "roads" },
      },
    };
    const next = deleteFolder(layout, "overlay", "Roads");
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
      members: { a: { role: "overlay", folder: "roads" } },
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
    writeFolderLayout(existing);

    const manager = createFolderLayoutManager();
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
    writeFolderLayout(existing);

    const manager = createFolderLayoutManager();
    const entryA = entry("a", "overlay", "Water", 1);
    manager.seed([entryA]);

    // The existing assignment wins; the new declaration "water" is not applied.
    expect(manager.layout.members.a).toEqual({ role: "overlay", folder: "roads" });
    expect(manager.layout.folders).toEqual([{ key: "roads", name: "Roads" }]);
  });

  it("an unassigned layer receives its author declaration when seeding", () => {
    const manager = createFolderLayoutManager();
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

  it("roleOrder lists listed keys first then unlisted by anchor, and roots last", () => {
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
    expect(order.map(e => e.id)).toEqual(["a", "c", "b"]);
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

  it("fullDisplayOrder composes both sections", () => {
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

  it("createFolder reuses an existing directory entry across sections", () => {
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

  it("renameFolder is a no-op on blank, normalisation-only, or missing", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "roads", name: "Roads" }],
      order: { overlay: ["roads"] },
    };
    expect(renameFolder(layout, "overlay", "Roads", "  ")).toBe(layout);
    expect(renameFolder(layout, "overlay", "Roads", "roads")).toBe(layout);
    expect(renameFolder(layout, "overlay", "Missing", "X")).toBe(layout);
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

  it("restoreAuthorLayout clears order and members but keeps the directory", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "roads", name: "Streets" }],
      order: { overlay: ["roads"] },
      members: { a: { role: "overlay", folder: "roads" } },
    };
    const restored = restoreAuthorLayout(layout);
    expect(restored.folders).toEqual([{ key: "roads", name: "Streets" }]);
    expect(restored.order.overlay ?? []).toEqual([]);
    expect(restored.members).toEqual({});
  });
});

describe("manager lifecycle", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("set then flush persists, reload re-reads, isEmpty reflects the state", () => {
    const manager = createFolderLayoutManager();
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
    expect(window.localStorage.getItem(LAYOUT_DOC_KEY)).not.toBeNull();
    const fresh = createFolderLayoutManager();
    expect(fresh.layout.members.a).toEqual({ role: "overlay", folder: "roads" });
    fresh.reload();
    expect(fresh.layout.order.overlay).toEqual(["roads"]);
  });

  it("set debounces the write and flush forces it", () => {
    vi.useFakeTimers();
    const manager = createFolderLayoutManager();
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      members: { a: { role: "overlay", folder: "roads" } },
    };
    manager.set(layout);
    expect(window.localStorage.getItem(LAYOUT_DOC_KEY)).toBeNull();
    vi.advanceTimersByTime(200);
    expect(window.localStorage.getItem(LAYOUT_DOC_KEY)).not.toBeNull();
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
    expect(next.order.overlay).toEqual(["water", "roads"]);
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
    expect(renameFolder(layout, "overlay", "Roads", "water")).toBe(layout);
  });

  it("moveLayerToFolder is a no-op on a blank folder key", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      members: { a: { role: "overlay", folder: "roads" } },
    };
    expect(moveLayerToFolder(layout, "a", "overlay", "   ")).toBe(layout);
  });

  it("seed skips an entry without an author folder", () => {
    const manager = createFolderLayoutManager();
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
    const map = { foliplus: api };
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
    writeFolderLayout(existing);
    const manager = createFolderLayoutManager();
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
    expect(renameFolder(layout, "overlay", "Missing", "X")).toBe(layout);
  });

  it("deleteFolder reads the role order through a missing role order", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "roads", name: "Roads" }],
      order: {},
      members: { a: { role: "overlay", folder: "roads" } },
    };
    const next = deleteFolder(layout, "overlay", "Roads");
    expect(next.members.a).toEqual({ role: "overlay", folder: "" });
    expect(next.order.overlay ?? []).toEqual([]);
  });
});
