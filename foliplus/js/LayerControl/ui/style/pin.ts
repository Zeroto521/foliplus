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
// (fill, border) use; it becomes the §47.1-② unified hook when those merge.

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

/** Leaves already pinned against the highlight restore. */
const pinned = new WeakSet<StyleSetter>();

/** Pin one leaf's style against folium's `resetStyle` on mouseout. The pin
 *  handler runs last in the dispatch order (see above), so the user's values
 *  — read live from `getStyle` on each fire — win over the author's restore.
 *  One listener per leaf, guarded by WeakSet. */
const pinStyleOnHighlight = (
  leaf: StyleSetter,
  getStyle: () => Record<string, unknown> | null,
): void => {
  if (typeof leaf.on !== "function" || pinned.has(leaf)) return;
  pinned.add(leaf);
  leaf.on("mouseout", () => {
    const style = getStyle();
    if (!style) return;
    leaf.setStyle(style);
  });
};

export { isStyleSetter, pinStyleOnHighlight, type StyleSetter };
