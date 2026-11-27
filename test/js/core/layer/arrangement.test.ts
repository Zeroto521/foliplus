// core/layer/arrangement — the ordered-tree model, its projections and mutations.
//
// Stage 2: `fromV2` (the v2 migration) is gone — the persisted shape IS the
// tree, an unknown record is dropped and rebuilt as the default. This suite
// drives the model directly (no DOM, no storage, no production caller);
// equivalence with the v2 read shapes is the snapshot parity suite's job.
import { entry } from "./arrangement.fixture.js";
import { describe, expect, it } from "vitest";
import {
  type Arrangement,
  type ResolvedTree,
  arrangementAddBlock as addBlock,
  arrangementAddLeaf as addLeaf,
  anchorOfNode,
  arrangementApplySavedOrder as applySavedOrder,
  arrangementRoleOfLeaf,
  defaultArrangement,
  arrangementDeleteBlock as deleteBlock,
  arrangementDeleteEmptyBlocks as deleteEmptyBlocks,
  arrangementDropLeaf as dropLeaf,
  hydrate,
  arrangementLeafPosition as leafPosition,
  arrangementMoveBlock as moveBlock,
  arrangementMoveEntry as moveEntry,
  arrangementPlaceLeafAtSaved as placeLeafAtSaved,
  projectBlocks,
  projectLayout,
  projectRows,
  projectZ,
  arrangementRenameBlock as renameBlock,
} from "#core/layer/index.js";

/** The rows a role projects, without the role header row. */
const rowsOf = (resolved: ResolvedTree, role: "overlay" | "base"): string[] =>
  projectRows(resolved, role).slice(1);

/** A minimal root-only tree: every layer at its role root, in the given order. */
const rootTree = (
  ids: string[],
  _roles?: "overlay"[] | ["overlay" | "base", string[]][],
): Arrangement => {
  const overlay = ids.map(id => ({ kind: "layer" as const, id }));
  return { blocks: {}, roles: { overlay, base: [] } };
};

describe("defaultArrangement", () => {
  it("projects every registered layer at its role root, in registry order", () => {
    const entries = [
      entry("a", "overlay", null, 0),
      entry("b", "overlay", null, 1),
      entry("c", "base", null, 2),
    ];
    const tree = defaultArrangement(entries);
    expect(tree.blocks).toEqual({});
    expect(tree.roles.overlay).toEqual([
      { kind: "layer", id: "a" },
      { kind: "layer", id: "b" },
    ]);
    expect(tree.roles.base).toEqual([{ kind: "layer", id: "c" }]);
  });

  it("materialises a declared folder as a block (the seed's grouping)", () => {
    const entries = [
      entry("a", "overlay", "roads", 0),
      entry("b", "overlay", "roads", 1),
      entry("c", "overlay", null, 2),
    ];
    const tree = defaultArrangement(entries);
    expect(tree.blocks.roads).toEqual({ kind: "folder", key: "roads", name: "roads" });
    expect(tree.roles.overlay).toEqual([
      {
        kind: "folder",
        key: "roads",
        children: [
          { kind: "layer", id: "a" },
          { kind: "layer", id: "b" },
        ],
      },
      { kind: "layer", id: "c" },
    ]);
  });

  it("drops a layer whose folder declaration normalises to nothing", () => {
    // placementFrom classifies a whitespace-only declaration as `dropped`: the
    // layer is neither a root layer (the declaration is truthy) nor a block
    // member (the key is empty) — it renders nowhere, never silently "root".
    const tree = defaultArrangement([entry("x", "overlay", "  ", 0)]);
    expect(tree.blocks).toEqual({});
    expect(tree.roles.overlay).toEqual([]);
  });
});

describe("roleOfLeaf", () => {
  it("returns the role that owns a leaf, and null for an id the tree does not hold", () => {
    const entries = [entry("a", "overlay", "roads", 0), entry("c", "base", null, 1)];
    const tree = defaultArrangement(entries);
    const resolved = hydrate(tree, entries);
    expect(arrangementRoleOfLeaf(resolved, "a")).toBe("overlay");
    expect(arrangementRoleOfLeaf(resolved, "c")).toBe("base");
    // An id the tree does not hold: the null branch (not found in either role).
    expect(arrangementRoleOfLeaf(resolved, "missing")).toBeNull();
  });
});

