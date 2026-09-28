// Per-layer dimension registry — the discovery surface for the style panel.
// opacity / zoomRange / border / fill / annotation … are all per-layer dimensions
// with the same shape (gate → row → state write), just different carriers.
// Today each dimension has its own set of helpers; the registry is the
// minimal slice — a descriptor shape + register + lookup — that lets the
// panel discover which dimensions apply to a layer without a switch table.
//
// Gate invariant (contract, not convention): every dimension's `gate` has
// exactly two layers, in this order:
//   1. Layer existence — the layer must be in the registry. A missing
//      layer is a programming error (the panel asked about something we
//      don't own), so return `false` immediately rather than probing a
//      surface we cannot resolve. This is a precondition guard, not a
//      capability check.
//   2. Capability — `capabilities.{dim} !== "none"`. The surface's
//      capability slot is the single source of truth for whether the
//      row is honest.
// Nothing else belongs in `gate`. Three classes of check explicitly
// do not:
//   - carrier probes (`hasSetStyleLeaf` for stroke, `hasFillGeometry`
//     for fill, etc.) belong to *capability derivation* at the
//     surface, not the gate — otherwise every gate is a fresh
//     restatement of the surface.
//   - `isColorBasemap` cases ("solid colour counts as fillable", "count
//     as zoomRange-able") are capability declarations, not gate
//     special-cases.
//   - canvas / styleSetters exclusion is *already* covered: a canvas-only
//     surface declares `capabilities.{dim}: "none"`, so the gate rejects
//     it naturally. Adding an extra `if (!canvas) return false` here
//     would be duplicate work — and every extra check is another place
//     a future dimension can drift.
// The pilot (`opacity`) is already in this form; `fill` / `border` /
// `zoomRange` gates are now pure capability checks too (#513).
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
// The registry is a module-level Map. BaseControl renders each control
// instance as a fresh IIFE around the bundled JS, so every map eval gets
// its own copy of this module — the registry is per-map-instance, not a
// process singleton. Descriptors must be pure shape ("this layer supports
// opacity"); never attach map-level state in the descriptor's closure. A
// dimension that needs per-map state belongs on the UI object, not here.
//
// Duplicate registration throws: two components shipping the same key
// alongside our built-in is a bug that must fail loudly, not silently
// overwrite. This registry is currently an internal surface only — the
// public extensibility API (a `registerDimension` re-exported from
// `LayerControl/index.ts`) is deferred.
import type { LayerDimension } from "../../type.js";
import type { LayerUI } from "../index.js";

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
 *  (honest degradation for unknown dimensions). */
const getDimension = <D = unknown>(key: string): LayerDimension<D> | undefined =>
  registry.get(key) as LayerDimension<D> | undefined;

/** Every registered descriptor, in registration order. */
const listDimensions = (): readonly LayerDimension<any>[] => [...registry.values()];

/** The Layer section's authoritative display order.
 *
 *  Registration order is NOT display order: `listDimensions()` returns the
 *  Map's insertion order, which tracks the ES module import graph, not the
 *  source order of the importing file. `opacity` was registered at #505
 *  top-level, so in most load graphs it lands ahead of `fill` and `border`
 *  — the display order would silently regress. The panel wants a stable
 *  contract (fill → border → opacity → zoomRange, per #458), so the
 *  order is declared here rather than inferred from the import graph.
 *
 *  The panel iterates this array through `gatedRows`, which casts each
 *  lookup straight to a descriptor — so a key listed here MUST be
 *  registered. That is a different contract from degrading: the cast
 *  states the invariant this array already implies, and
 *  `registry.test.ts` locks it (both order arrays together cover every
 *  registered built-in key and nothing more). A dimension that is
 *  registered but missing from both arrays is unreachable from the panel —
 *  adding a dimension without adding it to its section's order is the bug
 *  that same test catches.
 */
const DIM_ORDER = ["fill", "border", "opacity", "zoomRange"] as const;

/** The Label section's authoritative display order — the second section of
 *  the same panel, iterated exactly like `DIM_ORDER` (heading + gated rows).
 *  Sections own their own order arrays: the panel renders a heading per
 *  section, so one flat order cannot express "which section does this row
 *  live in". `registry.test.ts` asserts the UNION of both arrays covers
 *  every registered built-in key and nothing more, which is the drift this
 *  split would otherwise open: a dimension registered but put in neither
 *  order is unreachable from the panel. */
const LABEL_DIM_ORDER = ["annotation"] as const;

/** Whether the layer owns any registered dimension whose `gate` passes —
 *  the direct boolean form of the sweep, over every registered key. Both
 *  panel flavors now collect their own gated rows (`gatedRows`) and check
 *  those, so this is the generic "any gate at all" question rather than a
 *  panel entry point. Every dimension contributes through its own `gate`;
 *  no switch table of keys. */
const hasAnyDimension = (ui: LayerUI, layerId: string): boolean =>
  [...registry.values()].some(d => d.gate(ui, layerId));

/** Collect the descriptors whose `gate` passes, in the caller's declared
 *  order — the one gate pass every panel flavor shares. The annotation
 *  panel passes `DIM_ORDER` / `LABEL_DIM_ORDER`; the delegated drawer passes
 *  its own slice (`DELEGATED_DIM_ORDER` in `./delegated.js`). Same single
 *  implementation behind both consumers.
 *
 *  Every key listed in a section order is registered — `registry.test` locks
 *  the union of both orders against the built-ins — so the lookup cannot
 *  miss; the cast states that contract instead of branching on a null arm no
 *  test can reach. */
const gatedRows = (
  ui: LayerUI,
  layerId: string,
  keys: readonly string[],
): LayerDimension[] => {
  const rows: LayerDimension[] = [];
  for (const key of keys) {
    const dim = getDimension(key) as LayerDimension;
    if (dim.gate(ui, layerId)) rows.push(dim);
  }
  return rows;
};

export {
  DIM_ORDER,
  LABEL_DIM_ORDER,
  gatedRows,
  getDimension,
  hasAnyDimension,
  listDimensions,
  registerDimension,
};
