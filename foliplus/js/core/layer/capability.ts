// core/layer/capability — carrier probe for the stroke / fill / size axes.
//
// Both `LayerCapabilities.stroke` and `LayerCapabilities.fill` are derived
// from a tree walk of the layer's live node graph. The probes live here so
// `detectCapabilities` (LayerSurface) can call them without depending on the
// LayerControl UI tree, and so the two vector axes read the same
// honest-degradation invariant: capability = the existence of a carrier
// object.
//
// A node with `setStyle` alone is not a carrier — L.GeoJSON owns one too
// (it fans a style out to its features), so the walks descend through
// `eachLayer` first and treat a setter as a leaf only. Groups that own a
// `setStyle` of their own are still descended: an empty one has no feature
// to fan the style out to, so it returns false like an empty LayerGroup or
// a Marker with no children — the `setStyle` of its own is not a real
// carrier when the walk finds nothing to write to.
import { isMigratableLeaf } from "./carrier.js";
import * as CONST from "./const.js";
import type { LayerCapabilities, LayerKind } from "./type.js";
import { isGroupNode, someLeaf, walkLeaf } from "./walkLeaf.js";
import { internalLayers, isPixelRadiusLeaf } from "#core/leafletAdapter.js";

/** Whether any leaf in the tree owns a *pixel* radius — the honest carrier
 *  check for the size axis. The single-leaf test is `isPixelRadiusLeaf`; this
 *  is only the tree aggregation on top of it, and the size write path
 *  (`size.ts`) uses the same recognizer, so a row that renders always has a
 *  leaf it can write. */
const hasRadiusLeaf = (node: unknown): boolean => someLeaf(node, isPixelRadiusLeaf);

/** The GeoJSON geometry types that own a fill. `MultiLineString` and
 *  `MultiPoint` are deliberately absent: their `getLatLngs()` is nested
 *  exactly like a Polygon ring, so no amount of coordinate inspection can
 *  tell the two apart. Only a declaration decides. */
const AREAL_GEOMETRY_TYPES: ReadonlySet<string> = new Set(["Polygon", "MultiPolygon"]);

/** The reserved property a cross-realm or third-party Path sets to claim the
 *  fill axis. `instanceof L.Polygon` cannot see another window's class
 *  identity, and not every adapter ships a GeoJSON envelope, so the escape
 *  hatch is declared rather than inferred from coordinate nesting. */
const FILL_OPT_IN = "_foliplusAreal";

/** A third-party or cross-realm Path can be a class whose property getters
 *  throw, so a single read is its own boundary: a failing read is evidence of
 *  nothing, and the caller falls through to the signal that still answers.
 *  `undefined` is exactly what every caller needs - "nothing said". */
const safeRead = <T>(read: () => T | undefined): T | undefined => {
  try {
    return read();
  } catch {
    return undefined;
  }
};

/** Read a geometry type out of one GeoJSON envelope.
 *
 *  Every level is its own boundary, not just the envelope's owner: a
 *  third-party layer can hand back a real `feature` object whose *own*
 *  `geometry` (or `geometry.type`) is a getter that throws, and a shallow
 *  guard stops one read short of that. `undefined` at any level means that
 *  level said nothing, so the caller moves on to its next signal. */
const envelopeGeometryType = (envelope: unknown): string | undefined => {
  if (envelope === null || typeof envelope !== "object") return undefined;
  const geometry = safeRead(() => (envelope as { geometry?: unknown }).geometry);
  if (geometry === null || typeof geometry !== "object") return undefined;
  const declared = safeRead(() => (geometry as { type?: unknown }).type);
  return typeof declared === "string" ? declared : undefined;
};

/** Read the geometry type a node declares, if it declares one — the GeoJSON
 *  envelope on `feature` first (cheapest), then a `toGeoJSON()` call. A
 *  throwing getter or call is not evidence of any geometry, so it is
 *  ignored. Both sources funnel through the one envelope parser, so the
 *  shallow-read hole cannot reopen on one of them only. */
const declaredGeometryType = (node: {
  feature?: unknown;
  toGeoJSON?: unknown;
}): string | undefined => {
  const fromFeature = envelopeGeometryType(safeRead(() => node.feature));
  if (fromFeature !== undefined) return fromFeature;
  if (safeRead(() => typeof node.toGeoJSON === "function")) {
    const out = safeRead(() => (node.toGeoJSON as () => unknown)());
    return envelopeGeometryType(out);
  }
  return undefined;
};

/** Whether one node exposes a runtime `setStyle`. The guard is the
 *  recognizer's, not the walk's: a throwing getter answers nothing, so the axis
 *  reads "none" instead of the walk dying mid-tree.
 */
