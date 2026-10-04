// Pin a style-leaf against folium's highlight_on_hover restore.
//
// folium binds a per-feature `mouseout` during `addData` that runs the
// group's `resetStyle` â€?re-applying the author's style function and undoing
// any style write LayerControl made. A click on a feature necessarily crosses
// a mouseout, so without the pin the user's choice is gone the moment the
// pointer leaves the geometry.
//
// The pin handler binds AFTER folium's (folium wires its handlers during
// `addData`, which runs before any LayerControl attach), so Leaflet's event
// dispatch order runs ours last: the highlight still applies while the
// pointer is over the feature, and the user's style is the value left behind.
//
// `getStyle` must return only the dimensions the user set â€?`null` (or an
// empty object) means "nothing to restore", so a Reset keeps the author's
// value. This is the unified hook both self-managed style dimensions
// (fill, border) share: one handler per leaf merges every keyed getter
// into a single `setStyle` on fire.
import type { StyleSetter } from "../../type.js";
import { isStyleSetter } from "./styleBag.js";

type StyleGetter = () => Record<string, unknown> | null;

/** One mouseout handler per leaf; getters register under a dimension key
 *  ("fill", "border") and a re-register REPLACES the entry for that key.
 *  Identity dedupe cannot work here â€?every apply pass builds a fresh
 *  closure, so an `includes` check never matches and a plain array grows
 *  without bound on every commit. The key is the caller's stable dimension
 *  id instead: two dimensions share a leaf without one silently dropping
 *  the other's user value (folium's `resetStyle` fires first in the
 *  dispatch order, and each getter adds its own dims to the same `setStyle`
 *  call that goes last), and repeated commits hold at one getter per
 *  dimension. */
const pins = new WeakMap<StyleSetter, Map<string, StyleGetter>>();

/** Pin one leaf's style against folium's `resetStyle` on mouseout. The pin
 *  handler runs last in the dispatch order (see above), so the user's values
 *  â€?read live from `getStyle` on each fire â€?win over the author's restore.
 *  Distinct keys stack and each fire merges their output into a single
 *  `setStyle`; re-registering a key replaces its getter rather than
 *  appending another closure. */
const pinStyleOnHighlight = (
  leaf: StyleSetter,
  key: string,
  getStyle: StyleGetter,
): void => {
  if (typeof leaf.on !== "function" || typeof leaf.setStyle !== "function") {
    return;
  }
  const existing = pins.get(leaf);
  if (existing) {
    existing.set(key, getStyle);
    return;
  }
  const getters = new Map<string, StyleGetter>([[key, getStyle]]);
  pins.set(leaf, getters);
  leaf.on("mouseout", () => {
    const style: Record<string, unknown> = {};
    for (const g of getters.values()) {
      const s = g();
      if (s) Object.assign(style, s);
    }
    if (Object.keys(style).length === 0) return;
    leaf.setStyle(style);
  });
};

/** How many getters are currently pinned on a leaf. Exposed for tests:
 *  repeated commits must hold at one getter per dimension key, never grow
 *  the registry â€?a fresh closure per commit used to append without bound. */
const pinnedGetterCount = (leaf: StyleSetter): number => pins.get(leaf)?.size ?? 0;

export { isStyleSetter, pinnedGetterCount, pinStyleOnHighlight };
