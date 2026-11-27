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
          "folder:overlay:f": { kind: "folder", parent: null, rank: "a1", name: "F", role: "overlay" },
          "layer:x": { kind: "layer", parent: "folder:overlay:f", rank: "a0", hidden: true },
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
          "folder:overlay:a": { kind: "folder", parent: "folder:overlay:b", rank: "a0", name: "A", role: "overlay" },
          "folder:overlay:b": { kind: "folder", parent: "folder:overlay:a", rank: "a0", name: "B", role: "overlay" },
        }),
      ),
    ).toBe(false);
  });

  it("accepts a depth > 3 document as valid shape (sanitize drops the over-depth subtree)", () => {
    expect(
      isOrderDoc(
        doc({
          "folder:overlay:a": { kind: "folder", parent: null, rank: "a0", name: "A", role: "overlay" },
          "folder:overlay:b": { kind: "folder", parent: "folder:overlay:a", rank: "a0", name: "B", role: "overlay" },
          "folder:overlay:c": { kind: "folder", parent: "folder:overlay:b", rank: "a0", name: "C", role: "overlay" },
          "layer:x": { kind: "layer", parent: "folder:overlay:c", rank: "a0" },
        }),
      ),
    ).toBe(true);
  });

  it("sanitize drops over-depth subtrees (depth 3 allowed, 4 dropped)", () => {
    const s = sanitizeOrderDoc(
      doc({
        "folder:overlay:a": { kind: "folder", parent: null, rank: "a0", name: "A", role: "overlay" },
        "folder:overlay:b": { kind: "folder", parent: "folder:overlay:a", rank: "a0", name: "B", role: "overlay" },
        "folder:overlay:c": { kind: "folder", parent: "folder:overlay:b", rank: "a0", name: "C", role: "overlay" },
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
      "folder:overlay:f": { kind: "folder", parent: null, rank: "a0", name: "F", role: "overlay" },
      "layer:a": { kind: "layer", parent: "folder:overlay:f", rank: "a0" },
      "layer:b": { kind: "layer", parent: "folder:overlay:f", rank: "a1" },
      "layer:c": { kind: "layer", parent: null, rank: "a2" },
    });
    d = moveInto(d, "layer:c", "folder:overlay:f", 1);
    expect(childrenOf(d, "folder:overlay:f")).toEqual(["layer:a", "layer:c", "layer:b"]);
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
      "folder:overlay:f": { kind: "folder", parent: null, rank: "a0", name: "F", role: "overlay" },
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
      isOrderDoc(doc({ "layer:a": { kind: "layer", parent: null, rank: "a0", role: "overlay" } })),
    ).toBe(false);
  });


  it("resetOrder returns a clone of the defaults", () => {
    const defaults = doc({ "layer:a": { kind: "layer", parent: null, rank: "a0" } });
    const r = resetOrder(defaults);
    expect(r.nodes["layer:a"]).toEqual(defaults.nodes["layer:a"]);
    expect(r).not.toBe(defaults);
  });
});