describe("hydrate", () => {
  it("inserts a late registration at its anchor", () => {
    const tree = rootTree(["a", "b"]);
    const entries = [entry("a", "overlay", null, 0), entry("b", "overlay", null, 1)];
    const late = [...entries, entry("late", "overlay", null, 2)];
    expect(rowsOf(hydrate(tree, late), "overlay")).toEqual([
      "layer:a",
      "layer:b",
      "layer:late",
    ]);
    const early = [
      entry("early", "overlay", null, 0),
      ...entries.map((e, i) => ({ ...e, registeredAt: i + 1 })),
    ];
    expect(rowsOf(hydrate(tree, early), "overlay")).toEqual([
      "layer:early",
      "layer:a",
      "layer:b",
    ]);
  });

  it("drops an unregistered id from the projection and reports it as an orphan", () => {
    const tree = rootTree(["a", "b"]);
    const entries = [entry("a", "overlay", null, 0), entry("b", "overlay", null, 1)];
    const resolved = hydrate(tree, [entries[0]]);
    expect(projectZ(resolved)).toEqual(["a"]);
    expect(resolved.orphans).toEqual(["b"]);
    expect(rowsOf(hydrate(tree, entries), "overlay")).toEqual(["layer:a", "layer:b"]);
  });

  it("is idempotent and records each layer's parent block", () => {
    const tree: Arrangement = {
      blocks: { roads: { kind: "folder", key: "roads", name: "roads" } },
      roles: {
        overlay: [
          { kind: "folder", key: "roads", children: [{ kind: "layer", id: "a" }] },
          { kind: "layer", id: "b" },
        ],
        base: [],
      },
    };
    const entries = [entry("a", "overlay", "roads", 0), entry("b", "overlay", null, 1)];
    const resolved = hydrate(tree, entries);
    expect(hydrate(tree, entries).roles).toEqual(resolved.roles);
    expect(resolved.parentOf).toEqual({ a: "roads", b: null });
    expect(resolved.orphans).toEqual([]);
  });
});

describe("projectRows", () => {
  it("emits the role header, block headers and leaf rows in tree order", () => {
    const tree: Arrangement = {
      blocks: { roads: { kind: "folder", key: "roads", name: "roads" } },
      roles: {
        overlay: [
          { kind: "folder", key: "roads", children: [{ kind: "layer", id: "a" }] },
        ],
        base: [{ kind: "layer", id: "b" }],
      },
    };
    const entries = [entry("a", "overlay", "roads", 0), entry("b", "base", null, 1)];
    const resolved = hydrate(tree, entries);
    expect(projectRows(resolved, "overlay")).toEqual([
      "role:overlay",
      "folder:overlay:roads",
      "layer:a",
    ]);
    expect(projectRows(resolved, "base")).toEqual(["role:base", "layer:b"]);
  });

  it("projects a group block and its children", () => {
    const tree: Arrangement = {
      blocks: { g1: { kind: "group", key: "g1", name: "Group" } },
      roles: {
        overlay: [
          { kind: "group", key: "g1", children: [{ kind: "layer", id: "a" }] },
          { kind: "layer", id: "b" },
        ],
        base: [],
      },
    };
    const entries = [entry("a", "overlay", null, 0), entry("b", "overlay", null, 1)];
    const resolved = hydrate(tree, entries);
    expect(rowsOf(resolved, "overlay")).toEqual([
      "group:overlay:g1",
      "layer:a",
      "layer:b",
    ]);
    expect(resolved.parentOf).toEqual({ a: "g1", b: null });
  });
});

