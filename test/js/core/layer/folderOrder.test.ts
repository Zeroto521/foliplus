// vitest — core/layer/folderOrder invariants (design .foliplus/design/folder-order.md rev2).
//
// All 11 invariants (1,2,3,4,5a,5b,5c,6,7,8,9) are driven against the PURE
// functions — no registry, no controller, no DOM. The registry integration is
// tested separately (where the registry is the anchor axis owner).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type LayerInfo,
  deleteFolderFromOrder,
  freezeSectionOrder,
  fullDisplayOrder,
  normalizeFolderName,
  sectionOrder,
} from "#core/layer/index.js";

/** Minimal LayerInfo shape — the pure functions read `role` and `folder` only. */
function li(id: string, role: "base" | "overlay", folder?: string): LayerInfo {
  return { id, role, folder: folder ?? null } as LayerInfo;
}

const EMPTY = { version: 1 as const, sections: {} };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("normalizeFolderName", () => {
  it("NFC + whitespace fold + trim + casefold, locale-independent", () => {
    // #905 vector (Python side: NFC + trim + whitespace fold, no casefold) —
    // the JS side ADDS the casefold, so Basemap / basemap are ONE key here.
    expect(normalizeFolderName("Basemap")).toBe("basemap");
    expect(normalizeFolderName("basemap")).toBe("basemap");
    expect(normalizeFolderName("  basemap ")).toBe("basemap");
    // internal whitespace run folds to one space
    expect(normalizeFolderName("底 图")).toBe("底 图");
    expect(normalizeFolderName("底  图")).toBe("底 图");
    expect(normalizeFolderName("  底  图  ")).toBe("底 图");
    // NFC composes combining marks (é → e + U+0301 becomes U+00E9)
    expect(normalizeFolderName("e\u0301")).toBe("é");
    // no localeCompare anywhere → cross-locale consistent
    expect(normalizeFolderName("Roads")).toBe("roads");
  });
});

describe("invariant 1 — stability", () => {
  it("same registry snapshot sorts twice to the same order", () => {
    const reg = [
      li("rail", "overlay", "Rail"),
      li("roads1", "overlay", "Roads"),
      li("roads2", "overlay", "Roads"),
      li("root", "overlay"),
    ];
    const a = sectionOrder("overlay", reg, EMPTY);
    const b = sectionOrder("overlay", reg, EMPTY);
    expect(a).toEqual(b);
  });
});

describe("invariant 2 — no localeCompare", () => {
  it("never calls localeCompare (cross-locale consistent)", () => {
    const spy = vi.spyOn(String.prototype, "localeCompare");
    const reg = [
      li("a", "overlay", "干线"),
      li("b", "overlay", "支线"),
      li("c", "overlay", "Roads"),
    ];
    sectionOrder("overlay", reg, EMPTY);
    fullDisplayOrder(reg, EMPTY);
    expect(spy).toHaveBeenCalledTimes(0);
  });
});

describe("invariant 3 — author predictable (anchor = min member index)", () => {
  it("rail@1, Roads@3, Roads@7 → rail block first, Roads one block two members after", () => {
    // registry indices: rail=1, Roads=3 and 7
    const reg = [
      li("x0", "overlay"),
      li("rail", "overlay", "Rail"),
      li("x2", "overlay"),
      li("roads1", "overlay", "Roads"),
      li("x4", "overlay"),
      li("x5", "overlay"),
      li("x6", "overlay"),
      li("roads2", "overlay", "Roads"),
    ];
    const out = sectionOrder("overlay", reg, EMPTY);
    // folders first (rail anchor 1, Roads anchor 3) then root layers in registry order
    expect(out.map(e => e.id)).toEqual([
      "rail",
      "roads1",
      "roads2",
      "x0",
      "x2",
      "x4",
      "x5",
      "x6",
    ]);
  });
});

describe("invariant 4 — folderOrder highest priority", () => {
  it("folderOrder reversing the anchor order wins", () => {
    const reg = [
      li("x0", "overlay"),
      li("rail", "overlay", "Rail"),
      li("roads", "overlay", "Roads"),
    ];
    const order = { version: 1 as const, sections: { overlay: ["roads", "rail"] } };
    const out = sectionOrder("overlay", reg, order);
    expect(out.map(e => e.id)).toEqual(["roads", "rail", "x0"]);
  });
});

describe("invariant 5a — appended new folder lands at the block tail", () => {
  it("new folder first member has the largest index → block at folder-segment end", () => {
    const reg = [
      li("rail", "overlay", "Rail"),
      li("roads", "overlay", "Roads"),
      li("newf", "overlay", "New"),
    ];
    const out = sectionOrder("overlay", reg, EMPTY);
    expect(out.map(e => e.id)).toEqual(["rail", "roads", "newf"]);
  });
});

describe("invariant 5b — mid-inserted folder lands at its first-member position (unfrozen)", () => {
  it("new folder first member index 2 (between 1 and 3) → between those blocks", () => {
    const reg = [
      li("x0", "overlay"),
      li("rail", "overlay", "Rail"), // anchor 1
      li("mid", "overlay", "Mid"), // anchor 2
      li("roads", "overlay", "Roads"), // anchor 3
    ];
    const out = sectionOrder("overlay", reg, EMPTY);
    expect(out.map(e => e.id)).toEqual(["rail", "mid", "roads", "x0"]);
  });
});

