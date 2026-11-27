// core/layer/layout/merge — merge the saved order document over the defaults.
//
// The saved doc (user intent) wins per node: for every key the saved doc has, the
// saved node replaces the default node (rank / parent / name / hidden). Keys the
// saved doc has but the defaults do not are KEPT — a declared layer that has not
// registered yet (dormant) or a layer removed from CONF but still re-registerable
// (tombstone) must come back at its recorded position. The merged doc is sanitized
// (over-depth subtrees dropped) so an invalid saved parent chain cannot poison it.
import type { OrderDoc } from "#core/order/doc.js";
import { sanitizeOrderDoc } from "#core/order/doc.js";

export const mergeOrderDocs = (saved: OrderDoc, defaults: OrderDoc): OrderDoc => {
  const nodes: OrderDoc["nodes"] = { ...defaults.nodes };
  for (const [key, node] of Object.entries(saved.nodes)) {
    nodes[key] = node;
  }
  const merged: OrderDoc = { nodes };
  return sanitizeOrderDoc(merged) ?? merged;
};
