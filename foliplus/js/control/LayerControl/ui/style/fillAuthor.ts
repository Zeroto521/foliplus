// Author-paint readouts shared by the fill facade and both fill modes.
//
// `authorFill` reads the author's fill record from the layer registry;
// `paintsPerFeatureFill` answers whether the author painted per feature (the
// gate for the original-colors mode); `methodLabel` names one classification
// method in the locale vocabulary. These three are the only author-paint
// readouts the facade, the original mode and the value mode all read — they are
// split into this file to break the facade <-> mode import cycle (each mode and
// the facade import this instead of each other).
import type { LayerUI } from "../surface.js";
import { type LayerInfo, ROLE, type ValueConfig } from "#core/layer/index.js";
import { METHOD } from "#core/value/index.js";

type AuthorFill = NonNullable<LayerInfo["fillAuthor"]>;

const authorFill = (ui: LayerUI, layerId: string): AuthorFill | null =>
  ui.c.layerRegistry.get(layerId)?.fillAuthor ?? null;

/** Does the layer paint its own fill per feature?
 *
 *  The answer is Python's: `CONFIG.data[].fillAuthor` is computed once at
 *  render time from the GeoJson features' `__folium_color` (explore output)
 *  and the colormap the author mounted on the map, so the panel never walks
 *  the layer. A layer without the key keeps the normal single-color modes
 *  (per-feature author colors are recognised for geopandas explore layers
 *  only). This is what offers the "Original colors" mode at all; whether the
 *  layer is currently shown in it is {@link displayFillMode}'s question. */
const paintsPerFeatureFill = (ui: LayerUI, layerId: string): boolean =>
  authorFill(ui, layerId)?.perFeature === true;

/** Whether the layer is a solid-color basemap: a base layer whose fill is the
 *  value on `layerInfo.color` rather than a Leaflet layer's geometry.
 *
 *  `layerInfo.color` is the discriminator, not `layerInfo.canvas`: the color basemap *does*
 *  carry a `canvas` (its face element, which the export renderer draws — see
 *  `LayerFactory.createColor`), so excluding on `canvas` would never match it
 *  and silently drops its fill row. A heatmap canvas has no `color`, so it
 *  still belongs to the canvas family and is excluded here.
 *
 *  Used only by write paths (applyFillToLayer, resetLayerFill, buildFillRow)
 *  to route the color basemap's fill to `showSolidBasemap` instead of walking
 *  leaves. The gate (`layerCanFill`) reads the capability, not this. */
const isColorBasemap = (layerInfo: LayerInfo | undefined): boolean => {
  if (!layerInfo || layerInfo.styleSetters) return false;
  return Boolean(layerInfo.color) && layerInfo.role === ROLE.BASE;
};

/** Display label for one classification method. Written as literal _()
 *  calls rather than `_("foliplus.classification_" + method)`: the
 *  locale-usage scanner only sees literal keys, and a template-built key
 *  would let a renamed locale entry pass silently. */
const methodLabel = (ui: LayerUI, method: ValueConfig["method"]): string => {
  switch (method) {
    case METHOD.JENKS:
      return ui._("foliplus.classification_jenks");
    case METHOD.QUANTILE:
      return ui._("foliplus.classification_quantile");
    case METHOD.EQUAL:
      return ui._("foliplus.classification_equal");
    case METHOD.HEADS:
      return ui._("foliplus.classification_heads");
  }
};

export { authorFill, isColorBasemap, paintsPerFeatureFill, methodLabel };

export type { AuthorFill };
