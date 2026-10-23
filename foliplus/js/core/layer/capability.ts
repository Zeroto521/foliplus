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

/** Read the geometry type a node declares, if it declares one — the GeoJSON
 *  envelope on `feature` first (cheapest), then a `toGeoJSON()` call. A
 *  throwing `toGeoJSON` is not evidence of any geometry, so it is ignored. */
const declaredGeometryType = (node: {
  feature?: unknown;
  toGeoJSON?: unknown;
}): string | undefined => {
  const feature = node.feature as { geometry?: { type?: unknown } } | undefined;
  if (feature && typeof feature === "object") {
    const declared = feature.geometry?.type;
    if (typeof declared === "string") return declared;
  }
  if (typeof node.toGeoJSON === "function") {
    try {
      const out = (node.toGeoJSON as () => unknown)() as
        | {
            geometry?: { type?: unknown };
          }
        | undefined;
      const declared = out?.geometry?.type;
      if (typeof declared === "string") return declared;
    } catch {
      // A throw says nothing about the geometry.
    }
  }
  return undefined;
};

/** Whether any leaf in the tree exposes a runtime `setStyle` — the honest
 *  carrier check for the vector stroke axis (border). */
const hasSetStyleLeaf = (node: unknown): boolean =>
  someLeaf(
    node,
    leaf => typeof (leaf as { setStyle?: unknown }).setStyle === "function",
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
  if (typeof n.setStyle !== "function") return false;
  // 1. Circle / CircleMarker: the radius is the geometry.
  if (typeof n.getRadius === "function") return true;
  // 2. Declared fillable — the cross-realm / custom-path escape hatch.
  if (n[FILL_OPT_IN] === true) return true;
  // 3. Leaflet-native Polygon (Rectangle extends it). `instanceof` sees only
  //    this realm's identity, which is why step 2 exists.
  if (typeof L.Polygon !== "undefined" && n instanceof L.Polygon) return true;
  // 4. GeoJSON-declared geometry type.
  return AREAL_GEOMETRY_TYPES.has(declaredGeometryType(n) ?? "");
};

export { FILL_OPT_IN, hasFillLeaf, hasSetStyleLeaf, isArealStyleLeaf };