const hasSetStyle = (node: unknown): boolean =>
  safeRead(() => typeof (node as { setStyle?: unknown }).setStyle) === "function";

/** Whether any leaf in the tree exposes a runtime `setStyle` — the honest
 *  carrier check for the vector stroke axis (border). */
const hasSetStyleLeaf = (node: unknown): boolean => someLeaf(node, hasSetStyle);

/** Whether one node exposes a runtime `setIcon` — the marker icon carrier.
 *  Same guard as `hasSetStyle`: a throwing getter answers nothing, so the
 *  axis reads "none" instead of the walk dying mid-tree. */
const hasSetIcon = (node: unknown): boolean =>
  safeRead(() => typeof (node as { setIcon?: unknown }).setIcon) === "function";

/** A per-icon cache for the glyph-color probe: createIcon can be expensive
 *  (it builds a DOM node), so the same icon instance is probed once. Keyed
 *  by the icon object, not the leaf, because every marker leaf owns its own
 *  icon instance and the probe result is a property of the icon type, not of
 *  the leaf. */
const glyphCapableIcon = new WeakMap<object, boolean>();

/** Whether one icon instance can carry a glyph node — the honest carrier
 *  check for the glyph-color axis. "Can carry a glyph" means the authored
 *  icon's `createIcon()` output is a DOM Element that is not an
 *  `HTMLImageElement` — i.e. a div-type icon (awesome-markers / a plain
 *  DivIcon we can paint), not an `<img>`-based `Icon.Default` /
 *  `iconUrl`. A div-type icon can hold an inner `<i>` glyph node even if
 *  the author drew none (our derive inserts one), so the probe answers
 *  "native" for a bare divIcon too. Same throwing-getter guard as
 *  `hasSetIcon` — a hostile getter answers nothing rather than walking
 *  mid-flight. */
const canPaintGlyphOnIcon = (icon: unknown): boolean => {
  if (typeof icon !== "object" || icon === null) return false;
  const cached = glyphCapableIcon.get(icon);
  if (cached !== undefined) return cached;
  const result = safeRead(() => {
    const createIcon = (icon as { createIcon?: unknown }).createIcon;
    if (typeof createIcon !== "function") return false;
    const output = (createIcon as () => unknown).call(icon);
    return (
      typeof output === "object" &&
      output !== null &&
      output instanceof Element &&
      !(output instanceof HTMLImageElement)
    );
  });
  const decided = result === true;
  glyphCapableIcon.set(icon, decided);
  return decided;
};

/** Whether the leaf is a glyph-color carrier: a runtime `setIcon` whose
 *  authored icon can paint a glyph (div-based, not `<img>`-based). Same
 *  throwing-getter guard as `hasSetIcon` — a hostile getter answers
 *  nothing rather than walking mid-flight. */
const hasIconColorLeaf = (node: unknown): boolean =>
  safeRead(
    () =>
      typeof (node as { setIcon?: unknown }).setIcon === "function" &&
      canPaintGlyphOnIcon((node as { options?: { icon?: unknown } }).options?.icon),
  ) === true;

/** Whether the leaf is a chassis-color carrier: a runtime `setIcon` whose
 *  authored icon is an AwesomeMarkers (it declares a `markerColor` option —
 *  the sprite background preset). A bare divIcon, an `L.Icon.Default`
 *  (`<img>`) and a plain `iconUrl` marker all answer "none": their chassis
 *  is not the awesome-markers sprite, so changing the preset would not paint
 *  anything. Same throwing-getter guard as `hasSetIcon` — a hostile getter
 *  answers nothing rather than walking mid-flight. */
const hasMarkerColorLeaf = (node: unknown): boolean =>
  safeRead(
    () =>
      typeof (node as { setIcon?: unknown }).setIcon === "function" &&
      (() => {
        const icon = (
          node as { options?: { icon?: { options?: Record<string, unknown> } } }
        )?.options?.icon?.options;
        // folium camelizes every option key at render (folium/template.py); the snake spelling is accepted for hand-built Leaflet icons and as a guard if folium ever stops camelizing. Accept both spellings.
        return typeof (icon?.markerColor ?? icon?.marker_color) === "string";
      })(),
  ) === true;

/** Whether any leaf is a Leaflet Marker — the probe that decides whether a
 *  surface needs a marker-shadow pane. Guarded the same way as the native
 *  setter checks in `LayerSurface`: a stripped Leaflet mock (no `Marker`)
 *  must read as "no marker", not throw on `instanceof undefined`. */