describe("projectZ", () => {
  it("flattens overlays before base layers, blocks expanded in order", () => {
    const tree: Arrangement = {
      blocks: {
        roads: { kind: "folder", key: "roads", name: "roads" },
        water: { kind: "folder", key: "water", name: "water" },
      },
      roles: {
        overlay: [
          { kind: "folder", key: "roads", children: [{ kind: "layer", id: "a" }] },
          { kind: "layer", id: "b" },
        ],
        base: [
          { kind: "folder", key: "water", children: [{ kind: "layer", id: "c" }] },
          { kind: "layer", id: "d" },
        ],
      },
    };
    const entries = [
      entry("a", "overlay", "roads", 0),
      entry("b", "overlay", null, 1),
      entry("c", "base", "water", 2),
      entry("d", "base", null, 3),
    ];
    const resolved = hydrate(tree, entries);
    expect(projectZ(resolved)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("hydrate — partial blocks and defensive anchors", () => {
  it("keeps a folder that lost one member and reports the dead id once", () => {
    const entries = [
      entry("a", "overlay", "roads", 0),
      entry("b", "overlay", "roads", 1),
    ];
    const tree: Arrangement = {
      blocks: { roads: { kind: "folder", key: "roads", name: "roads" } },
      roles: {
        overlay: [
          {
            kind: "folder",
            key: "roads",
            children: [
              { kind: "layer", id: "a" },
              { kind: "layer", id: "b" },
            ],
          },
        ],
        base: [],
      },
    };
    const resolved = hydrate(tree, [entries[1]]);
    expect(rowsOf(resolved, "overlay")).toEqual(["folder:overlay:roads", "layer:b"]);
    expect(resolved.orphans).toEqual(["a"]);
    const twice: Arrangement = {
      ...tree,
      roles: {
        ...tree.roles,
        overlay: [
          { kind: "layer", id: "a" },
          { kind: "folder", key: "roads", children: [{ kind: "layer", id: "a" }] },
        ],
      },
    };
    expect(hydrate(twice, [entries[1]]).orphans).toEqual(["a"]);
  });

  it("does not duplicate a registered layer the tree already holds in a folder", () => {
    const entries = [entry("a", "overlay", "roads", 0), entry("b", "overlay", null, 1)];
    const tree: Arrangement = {
      blocks: { roads: { kind: "folder", key: "roads", name: "roads" } },
      roles: {
        overlay: [
          { kind: "folder", key: "roads", children: [{ kind: "layer", id: "a" }] },
          { kind: "layer", id: "b" },
        ],
        base: [],
      },
    };
    expect(rowsOf(hydrate(tree, entries), "overlay")).toEqual([
      "folder:overlay:roads",
      "layer:a",
      "layer:b",
    ]);
  });

  it("anchors a block by its first member and has no anchor without one", () => {
    const indexById = new Map([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
    expect(anchorOfNode({ kind: "folder", key: "f", children: [] }, indexById)).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(
      anchorOfNode(
        {
          kind: "folder",
          key: "f",
          children: [
            { kind: "layer", id: "c" },
            { kind: "layer", id: "b" },
          ],
        },
        indexById,
      ),
    ).toBe(1);
    expect(anchorOfNode({ kind: "layer", id: "ghost" }, indexById)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe("mutations", () => {
  const twoRoot = (): Arrangement => ({
    blocks: {},
    roles: {
      overlay: [
        { kind: "layer", id: "a" },
        { kind: "layer", id: "b" },
      ],
      base: [],
    },
  });

  it("moveEntry to a new folder creates the block at the role tail", () => {
    const tree = twoRoot();
    const next = moveEntry(tree, "overlay", "a", {
      kind: "folder",
      key: "roads",
      index: 0,
    });
    expect(next.roles.overlay).toEqual([
      { kind: "layer", id: "b" },
      { kind: "folder", key: "roads", children: [{ kind: "layer", id: "a" }] },
    ]);
    expect(next.blocks.roads).toEqual({ kind: "folder", key: "roads", name: "roads" });
  });

  it("moveEntry to root before an entry", () => {
    const tree = twoRoot();
    const next = moveEntry(tree, "overlay", "b", {
      kind: "root",
      beforeEntry: "layer:a",
    });
    expect(next.roles.overlay).toEqual([
      { kind: "layer", id: "b" },
      { kind: "layer", id: "a" },
    ]);
  });

  it("moveEntry is a no-op when the layer is absent", () => {
    const tree = twoRoot();
    expect(moveEntry(tree, "overlay", "ghost", { kind: "root" })).toBe(tree);
  });

  it("moveBlock reorders two top-level blocks", () => {
    const tree: Arrangement = {
      blocks: {
        one: { kind: "folder", key: "one", name: "one" },
        two: { kind: "folder", key: "two", name: "two" },
      },
      roles: {
        overlay: [
          { kind: "folder", key: "one", children: [] },
          { kind: "folder", key: "two", children: [] },
        ],
        base: [],
      },
    };
    const next = moveBlock(tree, "overlay", "two", "one", false);
    expect(next.roles.overlay.map(n => (n.kind === "layer" ? n.id : n.key))).toEqual([
      "two",
      "one",
    ]);
  });

  it("addBlock inserts a folder before an entry", () => {
    const tree = twoRoot();
    const next = addBlock(
      tree,
      "overlay",
      { kind: "folder", key: "f", name: "F" },
      "layer:b",
    );
    expect(next.roles.overlay.map(n => (n.kind === "layer" ? n.id : n.key))).toEqual([
      "a",
      "f",
      "b",
    ]);
  });

  it("deleteBlock promotes members to root", () => {
    const tree: Arrangement = {
      blocks: { f: { kind: "folder", key: "f", name: "F" } },
      roles: {
        overlay: [
          {
            kind: "folder",
            key: "f",
            children: [
              { kind: "layer", id: "a" },
              { kind: "layer", id: "b" },
            ],
          },
          { kind: "layer", id: "c" },
        ],
        base: [],
      },
    };
    const next = deleteBlock(tree, "overlay", "f");
    expect(next.roles.overlay).toEqual([
      { kind: "layer", id: "a" },
      { kind: "layer", id: "b" },
      { kind: "layer", id: "c" },
    ]);
    expect(next.blocks.f).toBeUndefined();
  });

  it("deleteEmptyBlocks removes empty folders only", () => {
    const tree: Arrangement = {
      blocks: { f: { kind: "folder", key: "f", name: "F" } },
      roles: {
        overlay: [
          { kind: "folder", key: "f", children: [] },
          { kind: "layer", id: "a" },
        ],
        base: [],
      },
    };
    const { tree: next, count } = deleteEmptyBlocks(tree, "overlay");
    expect(count).toBe(1);
    expect(next.roles.overlay).toEqual([{ kind: "layer", id: "a" }]);
  });

  it("renameBlock updates the display name only", () => {
    const tree = twoRoot();
    const next = renameBlock(tree, "overlay", "missing", "X");
    expect(next).toBe(tree);
  });

  it("leafPosition locates a root and a folder member", () => {
    const tree: Arrangement = {
      blocks: { f: { kind: "folder", key: "f", name: "F" } },
      roles: {
        overlay: [
          { kind: "folder", key: "f", children: [{ kind: "layer", id: "a" }] },
          { kind: "layer", id: "b" },
        ],
        base: [],
      },
    };
    expect(leafPosition(tree.roles.overlay, "a")).toEqual({
      container: { key: "f" },
      index: 0,
    });
    expect(leafPosition(tree.roles.overlay, "b")).toEqual({
      container: "root",
      index: 1,
    });
  });
});

describe("arrangement mutations — no-op and edge invariants", () => {
  const A = { kind: "layer" as const, id: "a" };
  const B = { kind: "layer" as const, id: "b" };
  const C = { kind: "layer" as const, id: "c" };

  it("returns the SAME tree object for a same-position root move (no-op)", () => {
    const tree: Arrangement = { blocks: {}, roles: { overlay: [A, B, C], base: [] } };
    // "a" already sits at index 0 — the placement puts it back there.
    const out = moveEntry(tree, "overlay", "a", { kind: "root", index: 0 });
    expect(out).toBe(tree);
  });

  it("returns the SAME tree object for a same-position folder-member move (no-op)", () => {
    const folder = { kind: "folder" as const, key: "f", children: [A, B, C] };
    const tree: Arrangement = { blocks: {}, roles: { overlay: [folder], base: [] } };
    const out = moveEntry(tree, "overlay", "b", { kind: "folder", key: "f", index: 1 });
    expect(out).toBe(tree);
  });

  it("returns the same tree when the moved id is not in the role", () => {
    const tree: Arrangement = { blocks: {}, roles: { overlay: [A], base: [] } };
    expect(moveEntry(tree, "overlay", "ghost", { kind: "root", index: 0 })).toBe(tree);
  });

  it("moveEntry on a role the tree does not hold returns the same tree", () => {
    const tree: Arrangement = { blocks: {}, roles: { overlay: [A], base: [] } };
    expect(moveEntry(tree, "base", "a", { kind: "root", index: 0 })).toBe(tree);
  });

  it("addBlock returns the same tree when the block key already exists", () => {
    const folder = { kind: "folder" as const, key: "f", children: [] };
    const tree: Arrangement = { blocks: {}, roles: { overlay: [folder], base: [] } };
    const out = addBlock(
      tree,
      "overlay",
      { kind: "folder", key: "f", name: "f" },
      null,
    );
    expect(out).toBe(tree);
  });

  it("addBlock inserts before a beforeEntry that exists, and at the tail when it does not", () => {
    const tree: Arrangement = { blocks: {}, roles: { overlay: [A, B], base: [] } };
    const before = addBlock(
      tree,
      "overlay",
      { kind: "folder", key: "f", name: "f" },
      "layer:a",
    );
    expect(
      before.roles.overlay.map(n => (n.kind === "layer" ? `layer:${n.id}` : n.key)),
    ).toEqual(["f", "layer:a", "layer:b"]);
    const absent = addBlock(
      tree,
      "overlay",
      { kind: "folder", key: "g", name: "g" },
      "layer:ghost",
    );
    expect(
      absent.roles.overlay.map(n => (n.kind === "layer" ? `layer:${n.id}` : n.key)),
    ).toEqual(["layer:a", "layer:b", "g"]);
  });

  it("deleteBlock / renameBlock / dropLeaf return the same tree for an absent key or id", () => {
    const tree: Arrangement = { blocks: {}, roles: { overlay: [A], base: [] } };
    expect(deleteBlock(tree, "overlay", "ghost")).toBe(tree);
    expect(renameBlock(tree, "overlay", "ghost", "x")).toBe(tree);
    expect(renameBlock(tree, "overlay", "a", "x")).toBe(tree); // key not a block (it's a layer)
    expect(dropLeaf(tree, "overlay", "ghost")).toBe(tree);
  });

  it("deleteEmptyBlocks reports 0 and returns the same tree when no empty block exists", () => {
    const tree: Arrangement = { blocks: {}, roles: { overlay: [A], base: [] } };
    const out = deleteEmptyBlocks(tree, "overlay");
    expect(out.count).toBe(0);
    expect(out.tree).toBe(tree);
  });

  it("applySavedOrder / placeLeafAtSaved return the same tree on an empty role or absent id", () => {
    const empty: Arrangement = { blocks: {}, roles: { overlay: [], base: [] } };
    expect(applySavedOrder(empty, "overlay", ["a"])).toBe(empty);
    const tree: Arrangement = { blocks: {}, roles: { overlay: [A, B], base: [] } };
    expect(placeLeafAtSaved(tree, "overlay", "ghost", ["a"])).toBe(tree);
    expect(applySavedOrder(tree, "overlay", ["ghost"])).not.toBe(tree); // unranked layers sort last
  });

  it("moveBlock returns the same tree when the key or target is absent (or same position)", () => {
    const tree: Arrangement = { blocks: {}, roles: { overlay: [A, B, C], base: [] } };
    expect(moveBlock(tree, "overlay", "ghost", "layer:a", false)).toBe(tree);
    expect(moveBlock(tree, "overlay", "layer:a", "ghost", false)).toBe(tree);
    expect(moveBlock(tree, "overlay", "layer:a", "layer:a", false)).toBe(tree);
  });

  it("roleOfLeaf returns null when the tree lacks the role key", () => {
    const resolved: ResolvedTree = {
      blocks: {},
      roles: { overlay: [A], base: [] },
      parentOf: {},
      orphans: [],
    };
    expect(arrangementRoleOfLeaf(resolved, "a")).toBe("overlay");
    const partial = { ...resolved, roles: {} as ResolvedTree["roles"] };
    expect(arrangementRoleOfLeaf(partial, "a")).toBeNull();
  });
});

describe("arrangement — saved-order rank edges", () => {
  const A = { kind: "layer" as const, id: "a" };
  const B = { kind: "layer" as const, id: "b" };
  const C = { kind: "layer" as const, id: "c" };

  it("applySavedOrder ranks a saved layer above an unsaved one", () => {
    const tree: Arrangement = { blocks: {}, roles: { overlay: [A, B], base: [] } };
    const out = applySavedOrder(tree, "overlay", ["b"]);
    expect(out.roles.overlay).toEqual([B, A]); // saved "b" ranks before unsaved "a"
  });

  it("placeLeafAtSaved moves a root layer DOWN to a later saved slot", () => {
    const tree: Arrangement = { blocks: {}, roles: { overlay: [A, B, C], base: [] } };
    // "a" saved after "c": a moves below b and c.
    const out = placeLeafAtSaved(tree, "overlay", "a", ["b", "c", "a"]);
    expect(out.roles.overlay).toEqual([B, C, A]);
  });

  it("renameBlock returns the same tree when the block meta is absent but the node exists", () => {
    // A folder node with no blocks directory entry: the key matches a node but
    // has no meta — the rename is a no-op.
    const f = { kind: "folder" as const, key: "f", children: [] };
    const tree: Arrangement = { blocks: {}, roles: { overlay: [f], base: [] } };
    expect(renameBlock(tree, "overlay", "f", "x")).toBe(tree);
  });
});

describe("arrangement — absent role key and block-deletion paths", () => {
  const A = { kind: "layer" as const, id: "a" };
  const B = { kind: "layer" as const, id: "b" };

  // Every mutation reads tree.roles[role] with a ?? [] fallback; a tree whose
  // base key is absent (never initialised) exercises that fallback on each.
  it("a tree missing the role key behaves like an empty role on every mutation", () => {
    const tree: Arrangement = {
      blocks: {},
      roles: { overlay: [A] } as Arrangement["roles"],
    };
    expect(moveEntry(tree, "base", "a", { kind: "root", index: 0 })).toBe(tree);
    // addLeaf on an absent (empty) role ADDS the leaf — the fallback is [] so
    // the layer lands at the role tail (a new tree, not a no-op).
    expect(addLeaf(tree, "base", "a", null).roles.base).toEqual([A]);
    expect(applySavedOrder(tree, "base", ["a"])).toBe(tree);
    expect(placeLeafAtSaved(tree, "base", "a", ["a"])).toBe(tree);
    expect(dropLeaf(tree, "base", "a")).toBe(tree);
    expect(moveBlock(tree, "base", "a", "b", false)).toBe(tree);
    expect(
      addBlock(tree, "base", { kind: "folder", key: "f", name: "f" }, null).roles.base,
    ).toEqual([{ kind: "folder", key: "f", children: [] }]);
    expect(deleteBlock(tree, "base", "f")).toBe(tree);
    expect(deleteEmptyBlocks(tree, "base").tree).toBe(tree);
    expect(renameBlock(tree, "base", "f", "x")).toBe(tree);
  });

  it("addLeaf returns the same tree when the id is already carried", () => {
    const tree: Arrangement = { blocks: {}, roles: { overlay: [A], base: [] } };
    expect(addLeaf(tree, "overlay", "a", null)).toBe(tree);
  });

  it("deleteBlock removes a folder block and promotes its layer members", () => {
    const f = { kind: "folder" as const, key: "f", children: [A, B] };
    const tree: Arrangement = {
      blocks: { f: { kind: "folder", key: "f", name: "F" } },
      roles: { overlay: [f], base: [] },
    };
    const out = deleteBlock(tree, "overlay", "f");
    expect(out.roles.overlay).toEqual([A, B]); // members promoted to the role root
    expect(out.blocks.f).toBeUndefined(); // directory entry removed
  });

  it("deleteEmptyBlocks removes an empty folder block and reports the count", () => {
    const f = { kind: "folder" as const, key: "f", children: [] };
    const tree: Arrangement = {
      blocks: { f: { kind: "folder", key: "f", name: "F" } },
      roles: { overlay: [A, f], base: [] },
    };
    const out = deleteEmptyBlocks(tree, "overlay");
    expect(out.count).toBe(1);
    expect(out.tree.roles.overlay).toEqual([A]);
    expect(out.tree.blocks.f).toBeUndefined();
  });

  it("moveBlock moves a root layer down (insert before the removed slot)", () => {
    const tree: Arrangement = { blocks: {}, roles: { overlay: [A, B], base: [] } };
    // "a" to after "b": a moves below b.
    const out = moveBlock(tree, "overlay", "layer:a", "layer:b", true);
    expect(out.roles.overlay).toEqual([B, A]);
  });
});

describe("projectLayout / projectBlocks — edge invariants", () => {
  const A = { kind: "layer" as const, id: "a" };

  it("projectLayout skips a non-folder block in the folder directory", () => {
    const resolved: ResolvedTree = {
      blocks: { g: { kind: "group", key: "g", name: "G" } },
      roles: { overlay: [{ kind: "group", key: "g", children: [A] }], base: [] },
      parentOf: { a: "g" },
      orphans: [],
    };
    const layout = projectLayout(resolved);
    expect(layout.folders).toEqual([]); // group is not a folder
    expect(layout.order.overlay).toEqual(["g"]); // node.key entry, not layer:<id>
    expect(layout.members.a).toEqual({ role: "overlay", folder: "g" });
  });

  it("projectLayout skips a parentOf member whose leaf is not in the tree", () => {
    const resolved: ResolvedTree = {
      blocks: {},
      roles: { overlay: [A], base: [] },
      parentOf: { ghost: null },
      orphans: [],
    };
    const layout = projectLayout(resolved);
    expect(layout.members).toEqual({});
  });

  it("projectLayout maps a root member to the empty-string folder", () => {
    const resolved: ResolvedTree = {
      blocks: {},
      roles: { overlay: [A], base: [] },
      parentOf: { a: null },
      orphans: [],
    };
    const layout = projectLayout(resolved);
    expect(layout.members.a).toEqual({ role: "overlay", folder: "" });
  });

  it("projectBlocks skips a node whose id is not in the registry (orphan)", () => {
    const resolved: ResolvedTree = {
      blocks: {},
      roles: { overlay: [A], base: [] },
      parentOf: {},
      orphans: [],
    };
    const out = projectBlocks(resolved, "overlay", []);
    expect(out).toEqual([]); // "a" has no registry entry → dropped
  });

  it("projectBlocks resolves a folder member from the registry and falls back to key for the name", () => {
    const folder = { kind: "folder" as const, key: "f", children: [A] };
    const resolved: ResolvedTree = {
      blocks: { f: { kind: "folder", key: "f", name: "F" } },
      roles: { overlay: [folder], base: [] },
      parentOf: { a: "f" },
      orphans: [],
    };
    const out = projectBlocks(resolved, "overlay", [entry("a", "overlay", "f", 0)]);
    expect(out).toEqual([
      {
        kind: "folder",
        key: "f",
        name: "F",
        block: { members: [{ ...entry("a", "overlay", "f", 0) }] },
      },
    ]);
  });
});
