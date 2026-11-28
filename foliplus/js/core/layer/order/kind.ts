// core/layer/order/kind — the node-kind and node-key-prefix vocabulary.
//
// The order document's node kinds and their key prefixes are single-source
// here; the engine and the layout adapter must not spell a bare "layer" /
// "folder" / "group" literal or concatenate a "layer:"-style prefix by hand
// (guarded by test/js/guard/order-vocabulary.test.ts).
export const ORDER_KIND = {
  LAYER: "layer",
  FOLDER: "folder",
  GROUP: "group",
} as const;

export type OrderKind = (typeof ORDER_KIND)[keyof typeof ORDER_KIND];

/** The node-key prefix for each kind (a layer key is "layer:<id>"). */
export const NODE_KEY_PREFIX = {
  LAYER: "layer:",
  FOLDER: "folder:",
  GROUP: "group:",
} as const;