/** One node is a Leaflet Marker — the marker geometry predicate. Guarded so a
 *  stripped Leaflet mock (no `Marker`) reads as "no marker" instead of throwing
 *  on `instanceof undefined`. */
const isMarkerLeaf = (node: unknown): boolean =>
  typeof L.Marker !== "undefined" && safeRead(() => node instanceof L.Marker) === true;

/** Whether any leaf is a Leaflet Marker — the probe that decides whether a
 *  surface needs a marker-shadow pane. The single-leaf test is `isMarkerLeaf`. */
const hasMarkerLeaf = (node: unknown): boolean => someLeaf(node, isMarkerLeaf);

/** Whether one leaf is a stroke-only Path leaf — a runtime `setStyle` with no
 *  areal geometry (a Polyline / MultiPolyline / GeoJSON LineString leaf). The
 *  geometry predicates stay declarations, never coordinate guesses: a line ring
 *  and a polygon ring share `getLatLngs()`, so only `isArealStyleLeaf` decides
 *  the areal face, and every setStyle-shaped leaf it does not claim is a line. */
const isPathLeaf = (node: unknown): boolean =>
  hasSetStyle(node) && !isGroupNode(node) && !isArealStyleLeaf(node);

/** Whether any leaf is an areal fill carrier — see `isArealStyleLeaf`. */
const hasFillLeaf = (node: unknown): boolean => someLeaf(node, isArealStyleLeaf);

/** Every carrier question one visit to the tree answers, so a caller that wants
 *  them all pays one walk instead of one per question.
 *
 *  `LayerSurface.matches` used to ask for `stroke`, `fill`, `size` and the
 *  migratable audit as four separate walks, and `enforceOrder` calls `matches`
 *  once per registered layer — a single row move re-traversed every leaf on the
 *  map four times. The recognizers are independent, so collecting their answers
 *  in one visit is the same answer the four walks gave, at the cost of the most
 *  expensive one alone. Each answer is computed exactly as its one-question
 *  probe computes it: same recognizer, same guarded read, same throw behaviour.
 *  The three booleans stop consulting their recognizer once answered; the audit
 *  needs the full visit either way, which is the floor the four walks shared. */
interface LayerCarrierProbe {
  /** Any leaf owns a runtime `setStyle` — the stroke carrier. */
  stroke: "native" | "none";
  /** Any leaf is an areal fill carrier — see `isArealStyleLeaf`. */
  fill: "native" | "none";
  /** Any leaf owns a pixel radius — the size carrier. */
  size: "native" | "none";
  /** Any leaf owns a runtime `setIcon` — the marker icon carrier. */
  icon: "native" | "none";
  /** Any leaf is an awesome-markers carrier (setIcon + div-based authored icon). */
  iconColor: "native" | "none";
  /** Any leaf is a chassis-color carrier: a runtime setIcon whose authored
   *  icon is a div-based AwesomeMarkers (declares a markerColor option). A
   *  bare divIcon / L.Icon.Default img answers "none" — the chassis is the
   *  sprite background, not a paintable glyph face. */
  markerColor: "native" | "none";
  /** The full-tree migratable audit: "mixed" is the degrade signal. */
  migratable: "ok" | "mixed" | "empty";
}

const probeLayerCarrier = (node: unknown): LayerCarrierProbe => {
  let stroke = false;
  let fill = false;
  let radius = false;
  let icon = false;
  let iconColor = false;
  let markerColor = false;
  let known = 0;
  let unknown = 0;
  walkLeaf(node, leaf => {
    if (!stroke && hasSetStyle(leaf)) stroke = true;
    if (!fill && isArealStyleLeaf(leaf)) fill = true;
    if (!radius && isPixelRadiusLeaf(leaf)) radius = true;
    if (!icon && hasSetIcon(leaf)) icon = true;
    if (!iconColor && hasIconColorLeaf(leaf)) iconColor = true;
    if (!markerColor && hasMarkerColorLeaf(leaf)) markerColor = true;
    if (isMigratableLeaf(leaf)) known += 1;
    else unknown += 1;
  });
  return {
    stroke: stroke ? "native" : "none",
    fill: fill ? "native" : "none",
    size: radius ? "native" : "none",
    icon: icon ? "native" : "none",
    iconColor: iconColor ? "native" : "none",
    markerColor: markerColor ? "native" : "none",
    migratable: unknown > 0 ? "mixed" : known > 0 ? "ok" : "empty",
  };
};

