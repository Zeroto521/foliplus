// core/layer/layout/merge — merge the saved order document over the defaults.
//
// The saved doc (user intent) wins per node: for every key the saved doc has, the
// saved node replaces the default node (rank / parent / name / hidden). Keys the
// saved doc has but the defaults do not are KEPT — a declared layer that has not
// registered yet (dormant) or a layer removed from CONF but still re-registerable
// (tombstone) must come back at its recorded position. The merged doc is sanitized
// (over-depth subtrees dropped) so an invalid saved parent chain cannot poison it.
import type { OrderDoc } from "#core/order/index.js";
import { sanitizeOrderDoc } from "#core/order/index.js";
import { rankAfter } from "#core/order/index.js";

/** The last (lexicographic max) rank across the saved doc's root-ranked nodes. */
const orderLastRank = (saved: OrderDoc): string => {
  let last = rankAfter("a0");
  for (const node of Object.values(saved.nodes)) {
    const rank = node.rank;
    if (rank !== undefined && rank > last) last = rank;
  }
  return last;
};

export const mergeOrderDocs = (saved: OrderDoc, defaults: OrderDoc): OrderDoc => {
  const nodes: OrderDoc["nodes"] = { ...defaults.nodes };
  for (const [key, node] of Object.entries(saved.nodes)) {
    nodes[key] = node;
  }
  // A default-only node must not collide with a saved rank: the saved doc is
  // the user's intent, so its ranked slots come first and the defaults fill in
  // AFTER them (declaration order). Re-rank default-only nodes past the saved
  // nodes' ranks so a saved first slot (rankFirst) does not share a rank with
  // the declared first layer.
  const savedKeys = new Set(Object.keys(saved.nodes));
  const defaultOnly = Object.entries(nodes).filter(([k]) => !savedKeys.has(k));
  if (defaultOnly.length > 0) {
    const lastRank = orderLastRank(saved);
    let cursor = lastRank;
    for (const [k, node] of defaultOnly) {
      if (node.kind === "layer" || node.kind === "folder" || node.kind === "group") {
        cursor = rankAfter(cursor);
        nodes[k] = { ...node, rank: cursor };
      }
    }
  }
  const merged: OrderDoc = { nodes };
  return sanitizeOrderDoc(merged) ?? merged;
};
