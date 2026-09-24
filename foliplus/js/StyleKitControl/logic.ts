// StyleKitControl logic — restore the Python-declared style defaults.
import type { LayerInfo } from "#core/layer/type.js";

/** Every style dimension a layer delegates, called back to its Python default.
 *
 *  `styleSetters` and `styleDefaults` are both pull-on-demand contracts: the
 *  component owns the value and hands out the setter, and the defaults snapshot
 *  was taken at construction. This is the loop the per-layer style drawer's
 *  Reset already runs, with the panel removed.
 *
 *  A layer without `styleSetters` (a plain data layer, a basemap) owns no
 *  delegated dimensions, so it is skipped — there is nothing to restore and
 *  nothing to report.
 *
 *  @returns How many layers had at least one dimension written back.
 */
const restoreDefaults = (layers: readonly LayerInfo[]): number => {
  let restored = 0;
  for (const layer of layers) {
    const setters = layer.styleSetters;
    if (!setters) continue;
    const defaults = layer.styleDefaults?.() ?? {};
    let any = false;
    for (const [key, setter] of Object.entries(setters)) {
      if (key in defaults) {
        setter(defaults[key]);
        any = true;
      }
    }
    if (any) restored += 1;
  }
  return restored;
};

export { restoreDefaults };