describe("invariant 5c — existing folder new member lands at block tail, no block move", () => {
  it("Roads member@3 + member@7 → one Roads block, anchor min=3 unchanged", () => {
    const reg = [
      li("rail", "overlay", "Rail"),
      li("roads1", "overlay", "Roads"), // anchor 3 (index)
      li("roads2", "overlay", "Roads"), // index 7
    ];
    const out = sectionOrder("overlay", reg, EMPTY);
    expect(out.map(e => e.id)).toEqual(["rail", "roads1", "roads2"]);
  });
});

describe("invariant 6 — deleting a folder does not reorder the rest", () => {
  it("remove middle folder → other blocks keep their relative order", () => {
    const reg = [
      li("a", "overlay", "A"),
      li("b", "overlay", "B"),
      li("c", "overlay", "C"),
    ];
    const after = reg.filter(e => e.id !== "b");
    const out = sectionOrder("overlay", after, EMPTY);
    expect(out.map(e => e.id)).toEqual(["a", "c"]);
  });
});

describe("invariant 7 — empty folder preserves position + persists + freeze materialisation", () => {
  it("A/B/C, B emptied → frozen order is A/B/C and B name stays in folderOrder", () => {
    const reg = [
      li("a", "overlay", "A"),
      li("b", "overlay", "B"),
      li("c", "overlay", "C"),
    ];
    // freeze BEFORE the last B member is removed (pre-removal snapshot)
    const frozen = freezeSectionOrder("overlay", reg, EMPTY, normalizeFolderName("B"));
    expect(frozen.sections.overlay).toEqual(["a", "b", "c"]);
    // after B is gone: display has no B block, but B name persists in folderOrder
    const after = reg.filter(e => e.id !== "b");
    const out = sectionOrder("overlay", after, frozen);
    expect(out.map(e => e.id)).toEqual(["a", "c"]);
    expect(frozen.sections.overlay).toContain("b");
  });

  it("a folder with no live members (author-declared) freezes at the block tail, not mid", () => {
    const reg = [li("a", "overlay", "A"), li("c", "overlay", "C")];
    const frozen = freezeSectionOrder("overlay", reg, EMPTY, "b");
    expect(frozen.sections.overlay).toEqual(["a", "c", "b"]);
  });
});

describe("invariant 8 — two-segment: folders first, then root layers", () => {
  it("mixed registry → all folder blocks before root layers, sections in overlay-then-base order", () => {
    const reg = [
      li("root1", "overlay"),
      li("f1", "overlay", "F"),
      li("root2", "overlay"),
      li("base1", "base", "B"),
      li("broot", "base"),
    ];
    const out = fullDisplayOrder(reg, EMPTY);
    expect(out.map(e => e.id)).toEqual(["f1", "root1", "root2", "base1", "broot"]);
  });
});

describe("invariant 9 — freeze side effect: later new folder lands at the block tail", () => {
  it("after a freeze, a mid-inserted folder falls at the folder-segment tail", () => {
    const reg = [
      li("a", "overlay", "A"),
      li("b", "overlay", "B"),
      li("c", "overlay", "C"),
    ];
    const frozen = freezeSectionOrder("overlay", reg, EMPTY, normalizeFolderName("B"));
    // now a NEW folder Mid is inserted mid-registry (index 1)
    const reg2 = [
      li("a", "overlay", "A"),
      li("mid", "overlay", "Mid"),
      li("b", "overlay", "B"),
      li("c", "overlay", "C"),
    ];
    const out = sectionOrder("overlay", reg2, frozen);
    // frozen lists [a,b,c]; Mid is unlisted → appended at the block tail (not mid)
    expect(out.map(e => e.id)).toEqual(["a", "b", "c", "mid"]);
  });
});

describe("deleteFolderFromOrder", () => {
  it("removes the normalised name from the section list", () => {
    const order = { version: 1 as const, sections: { overlay: ["a", "b", "c"] } };
    const next = deleteFolderFromOrder("overlay", "B", order);
    expect(next.sections.overlay).toEqual(["a", "c"]);
  });

  it("is a no-op when the section has no order yet", () => {
    // The `?? []` read side: a section that never entered folderOrder must not
    // invent a key — the result stays an empty overlay list, not undefined.
    const order = { version: 1 as const, sections: {} };
    const next = deleteFolderFromOrder("overlay", "Roads", order);
    expect(next.sections.overlay).toEqual([]);
    expect(next.sections.base).toBeUndefined();
  });
});

describe("third-party same-name-same-role grouping", () => {
  it("groups two third-party layers with the same folder name and role", () => {
    // Two independently-registered third-party layers (same role, same folder
    // display spelling) must land in ONE folder block.
    const entries = [
      li("third-a", "overlay", "Basemap"),
      li("third-b", "overlay", "Basemap"),
    ];
    const order = sectionOrder("overlay", entries, EMPTY);
    // One folder block: the two members are adjacent, folder first segment.
    expect(order.map(l => l.id)).toEqual(["third-a", "third-b"]);
  });

  it("same normalised name, different display spelling, still one folder", () => {
    const entries = [
      li("third-a", "overlay", "Basemap"),
      li("third-b", "overlay", "basemap"),
    ];
    const order = sectionOrder("overlay", entries, EMPTY);
    expect(order.map(l => l.id)).toEqual(["third-a", "third-b"]);
  });

  it("same folder name, different role, stays separate", () => {
    const entries = [
      li("third-overlay", "overlay", "Basemap"),
      li("third-base", "base", "Basemap"),
    ];
    const overlayOrder = sectionOrder("overlay", entries, EMPTY);
    const baseOrder = sectionOrder("base", entries, EMPTY);
    expect(overlayOrder.map(l => l.id)).toEqual(["third-overlay"]);
    expect(baseOrder.map(l => l.id)).toEqual(["third-base"]);
  });
});
