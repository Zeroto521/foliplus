// authorFill — read the fill an author's source declared, per leaf.
//
// The panel's `fillAuthor` state comes from CONF: Python computes it once at
// render time from the GeoJson features' `__folium_color` property (geopandas
// explore output). This module is the one lazy read left — Reset replays the
// author's per-feature colours, and doing that needs each leaf's value, so the
// walk happens on the user's click rather than being shipped in the payload.
//
// It never writes and never touches the DOM.
import { isArealStyleLeaf } from "./capability.js";
import { walkLeaf } from "./walkLeaf.js";

/** folium's per-feature colour property. */
const FOLIUM_COLOR_PROP = "__folium_color";

/** One paint, one string: #rgb and #rrggbb, any case. */
const normalizeFillColor = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase();
  if (raw === "") return null;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(raw);
  return short
    ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
    : raw;
};

/** leaf → author colour, or null when the feature carried no colour. */
type AuthorFillSnapshot = Map<unknown, string | null>;

/** Read each areal leaf's declarative author colour. Empty when the layer is
 *  not explore output (no leaf carries the property). */
const readFeatureFillColors = (layer: unknown): AuthorFillSnapshot => {
  const snapshot: AuthorFillSnapshot = new Map();
  walkLeaf(layer, leaf => {
    if (!isArealStyleLeaf(leaf)) return;
    const props = (leaf as { feature?: { properties?: Record<string, unknown> } })
      .feature?.properties;
    snapshot.set(leaf, normalizeFillColor(props?.[FOLIUM_COLOR_PROP]));
  });
  return snapshot;
};

export { readFeatureFillColors };
