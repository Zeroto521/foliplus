// LayerControl UI — pure projection of intent + policy per layer.
//
// Every dimension the panel and the map care about is derived from one
// projection per layer. `buildRowCell` reads `effectiveShown` from here
// instead of recomputing the same expression as the state-side policy
// writer, so the formula has one home. The map-side executor
// (`./apply.ts`) diffs this projection against the last one it wrote,
// so a change on either input reaches the map through exactly one path.
//
// Nothing in this file touches the map, the registry, or storage.
import type { AuthorZoomRange } from "#core/layer/index.js";
import { createLogger } from "#common/log.js";
import type { Projection } from "../type.js";
import { INTENT, getIntent } from "./intent.js";
import type { LayerUI } from "./surface.js";

const log = createLogger("LayerControl");

/** Layer ids already warned about an unusable declared zoom range. Warn once
 *  per layer: a hand-edited CONF or a package whose declaration predates the
 *  validation should surface the bad payload without printing on every
 *  projection sweep (the sweep runs on each zoom-end). */
const warnedZoomDeclarations = new Set<string>();

const warnZoomOnce = (id: string, message: string): void => {
  if (warnedZoomDeclarations.has(id)) return;
  warnedZoomDeclarations.add(id);
  log.warn(`layer "${id}": ${message}`);
};

/** Read the author's declared zoom range off the layer record, validating the
 *  payload on the way out. `undefined` means "not declared": either the author
 *  declared nothing, or the record is malformed — Python validates the
 *  declaration at render time, but CONF can be hand-edited or come from an
 *  older package, so the read point stays defensive instead of trusting it.
 *  A malformed record warns once and is treated exactly like "no declaration"
 *  (never as "hide the layer"). */
const authorZoomRangeOf = (
  layerInfo: LayerInfo | null | undefined,
): AuthorZoomRange | undefined => {
  const zoom = layerInfo?.zoom;
  if (!zoom) return undefined;
  if (
    typeof zoom !== "object" ||
    !Number.isFinite(zoom.min) ||
    !Number.isFinite(zoom.max) ||
    zoom.min > zoom.max
  ) {
    warnZoomOnce(
      layerInfo!.id,
      `declares an unusable zoom range (got ${JSON.stringify(zoom)}); treating it as undeclared`,
    );
    return undefined;
  }
  return zoom;
};

/** Clamp a declared range onto the map's own range without ever producing an
 *  empty interval.
 *
 *  Clamping is a policy/display step only — the declared values are never
 *  rewritten, so switching the basemap back restores the declared range
 *  verbatim (the same reversibility rule the stored range follows). A
 *  declaration sitting entirely outside the map (author `[20, 30]` on a map
 *  capped at 18) would clamp to `min > max`; that degenerate interval
 *  collapses onto the nearest bound and the caller is told via `degenerate`
 *  so it can decide how to read it. */
const clampZoomRangeToMap = (
  ui: LayerUI,
  range: AuthorZoomRange,
): { range: AuthorZoomRange; degenerate: boolean } => {
  const mapMin = ui.c.map.getMinZoom();
  const mapMax = ui.c.map.getMaxZoom();
  const lo = Math.max(range.min, mapMin);
  const hi = Math.min(range.max, mapMax);
  if (lo <= hi) return { range: { min: lo, max: hi }, degenerate: false };
  const point = Math.min(Math.max(range.min, mapMin), mapMax);
  return { range: { min: point, max: point }, degenerate: true };
};

/** The author's declaration as the *visibility policy* sees it.
 *
 *  A degenerate clamp is not turned into a blanket "hidden": the declaration
 *  is judged as declared (the map may widen later, and a caller-supplied zoom
 *  outside the map bounds still has an honest answer), and the fact is
 *  reported once. That keeps "the layer disappeared" attributable to the
 *  declaration rather than to a clamp artefact. */
const authorZoomPolicyRange = (
  ui: LayerUI,
  layerInfo: LayerInfo,
): AuthorZoomRange | undefined => {
  const declared = authorZoomRangeOf(layerInfo);
  if (!declared) return undefined;
  const { range, degenerate } = clampZoomRangeToMap(ui, declared);
  if (!degenerate) return range;
  warnZoomOnce(
    layerInfo.id,
    `declares zoom range ${JSON.stringify(declared)} outside the map's zoom range; judging the declaration itself`,
  );
  return declared;
};

/** The author's declaration as the zoom-range *row* sees it: clamped to the
 *  map's rail and never empty, so the slider always has a drawable value.
 *  Distinct from {@link authorZoomPolicyRange} on the degenerate case only —
 *  a row must show something, so it collapses onto the nearest bound. */
const authorZoomRowRange = (
  ui: LayerUI,
  layerInfo: LayerInfo | null | undefined,
): AuthorZoomRange | undefined => {
  if (!layerInfo) return undefined;
  const declared = authorZoomRangeOf(layerInfo);
  if (!declared) return undefined;
  const { range, degenerate } = clampZoomRangeToMap(ui, declared);
  if (degenerate) {
    warnZoomOnce(
      layerInfo.id,
      `declares zoom range ${JSON.stringify(declared)} outside the map's zoom range; the row collapses it onto the nearest bound`,
    );
  }
  return range;
};

