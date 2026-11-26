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
  anchorOfNode,
  defaultArrangement,
  arrangementDeleteBlock as deleteBlock,
  arrangementDeleteEmptyBlocks as deleteEmptyBlocks,
  hydrate,
  arrangementLeafPosition as leafPosition,
  arrangementMoveBlock as moveBlock,
  arrangementMoveEntry as moveEntry,
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
