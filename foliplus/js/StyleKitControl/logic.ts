// StyleKitControl logic — restore the Python-declared style defaults and clear
// this map's saved settings.
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

/** The prefix every component scopes its localStorage record with. */
const STORAGE_PREFIX = "foliplus_";

/** True for a localStorage key owned by this map container: the shared
 *  `foliplus_` prefix, the container's own id as the suffix, and at least one
 *  character between them for the record's name. */
const isMapStorageKey = (key: string, suffix: string): boolean => {
  if (!key.startsWith(STORAGE_PREFIX) || !key.endsWith(suffix)) return false;
  return key.length > STORAGE_PREFIX.length + suffix.length;
};

/** Drop every localStorage record this map container owns.
 *
 *  Scanning rather than naming the keys is deliberate: each component keeps
 *  its key private in its own const module, and a key added by a component
 *  written later is covered without this control changing. The container-id
 *  suffix is what makes the sweep map-scoped — a second map on the same page
 *  keeps its own record.
 *
 *  `common/storage.ts` has no `removeItem`: it wraps a write-through state,
 *  not a document, so dropping a whole record goes straight to the backend
 *  the way HeatmapControl's own clear does.
 *
 *  @returns How many records were removed.
 */
const resetMapSettings = (): number => {
  const suffix = `_${map.getContainer().id}`;
  let removed = 0;
  // Backwards: `removeItem` shifts every key above the one removed, so a
  // forward walk would resurface a deleted key at the freed index and skip
  // the next surviving one.
  for (let i = window.localStorage.length - 1; i >= 0; i--) {
    const key = window.localStorage.key(i);
    if (key && isMapStorageKey(key, suffix)) {
      window.localStorage.removeItem(key);
      removed += 1;
    }
  }
  return removed;
};

export { restoreDefaults, resetMapSettings };
