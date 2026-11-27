// test/js/core/order/order.test.ts — document validation and the command library.
import { describe, expect, it } from "vitest";
import {
  createBlock,
  deleteBlock,
  moveBefore,
  moveInto,
  moveToIndex,
  renameBlock,
  resetOrder,
  restore,
  suppress,
} from "#core/order/command.js";
import { emptyOrderDoc, isOrderDoc, sanitizeOrderDoc } from "#core/order/doc.js";
import type { OrderDoc } from "#core/order/doc.js";
import { childrenOf } from "#core/order/resolve.js";

const doc = (nodes: OrderDoc["nodes"]): OrderDoc => ({ nodes });

describe("isOrderDoc", () => {
  it("accepts a valid document", () => {
    expect(
      isOrderDoc(
        doc({
          "layer:a": { kind: "layer", parent: null, rank: "a0" },
          "folder:f": { kind: "folder", parent: null, rank: "a1", name: "F" },
          "layer:x": { kind: "layer", parent: "folder:f", rank: "a0", hidden: true },
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
          "folder:a": { kind: "folder", parent: "folder:b", rank: "a0", name: "A" },
          "folder:b": { kind: "folder", parent: "folder:a", rank: "a0", name: "B" },
        }),
      ),
    ).toBe(false);
  });

  it("accepts a depth > 3 document as valid shape (sanitize drops the over-depth subtree)", () => {
    expect(
      isOrderDoc(
        doc({
          "folder:a": { kind: "folder", parent: null, rank: "a0", name: "A" },
          "folder:b": { kind: "folder", parent: "folder:a", rank: "a0", name: "B" },
          "folder:c": { kind: "folder", parent: "folder:b", rank: "a0", name: "C" },
          "layer:x": { kind: "layer", parent: "folder:c", rank: "a0" },
        }),
      ),
    ).toBe(true);
  });

  it("sanitize drops over-depth subtrees (depth 3 allowed, 4 dropped)", () => {
    const s = sanitizeOrderDoc(
      doc({
        "folder:a": { kind: "folder", parent: null, rank: "a0", name: "A" },
        "folder:b": { kind: "folder", parent: "folder:a", rank: "a0", name: "B" },
        "folder:c": { kind: "folder", parent: "folder:b", rank: "a0", name: "C" },
        "layer:x": { kind: "layer", parent: "folder:c", rank: "a0" },
      }),
    );
    expect(s).not.toBeNull();
    expect(s!.nodes["layer:x"]).toBeUndefined();
    expect(s!.nodes["folder:c"]).toBeDefined();
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
      "folder:f": { kind: "folder", parent: null, rank: "a0", name: "F" },
      "layer:a": { kind: "layer", parent: "folder:f", rank: "a0" },
      "layer:b": { kind: "layer", parent: "folder:f", rank: "a1" },
      "layer:c": { kind: "layer", parent: null, rank: "a2" },
    });
    d = moveInto(d, "layer:c", "folder:f", 1);
    expect(childrenOf(d, "folder:f")).toEqual(["layer:a", "layer:c", "layer:b"]);
    expect(d.nodes["layer:c"].parent).toBe("folder:f");
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
    d = createBlock(d, "folder", "folder:new", "New");
    expect(d.nodes["folder:new"]).toMatchObject({
      kind: "folder",
      name: "New",
      parent: null,
    });
    d = renameBlock(d, "folder:new", "Renamed");
    expect(d.nodes["folder:new"].name).toBe("Renamed");
    d = deleteBlock(d, "folder:new");
    expect(d.nodes["folder:new"]).toBeUndefined();
  });

  it("deleteBlock refuses a non-empty block", () => {
    const d = doc({
      "folder:f": { kind: "folder", parent: null, rank: "a0", name: "F" },
      "layer:a": { kind: "layer", parent: "folder:f", rank: "a0" },
    });
    expect(deleteBlock(d, "folder:f")).toBe(d);
  });

  it("resetOrder returns a clone of the defaults", () => {
    const defaults = doc({ "layer:a": { kind: "layer", parent: null, rank: "a0" } });
    const r = resetOrder(defaults);
    expect(r.nodes["layer:a"]).toEqual(defaults.nodes["layer:a"]);
    expect(r).not.toBe(defaults);
  });
});
