// core/layer/layout/persist — load/save the raw layer_order document.
//
// The key is map-scoped (same helper as layer_state) and the record has NO version
// field and NO migrator: an unknown/incomplete shape fails isOrderDoc and the caller
// falls back to defaultDoc() (design §4.1). Old keys (layer_layout / layer_arrangement /
// layer_state.order|removed) are not read, migrated or deleted here.
import type { OrderDoc } from "#core/order/doc.js";
import { isOrderDoc, sanitizeOrderDoc } from "#core/order/doc.js";
import { scopedStorageKey } from "#platform/storage.js";

type MapLike = { getContainer: () => { id: string } };

/** The localStorage key for one map's order document. */
export const orderKeyOf = (map: MapLike): string =>
  scopedStorageKey(map, "layer_order");

/** Load the saved order document. Returns null when absent/unreadable/invalid
 *  (the caller then uses defaultDoc()). Over-depth subtrees are dropped, not fatal. */
export const loadOrderDoc = (map: MapLike): OrderDoc | null => {
  try {
    const raw = window.localStorage.getItem(orderKeyOf(map));
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (!isOrderDoc(value)) return null;
    return sanitizeOrderDoc(value);
  } catch {
    return null;
  }
};

/** Persist the order document (raw JSON, no version). Returns whether written. */
export const saveOrderDoc = (map: MapLike, doc: OrderDoc): boolean => {
  try {
    window.localStorage.setItem(orderKeyOf(map), JSON.stringify(doc));
    return true;
  } catch {
    return false;
  }
};

/** Remove the order document (reset layout). Returns whether it existed. */
export const clearOrderDoc = (map: MapLike): boolean => {
  try {
    const existed = window.localStorage.getItem(orderKeyOf(map)) !== null;
    window.localStorage.removeItem(orderKeyOf(map));
    return existed;
  } catch {
    return false;
  }
};
