// test/js/core/layer/layout/scenarios - the layer-order design §5.2 scenario matrix.
// Default order comes from the Python declaration order (CONF.data), never from
// registration timing: these tests drive defaultDoc -> mergeOrderDocs -> projectView
// directly, so the six scenarios prove the doc model, not the registration sequence.
import { describe, expect, it } from "vitest";
import {
  type LayerDeclaration,
  defaultDoc,
  layerKeyOf,
} from "#core/layer/layout/default.js";
import { mergeOrderDocs } from "#core/layer/layout/merge.js";
import { projectRows, projectView, projectZ } from "#core/layer/layout/project.js";
import { type OrderDoc, emptyOrderDoc } from "#core/order/doc.js";
import { rankAfter } from "#core/order/rank.js";
import type { Present } from "#core/order/resolve.js";

type Role = "overlay" | "base";

const decl = (id: string, role: Role, folder?: string): LayerDeclaration => ({
  id,
  role,
  folder,
});

/** Present predicate from plain ids (a real registry uses LayerInfo; the model reads only ids). */
const presentOfIds = (ids: readonly string[]): Present => {
  const set = new Set(ids.map(id => layerKeyOf(id)));
  return (key: string) => set.has(key);
};

/** Default projection: merge an empty saved doc over the defaults, then resolve. */
const defaultView = (
  declarations: readonly LayerDeclaration[],
  ids: readonly string[],
) =>
  projectView(
    mergeOrderDocs(emptyOrderDoc(), defaultDoc(declarations)),
    presentOfIds(ids),
  );

describe("layer-order scenario matrix (design §5.2)", () => {
  it("scenario 1: layers declared before the control keep writing order", () => {
    const declarations = [decl("a", "overlay"), decl("b", "base"), decl("c", "base")];
    const v = defaultView(declarations, ["a", "b", "c"]);
    expect(v.rows.map(r => r.key)).toEqual(["layer:a", "layer:b", "layer:c"]);
    // I2: z comes from the same projection (no drift between rows and leaves).
    expect(v.leaves).toEqual(["layer:a", "layer:b", "layer:c"]);
  });

  it("scenario 2: control before layers still yields writing order", () => {
    // CONF.data order is the only source; the doc model does not care which script ran first.
    const declarations = [decl("a", "overlay"), decl("b", "base")];
    const v = defaultView(declarations, ["a", "b"]);
    expect(v.rows.map(r => r.key)).toEqual(["layer:a", "layer:b"]);
  });

  it("scenario 3: interleaved layers and control keep writing order", () => {
    const declarations = [
      decl("a", "overlay"),
      decl("b", "base"),
      decl("c", "overlay"),
    ];
    const v = defaultView(declarations, ["a", "b", "c"]);
    expect(v.rows.map(r => r.key)).toEqual(["layer:a", "layer:b", "layer:c"]);
  });

  it("scenario 4: late registration lands at the default slot, not appended", () => {
    const declarations = [
      decl("a", "overlay"),
      decl("b", "overlay"),
      decl("c", "overlay"),
    ];
    // b is declared but not yet registered: dormant, not shown.
    expect(defaultView(declarations, ["a", "c"]).rows.map(r => r.key)).toEqual([
      "layer:a",
      "layer:c",
    ]);
    // b registers late: it appears at its default slot (index 1), not at the end.
    expect(defaultView(declarations, ["a", "b", "c"]).rows.map(r => r.key)).toEqual([
      "layer:a",
      "layer:b",
      "layer:c",
    ]);
  });

  it("scenario 5: dormant declared layer is hidden, then returns to its slot", () => {
    const declarations = [
      decl("a", "overlay"),
      decl("b", "overlay"),
      decl("c", "overlay"),
    ];
    // b declared but never registered: dormant, not displayed.
    expect(defaultView(declarations, ["a", "c"]).rows.map(r => r.key)).toEqual([
      "layer:a",
      "layer:c",
    ]);
    // After registration b returns to its original slot.
    expect(defaultView(declarations, ["a", "b", "c"]).rows.map(r => r.key)).toEqual([
      "layer:a",
      "layer:b",
      "layer:c",
    ]);
  });

  it("scenario 6a: runtime-registered layer with no saved entry appends to its role's default end", () => {
    // c is NOT in CONF and NOT in the saved doc (fresh session, runtime
    // registerLayer). There is no default slot and no saved position, so the
    // controller appends it at the role's default end: a new root node ranked
    // after the last root sibling (base is the last role in ROLE_ORDER).
    const declarations = [decl("a", "overlay"), decl("b", "base")];
    const defaults = defaultDoc(declarations);
    const doc: OrderDoc = {
      nodes: {
        ...defaults.nodes,
        [layerKeyOf("c")]: {
          kind: "layer",
          parent: null,
          rank: rankAfter(defaults.nodes[layerKeyOf("b")].rank),
        },
      },
    };
    const present = presentOfIds(["a", "b", "c"]);
    const roleOf = (id: string): Role | null =>
      ({ a: "overlay", b: "base", c: "base" })[id] ?? null;
    // c joins base's end after b.
    expect(projectZ(doc, present, roleOf, "base")).toEqual(["b", "c"]);
    expect(projectZ(doc, present, roleOf, "overlay")).toEqual(["a"]);
    // Typed rows (no role header in the projection): c after b.
    expect(projectRows(doc, present, roleOf, "base").map(r => r.key)).toEqual([
      "layer:b",
      "layer:c",
    ]);
    expect(projectView(doc, present).rows.map(r => r.key)).toEqual([
      "layer:a",
      "layer:b",
      "layer:c",
    ]);
  });

  it("scenario 6b: runtime-registered layer with a saved rank keeps that position (user intent)", () => {
    // c is NOT in CONF but IS in the saved doc with a rank BEFORE the declared
    // layers. The saved doc is user intent: merge keeps c's saved rank and
    // re-ranks the default-only nodes (a, b) AFTER the saved nodes, so c leads.
    const declarations = [decl("a", "overlay"), decl("b", "base")];
    const defaults = defaultDoc(declarations);
    const saved: OrderDoc = {
      nodes: {
        [layerKeyOf("c")]: { kind: "layer", parent: null, rank: "a0" },
      },
    };
    const doc = mergeOrderDocs(saved, defaults);
    const present = presentOfIds(["a", "b", "c"]);
    const roleOf = (id: string): Role | null =>
      ({ a: "overlay", b: "base", c: "base" })[id] ?? null;
    // Why ['c','a','b']: mergeOrderDocs keeps the saved doc first (saved = user
    // intent), so c's saved rank a0 leads. The default-only nodes (a, b) are
    // re-ranked after the last saved rank, in declaration order (a at index 0,
    // b at index 1) — so a stays before b.
    expect(projectZ(doc, present, roleOf, "base")).toEqual(["c", "b"]);
    expect(projectZ(doc, present, roleOf, "overlay")).toEqual(["a"]);
    expect(projectView(doc, present).rows.map(r => r.key)).toEqual([
      "layer:c",
      "layer:a",
      "layer:b",
    ]);
  });
});