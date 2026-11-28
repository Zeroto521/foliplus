// test/js/core/layer/layout.test.ts — the layer layout adapter (defaults/merge/project/persist).
import { describe, expect, it } from "vitest";
import {
  type LayerDeclaration,
  type LayerInfo,
  type ProjectedBlock,
  type RoleOf,
  childrenOfView,
  clearOrderDoc,
  defaultDoc,
  folderKeyOf,
  loadOrderDoc,
  mergeOrderDocs,
  orderKeyOf,
  presentOf,
  projectBlocks,
  projectRows,
  projectView,
  projectZ,
  resolveOrderView,
  saveOrderDoc,
} from "#core/layer/index.js";
import type { OrderDoc } from "#core/order/index.js";

const mapLike = () => ({ getContainer: () => ({ id: "map-x" }) });

const decl = (
  id: string,
  role: "base" | "overlay",
  folder?: string | null,
): LayerDeclaration => ({ id, role, folder: folder ?? null });

describe("defaultDoc", () => {
  it("assigns ranks by declaration order (not registration order)", () => {
    const d = defaultDoc([
      decl("b", "overlay"),
      decl("a", "overlay"),
      decl("c", "base"),
    ]);
    expect(Object.keys(d.nodes)).toEqual(["layer:b", "layer:a", "layer:c"]);
    expect(d.nodes["layer:b"].rank < d.nodes["layer:a"].rank).toBe(true);
    expect(d.nodes["layer:a"].rank < d.nodes["layer:c"].rank).toBe(true);
  });

  it("creates a folder node at its first member position", () => {
    const d = defaultDoc([
      decl("a", "overlay"),
      decl("b", "overlay", "Roads"),
      decl("c", "overlay", "Roads"),
    ]);
    const fk = "folder:overlay:roads";
    expect(d.nodes[fk]).toMatchObject({ kind: "folder", parent: null, name: "Roads" });
    expect(d.nodes["layer:b"].parent).toBe(fk);
    expect(d.nodes["layer:c"].parent).toBe(fk);
  });

  it("late registration lands at its default slot (declaration index rank)", () => {
    const d = defaultDoc([decl("a", "overlay"), decl("z", "overlay")]);
    expect(d.nodes["layer:z"].rank > d.nodes["layer:a"].rank).toBe(true);
  });

  it("folderKeyOf normalizes case + whitespace", () => {
    expect(folderKeyOf("  Roads  ")).toBe("roads");
    expect(folderKeyOf("Roads\tX")).toBe("roads x");
  });
});

describe("mergeOrderDocs", () => {
  it("saved node wins over the default for the same key", () => {
    const defaults = defaultDoc([decl("a", "overlay")]);
    const saved: OrderDoc = {
      nodes: { "layer:a": { kind: "layer", parent: null, rank: "z9", hidden: true } },
    };
    const m = mergeOrderDocs(saved, defaults);
    expect(m.nodes["layer:a"]).toMatchObject({ rank: "z9", hidden: true });
  });

  it("keeps saved-only nodes (dormant/tombstone) at their rank", () => {
    const defaults = defaultDoc([decl("a", "overlay")]);
    const saved: OrderDoc = {
      nodes: { "layer:gone": { kind: "layer", parent: null, rank: "a0" } },
    };
    const m = mergeOrderDocs(saved, defaults);
    expect(m.nodes["layer:gone"]).toBeDefined();
  });

  it("defaults fill keys the saved doc lacks", () => {
    const defaults = defaultDoc([decl("a", "overlay"), decl("b", "overlay")]);
    const saved: OrderDoc = {
      nodes: { "layer:a": { kind: "layer", parent: null, rank: "a0" } },
    };
    const m = mergeOrderDocs(saved, defaults);
    expect(m.nodes["layer:b"]).toBeDefined();
  });
});