/**
 * Whether the range in force covers the map's current zoom.
 *
 *  Two sources, one predicate. The user's stored range wins when it exists
 *  (the persisted choice is the user's, and nothing in foliplus writes
 *  through it); otherwise the author's `foliplus={"zoom": {...}}` declaration
 *  is the policy, exactly as `data[].show` is the author default for
 *  visibility. A layer with neither is unconstrained.
 *
 *  The map's range can be narrower than either range's endpoints (a basemap
 *  switch), so the endpoints are clamped here while the *stored* values stay
 *  untouched — reversibility: switching the basemap back must restore the
 *  original choice. If both stored endpoints clamp past each other the whole
 *  range is outside the map and no zoom can land inside it (the stored-range
 *  case keeps that verdict; the author path falls back to the declaration —
 *  see {@link authorZoomPolicyRange}).
 *
 *  Deliberately NOT gated on `canShowZoomRange`: the capability check decides
 *  whether the panel renders a row, not whether a declaration is honoured.
 *  Gating the policy on it would silently drop the author's declaration for a
 *  layer the panel cannot show a row for — the exact "declared but ignored"
 *  gap this dimension exists to close.
 */
const inZoomRange = (ui: LayerUI, layerInfo: LayerInfo): boolean => {
  const stored = getIntent(ui, layerInfo.id, INTENT.ZOOM_RANGE);
  if (stored) {
    const min = Math.max(stored[0], ui.c.map.getMinZoom());
    const max = Math.min(stored[1], ui.c.map.getMaxZoom());
    if (min > max) return false;
    const zoom = ui.c.map.getZoom();
    return zoom >= min && zoom <= max;
  }
  // Read the map only once a declaration exists: an unconstrained layer is the
  // common case, and thin UI stubs (row builders) may carry no map.
  const author = authorZoomPolicyRange(ui, layerInfo);
  if (!author) return true;
  const zoom = ui.c.map.getZoom();
  return zoom >= author.min && zoom <= author.max;
};

/** The user's own visibility choice, or the author's declared default
 *  (read from CONFIG `data[].show`, seeded into `runtimeStore.authorVisible`
 *  at attach time) when the user never touched it. This is the single entry
 *  point other modules — `syncNoBasemap`, `rowView`, and the executor's
 *  baseline — read the intent through, so no mirror is stored on the layer
 *  record.
 *
 *  The user's choice is signalled by the dimension's `overrides` provenance
 *  marker *or* by the value being present on the intent record. The two travel
 *  together out of `loadPersistedState` and `setVisibleIntent`, so either alone still
 *  means "the user chose this" — a caller that records the value (a restored
 *  record, a test fixture, a re-registration replay) must not have it silently
 *  read back as the author's default. */
const intentVisibleOf = (ui: LayerUI, id: string): boolean => {
  const visible = getIntent(ui, id, INTENT.VISIBLE);
  const hasVisible =
    ui.intentStore.isUserSet(id, INTENT.VISIBLE) || typeof visible === "boolean";
  const authorDefault = ui.runtimeStore.getAuthorVisible(id) ?? true;
  return hasVisible ? (visible ?? true) : authorDefault;
};

/** The layer's opacity right now: the user's intent when set, otherwise the
 *  author's declared default (`layerInfo.opacity`, seeded at registration
 *  from `layer.options.opacity`), and 1 while the layer is focused.
 *
 *  This is the *resolved* value — `undefined` is folded into the author's
 *  default. It is distinct from `Projection.opacity`, which keeps
 *  `undefined` = "the user never intervened" because the executor's diff
 *  needs that distinction. A missing layer (a style row for an id the
 *  registry no longer holds) resolves to `undefined` — the caller treats
 *  "no layer" as "no value". The overload for a known layer drops the
 *  undefined arm so callers with a registry-guaranteed layer (`basePaints`)
 *  read a plain number. */
function currentOpacity(ui: LayerUI, layerInfo: LayerInfo): number;
function currentOpacity(
  ui: LayerUI,
  layerInfo: LayerInfo | undefined,
): number | undefined;
function currentOpacity(
  ui: LayerUI,
  layerInfo: LayerInfo | undefined,
): number | undefined {
  return layerInfo
    ? ui.focusController.focusingLayerId === layerInfo.id
      ? 1
      : (getIntent(ui, layerInfo.id, INTENT.OPACITY) ?? layerInfo.opacity ?? 1)
    : undefined;
}

/** Build one layer's projection from the persisted intent and the current
 *  policy inputs (focus, map zoom). Read-only. */
const projectLayer = (ui: LayerUI, layerInfo: LayerInfo): Projection => {
  const id = layerInfo.id;
  // The author's default is the CONFIG `data[].show` fact, seeded into
  // `runtimeStore.authorVisible` at attach time (initial layers) or
  // registration time (late-registered layers) — read through
  // `intentVisibleOf` below, never off the map's own state.
  const intent = intentVisibleOf(ui, id);

  // Policy is independent of intent: focus overrides range, range may
  // exclude, but neither touches the user's stored choice. The range itself
  // resolves intent-first, then the author's `data[].zoom` declaration (see
  // `inZoomRange`).
  const policy =
    ui.focusController.focusingLayerId != null ? true : inZoomRange(ui, layerInfo);
  const effectiveShown = intent && policy;

  // A dimension's value being present is what the sweep has always read as
  // the user's choice (a restored record, a late replay). The provenance
  // marker lives on `IntentRow.provenance`, not on this projection. Focus
  // forces opacity to 1 for the *focused* layer only (see focus.ts) — the
  // user's intent is left untouched, so dismissFocus's replay lands the
  // author's value back. Different from `policy` above: zoom-range is a
  // permissive gate for every layer during focus (`!= null`), opacity is a
  // single-layer override (`=== id`). This `opacity` keeps its
  // `number | undefined` semantics on purpose (see `currentOpacity`).
  const intentOpacity = getIntent(ui, id, INTENT.OPACITY);
  const opacity = ui.focusController.focusingLayerId === id ? 1 : intentOpacity;

  return { id, intent: { visible: intent }, effectiveShown, opacity };
};

export {
  projectLayer,
  intentVisibleOf,
  inZoomRange,
  currentOpacity,
  authorZoomRowRange,
};
