// declaredFilter — the filter an author declared on the layer itself.
//
// The per-layer `foliplus={"filter": ...}` declaration is normalised ONCE in
// Python (`normalise_layer_filter`) into CONF `data[].filter`, carried on the
// layer record's `filter` slot — the same slot the controller keeps in sync as
// the committed filter, so the declared value IS the initial committed value.
// This module only reads that AST and never re-validates the shape: a second
// shape judgment here would be a second source for the same fact — the
// dual-source the Python normaliser exists to prevent.
//
// Absent / `null` reads as "no declared filter" (`undefined`), the same state
// as no filter (distinct from a filter that matches nothing, which is an empty
// `and`/`or` node — still a filter).
import type { LayerFilter } from "#core/layer/index.js";

const readDeclaredFilter = (
  layer: { readonly filter?: LayerFilter | null },
): LayerFilter | undefined => layer.filter ?? undefined;

export { readDeclaredFilter };
