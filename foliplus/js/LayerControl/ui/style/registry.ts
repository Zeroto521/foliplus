// Per-layer dimension registry — the discovery surface for the style panel.
// §43.9: opacity / zoomRange / border / fill / … are all per-layer dimensions
// with the same shape (gate → row → state write), just different carriers.
// Today each dimension has its own set of helpers; the registry is the
// minimal slice — a descriptor shape + register + lookup — that lets the
// panel discover which dimensions apply to a layer without a switch table.
//
// Gate invariant (contract, not convention): every dimension's `gate` is
// exactly `capabilities.{dim} !== "none"` — the surface's capability slot is
// the single source of truth for whether the row is honest. No other
// checks belong in `gate`:
//   - carrier probes (`hasSetStyleLeaf` for stroke, `hasFillGeometry` for
//     fill, etc.) belong to *capability derivation* at the surface, not the
//     gate — otherwise every gate is a fresh restatement of the surface.
//   - `isColorBasemap` cases ("solid colour counts as fillable", "count as
//     zoomRange-able") are capability declarations, not gate special-cases.
//   - canvas / styleSetters exclusion is *already* covered: a canvas-only
//     surface declares `capabilities.{dim}: "none"`, so the gate rejects it
//     naturally. Adding an extra `if (!canvas) return false` here would
//     be duplicate work — and every extra check is another place a future
//     dimension can drift.
// The pilot (`opacity`) is already in this form; legacy `fill` / `border` /
// `zoomRange` gates carry extras and are scheduled for a follow-up PR that
// moves those checks into their surface declarations.
//
// First pilot: `opacity`. Its existing helpers (`layerCanOpacity`,
// `buildOpacityRow`, `commitOpacityPct`, `resetLayerOpacity`) stay as the
// authoritative implementation; the descriptor wires them up. The write
// path (state + DOM sync) is deliberately not moved into the descriptor
// yet: the panel's commit pass knows which row element to refresh, and
// that argument does not belong in the descriptor contract. Follow-up
// migration work can move `write` / `reset` in once that coupling is
// broken.
//
// The registry is a module-level Map. It is not scoped to a single map
// instance — dimensions are keyed by name, not by map id, because a
// descriptor is a *shape* ("this layer supports opacity"), not state
// ("layer X has opacity 0.4").
//
// Duplicate registration throws: two components shipping the same key
// (a third-party `registerDimension({ key: "opacity", ... })` alongside
// our built-in) is a bug that must fail loudly, not silently overwrite.
import type { LayerUI } from "../index.js";

/** One per-layer dimension. `key` is the persistence-identifier and the
 *  registry key (`"opacity"`, later `"zoomRange"`, `"fillColor"`, or a
 *  third-party namespaced key like `"myplugin.radius"`). */
type LayerDimension<D = unknown> = {
  key: string;
  /** Row-honest gate. **Must be exactly `capabilities.{dim} !== "none"`** —
   *  the surface's declared capability is the single source of truth for
   *  whether this row is honest to render (§6.2). Nothing else: no carrier
   *  probes, no `isColorBasemap` special-cases, no canvas/styleSetters
   *  exclusion (a canvas-only surface already declares `"none"` for the
   *  dimension it can't carry, so the gate rejects it naturally). See the
   *  file header for the full invariant. */
  gate: (ui: LayerUI, layerId: string) => boolean;
  /** Resolved current value — the user's stored override, falling back to
   *  the author's declared default when the user has never touched the
   *  dimension. `undefined` when the layer is not in the registry. */
  value: (ui: LayerUI, layerId: string) => D | undefined;
  /** Build the style-panel row. The descriptor owns the DOM shape; the
   *  panel still owns event binding, because binding needs the row's
   *  parent (the panel root) to install the drag bubble and shared
   *  number-field commit handler. */
  row: (ui: LayerUI, layerId: string) => HTMLElement;
};

const registry: Map<string, LayerDimension<any>> = new Map();

/** Register a dimension descriptor. Throws on a duplicate key — a registry
 *  that silently overwrites is a bug that only surfaces once a user's
 *  saved state no longer round-trips. */
const registerDimension = <D>(d: LayerDimension<D>): LayerDimension<D> => {
  if (registry.has(d.key)) {
    throw new Error(`LayerControl: dimension "${d.key}" already registered`);
  }
  registry.set(d.key, d);
  return d;
};

/** Fetch a dimension descriptor by key. `undefined` for unregistered keys —
 *  the panel treats that as "this dimension does not apply" rather than
 *  erroring, matching the honest-degradation rule for unknown dimensions
 *  (§43.9). */
const getDimension = <D = unknown>(key: string): LayerDimension<D> | undefined =>
  registry.get(key) as LayerDimension<D> | undefined;

/** Every registered descriptor, in registration order. */
const listDimensions = (): readonly LayerDimension<any>[] => [...registry.values()];

export type { LayerDimension };
export { getDimension, listDimensions, registerDimension };
