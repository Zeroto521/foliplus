// test/js/core/order/order.test.ts — document validation and the command library.
import { describe, expect, it } from "vitest";
import {
  type OrderDoc,
  childrenOf,
  createBlock,
  deleteBlock,
  emptyOrderDoc,
  isOrderDoc,
  moveBefore,
  moveInto,
  moveToIndex,
  renameBlock,
  resetOrder,
  restore,
  sanitizeOrderDoc,
  suppress,
} from "#core/order/index.js";

const doc = (nodes: OrderDoc["nodes"]): OrderDoc => ({ nodes });

describe("isOrderDoc", () => {
  it("accepts a valid document", () => {
    expect(
      isOrderDoc(
        doc({
          "layer:a": { kind: "layer", parent: null, rank: "a0" },
          "folder:overlay:f": {
            kind: "folder",
            parent: null,
            rank: "a1",
            name: "F",
            role: "overlay",
          },
          "layer:x": {
            kind: "layer",
            parent: "folder:overlay:f",
            rank: "a0",
            hidden: true,
          },
        }),
      ),
    ).toBe(true);
  });

  it("rejects an unknown kind", () => {
    expect(
      isOrderDoc(
        doc({
          "layer:a": { kind: "bogus", parent: null, rank: "a0" } as never,
        }),
      ),
    ).toBe(false);
  });

  it("rejects a missing parent", () => {
    expect(
      isOrderDoc(
        doc({
          "layer:a": { kind: "layer", parent: "layer:nope", rank: "a0" },
        }),
      ),
    ).toBe(false);
  });

  it("rejects a parent cycle", () => {
    expect(
      isOrderDoc(
        doc({
          "folder:overlay:a": {
            kind: "folder",
            parent: "folder:overlay:b",
            rank: "a0",
            name: "A",
            role: "overlay",
          },
          "folder:overlay:b": {
            kind: "folder",
            parent: "folder:overlay:a",
            rank: "a0",
            name: "B",
            role: "overlay",
          },
        }),
      ),
    ).toBe(false);
  });

  it("accepts a depth > 3 document as valid shape (sanitize drops the over-depth subtree)", () => {
    expect(
      isOrderDoc(
        doc({
          "folder:overlay:a": {
            kind: "folder",
            parent: null,
            rank: "a0",
            name: "A",
            role: "overlay",
          },
          "folder:overlay:b": {
            kind: "folder",
            parent: "folder:overlay:a",
            rank: "a0",
            name: "B",
            role: "overlay",
          },
          "folder:overlay:c": {
            kind: "folder",
            parent: "folder:overlay:b",
            rank: "a0",
            name: "C",
            role: "overlay",
          },
          "layer:x": { kind: "layer", parent: "folder:overlay:c", rank: "a0" },
        }),
      ),
    ).toBe(true);
  });

  it("sanitize drops over-depth subtrees (depth 3 allowed, 4 dropped)", () => {
    const s = sanitizeOrderDoc(
      doc({
        "folder:overlay:a": {
          kind: "folder",
          parent: null,
          rank: "a0",
          name: "A",
          role: "overlay",
        },
        "folder:overlay:b": {
          kind: "folder",
          parent: "folder:overlay:a",
          rank: "a0",
          name: "B",
          role: "overlay",
        },
        "folder:overlay:c": {
          kind: "folder",
          parent: "folder:overlay:b",
          rank: "a0",
          name: "C",
          role: "overlay",
        },
        "layer:x": { kind: "layer", parent: "folder:overlay:c", rank: "a0" },
      }),
    );
    expect(s).not.toBeNull();
    expect(s!.nodes["layer:x"]).toBeUndefined();
    expect(s!.nodes["folder:overlay:c"]).toBeDefined();
  });
});