const info = (id: string, role: "base" | "overlay"): LayerInfo =>
  ({
    id,
    name: id,
    layer: null,
    kind: "tile",
    carrier: { layer: null },
    role,
    show: true,
    paneName: null,
    paneSpecs: [],
    iconSvg: null,
    type: null,
  }) as LayerInfo;

describe("project", () => {
  const registry = [
    info("a", "overlay"),
    info("x", "overlay"),
    info("y", "overlay"),
    info("b", "base"),
  ];
  const present = presentOf(registry);
  const roleOf = (id: string) => registry.find(i => i.id === id)?.role ?? null;
  const doc = defaultDoc([
    decl("a", "overlay"),
    decl("x", "overlay", "Roads"),
    decl("y", "overlay", "Roads"),
    decl("b", "base"),
  ]);

  it("projectZ returns overlay leaves then base leaves (role ladder, block ignored)", () => {
    expect(projectZ(doc, present, roleOf, "overlay")).toEqual(["a", "x", "y"]);
    expect(projectZ(doc, present, roleOf, "base")).toEqual(["b"]);
  });

  it("projectRows returns typed rows in DFS order (role header is a UI concern)", () => {
    const rows = projectRows(doc, present, roleOf, "overlay");
    expect(rows.map(r => r.key)).toEqual([
      "layer:a",
      "folder:overlay:roads",
      "layer:x",
      "layer:y",
    ]);
    expect(rows[0]).toMatchObject({ kind: "layer", depth: 1 });
    expect(rows[1]).toMatchObject({ kind: "block", depth: 1, name: "Roads" });
  });

  it("projectBlocks returns folder blocks with live members + root layer rows", () => {
    const blocks = projectBlocks(doc, present, registry, "overlay");
    expect(blocks[0]).toMatchObject({ kind: "layer" });
    expect(blocks[1]).toMatchObject({
      kind: "folder",
      key: "roads",
      name: "Roads",
    });
    if (blocks[1].kind === "folder") {
      expect(blocks[1].members.map(i => i.id)).toEqual(["x", "y"]);
    }
  });

  it("projectView returns the engine rows/leaves/blocks (same-source I2)", () => {
    const v = projectView(doc, present);
    expect(v.leaves).toEqual(["layer:a", "layer:x", "layer:y", "layer:b"]);
    expect(v.rows.length).toBeGreaterThan(0);
    expect(v.blocks.length).toBeGreaterThan(0);
    const roleOf2: RoleOf = roleOf;
    expect(roleOf2("a")).toBe("overlay");
    const b: ProjectedBlock | undefined = projectBlocks(
      doc,
      present,
      registry,
      "overlay",
    )[0];
    expect(b?.kind).toBe("layer");
  });

  it("resolveOrderView returns typed rows/blocks/z from one resolve (single source)", () => {
    const view = resolveOrderView(doc, present, registry);
    expect(view.z).toEqual(["a", "x", "y", "b"]);
    expect(view.rows.overlay.map(r => r.key)).toEqual([
      "layer:a",
      "folder:overlay:roads",
    ]);
    expect(view.rows.overlay[1]).toMatchObject({ kind: "block", depth: 1 });
    expect(view.rows.base.map(r => r.key)).toEqual(["layer:b"]);
    const f = view.blocks.overlay.find(b => b.kind === "folder");
    expect(f).toMatchObject({ kind: "folder", key: "roads", name: "Roads" });
    if (f && f.kind === "folder") expect(f.members.map(i => i.id)).toEqual(["x", "y"]);
  });

  it("childrenOfView returns the ordered children of a parent", () => {
    expect(childrenOfView(doc, null).children).toContain("folder:overlay:roads");
    expect(childrenOfView(doc, "folder:overlay:roads").children).toEqual([
      "layer:x",
      "layer:y",
    ]);
  });

  it("presentOf hides a layer whose info is not registered", () => {
    const p = presentOf([info("a", "overlay")]);
    expect(p("layer:a")).toBe(true);
    expect(p("layer:zzz")).toBe(false);
  });
});

