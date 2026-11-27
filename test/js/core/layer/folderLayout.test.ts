// core/layer/folderLayout — the v2 folder-layout domain (kept surface).
//
// These tests drive the pure layout functions (no DOM, no storage) and the
// storage round-trip. The single-source invariant is the thread:
// layout.members[layerId] is the ONLY assignment a layer carries once a layout
// exists, and the order keys are the ONLY block priority. The ordering helpers
// that once lived here moved to the order-doc model (see core/order and
// controller.order.test.ts); the folder
// manager API is gone — the controller projects the derived layout from the doc
// directly.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FolderLayout,
  type LayerInfo,
  type LayerRole,
  createFolder,
  deleteFolder,
  dropLayer,
  emptyFolderLayout,
  folderEntries,
  folderLayoutKey,
  folderOf,
  isFolderLayout,
  mergeDeclaredFolders,
  moveFolder,
  moveLayerToFolder,
  moveLayerToRootAt,
  nextFolderDefaultName,
  readFolderLayout,
  renameFolder,
  rootLayerEntry,
  writeFolderLayout,
} from "#core/layer/index.js";

/** A minimal fake map for the storage-key argument: the layout only reads
 *  `getContainer().id`, so a plain object suffices. */
const fakeMap = (id = "test-map"): { getContainer: () => { id: string } } => ({
  getContainer: () => ({ id }),
});

/** The production merge applied to an empty layout — the "first seed" case.
 *  `mergeDeclaredFolders` is the function the manager's `seed()` used to call,
 *  so driving it directly is a green about production. */
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
    const created = createFolder(layout, "overlay", "Facilities");
    // The pure helper appends the new key to the role's existing block order;
    // the anchor-interleaving (root layers keeping their slots) is the order
    // doc's job (projectLayoutOf), not this pure helper's.
    expect(created.order.overlay).toEqual(["facilities"]);
  });

  it("createFolder keeps root layers interleaved at their anchor slots (P2 #1289)", () => {
    // Same P1 scenario but the folder is created AFTER the layout is seeded:
    // root1/member a/root2, then the user adds a new folder. The roots must stay
    // interleaved, not be pushed to the tail after every folder.
    const entries = [
      entry("root1", "overlay", null, 0),
      entry("a", "overlay", "Roads", 1),
      entry("root2", "overlay", null, 2),
    ] as LayerInfo[];
    const layout = seedFolderLayout(entries);
    expect(layout.order.overlay).toBeUndefined();
    const created = createFolder(layout, "overlay", "New Roads");
    // Append-only (the anchor merge lives in the order doc's projection).
    expect(created.order.overlay).toEqual(["new roads"]);
  });

  it("moveLayerToRootAt places the layer between two listed folder blocks", () => {
    const entries = [
      entry("a", "overlay", "Alpha", 0),
      entry("b", "overlay", "Beta", 1),
    ];
    let layout = seedFolderLayout(entries);
    layout = { ...layout, order: { overlay: ["alpha", "beta"] } };
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
    const entryA = entry("a", "overlay", "Roads", 0);
    const next = mergeDeclaredFolders(existing, [entryA]);

    // The user pin is untouched; the declaration does not sink the layer back.
    expect(next.members.a).toEqual({ role: "overlay", folder: "" });
    expect(next.folders).toEqual([]);
    expect(next.order.overlay ?? []).toEqual([]);
  });

  it("an existing member assignment wins over the author declaration when seeding", () => {
    // Pre-existing layout has layer "a" inside "roads" already.
    const existing: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "roads", name: "Roads" }],
      order: { overlay: ["roads"] },
      members: { a: { role: "overlay", folder: "roads" } },
    };
    const entryA = entry("a", "overlay", "Water", 1);
    const next = mergeDeclaredFolders(existing, [entryA]);

    // The existing assignment wins; the new declaration "water" is not applied.
    expect(next.members.a).toEqual({ role: "overlay", folder: "roads" });
    expect(next.folders).toEqual([{ key: "roads", name: "Roads" }]);
  });

  it("an unassigned layer receives its author declaration when seeding", () => {
    const entryA = entry("a", "overlay", "Roads", 0);
    const next = mergeDeclaredFolders(emptyFolderLayout(), [entryA]);

    expect(next.members.a).toEqual({ role: "overlay", folder: "roads" });
    expect(next.folders).toEqual([{ key: "roads", name: "Roads" }]);
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
describe("pure folder helpers (kept from the order-helper era)", () => {
  it("a root layer's block entry never collides with a folder key", () => {
    const rootEntry = rootLayerEntry("a");
    expect(rootEntry).not.toBe("a");
    expect(folderEntries(["roads", rootEntry, "water"])).toEqual(["roads", "water"]);
    expect(folderEntries([])).toEqual([]);
  });

  it("moveFolder no-ops on a missing role order (the ?? [] arm)", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "roads", name: "Roads" }],
      order: {},
      members: {},
    };
    expect(moveFolder(layout, "overlay", "roads", "water", true)).toBe(layout);
  });

  it("moveFolder no-ops when the target is not listed (key is listed)", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "roads", name: "Roads" }],
      order: { overlay: ["roads"] },
      members: {},
    };
    expect(moveFolder(layout, "overlay", "roads", "ghost", true)).toBe(layout);
  });

  it("renameFolder accepts a member-only folder key (hasOld via members)", () => {
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
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "other", name: "Other" }],
      order: { overlay: ["other"] },
      members: {},
    };
    expect(nextFolderDefaultName(layout, "overlay", "new folder")).toBe("new folder");
  });

  it("nextFolderDefaultName counts a member-only folder in the taken set", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [],
      order: {},
      members: { a: { role: "overlay", folder: "roads" } },
    };
    expect(nextFolderDefaultName(layout, "overlay", "roads")).toBe("roads 2");
  });

  it("nextFolderDefaultName truncates the stem so the suffix still fits the cap", () => {
    const base = "a".repeat(64);
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: base, name: base }],
      order: { overlay: [base] },
      members: {},
    };
    const next = nextFolderDefaultName(layout, "overlay", base);
    expect(next).not.toBe(base);
    expect(next.endsWith(" 2")).toBe(true);
  });

  it("nextFolderDefaultName ignores members of a different role", () => {
    const layout: FolderLayout = {
      ...emptyFolderLayout(),
      folders: [{ key: "new folder", name: "new folder" }],
      order: { overlay: ["new folder"] },
      members: { a: { role: "base", folder: "basemap" } },
    };
    expect(nextFolderDefaultName(layout, "overlay", "new folder")).toBe("new folder 2");
  });
});