describe("commands", () => {
  it("suppress and restore flip the hidden marker", () => {
    let d = doc({ "layer:a": { kind: "layer", parent: null, rank: "a0" } });
    d = suppress(d, "layer:a");
    expect(d.nodes["layer:a"].hidden).toBe(true);
    d = restore(d, "layer:a");
    expect(d.nodes["layer:a"].hidden).toBeUndefined();
  });

  it("moveBefore re-parents and inserts before the target", () => {
    let d = doc({
      "layer:a": { kind: "layer", parent: null, rank: "a0" },
      "layer:b": { kind: "layer", parent: null, rank: "a1" },
      "layer:c": { kind: "layer", parent: null, rank: "a2" },
    });
    d = moveBefore(d, "layer:c", "layer:b");
    expect(childrenOf(d, null)).toEqual(["layer:a", "layer:c", "layer:b"]);
    expect(d.nodes["layer:c"].parent).toBeNull();
  });

  it("moveInto places at an index inside a container", () => {
    let d = doc({
      "folder:overlay:f": {
        kind: "folder",
        parent: null,
        rank: "a0",
        name: "F",
        role: "overlay",
      },
      "layer:a": { kind: "layer", parent: "folder:overlay:f", rank: "a0" },
      "layer:b": { kind: "layer", parent: "folder:overlay:f", rank: "a1" },
      "layer:c": { kind: "layer", parent: null, rank: "a2" },
    });
    d = moveInto(d, "layer:c", "folder:overlay:f", 1);
    expect(childrenOf(d, "folder:overlay:f")).toEqual([
      "layer:a",
      "layer:c",
      "layer:b",
    ]);
    expect(d.nodes["layer:c"].parent).toBe("folder:overlay:f");
  });

  it("moveToIndex moves to a root absolute index", () => {
    let d = doc({
      "layer:a": { kind: "layer", parent: null, rank: "a0" },
      "layer:b": { kind: "layer", parent: null, rank: "a1" },
      "layer:c": { kind: "layer", parent: null, rank: "a2" },
    });
    d = moveToIndex(d, "layer:a", null, 2);
    expect(childrenOf(d, null)).toEqual(["layer:b", "layer:c", "layer:a"]);
  });

  it("createBlock / renameBlock / deleteBlock manage folder blocks", () => {
    let d = emptyOrderDoc();
    d = createBlock(d, "folder", "folder:overlay:new", "New", "overlay");
    expect(d.nodes["folder:overlay:new"]).toMatchObject({
      kind: "folder",
      name: "New",
      parent: null,
    });
    d = renameBlock(d, "folder:overlay:new", "Renamed");
    expect(d.nodes["folder:overlay:new"].name).toBe("Renamed");
    d = deleteBlock(d, "folder:overlay:new");
    expect(d.nodes["folder:overlay:new"]).toBeUndefined();
  });

  it("deleteBlock refuses a non-empty block", () => {
    const d = doc({
      "folder:overlay:f": {
        kind: "folder",
        parent: null,
        rank: "a0",
        name: "F",
        role: "overlay",
      },
      "layer:a": { kind: "layer", parent: "folder:overlay:f", rank: "a0" },
    });
    expect(deleteBlock(d, "folder:overlay:f")).toBe(d);
  });
  it("renameBlock / deleteBlock are defensive on unknown and layer keys", () => {
    const d = doc({
      "layer:a": { kind: "layer", parent: null, rank: "a0" },
    });
    // Unknown key — no-op returns the same document.
    expect(renameBlock(d, "folder:overlay:missing", "X")).toBe(d);
    expect(deleteBlock(d, "folder:overlay:missing")).toBe(d);
    // A layer key is not a block — no-op.
    expect(renameBlock(d, "layer:a", "X")).toBe(d);
    expect(deleteBlock(d, "layer:a")).toBe(d);
  });

  it("isOrderDoc rejects a non-folder node carrying a role", () => {
    expect(
      isOrderDoc(
        doc({
          "layer:a": { kind: "layer", parent: null, rank: "a0", role: "overlay" },
        }),
      ),
    ).toBe(false);
  });

  it("resetOrder returns a clone of the defaults", () => {
    const defaults = doc({ "layer:a": { kind: "layer", parent: null, rank: "a0" } });
    const r = resetOrder(defaults);
    expect(r.nodes["layer:a"]).toEqual(defaults.nodes["layer:a"]);
    expect(r).not.toBe(defaults);
  });
});

