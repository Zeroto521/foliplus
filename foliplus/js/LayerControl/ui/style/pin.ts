// Pin a style-leaf against folium's highlight_on_hover restore.
//
// folium binds a per-feature `mouseout` during `addData` that runs the
// group's `resetStyle` — re-applying the author's style function and undoing
// any style write LayerControl made. A click on a feature necessarily crosses
// a mouseout, so without the pin the user's choice is gone the moment the
// pointer leaves the geometry.
//
// The pin handler binds AFTER folium's (folium wires its handlers during
// `addData`, which runs before any LayerControl attach), so Leaflet's event
// dispatch order runs ours last: the highlight still applies while the
// pointer is over the feature, and the user's style is the value left behind.
//
// `getStyle` must return only the dimensions the user set — `null` (or an
// empty object) means "nothing to restore", so a Reset keeps the author's
// value. This is the shared mechanism both self-managed style dimensions
// (fill, border) use; it becomes the unified hook when those merge.

/** A leaf whose `setStyle` is there for real. Narrowing through a guard
 *  rather than a `typeof` test keeps call sites plain method calls, which
 *  matters: Leaflet's `Path.setStyle` runs `setOptions(this, style)`, so a
 *  method captured into a local and called detached would see `this` as
 *  undefined and throw instead of writing. */
type StyleSetter = {
  setStyle: (style: Record<string, unknown>) => void;
  on?: (type: string, fn: () => void) => void;
};

const isStyleSetter = (node: unknown): node is StyleSetter =>
  node != null && typeof (node as StyleSetter).setStyle === "function";

type StyleGetter = () => Record<string, unknown> | null;

/** One mouseout handler per leaf; every `pinStyleOnHighlight` call
 *  registers its own getter, and the shared handler reads all of them on
 *  fire. Two dimensions (fill, border) can share a leaf without one
 *  silently dropping the other's user value — folium's `resetStyle` fires
 *  first in the dispatch order, and each getter adds its own dims to the
 *  same `setStyle` call that goes last. */
const pins = new WeakMap<StyleSetter, StyleGetter[]>();

/** Pin one leaf's style against folium's `resetStyle` on mouseout. The pin
 *  handler runs last in the dispatch order (see above), so the user's values
 *  — read live from `getStyle` on each fire — win over the author's restore.
 *  Repeated calls with the same getter are idempotent; distinct getters
 *  stack, and each fire merges their output into a single `setStyle`. */
const pinStyleOnHighlight = (leaf: StyleSetter, getStyle: StyleGetter): void => {
  if (typeof leaf.on !== "function" || typeof leaf.setStyle !== "function") {
    return;
  }
  const existing = pins.get(leaf);
  if (existing) {
    if (existing.includes(getStyle)) return;
    existing.push(getStyle);
    return;
  }
  const getters: StyleGetter[] = [getStyle];
  pins.set(leaf, getters);
  leaf.on("mouseout", () => {
    const style: Record<string, unknown> = {};
    for (const g of getters) {
      const s = g();
      if (s) Object.assign(style, s);
    }
    if (Object.keys(style).length === 0) return;
    leaf.setStyle(style);
  });
};

/** A node in the layer tree that a style walk may reach. `setStyle` alone does
 *  not make a node a carrier — L.GeoJSON owns one too (it fans a style out to
 *  its features) — so walks descend groups through `eachLayer` first and treat
 *  a setter as a leaf only. */
type WalkableNode = {
  setStyle?: (style: Record<string, unknown>) => void;
  eachLayer?: (fn: (child: L.Layer) => void) => void;
};

/** Whether any leaf in the tree exposes a runtime `setStyle` — the honest
 *  carrier check for the vector style axis (border / fill). Groups are
 *  descended; a node with `setStyle` of its own counts only when it is a
 *  leaf (no `eachLayer`). Groups that own a `setStyle` of their own
 *  (L.GeoJSON, L.FeatureGroup) are still descended: an empty one has no
 *  feature to fan the style out to, so it returns false like an empty
 *  LayerGroup or a Marker with no children — the `setStyle` of its own is
 *  not a real carrier when the walk finds nothing to write to. A null node
 *  also falls out.
 *
 *  Shared by `layerCanBorder` and `hasFillGeometry` so the two vector axes
 *  read the same honest-degradation invariant (§44.2: capability = the
 *  existence of a carrier object). */
const hasSetStyleLeaf = (node: WalkableNode | null): boolean => {
  if (!node) return false;
  if (typeof node.eachLayer === "function") {
    let found = false;
    node.eachLayer(child => {
      if (!found) found = hasSetStyleLeaf(child as WalkableNode);
    });
    return found;
  }
  return typeof node.setStyle === "function";
};

export { hasSetStyleLeaf, isStyleSetter, pinStyleOnHighlight };
export type { StyleSetter };
