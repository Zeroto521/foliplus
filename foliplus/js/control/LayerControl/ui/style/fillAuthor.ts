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
import { METHOD } from "#core/value/classify.js";
import type { LayerInfo, ValueConfig } from "#core/layer/index.js";

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

/** Display label for one classification method. Written as literal T()
 *  calls rather than `T(\`style_method_\${method}\`)`: the locale-usage scanner
 *  only sees literal keys, and a template-built key would let a renamed locale
 *  entry pass silently. */
const methodLabel = (ui: LayerUI, method: ValueConfig["method"]): string => {
  switch (method) {
    case METHOD.JENKS:
      return ui.T("style_method_jenks");
    case METHOD.QUANTILE:
      return ui.T("style_method_quantile");
    case METHOD.EQUAL:
      return ui.T("style_method_equal");
    case METHOD.HEADS:
      return ui.T("style_method_heads");
  }
};

export { authorFill, paintsPerFeatureFill, methodLabel };

export type { AuthorFill };