describe("command edge cases", () => {
  const base = (): OrderDoc =>
    doc({
      "layer:a": { kind: "layer", parent: null, rank: "a0" },
      "layer:b": { kind: "layer", parent: null, rank: "a1" },
      "folder:overlay:f": {
        kind: "folder",
        parent: null,
        rank: "a2",
        name: "F",
        role: "overlay",
      },
    });

  it("suppress ignores a non-layer key", () => {
    const d = base();
    expect(suppress(d, "folder:overlay:f")).toBe(d);
  });

  it("restore ignores a non-layer key", () => {
    const d = base();
    expect(restore(d, "folder:overlay:f")).toBe(d);
  });

  it("restore clears the hidden marker on a hidden layer", () => {
    const d = doc({
      "layer:a": { kind: "layer", parent: null, rank: "a0", hidden: true },
    });
    const out = restore(d, "layer:a");
    expect(out.nodes["layer:a"].hidden).toBeUndefined();
  });

  it("moveBefore ignores a non-layer source", () => {
    const d = base();
    expect(moveBefore(d, "folder:overlay:f", "layer:b")).toBe(d);
  });

  it("moveBefore moves across parents", () => {
    const d = doc({
      "layer:a": { kind: "layer", parent: null, rank: "a0" },
      "layer:b": { kind: "layer", parent: "layer:a", rank: "a1" },
    });
    const out = moveBefore(d, "layer:b", "layer:a");
    expect(out.nodes["layer:b"].parent).toBeNull();
  });

  it("moveBefore to a non-first sibling computes a rank inside the gap", () => {
    const d = base();
    const out = moveBefore(d, "layer:b", "folder:overlay:f");
    const r = out.nodes["layer:b"].rank;
    expect(r > d.nodes["layer:a"].rank && r < d.nodes["folder:overlay:f"].rank).toBe(
      true,
    );
  });

  it("moveBefore handles equal-rank neighbours without renumbering", () => {
    const d = doc({
      "layer:a": { kind: "layer", parent: null, rank: "a0" },
      "layer:b": { kind: "layer", parent: null, rank: "a0" },
      "layer:c": { kind: "layer", parent: null, rank: "a1" },
    });
    const out = moveBefore(d, "layer:c", "layer:b");
    expect(out.nodes["layer:c"].rank).toBe("a0");
  });

  it("moveInto ignores a layer container", () => {
    const d = base();
    expect(moveInto(d, "layer:b", "layer:a")).toBe(d);
  });

  it("moveToIndex ignores a non-layer source", () => {
    const d = base();
    expect(moveToIndex(d, "folder:overlay:f", null, 0)).toBe(d);
  });

  it("moveToIndex ignores an undefined container", () => {
    const d = base();
    expect(moveToIndex(d, "layer:b", "layer:nope", 0)).toBe(d);
  });

  it("createBlock ignores a layer kind", () => {
    const d = base();
    expect(createBlock(d, "layer", "layer:x", "X")).toBe(d);
  });

  it("createBlock ignores an existing key", () => {
    const d = base();
    expect(createBlock(d, "folder", "folder:overlay:f", "F", "overlay")).toBe(d);
  });

  it("createBlock ignores a folder without a role", () => {
    const d = base();
    expect(createBlock(d, "folder", "folder:overlay:g", "G")).toBe(d);
  });

  it("createBlock ignores a group carrying a role", () => {
    const d = base();
    expect(createBlock(d, "group", "group:g", "G", "overlay")).toBe(d);
  });

  it("resetOrder falls back to empty for an invalid default", () => {
    const out = resetOrder({ nodes: {} } as unknown as OrderDoc);
    expect(out.nodes).toEqual({});
  });
});
