// core/layer/layout/persist — load/save the raw layer_order document.
//
// The key is map-scoped (same helper as layer_state) and the record has NO version
// field and NO migrator: an unknown/incomplete shape fails isOrderDoc and the caller
// falls back to defaultDoc() (design note: an unknown/incomplete shape is discarded, not migrated). Old keys (layer_layout / layer_arrangement /
// layer_state.order|removed) are not read, migrated or deleted here.
import { type OrderDoc, isOrderDoc, sanitizeOrderDoc } from "#core/order/index.js";
import { loadRecord, removeRecord, saveRecord, scopedStorageKey } from "#platform/storage.js";

type MapLike = { getContainer: () => { id: string } };

/** The localStorage key for one map's order document. */
const orderKeyOf = (map: MapLike): string => scopedStorageKey(map, "layer_order");

/** Load the saved order document. Returns null when absent/unreadable/invalid
 *  (the caller then uses defaultDoc()). Over-depth subtrees are dropped, not fatal. */
const loadOrderDoc = (map: MapLike): OrderDoc | null => {
  const value = loadRecord<unknown>(orderKeyOf(map), "LayerControl");
  if (value === null) return null;
  if (!isOrderDoc(value)) return null;
  return sanitizeOrderDoc(value);
};

/** Persist the order document (raw JSON, no version). Returns whether written. */
const saveOrderDoc = (map: MapLike, doc: OrderDoc): boolean =>
  saveRecord(orderKeyOf(map), doc, "LayerControl");

/** Remove the order document (reset layout). Returns whether it existed. */
const clearOrderDoc = (map: MapLike): boolean =>
  removeRecord(orderKeyOf(map), "LayerControl");

export {
  orderKeyOf,
  loadOrderDoc,
  saveOrderDoc,
  clearOrderDoc,
};
