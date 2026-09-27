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

/** A node in the layer tree a probe walk may reach. */
type StyleProbeNode = {
  setStyle?: (style: Record<string, unknown>) => void;
  eachLayer?: (fn: (layer: L.Layer) => void) => void;
};

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

/** Whether any leaf is an areal carrier — L.Polygon, L.Circle, or
 *  L.CircleMarker (the last two because CircleMarker extends Circle, so
 *  `instanceof L.Circle` catches both) with a `setStyle` leaf.
 *
 *  Line-only leaves (L.Polyline, L.Rectangle which extends Polygon) and
 *  markers fall out; so do native setter surfaces (GridLayer / ImageOverlay)
 *  and canvas layers, whose write axis is not `setStyle`. */
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
  if (typeof n.setStyle !== "function") return false;
  return (
    node instanceof L.Polygon ||
    (typeof L.Circle !== "undefined" && node instanceof L.Circle)
  );
};

export { hasFillLeaf, hasSetStyleLeaf };
export type { StyleProbeNode };
