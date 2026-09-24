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
import type { AnnotationConfig } from "../../annotation/index.js";
import * as CONST from "../../const.js";
import type { LayerUI } from "../index.js";

/** Field list for a layer (cached on the UI shell). collectFields walks every
 *  feature, so the answer is cached per layer id; invalidateFields drops a
 *  layer's entry whenever its features can change at runtime. */
const layerFields = (ui: LayerUI, layerId: string): LabelField[] => {
  const cached = ui.fieldCache.get(layerId);
  if (cached) return cached;
  const fields = ui.m.annotation.collectFields(layerId);
  ui.fieldCache.set(layerId, fields);
  return fields;
};

/** Whether the layer has any labelable fields. False for base maps, the color
 *  basemap, and canvas layers (no feature.properties) — the ⋮ menu's Style
 *  item keys off this. */
const layerHasLabelFields = (ui: LayerUI, layerId: string): boolean =>
  layerFields(ui, layerId).length > 0;

/** Drop a layer's cached field list and re-render if it is currently labelling.
 *  Called when a layer's features can change (runtime createLayers) or when the
 *  layer is removed.
 *
 *  The re-render matters: the drawn labels carry text baked from the *old*
 *  fields, and the picker would now resolve a different auto field, so without
 *  it the map and the panel disagree until the user touches a control. */
const invalidateFields = (ui: LayerUI, layerId: string): void => {
  ui.fieldCache.delete(layerId);
  ui.m.annotation.invalidateAutoField(layerId);
  if (ui.m.annotation.getConfig(layerId).show) {
    ui.m.annotation.renderLabels(layerId);
  }
};

/** Persist the current per-layer annotation config map. */
const persistStyleLabel = (ui: LayerUI): void => {
  ui.m.persistence.schedule({
    annotations: () => Object.fromEntries(ui.m.annotation.configEntries()),
  });
};

/** Apply one control change to the layer's config, re-render its labels and
 *  persist. Shared by the toggle and both selects so the update order
 *  (config → labels → storage) lives in exactly one place. */
const applyPatch = (
  ui: LayerUI,
  layerId: string,
  patch: Partial<AnnotationConfig>,
): void => {
  const cfg = ui.m.annotation.getConfig(layerId);
  Object.assign(cfg, patch);
  ui.m.annotation.setConfig(layerId, cfg);
  ui.m.annotation.renderLabels(layerId);
  persistStyleLabel(ui);
};

/** Load persisted per-layer style (label) config and apply it.
 *
 *  `ui.labelConfigs` is the *load-time snapshot*, so this is a seed, not a
 *  restore: a layer already carrying a config has the live one (the user may
 *  have switched it on since the page loaded), and re-applying the snapshot over
 *  it would silently revert that. Idempotent. */
const applyStyleLabelState = (ui: LayerUI): void => {
  for (const [id, raw] of Object.entries(ui.labelConfigs)) {
    if (!layerHasLabelFields(ui, id)) continue; // stale / no fields
    if (ui.m.annotation.hasConfig(id)) continue; // live state wins
    const cfg = raw as Partial<AnnotationConfig>;
    ui.m.annotation.setConfig(id, {
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
    });
    // A stored `show: false` still has to act: labels left over from an earlier
    // pass would otherwise stay on the map with the toggle reading off.
    if (cfg.show) ui.m.annotation.renderLabels(id);
    else ui.m.annotation.clearLabels(id);
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
  invalidateFields,
  layerFields,
  layerHasLabelFields,
  syncFormatRow,
};