/** A leaf that owns `setStyle` and an areal geometry.
 *
 *  The answer comes from a declaration, never from coordinate nesting: a
 *  Polygon ring and a MultiPolyline share the same `getLatLngs()` shape, so
 *  guessing from it paints line geometry as if it were an area. In order:
 *   1. `getRadius` — Circle / CircleMarker, where the radius IS the geometry;
 *   2. `FILL_OPT_IN` — a cross-realm or third-party Path declaring itself;
 *   3. `instanceof L.Polygon` — Rectangle extends it, so it covers both;
 *   4. a GeoJSON-declared `Polygon` or `MultiPolygon`.
 *  Without one of those a leaf is not fillable, which is how a bare Polyline,
 *  a MultiPolyline / MultiLineString, a Marker, a GridLayer and an
 *  ImageOverlay all fall out — their write axis is not a fill. */
const isArealStyleLeaf = (node: unknown): boolean => {
  if (node === null || node === undefined || typeof node !== "object") return false;
  const n = node as {
    setStyle?: unknown;
    getRadius?: unknown;
    feature?: unknown;
    toGeoJSON?: unknown;
    [key: string]: unknown;
  };
  // Each read is its own boundary: a getter that throws answers nothing, so
  // the probe falls through to the next signal instead of aborting the walk.
  if (safeRead(() => typeof n.setStyle) !== "function") return false;
  // 1. Circle / CircleMarker: the radius is the geometry.
  if (safeRead(() => typeof n.getRadius) === "function") return true;
  // 2. Declared fillable — the cross-realm / custom-path escape hatch.
  if (safeRead(() => n[FILL_OPT_IN]) === true) return true;
  // 3. Leaflet-native Polygon (Rectangle extends it). `instanceof` sees only
  //    this realm's identity, which is why step 2 exists.
  if (safeRead(() => typeof L.Polygon !== "undefined" && n instanceof L.Polygon)) {
    return true;
  }
  // 4. GeoJSON-declared geometry type.
  return AREAL_GEOMETRY_TYPES.has(declaredGeometryType(n) ?? "");
};

const findLayer = (map: L.Map, id: string): L.Layer | null => {
  if (typeof window === "undefined") return null;
  return (internalLayers(map)?.[id] ??
    Reflect.get(window, id) ??
    null) as L.Layer | null;
};

/**
 * Build a predicate matching leaves whose `options.pane` is one of `panes`.
 * Used as a map-interaction suspension skip so a component can keep its own
 * layers interactive (e.g. edit mode's measurements) while suspending every
 * other layer. The pane list is supplied by the caller, keeping this helper
 * component-agnostic.
 */
const isLayerInPanes = (panes: readonly string[]): ((leaf: L.Layer) => boolean) => {
  return (leaf: L.Layer) => {
    const opts = leaf.options as { pane?: string } | undefined;
    return !!opts?.pane && panes.includes(opts.pane);
  };
};

/** Whether the layer actually paints at the map's current zoom.
 *
 *  `GridLayer._setView` sets `_tileZoom = undefined` when the zoom falls
 *  outside the layer's own `options.minZoom/maxZoom`, so it builds no tile —
 *  yet `map.hasLayer()` still reports true. Consumers answering "is this
 *  layer visible?" must fold both facts in, or they name a layer the screen
 *  does not show. Layers without `minZoom/maxZoom` skip the range check.
 *
 *  Scope: Leaflet only applies the min/max zoom gate to **GridLayer**
 *  descendants (TileLayer, WMS, ImageOverlay, etc.). `L.Path` / `L.Marker`
 *  and other vector layers declare `maxZoom` but still render at any zoom —
 *  using this predicate for them would produce false negatives (e.g. labels
 *  vanishing at zoom levels where the vector layer is clearly on screen).
 *  Callers must be in a tile-layer context.
 */
const paintsAtZoom = (map: L.Map, layer: L.Layer | null | undefined): boolean => {
  if (!layer || !map.hasLayer(layer)) return false;
  const opts = (layer.options ?? {}) as { minZoom?: number; maxZoom?: number };
  const z = map.getZoom();
  if (typeof opts.minZoom === "number" && z < opts.minZoom) return false;
  if (typeof opts.maxZoom === "number" && z > opts.maxZoom) return false;
  return true;
};

/** Honest capability profile for `kind: "cluster"`. Named so the UI and the
 *  regression suite share one answer: cluster icons live in the shared
 *  `markerPane` (opacity/zoomRange/bounds have no honest carrier), but the
 *  group itself is an `L.Layer` so visibility is still map membership. */

