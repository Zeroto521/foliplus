// core/layer/traverse — tree queries over a layer's child registry and rows.
//
// These answer "is this node a group, is this entry a group row, and how many
// direct children does it own. The recursion itself lives in walkLeaf; this
// module only asks structural questions of the result.
import type { LayerInfo } from "./type.js";
import { childrenOf, countChildLayers } from "./walkLeaf.js";
import { internalLayers, isGroupLike } from "#core/leafletAdapter.js";

type GroupLike = L.Layer & {
  addLayer?: (layer: L.Layer) => unknown;
  getLayers?: () => L.Layer[];
  eachLayer?: (fn: (layer: L.Layer) => void) => void;
};

/** Whether a layer is a group of other layers.
 *
 *  A group is a group-like node that OWNS a child registry — a real
 *  Leaflet LayerGroup / FeatureGroup (or a folium FeatureGroup), recognised by
 *  its `_layers` object or add/remove pair. A leaf stand-in that happens to
 *  carry `eachLayer` (a Polygon stand-in, a marker with a stray method) is not
 *  a group.
 *
 *  A real L.FeatureGroup (L.featureGroup / a folium FeatureGroup) is always
 *  a group — even when its direct children carry `.feature` envelopes
 *  (feature leaves), the GeoJSON shape fallback below would wrongly exclude
 *  such a group, so the canonical class branch wins first.
 *
 *  One deliberate exclusion keeps the probe honest: L.GeoJSON extends
 *  L.FeatureGroup extends L.LayerGroup, so a naive `eachLayer` probe would
 *  mislabel EVERY GeoJSON row as a group — a GeoJSON layer is data, not a
 *  folder of sub-layers. The exclusion prefers `instanceof L.GeoJSON` (the
 *  canonical check) and falls back to the GeoJSON shape (every direct child
 *  carries a `feature` envelope) when the class identity is unavailable.
 *
 *  @param {L.Layer} layer - Leaflet layer (group or leaf).
 *  @returns {boolean} Whether the layer is a user-facing group. */

const isGroupLayer = (layer: L.Layer): layer is GroupLike => {
  if (!isGroupLike(layer)) return false;
  // A real group enumerates children through Leaflet's child registry
  // (the _layers object) or the add/remove pair. A leaf stand-in that happens
  // to carry eachLayer (a Polygon stand-in in tests, a marker with a stray
  // method) is NOT a group — it has no child registry to own.
  const c = layer as Partial<GroupLike>;
  // The child-registry read is the adapter's own reach (internalLayers), so
  // this module never touches a Leaflet private field directly.
  const hasChildRegistry =
    internalLayers(layer) !== undefined ||
    typeof c.addLayer === "function" ||
    typeof c.getLayers === "function";
  if (!hasChildRegistry) return false;
  // GeoJSON is a data layer with a group shape (FeatureGroup -> LayerGroup); it
  // owns no sub-layers, so a naive eachLayer probe would mislabel EVERY
  // GeoJSON row as a group. instanceof L.GeoJSON is the canonical check;
  // the guard keeps a jsdom mock L (no GeoJSON class) from throwing.
  // A real L.FeatureGroup (not a GeoJSON data layer) is always a user-facing
  // group — a folium FeatureGroup groups sub-layers even when its direct
  // children carry .feature envelopes (feature leaves). The GeoJSON shape
  // fallback below would wrongly exclude such a group, so the canonical class
  // branch wins first. Guarded because jsdom mocks L without the FeatureGroup
  // class (layerGroup is a factory there).
  if (
    typeof L.FeatureGroup === "function" &&
    layer instanceof (L.FeatureGroup as new () => L.Layer) &&
    !(
      typeof L.GeoJSON === "function" &&
      layer instanceof (L.GeoJSON as new () => L.Layer)
    )
  ) {
    return true;
  }
  if (
    typeof L.GeoJSON === "function" &&
    layer instanceof (L.GeoJSON as new () => L.Layer)
  ) {
    return false;
  }
  // A GeoJSON layer whose class identity is unavailable (foreign bundle,
  // jsdom mock) is recognised by its shape: every direct child carries a
  // GeoJSON feature envelope. A user FeatureGroup children (plain markers /
  // paths) carry none, so the two cannot be confused.
  const children = childrenOf(layer);
  if (children.length > 0 && children.every(child => child && "feature" in child)) {
    return false;
  }
  return true;
};

/** Whether a registry entry renders as a group ROW.
 *
 *  Row semantics — the type glyph, the count column, and whether the style and
 *  filter panels are available — belong to the entry, not to the Leaflet class
 *  alone. A logical layer can be backed by a group and still be data:
 *  MeasureControl and HeatmapControl both register an L.layerGroup with a
 *  `featureCountProvider`, and their count is provider-driven rather than a
 *  sub-layer census. `isGroupLayer` answers the geometry question (is this
 *  a group?); this answers the row question, so the provider exception lives
 *  here once instead of being re-derived at every call site.
 *
 *  @param {LayerInfo|null|undefined} layerInfo - Registry entry behind the row.
 *  @param {L.Layer|null|undefined} layer - Leaflet layer behind the entry.
 *  @returns {boolean} Whether the row is a group row. */

const isGroupRow = (
  layerInfo: LayerInfo | null | undefined,
  layer: L.Layer | null | undefined,
): boolean =>
  Boolean(layer && layerInfo && !layerInfo.featureCountProvider && isGroupLayer(layer));

/** Count a group's DIRECT children (its own sub-layers, not deep leaves).
 *  @param {L.Layer} layer - Leaflet group.
 *  @returns {number} Number of direct children. */

const countChildLayersOf = (layer: L.Layer): number => countChildLayers(layer);
/** Count a group's DIRECT children currently added to the map (visible
 *  sub-layers). A direct child is counted only when the map still owns it
 *  (map.hasLayer(child)); a child removed from the map is not a visible
 *  sub-layer even though it remains in the group's registry.
 *  @param {L.Layer} layer - Leaflet group.
 *  @param {L.Map} map - Leaflet map (owner of the membership fact).
 *  @returns {number} Number of direct children on the map. */

const countVisibleChildLayers = (layer: L.Layer, map: L.Map): number => {
  // The child enumeration is walkLeaf's childrenOf — the same read
  // countChildLayers uses, so "how many children" and "how many are visible"
  // can never disagree about what a child is.
  if (typeof map.hasLayer !== "function") return 0;
  let visible = 0;
  for (const child of childrenOf(layer)) {
    if (map.hasLayer(child)) visible++;
  }
  return visible;
};

/** Count geometric features in a layer tree.
 *  Counts geometry-producing leaves (Polygon / Polyline / CircleMarker / Marker).
 *  A plain L.Marker without .feature (e.g. folium.Marker()) still counts as a
 *  point feature.  Excludes label layers and non-geometric nodes.
 *  @param {L.Layer} layer - Leaflet layer (group or leaf).
 *  @returns {number} Number of geometric features. */

export { countChildLayersOf, countVisibleChildLayers, isGroupLayer, isGroupRow };
