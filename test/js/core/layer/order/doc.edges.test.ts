// test/js/core/layer/order/doc.edges.test.ts — drive the document model's
// defensive branches so the order-system rework keeps whole patch coverage.
import { describe, expect, it } from "vitest";
import {
  ORDER_KIND,
  type OrderDoc,
  folderBareOf,
  isOrderDoc,
  orderDepth,
  sanitizeOrderDoc,
} from "#core/layer/order/index.js";

const doc = (nodes: OrderDoc["nodes"]): OrderDoc => ({ nodes });

describe("doc edges", () => {
  it("folderBareOf returns a malformed folder key unchanged", () => {
    expect(folderBareOf("folder:overlay")).toBe("folder:overlay");
  });

  it("isOrderDoc rejects a node with a non-string parent", () => {
    const d = doc({
      "layer:a": { kind: ORDER_KIND.LAYER, parent: 5 as never, rank: "a0" },
    });
    expect(isOrderDoc(d)).toBe(false);
  });

  it("isOrderDoc rejects an empty rank", () => {
    const d = doc({
      "layer:a": { kind: ORDER_KIND.LAYER, parent: null, rank: "" },
    });
    expect(isOrderDoc(d)).toBe(false);
  });

  it("isOrderDoc rejects a non-string name", () => {
    const d = doc({
      "folder:overlay:f": {
        kind: ORDER_KIND.FOLDER,
        parent: null,
        rank: "a0",
        name: 5 as never,
        role: "overlay",
      },
    });
    expect(isOrderDoc(d)).toBe(false);
  });

  it("isOrderDoc rejects a non-true hidden marker", () => {
    const d = doc({
      "layer:a": {
        kind: ORDER_KIND.LAYER,
        parent: null,
        rank: "a0",
        hidden: false as never,
      },
    });
    expect(isOrderDoc(d)).toBe(false);
  });

  it("isOrderDoc rejects a folder with an invalid role", () => {
    const d = doc({
      "folder:overlay:f": {
        kind: ORDER_KIND.FOLDER,
        parent: null,
        rank: "a0",
        name: "F",
        role: "bogus" as never,
      },
    });
    expect(isOrderDoc(d)).toBe(false);
  });

  it("orderDepth returns 0 for an unknown key", () => {
    const d = doc({
      "layer:a": { kind: ORDER_KIND.LAYER, parent: null, rank: "a0" },
    });
    expect(orderDepth(d, "layer:nope")).toBe(0);
  });

  it("isOrderDoc rejects a non-object", () => {
    expect(isOrderDoc("x")).toBe(false);
  });

  it("isOrderDoc rejects an empty node key", () => {
    const d = doc({ "": { kind: ORDER_KIND.LAYER, parent: null, rank: "a0" } });
    expect(isOrderDoc(d)).toBe(false);
  });

  it("sanitizeOrderDoc returns null for a structurally invalid doc", () => {
    expect(sanitizeOrderDoc({ nodes: { "layer:a": { kind: "bogus" } } })).toBeNull();
  });
});
