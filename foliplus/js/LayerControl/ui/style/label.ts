// Per-layer annotation label controls — the ⚙︎ drawer's "Label" section.
// Moved verbatim from ui/style.ts. Owns the field cache,
// the toggle/select wiring through applyPatch, and the load-time
// applyStyleLabelState snapshot seed. Called back by the panel
// assembly in index.ts.
import {
  AUTO_FIELD,
  type LabelField,
  isNumericField,
  resolveSelectedField,
} from "#core/labelField.js";
import {
  LABEL_COLOR_DEFAULT,
  LABEL_SIZE,
  clampLabelSize,
  normalizeHexColor,
} from "#common/form.js";
import { NUMBER_FORMAT } from "#common/format.js";
import * as CONST from "../../const.js";
import type { AnnotationConfig } from "../../type.js";
import type { LayerAccess } from "../access.js";
import type { FocusStore } from "../focusStore.js";
import { INTENT, getIntent } from "../intent.js";
import type { PanelStore } from "../panelStore.js";
import { saveState } from "../state.js";

/** Field list for a layer (cached on the runtime store). collectFields walks
 *  every feature, so the answer is cached per layer id; invalidateFields drops
 *  a layer's entry whenever its features can change at runtime. */
const layerFields = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  layerId: string,
): LabelField[] => {
  const cached = la.runtimeStore.getFields(layerId);
  if (cached) return cached;
  const fields = la.annotation.collectFields(layerId);
  la.runtimeStore.setFields(layerId, fields);
  return fields;
};

/** Whether the layer has any labelable fields. False for base maps, the color
 *  basemap, and canvas layers (no feature.properties) — the ⋮ menu's Style
 *  item keys off this. */
const layerHasLabelFields = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  layerId: string,
): boolean => layerFields(la, ps, fs, layerId).length > 0;

/** Drop a layer's cached field list and re-render if it is currently labeling.
 *  Called when a layer's features can change (runtime createLayers) or when the
 *  layer is removed.
 *
 *  The re-render matters: the drawn labels carry text baked from the *old*
 *  fields, and the picker would now resolve a different auto field, so without
 *  it the map and the panel disagree until the user touches a control. */
const invalidateFields = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  layerId: string,
): void => {
  la.runtimeStore.deleteFields(layerId);
  la.annotation.invalidateAutoField(layerId);
  if (la.annotation.getConfig(layerId).show) {
    la.annotation.renderLabels(layerId);
  }
};

/** Persist the per-layer label config — it rides the record's `layers`
 *  section (`layers[id].annotation`), so the same writer that saves
 *  visibility / opacity / zoom range now saves it. The legacy top-level
 *  `annotations` segment has no live source anymore: it passes through on
 *  every write, read only as the fallback when the new key is absent. */
const persistStyleLabel = (la: LayerAccess, ps: PanelStore, fs: FocusStore): void => {
  saveState(la, ps, fs);
};

/** Apply one control change to the layer's config, re-render its labels and
 *  persist. Shared by the toggle and both selects so the update order
 *  (config → labels → storage) lives in exactly one place. */
const applyPatch = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  layerId: string,
  patch: Partial<AnnotationConfig>,
): void => {
  const cfg = la.annotation.getConfig(layerId);
  Object.assign(cfg, patch);
  la.annotation.setConfig(layerId, cfg);
  la.annotation.renderLabels(layerId);
  persistStyleLabel(la, ps, fs);
};

/** Coerce one stored label config into a complete {@link AnnotationConfig}.
 *
 *  The single home of the per-field rules: persistence's tolerant parse only
 *  checks the object shape (and normalises colour), so every coercion — and
 *  the default of every future field, e.g. `position` — belongs here. The
 *  renderer consumes the result; nothing in between re-derives defaults. */
const coerceAnnotationFields = (raw: unknown): AnnotationConfig => {
  const cfg = (raw && typeof raw === "object" ? raw : {}) as Partial<AnnotationConfig>;
  return {
    show: !!cfg.show,
    field: typeof cfg.field === "string" ? cfg.field : "",
    color:
      typeof cfg.color === "string"
        ? normalizeHexColor(cfg.color)
        : CONST.DEFAULT_ANNOTATION.color,
    size:
      typeof cfg.size === "number"
        ? clampLabelSize(cfg.size)
        : CONST.DEFAULT_ANNOTATION.size,
    format: typeof cfg.format === "string" ? cfg.format : NUMBER_FORMAT.AUTO,
    // Absent in configs stored before the switch existed: default to on.
    collide: cfg.collide !== false,
  };
};

/** Load persisted per-layer style (label) config and apply it.
 *
 *  `la.intentStore` annotation is the *load-time snapshot*, so this is a seed, not a
 *  restore: a layer already carrying a config has the live one (the user may
 *  have switched it on since the page loaded), and re-applying the snapshot over
 *  it would silently revert that. Idempotent. */
const applyStyleLabelState = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
): void => {
  const seedIds = la.intentStore.ids();
  for (const id of seedIds) {
    const raw = getIntent(la, id, INTENT.ANNOTATION);
    if (!raw) continue;
    if (!layerHasLabelFields(la, ps, fs, id)) continue; // stale / no fields
    if (la.annotation.hasConfig(id)) continue; // live state wins
    const cfg = coerceAnnotationFields(raw);
    la.annotation.setConfig(id, cfg);
    // A stored `show: false` still has to act: labels left over from an earlier
    // pass would otherwise stay on the map with the toggle reading off.
    if (cfg.show) la.annotation.renderLabels(id);
    else la.annotation.clearLabels(id);
  }
};

/** Show / hide the number-format row for the field the select currently holds.
 *  Only numbers render differently under comma / percent / int, so every other
 *  field hides the row — the heatmap's "only show controls that change the
 *  picture" rule.
 *
 *  Takes the row itself rather than a container to search: the caller always
 *  holds the row, and searching a container for a descendant that IS the row
 *  silently matched nothing, which is how the row once shipped visible for
 *  string fields. */
const syncFormatRow = (fields: LabelField[], row: HTMLElement, field: string): void => {
  row.classList.toggle("foliplus-hidden", !isNumericField(fields, field));
};

export {
  applyPatch,
  applyStyleLabelState,
  coerceAnnotationFields,
  invalidateFields,
  layerFields,
  layerHasLabelFields,
  syncFormatRow,
};