const CLUSTER_CAPABILITIES: Omit<LayerCapabilities, "label"> = {
  fill: CONST.CAP_TIER.NONE,
  stroke: CONST.CAP_TIER.NONE,
  size: CONST.CAP_TIER.NONE,
  // Icon is "none" for the same reason opacity is: cluster bubbles live in
  // the shared `markerPane` and never enter `eachLayer`, so a per-leaf
  // `setIcon` write would change the individual markers but not the cluster
  // bubbles — half the layer. Do not "fix" this to "native".
  icon: CONST.CAP_TIER.NONE,
  iconColor: CONST.CAP_TIER.NONE,
  markerColor: CONST.CAP_TIER.NONE,
  opacity: CONST.CAP_TIER.NONE,
  zoomRange: CONST.CAP_TIER.NONE,
  visibility: CONST.CAP_TIER.NATIVE,
  relocatable: false,
  bounds: false,
};

/** The MarkerCluster plugin's group — **kind derivation only**. Capability
 *  dispatch goes through `kind: "cluster"` + `CLUSTER_CAPABILITIES`, not
 *  through this probe; callers should declare `kind: "cluster"`.
 *
 *  Two tells: the plugin attaches `_topClusterLevel`, and (when loaded) the
 *  group is an `L.MarkerClusterGroup`. Why the honest tier drops opacity:
 *  `eachLayer` reaches the individual markers, but the cluster icons live in
 *  the shared `markerPane` and never enter `eachLayer` — a pane write would
 *  fade the leaves and not the clusters (half the layer). */

const isMarkerCluster = (layer: L.Layer): boolean => {
  const ctor = (window.L as { MarkerClusterGroup?: unknown })?.MarkerClusterGroup;
  if (
    typeof ctor === "function" &&
    layer instanceof (ctor as new (...args: never[]) => unknown)
  ) {
    return true;
  }
  return !!(layer as L.Layer & { _topClusterLevel?: unknown })._topClusterLevel;
};

/** Whether the layer is a tile-family GridLayer (TileLayer is a subclass). */

const isTileFamily = (layer: L.Layer): boolean =>
  typeof L.GridLayer !== "undefined" && layer instanceof L.GridLayer;

/** Whether the layer is in the Path/Marker vector family (or a group of
 *  them). Same probe family as capability detection — not a new duck type. */

const isVectorFamily = (layer: L.Layer): boolean => {
  if (typeof L.Path !== "undefined" && layer instanceof L.Path) return true;
  if (typeof L.Marker !== "undefined" && layer instanceof L.Marker) return true;
  if (typeof L.LayerGroup !== "undefined" && layer instanceof L.LayerGroup) {
    return true;
  }
  return false;
};

/** Derive `kind` when the caller did not declare one.
 *
 *  `tile | vector` comes from the Leaflet layer family (GridLayer/TileLayer vs
 *  Path/Marker/LayerGroup) — the same probe family as capabilities. MarkerCluster
 *  may derive `"cluster"` so a folium plugin group still lands in the honest
 *  capability tier; callers should declare `kind: "cluster"` explicitly. */

const deriveLayerKind = (opts: {
  kind?: LayerKind;
  color?: string | null;
  custom?: unknown;
  canvas?: boolean;
  layer?: L.Layer | null;
}): LayerKind => {
  if (opts.kind) return opts.kind;
  if (opts.color != null) return CONST.KIND.SOLID;
  if (opts.custom !== undefined) return CONST.KIND.CUSTOM;
  if (opts.canvas && !opts.layer) return CONST.KIND.CANVAS;
  const layer = opts.layer;
  if (layer && isMarkerCluster(layer)) return CONST.KIND.CLUSTER;
  if (layer && isTileFamily(layer)) return CONST.KIND.TILE;
  if (layer && isVectorFamily(layer)) return CONST.KIND.VECTOR;
  if (layer) return CONST.KIND.VECTOR;
  // No layer and no explicit non-layer carrier: a pending Leaflet-layer
  // registration (folium script-stream). NOT "custom" — that kind means an
  // explicit no-carrier third-party payload and would hide the entry from
  // `hasUnresolvedLayers`.
  return CONST.KIND.VECTOR;
};

export {
  FILL_OPT_IN,
  hasFillLeaf,
  hasMarkerLeaf,
  hasMarkerColorLeaf,
  isMarkerLeaf,
  isPathLeaf,
  hasRadiusLeaf,
  hasSetStyleLeaf,
  isArealStyleLeaf,
  probeLayerCarrier,
  CLUSTER_CAPABILITIES,
  deriveLayerKind,
  findLayer,
  isLayerInPanes,
  paintsAtZoom,
};
export type { LayerCarrierProbe };
