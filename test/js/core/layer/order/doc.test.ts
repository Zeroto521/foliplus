// core/layer/order/doc — the order-document semantics that replaced the retired
// folder-layout ordering helpers (the retired order-pass).
//
// The contract pinned here is the one the old folder-layout domain used to own:
// a folder block is a FIRST-CLASS doc node with a role, so an empty folder keeps
// its role and stays in place after its last member is suppressed, and a member
// can be dragged back in. The doc node (not a block-order helper) is the source.
import { describe, expect, it } from "vitest";
import {
  ORDER_KIND,
  createBranch,
  emptyOrderDoc,
  folderDocKey,
  layerKeyOf,
  moveInto,
  rankFirst,
  restore,
  suppress,
} from "#core/layer/index.js";

const folderKey = folderDocKey("overlay", "roads");

describe("order doc: empty folder keeps role and stays after its last member", () => {
  it("a folder node owns a role and survives the last member's suppression", () => {
    let doc = emptyOrderDoc();
    doc = createBranch(doc, "folder", folderKey, "Roads", "overlay");
    const layerKey = layerKeyOf("a");
    // A freshly registered layer node sits at the root level.
    doc = moveInto(doc, layerKey, folderKey, 0);
    // The layer node must exist before moveInto (the doc is sparse; the
    // adapter inserts declared layers up front). Insert it at the root.
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [layerKey]: { kind: ORDER_KIND.LAYER, parent: null, rank: rankFirst() },
      },
    };
    doc = moveInto(doc, layerKey, folderKey, 0);
    expect(doc.nodes[layerKey]?.parent).toBe(folderKey);
    expect(doc.nodes[folderKey]?.role).toBe("overlay");

    // Suppress the last member (the user delete path).
    const after = suppress(doc, layerKey);
    // The folder node is still present, still owns its role.
    expect(after.nodes[folderKey]?.kind).toBe("folder");
    expect(after.nodes[folderKey]?.role).toBe("overlay");
    expect(after.nodes[layerKey]?.hidden).toBe(true);

    // Restore + move back in: a re-registered layer can rejoin the folder.
    const restored = restore(after, layerKey);
    const rejoined = moveInto(restored, layerKey, folderKey, 0);
    expect(rejoined.nodes[layerKey]?.parent).toBe(folderKey);
    expect(rejoined.nodes[layerKey]?.hidden).toBeUndefined();
    expect(rejoined.nodes[folderKey]?.role).toBe("overlay");
  });

  it("a folder block is role-scoped: the same name in two roles is two folders", () => {
    let doc = emptyOrderDoc();
    const overlayKey = folderDocKey("overlay", "roads");
    const baseKey = folderDocKey("base", "roads");
    doc = createBranch(doc, "folder", overlayKey, "Roads", "overlay");
    doc = createBranch(doc, "folder", baseKey, "Roads", "base");
    expect(doc.nodes[overlayKey]?.role).toBe("overlay");
    expect(doc.nodes[baseKey]?.role).toBe("base");
    expect(overlayKey).not.toBe(baseKey);
  });
});
