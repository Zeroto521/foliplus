// core/layer/capability — vector-style probe for stroke / fill carriers.
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
import { someLeaf } from "./walkLeaf.js";

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

/** Whether any leaf in the tree exposes a runtime `setStyle` — the honest
 *  carrier check for the vector stroke axis (border). */
const hasSetStyleLeaf = (node: unknown): boolean =>
  someLeaf(
    node,
    leaf =>
      safeRead(() => typeof (leaf as { setStyle?: unknown }).setStyle) === "function",
  );

/** Whether any leaf is an areal fill carrier — see `isArealStyleLeaf`. */
const hasFillLeaf = (node: unknown): boolean => someLeaf(node, isArealStyleLeaf);

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

export { FILL_OPT_IN, hasFillLeaf, hasSetStyleLeaf, isArealStyleLeaf };
