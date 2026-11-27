// core/layer/layout/defaults — build the default order document from declarations.
//
// The default is a pure function of CONF.data (declaration order): each layer gets
// a rank by its declaration index, so the default layout is independent of the JS
// bundle execution / registration order (design §5). A declared folder becomes a
// folder node at the position of its first member; members nest under it.
import type { LayerRole } from "../role.js";
import type { OrderDoc, OrderNode } from "#core/order/doc.js";
import { rankAfter, rankStart } from "#core/order/rank.js";

/** One layer declaration as the panel receives it (CONF.data row, folded). */
export interface LayerDeclaration {
  id: string;
  role: LayerRole;
  /** Author-declared folder display spelling (null = root). */
  folder?: string | null;
}

/** The identity key for a folder: NFC + whitespace fold + casefold. This is the
 *  same normalization the retired folderLayout used (folder key = normalize(name));
 *  it lives here because the key is a document-model fact, not a UI one. */
export const folderKeyOf = (name: string): string =>
  name.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

/** The doc node key for a layer id. */
export const layerKeyOf = (id: string): string => `layer:${id}`;

/** Build the default document from CONF.data declaration order. Folders are
 *  created at the position of their first member; a layer's rank encodes its
 *  declaration index, so a late registration lands at its default slot (design §5.2 ④). */
export const defaultDoc = (declarations: readonly LayerDeclaration[]): OrderDoc => {
  const nodes: Record<string, OrderNode> = {};
  const rootOrder: string[] = [];
  const folderOrder = new Map<string, string[]>();
  const appendRoot = (key: string, node: Omit<OrderNode, "rank">): void => {
    const prev =
      rootOrder.length > 0 ? nodes[rootOrder[rootOrder.length - 1]].rank : null;
    const rank = prev === null ? rankStart() : rankAfter(prev);
    nodes[key] = { ...node, rank };
    rootOrder.push(key);
  };
  const appendChild = (
    folderKey: string,
    key: string,
    node: Omit<OrderNode, "rank">,
  ): void => {
    const order = folderOrder.get(folderKey) ?? [];
    const prev = order.length > 0 ? nodes[order[order.length - 1]].rank : null;
    const rank = prev === null ? rankStart() : rankAfter(prev);
    nodes[key] = { ...node, rank };
    order.push(key);
    folderOrder.set(folderKey, order);
  };
  for (const decl of declarations) {
    const key = layerKeyOf(decl.id);
    if (nodes[key] !== undefined) continue;
    if (decl.folder && folderKeyOf(decl.folder) !== "") {
      const folderKey = `folder:${folderKeyOf(decl.folder)}`;
      if (nodes[folderKey] === undefined) {
        appendRoot(folderKey, { kind: "folder", parent: null, name: decl.folder });
      }
      appendChild(folderKey, key, { kind: "layer", parent: folderKey });
    } else {
      appendRoot(key, { kind: "layer", parent: null });
    }
  }
  return { nodes };
};
