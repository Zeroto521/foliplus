// core/layer/arrangement — the ordered-tree model and its two projections.
//
// Stage 1 of the single-order refactor: this suite drives the model directly
// (no DOM, no storage, no production caller). Equivalence with today's projections is the
// parity suite's job; here each rule is pinned on its own.
import { entry } from "./arrangement.fixture.js";
import { describe, expect, it } from "vitest";
import {
  type Arrangement,
  type ResolvedTree,
  emptyFolderLayout,
  fromV2,
  hydrate,
  mergeDeclaredFolders,
  projectRows,
  projectZ,
} from "#core/layer/index.js";

/** The rows a role projects, without the role header row. */
const rowsOf = (resolved: ResolvedTree, role: "overlay" | "base"): string[] =>
  projectRows(resolved, role).slice(1);

describe("fromV2", () => {
  it("projects an empty layout as the registry's root layers, in anchor order", () => {
    const entries = [entry("a", "overlay", null, 0), entry("b", "overlay", null, 1)];
    const tree = fromV2(emptyFolderLayout(), entries);
    expect(tree.version).toBe(3);
    expect(tree.blocks).toEqual({});
    expect(tree.roles.overlay).toEqual([
      { kind: "layer", id: "a" },
      { kind: "layer", id: "b" },
    ]);
    expect(tree.roles.base).toEqual([]);
  });

  it("turns a declared folder into a block whose children keep registry order", () => {
    const entries = [
      entry("a", "overlay", "Roads", 0),
      entry("b", "overlay", "roads", 1),
      entry("c", "overlay", null, 2),
    ];
    const tree = fromV2(mergeDeclaredFolders(emptyFolderLayout(), entries), entries);
    // The same normalised key merges both spellings; the first-seen name wins.
    expect(tree.blocks.roads).toEqual({ kind: "folder", key: "roads", name: "Roads" });
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

  it("keeps an empty listed folder as a row", () => {
    const layout = {
      ...emptyFolderLayout(),
      folders: [{ key: "empty", name: "Empty" }],
      order: { overlay: ["empty"] },
    };
    const tree = fromV2(layout, [entry("a", "overlay", null, 0)]);
    expect(tree.roles.overlay).toEqual([
      { kind: "folder", key: "empty", children: [] },
      { kind: "layer", id: "a" },
    ]);
    expect(tree.blocks.empty).toEqual({ kind: "folder", key: "empty", name: "Empty" });
  });

  it("honours a frozen block order including a root layer between two folders", () => {
    const entries = [
      entry("a", "overlay", "one", 0),
      entry("mid", "overlay", null, 1),
      entry("b", "overlay", "two", 2),
    ];
    const layout = {
      ...mergeDeclaredFolders(emptyFolderLayout(), entries),
      order: { overlay: ["one", "layer:mid", "two"] },
    };
    const tree = fromV2(layout, entries);
    expect(
      tree.roles.overlay.map(node => (node.kind === "layer" ? node.id : node.key)),
    ).toEqual(["one", "mid", "two"]);
  });

  it("ignores a root-layer order entry for a layer that now lives in a folder", () => {
    const entries = [entry("a", "overlay", "roads", 0)];
    const layout = {
      ...mergeDeclaredFolders(emptyFolderLayout(), entries),
      order: { overlay: ["layer:a", "roads"] },
    };
    const tree = fromV2(layout, entries);
    // The stale root entry projects nothing; the folder still owns the layer.
    expect(tree.roles.overlay).toEqual([
      { kind: "folder", key: "roads", children: [{ kind: "layer", id: "a" }] },
    ]);
  });

  it("drops a non-root layer whose folder key normalises to empty (v2 parity)", () => {
    // The v2 projection drops it too: it is neither a root layer nor a block
    // member. Pinned here so a future stage cannot silently change the shape.
    const entries = [entry("a", "overlay", "   ", 0), entry("b", "overlay", null, 1)];
    const tree = fromV2(emptyFolderLayout(), entries);
    expect(tree.roles.overlay).toEqual([{ kind: "layer", id: "b" }]);
  });
});

describe("hydrate", () => {
  it("inserts a late registration at its anchor", () => {
    const entries = [entry("a", "overlay", null, 0), entry("b", "overlay", null, 1)];
    const tree = fromV2(emptyFolderLayout(), entries);
    const late = [...entries, entry("late", "overlay", null, 2)];
    // The tree was built before "late" existed: it lands after b.
    expect(rowsOf(hydrate(tree, late), "overlay")).toEqual([
      "layer:a",
      "layer:b",
      "layer:late",
    ]);
    // A layer registered before both sorts to the head, not the tail.
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
    const entries = [entry("a", "overlay", null, 0), entry("b", "overlay", null, 1)];
    const tree = fromV2(emptyFolderLayout(), entries);
    const resolved = hydrate(tree, [entries[0]]);
    expect(projectZ(resolved)).toEqual(["a"]);
    expect(resolved.orphans).toEqual(["b"]);
    // The persisted tree is untouched: a re-registration returns to its slot.
    expect(rowsOf(hydrate(tree, entries), "overlay")).toEqual(["layer:a", "layer:b"]);
  });

  it("is idempotent and records each layer's parent block", () => {
    const entries = [entry("a", "overlay", "roads", 0), entry("b", "overlay", null, 1)];
    const layout = mergeDeclaredFolders(emptyFolderLayout(), entries);
    const resolved = hydrate(fromV2(layout, entries), entries);
    expect(hydrate(fromV2(layout, entries), entries).roles).toEqual(resolved.roles);
    expect(resolved.parentOf).toEqual({ a: "roads", b: null });
    expect(resolved.orphans).toEqual([]);
  });
});

describe("projectRows", () => {
  it("emits the role header, block headers and leaf rows in tree order", () => {
    const entries = [entry("a", "overlay", "roads", 0), entry("b", "base", null, 1)];
    const layout = mergeDeclaredFolders(emptyFolderLayout(), entries);
    const resolved = hydrate(fromV2(layout, entries), entries);
    expect(projectRows(resolved, "overlay")).toEqual([
      "role:overlay",
      "folder:overlay:roads",
      "layer:a",
    ]);
    expect(projectRows(resolved, "base")).toEqual(["role:base", "layer:b"]);
  });

  it("projects a group block and its children once groups exist", () => {
    // Groups are expressible before the panel renders them (stage 4): the model
    // is the same, the block kind differs.
    const tree: Arrangement = {
      version: 3,
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
    const entries = [
      entry("a", "overlay", "roads", 0),
      entry("b", "overlay", null, 1),
      entry("c", "base", "water", 2),
      entry("d", "base", null, 3),
    ];
    const layout = mergeDeclaredFolders(emptyFolderLayout(), entries);
    const resolved = hydrate(fromV2(layout, entries), entries);
    expect(projectZ(resolved)).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps a folder's layers contiguous in the z sequence", () => {
    const entries = [
      entry("a", "overlay", null, 0),
      entry("b", "overlay", "roads", 1),
      entry("c", "overlay", "roads", 2),
      entry("d", "overlay", null, 3),
    ];
    const layout = mergeDeclaredFolders(emptyFolderLayout(), entries);
    const resolved = hydrate(fromV2(layout, entries), entries);
    expect(projectZ(resolved)).toEqual(["a", "b", "c", "d"]);
    // The block sits where its first member was registered.
    expect(rowsOf(resolved, "overlay")).toEqual([
      "layer:a",
      "folder:overlay:roads",
      "layer:b",
      "layer:c",
      "layer:d",
    ]);
  });
});
