// test/js/core/layer/order/doc.edges.test.ts — drive the document model's
// defensive branches so the order-system rework keeps whole patch coverage.
import { describe, expect, it } from "vitest";
import {
  ORDER_KIND,
  type OrderDoc,
  folderBareOf,
  isOrderDoc,
  orderDepth,
  resolveView,
  sanitizeOrderDoc,
} from "#core/layer/index.js";

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

  it("sanitizeOrderDoc promotes an over-deep leaf to the nearest legal container", () => {
    // f(d1) → g(d2) → x(d3): x is past the cap, so it is promoted to the nearest
    // legal container (f, depth MAX-1=1); the depth-2 container g stays (empty).
    const d = doc({
      "layer:a": { kind: ORDER_KIND.LAYER, parent: null, rank: "a0" },
      "folder:overlay:f": {
        kind: ORDER_KIND.FOLDER,
        parent: null,
        rank: "a1",
        name: "F",
        role: "overlay",
      },
      "folder:overlay:g": {
        kind: ORDER_KIND.FOLDER,
        parent: "folder:overlay:f",
        rank: "a0",
        name: "G",
        role: "overlay",
      },
      "layer:x": {
        kind: ORDER_KIND.LAYER,
        parent: "folder:overlay:g",
        rank: "a0",
      },
    });
    const out = sanitizeOrderDoc(d);
    expect(out).not.toBeNull();
    // The over-deep leaf is preserved and reparented to the nearest legal container.
    const leaf = out!.nodes["layer:x"];
    expect(leaf).toBeDefined();
    expect(leaf!.kind).toBe(ORDER_KIND.LAYER);
    expect(leaf!.parent).toBe("folder:overlay:f");
    // The depth-2 container survives as an empty folder; the root structure stands.
    expect(out!.nodes["folder:overlay:g"]).toMatchObject({
      kind: ORDER_KIND.FOLDER,
      parent: "folder:overlay:f",
    });
    expect(out!.nodes["folder:overlay:f"]).toBeDefined();
    expect(out!.nodes["layer:a"]).toBeDefined();
    // No node remains deeper than the cap.
    for (const k of Object.keys(out!.nodes)) {
      expect(orderDepth(out!, k)).toBeLessThanOrEqual(2);
    }
  });

  it("sanitizeOrderDoc is idempotent on a legal depth-2 document", () => {
    const d = doc({
      "layer:a": { kind: ORDER_KIND.LAYER, parent: null, rank: "a0" },
      "folder:overlay:f": {
        kind: ORDER_KIND.FOLDER,
        parent: null,
        rank: "a1",
        name: "F",
        role: "overlay",
      },
      "layer:x": {
        kind: ORDER_KIND.LAYER,
        parent: "folder:overlay:f",
        rank: "a0",
      },
    });
    expect(sanitizeOrderDoc(d)).toEqual(d);
  });

  it("resolveView rows after the clamp never exceed depth 2", () => {
    const d = doc({
      "layer:a": { kind: ORDER_KIND.LAYER, parent: null, rank: "a0" },
      "folder:overlay:f": {
        kind: ORDER_KIND.FOLDER,
        parent: null,
        rank: "a1",
        name: "F",
        role: "overlay",
      },
      "layer:x": {
        kind: ORDER_KIND.LAYER,
        parent: "folder:overlay:f",
        rank: "a0",
      },
    });
    const view = resolveView(d, () => true);
    const maxDepth = Math.max(...view.rows.map(r => r.depth));
    expect(maxDepth).toBeLessThanOrEqual(2);
  });
});