describe("persist", () => {
  it("round-trips a document through localStorage", () => {
    const map = mapLike();
    clearOrderDoc(map);
    expect(loadOrderDoc(map)).toBeNull();
    const d = defaultDoc([decl("a", "overlay")]);
    expect(saveOrderDoc(map, d)).toBe(true);
    expect(loadOrderDoc(map)).toEqual(d);
    expect(orderKeyOf(map)).toContain("layer_order");
    clearOrderDoc(map);
    expect(loadOrderDoc(map)).toBeNull();
  });

  it("returns null for an invalid shape (no migration)", () => {
    const map = mapLike();
    window.localStorage.setItem(
      orderKeyOf(map),
      JSON.stringify({ version: 2, nodes: { x: 1 } }),
    );
    expect(loadOrderDoc(map)).toBeNull();
    window.localStorage.removeItem(orderKeyOf(map));
  });

  it("drops an over-depth subtree on load, not fatal", () => {
    const map = mapLike();
    const over: OrderDoc = {
      nodes: {
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
      },
    };
    window.localStorage.setItem(orderKeyOf(map), JSON.stringify(over));
    const loaded = loadOrderDoc(map);
    expect(loaded).not.toBeNull();
    expect(loaded!.nodes["layer:x"]).toBeUndefined();
    window.localStorage.removeItem(orderKeyOf(map));
  });
});

describe("projection edges", () => {
  const doc = (nodes: OrderDoc["nodes"]): OrderDoc => ({ nodes });
  const info = (id: string, role: "overlay" | "base"): LayerInfo =>
    ({
      id,
      name: id,
      layer: null,
      kind: "tile",
      carrier: {},
      role,
    }) as unknown as LayerInfo;

  it("resolveOrderView skips unknown ids and keeps empty folders in their role", () => {
    const d = doc({
      "layer:p1": { kind: "layer", parent: null, rank: "a0" },
      "folder:overlay:vacant": {
        kind: "folder",
        parent: null,
        rank: "a1",
        name: "Vacant",
        role: "overlay",
      },
      "layer:gone": { kind: "layer", parent: "folder:overlay:vacant", rank: "a0" },
      "layer:q1": { kind: "layer", parent: null, rank: "a2" },
    });
    const reg = [info("p1", "overlay"), info("q1", "base")];
    const view = resolveOrderView(d, presentOf(reg), reg);
    expect(view.rows.overlay.some(r => r.kind === "block")).toBe(true);
    expect(view.rows.base.some(r => r.key === "layer:gone")).toBe(false);
    expect(view.rows.overlay.some(r => r.key === "layer:p1")).toBe(true);
    expect(view.rows.base.some(r => r.key === "layer:q1")).toBe(true);
  });

  it("projectRows drops a block with no member of the role", () => {
    const d = doc({
      "folder:overlay:v": {
        kind: "folder",
        parent: null,
        rank: "a0",
        name: "V",
        role: "overlay",
      },
      "layer:gone": { kind: "layer", parent: "folder:overlay:v", rank: "a0" },
    });
    const reg = [info("p1", "overlay")];
    const roleOf = (id: string) => reg.find(i => i.id === id)?.role ?? null;
    const rows = projectRows(d, presentOf(reg), roleOf, "base");
    expect(rows).toEqual([]);
  });

  it("projectBlocks omits a block with no members", () => {
    const d = doc({
      "layer:p1": { kind: "layer", parent: null, rank: "a0" },
    });
    const reg = [info("p1", "overlay")];
    const blocks = projectBlocks(d, presentOf(reg), reg, "overlay");
    expect(blocks.some(b => b.kind === "layer")).toBe(true);
  });

  it("defaultDoc skips a duplicate layer id", () => {
    const d = defaultDoc([
      { id: "a", role: "overlay", folder: null },
      { id: "a", role: "overlay", folder: null },
    ]);
    expect(Object.keys(d.nodes).filter(k => k === "layer:a").length).toBe(1);
  });
});
