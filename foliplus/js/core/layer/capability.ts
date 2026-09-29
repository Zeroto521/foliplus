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
import type { StyleProbeNode } from "./type.js";

/** Coerce any layer to the probe node shape. The walk is duck-typed: it
 *  checks for `eachLayer` and `setStyle` at runtime, so the cast is safe
 *  even for layers whose TypeScript type does not declare those methods. */
const asProbeNode = (node: unknown): StyleProbeNode | null =>
  node != null ? (node as StyleProbeNode) : null;

/** Whether any leaf in the tree exposes a runtime `setStyle` — the honest
 *  carrier check for the vector stroke axis (border). */
const hasSetStyleLeaf = (node: unknown): boolean => {
  const n = asProbeNode(node);
  if (!n) return false;
  if (typeof n.eachLayer === "function") {
    let found = false;
    n.eachLayer(child => {
      if (!found) found = hasSetStyleLeaf(child);
    });
    return found;
  }
  return typeof n.setStyle === "function";
};

/** Whether any leaf is an areal fill carrier — a Path-family leaf with a
 *  `setStyle` whose geometry carries a fill (Polygon / Rectangle rings, or
 *  Circle / CircleMarker via `getRadius`). No `instanceof` class checks:
 *  Leaflet's Circle / CircleMarker hierarchy has inverted before, and
 *  stubs / third-party paths do not share our class identities. The probe
 *  reads carrier features the write path actually uses.
 *
 *  Line-only leaves (Polyline) fall out: they have `getLatLngs` but no
 *  ring nesting and no `getRadius`. Markers, GridLayer / ImageOverlay and
 *  canvas layers fall out too — their write axis is not `setStyle`. */
const hasFillLeaf = (node: unknown): boolean => {
  const n = asProbeNode(node);
  if (!n) return false;
  if (typeof n.eachLayer === "function") {
    let found = false;
    n.eachLayer(child => {
      if (!found) found = hasFillLeaf(child);
    });
    return found;
  }
  return isArealStyleLeaf(n);
};

/** A leaf that owns `setStyle` and an areal geometry, detected by carrier
 *  features rather than class identity. */
const isArealStyleLeaf = (node: unknown): boolean => {
  const n = node as {
    setStyle?: unknown;
    getRadius?: unknown;
    getLatLngs?: unknown;
  };
  if (typeof n.setStyle !== "function") return false;
  // Circle / CircleMarker: radius is the geometry.
  if (typeof n.getRadius === "function") return true;
  // Polygon / Rectangle: getLatLngs returns rings (array of arrays).
  if (typeof n.getLatLngs === "function") {
    const rings = (n.getLatLngs as () => unknown)();
    return Array.isArray(rings) && rings.length > 0 && Array.isArray(rings[0]);
  }
  return false;
};

export { hasFillLeaf, hasSetStyleLeaf };
