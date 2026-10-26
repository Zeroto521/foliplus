// HeatmapControl persistence — loading, applying, and clearing saved heatmap
// configuration from localStorage. Pure functions over the manager's public
// state surface.
import { CLASS_COUNT, type ClassifyMethod, isClassifyMethod } from "#core/classify.js";
import { bareFieldName } from "#core/label/index.js";
import {
  type LayerFilter,
  parsePersistedFilters,
  restoreFilters,
} from "#core/layer/index.js";
import type { NumberStyle } from "#foliplus/config-schema.js";
import { clampBorderWeight, clampLabelSize } from "#common/form.js";
import * as Storage from "#common/storage.js";
import { AGG } from "./const.js";
import * as CONST from "./const.js";
import type { SavedConfig } from "./type.js";

/** The closed aggregation vocabulary, read off AGG so a new aggregate
 *  cannot drift out of the parser. */
const AGGS: readonly string[] = Object.values(AGG).filter(
  (value): value is string => typeof value === "string",
);

/** Every NumberStyle value. Typed as a total Record so adding a member to
 *  the union fails typecheck here instead of silently being dropped on
 *  reload. */
const LABEL_FORMATS: Record<NumberStyle, true> = {
  auto: true,
  int: true,
  comma: true,
  percent: true,
};

/** Read one saved record through a runtime schema.
 *
 *  `Storage.loadRecord<SavedConfig>` is a static assertion, not a check: a
 *  record from an older build, a hand-edited one, or one written by a
 *  future version carries whatever it likes. Writing an unrecognised
 *  `method` into the manager used to reach the classifier (and be silently
 *  re-meant as equal), so each field is validated here and an invalid one
 *  keeps the in-memory default instead of polluting the manager.
 *
 *  `scheme` is only checked for shape. chroma supports any ColorBrewer name
 *  and the Python side accepts custom palettes, so the closed set is not
 *  ours to decide; `getColorScale` degrades an unparsable name to the
 *  fallback colour, which is the one place that knowledge lives. */
const parseSavedConfig = (raw: unknown): SavedConfig | null => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  const out: SavedConfig = {};
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined;
  const finite = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;

  if (data.version !== undefined) {
    const version = finite(data.version);
    if (version !== undefined && Number.isInteger(version) && version > 0) {
      out.version = version;
    }
  }
  // `null` is a real value here - it means "the user cleared the
  // selection" - so it is preserved rather than treated as absent.
  if (data.layerId === null || typeof data.layerId === "string") {
    out.layerId = data.layerId;
  }
  const agg = str(data.agg);
  if (agg !== undefined && AGGS.includes(agg)) out.agg = agg;
  if (isClassifyMethod(data.method)) out.method = data.method;
  const scheme = str(data.scheme);
  if (scheme !== undefined) out.scheme = scheme;
  const numClasses = finite(data.numClasses);
  if (numClasses !== undefined && Number.isInteger(numClasses)) {
    out.numClasses = Math.min(CLASS_COUNT.MAX, Math.max(CLASS_COUNT.MIN, numClasses));
  }
  const borderWeight = finite(data.borderWeight);
  // The live setter clamps to BORDER_WEIGHT; a record must not enter the
  // manager through a wider gate than the panel itself offers.
  if (borderWeight !== undefined) {
    out.borderWeight = clampBorderWeight(borderWeight);
  }
  const borderColor = str(data.borderColor);
  if (borderColor !== undefined) out.borderColor = borderColor;
  if (typeof data.labelShow === "boolean") out.labelShow = data.labelShow;
  const labelColor = str(data.labelColor);
  if (labelColor !== undefined) out.labelColor = labelColor;
  const labelSize = finite(data.labelSize);
  if (labelSize !== undefined) out.labelSize = labelSize;
  const labelFormat = data.labelFormat;
  if (typeof labelFormat === "string" && Object.hasOwn(LABEL_FORMATS, labelFormat)) {
    out.labelFormat = labelFormat as NumberStyle;
  }
  const field = str(data.field);
  if (field !== undefined) out.field = field;
  const filters = parsePersistedFilters(data.filters);
  if (filters) out.filters = filters;
  return out;
};

/** The minimal manager state surface the persistence helpers write to. */
interface ManagerLike {
  selectedLayerId: string | null;
  agg: string;
  method: ClassifyMethod;
  scheme: string;
  numClasses: number;
  borderWeight: number;
  borderColor: string;
  labelShow: boolean;
  labelColor: string;
  labelSize: number;
  labelFormat: NumberStyle;
  field: string;
  hasScanned: boolean;
  /** Per-source committed filters (restored before the first render, then
   *  re-validated against the rebuilt snapshot by the manager). */
  layerFilters: Map<string, LayerFilter>;
}

/** Load saved configuration from localStorage, through the runtime schema. */
const loadSavedConfig = (): SavedConfig | null =>
  parseSavedConfig(Storage.loadRecord<unknown>(CONST.STORAGE.KEY, CONFIG.name));

/** Remove persisted configuration from localStorage. */
const clearSavedConfig = (): void => {
  Storage.removeRecord(CONST.STORAGE.KEY, CONFIG.name);
};

/** Apply a loaded config object to the manager's state.
 *
 *  The record is parsed here too, not only on load: this is public on the
 *  manager surface, so a caller can hand over whatever a record could hold.
 *  A non-object carries no user choice at all, so the one-shot guard stays
 *  untouched for it. */
const applySavedConfig = (mgr: ManagerLike, raw: SavedConfig): void => {
  const saved = parseSavedConfig(raw);
  if (saved === null) return;
  // A record existing at all means the user already spoke in a previous
  // session (picked a layer, or explicitly cleared the selection). Consume
  // the one-shot auto-select guard so reload does not undo that choice —
  // without this, hasScanned stays false and the single-layer auto-select
  // in buildLayerListItems re-fires after a manual clear survives reload.
  mgr.hasScanned = true;
  if (saved.agg) mgr.agg = saved.agg;
  if (saved.method) mgr.method = saved.method;
  if (saved.scheme) mgr.scheme = saved.scheme;
  // Already integer-checked and clamped by the parser.
  if (saved.numClasses !== undefined) mgr.numClasses = saved.numClasses;
  if (saved.borderWeight !== undefined) {
    mgr.borderWeight = saved.borderWeight;
  }
  if (saved.borderColor) mgr.borderColor = saved.borderColor;
  if (saved.labelShow !== undefined) mgr.labelShow = saved.labelShow;
  if (saved.labelColor) mgr.labelColor = saved.labelColor;
  if (saved.labelSize !== undefined) {
    mgr.labelSize = clampLabelSize(saved.labelSize);
  }
  if (saved.labelFormat) mgr.labelFormat = saved.labelFormat;
  if (saved.field) mgr.field = bareFieldName(saved.field);
  mgr.selectedLayerId = saved.layerId ?? null;
  // Restore the record's filter map as-is; the first render revalidates each
  // stored filter against the rebuilt snapshot (clamp to the current extent,
  // drop a field that disappeared) before it can exclude a point.
  restoreFilters(mgr.layerFilters, saved.filters);
};

export { applySavedConfig, clearSavedConfig, loadSavedConfig };
