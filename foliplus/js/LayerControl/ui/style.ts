// LayerControl UI —per-layer annotation style panel.
//
// Opened from a data layer's ⋮ menu. The panel is anchored to the layer's own
// row and built on the shared `foliplus-panel` vocabulary (header bar, content
// scroll, close affordance), exactly like the attributes panel — so there is
// no JS positioning and no scroll/resize bookkeeping to clean up.
import {
  AUTO_FIELD,
  type LabelField,
  isNumericField,
  resolveSelectedField,
} from "#core/labelField.js";
import { dom } from "#common/dom.js";
import { type NumberStyle } from "#common/format.js";
import { createRowPanel } from "#common/panel.js";
import type { AnnotationConfig } from "../annotation.js";
import * as CONST from "../const.js";
import * as SVGs from "../icon.js";
import type { LayerUI } from "./index.js";
import { finishRename } from "./rename.js";

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

/** Drop a layer's cached field list. Called when a layer's features can
 *  change (runtime createLayers) or when the layer is removed. The annotation
 *  side caches the resolved auto pick off the same walk, so it drops with it. */
const invalidateFields = (ui: LayerUI, layerId: string): void => {
  ui.fieldCache.delete(layerId);
  ui.m.annotation.invalidateAutoField(layerId);
};

/** Persist the current per-layer annotation config map. */
const persistStyleLabel = (ui: LayerUI): void => {
  ui.m.persistence.saveAnnotations(() =>
    Object.fromEntries(ui.m.annotation.configEntries()),
  );
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

/** Load persisted per-layer style (label) config and re-render labels. Called
 *  from the deferred init passes in attachUI, so the layers are resolvable
 *  and labels can be drawn at their anchors. Idempotent. */
const applyStyleLabelState = (ui: LayerUI): void => {
  for (const [id, raw] of Object.entries(ui.labelConfigs)) {
    const cfg = raw as Partial<AnnotationConfig>;
    if (!layerHasLabelFields(ui, id)) continue; // stale / no fields
    ui.m.annotation.setConfig(id, {
      show: !!cfg.show,
      field: typeof cfg.field === "string" ? cfg.field : "",
      format: typeof cfg.format === "string" ? cfg.format : CONST.FORMAT.AUTO,
    });
    // `field` may be the auto sentinel; renderLabels resolves it.
    if (cfg.show) ui.m.annotation.renderLabels(id);
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

/** Build the style panel DOM for a layer. Returns null when there are no
 *  labelable fields (defensive: the menu item should have been disabled). */
const renderStylePanel = (ui: LayerUI, layerId: string): HTMLElement | null => {
  const fields = layerFields(ui, layerId);
  if (!fields.length) return null;

  const cfg = ui.m.annotation.getConfig(layerId);
  const fmtLabel = (f: string) => ui.T(`style_label_format_${f}`) || f;
  // Labels are off by default — the user opens the panel, sees the field and
  // format chooser idle, and flips the switch to begin. `cfg.show ? "" : null`
  // follows the persisted state when this is a reopen, but the *first* open
  // never reads from storage (DEFAULT_ANNOTATION.show = false). The body
  // collapses under the toggle on first paint and on every reopen where
  // show === false, mirroring the heatmap's "switch off → hide body" rule.
  const showChecked = !!cfg.show;
  // The picker's "Auto" entry means "let foliplus choose", and the config
  // records it as the shared sentinel rather than a resolved name — so the layer
  // keeps labelling itself when its columns change. `resolveSelectedField`
  // (core/labelField) is what turns the select's value back into a field.
  const selectedField = cfg.field;

  // Field options: the auto entry first, then one per field. The auto entry is
  // the select's own empty value, so it is what a fresh panel shows. The
  // per-field <option>s are appended to the select itself — appending them into
  // the first option would nest <option> inside <option>, and the browser skips
  // nested options when it builds the options list.
  const fieldSelect = dom.el(
    "select",
    {
      class: "foliplus-form-select foliplus-style-field-select",
      "aria-label": ui.T("style_label_field"),
    },
    dom.el("option", { value: AUTO_FIELD }, ui.T("style_label_field_auto")),
  );
  fields.forEach(f =>
    fieldSelect.appendChild(
      dom.el(
        "option",
        { value: f.name, selected: f.name === selectedField ? "" : null },
        f.name,
      ),
    ),
  );
  (fieldSelect as HTMLSelectElement).value = selectedField || AUTO_FIELD;

  const formatOpts = [
    CONST.FORMAT.AUTO,
    CONST.FORMAT.INT,
    CONST.FORMAT.COMMA,
    CONST.FORMAT.PERCENT,
  ].map(f => dom.el("option", { value: f }, fmtLabel(f)));

  // The toggle gets a focus-visible ring tied to the panel's design token,
  // not the browser default — without it, a tab stop on a switch looks
  // identical to "not focused", which is the heatmap-style bug we hit.
  const showToggle = dom.el("input", {
    type: "checkbox",
    class: "foliplus-style-toggle-input",
    checked: showChecked ? "" : null,
    "aria-label": ui.T("style_label_tooltip"),
  });
  const formatSelect = dom.el(
    "select",
    {
      class: "foliplus-form-select foliplus-style-format-select",
      "aria-label": ui.T("style_label_format"),
    },
    ...formatOpts,
  );
  (formatSelect as HTMLSelectElement).value = cfg.format || CONST.FORMAT.AUTO;

  // Numeric-only: hide the format dropdown when the picked field is not a
  // number — comma/percent/int all render the same as auto in that case.
  const formatRow = dom.el(
    "div",
    { class: "foliplus-form-row foliplus-style-format-row" },
    dom.el("label", { class: "foliplus-form-label" }, ui.T("style_label_format")),
    dom.el("div", { class: "foliplus-form-control" }, formatSelect),
  );
  syncFormatRow(
    fields,
    formatRow,
    resolveSelectedField((fieldSelect as HTMLSelectElement).value, fields),
  );

  // Body wrapper: hidden by default when cfg.show is false, shown on toggle
  // on. Listens to the toggle so flipping it reveals the field/format rows
  // and auto-picks a field if none was selected yet (the "warm start" from
  // the heatmap's rule: open the gate, the first thing shows up).
  const body = dom.el(
    "div",
    { class: "foliplus-style-body" },
    dom.el(
      "div",
      { class: "foliplus-form-row" },
      dom.el("label", { class: "foliplus-form-label" }, ui.T("style_label_field")),
      dom.el("div", { class: "foliplus-form-control" }, fieldSelect),
    ),
    formatRow,
  );
  body.classList.toggle("foliplus-hidden", !showChecked);

  // Shell (surface, header, content scroll) comes from the shared row-panel
  // factory — the attributes panel's twin, built by the same code, so the
  // width, header and card chrome cannot drift from it.
  const { panel, content } = createRowPanel({
    cssClass: CONST.CLASSES.STYLE_PANEL,
    title: ui.T("style_layer"),
    iconSvg: SVGs.STYLE,
    closeTitle: ui.T("close_title"),
    iconClass: "foliplus-layer-style-icon foliplus-header-icon",
  });
  content.append(
    dom.el(
      "div",
      { class: "foliplus-form-row" },
      dom.el("label", { class: "foliplus-form-label" }, ui.T("style_label")),
      dom.el(
        "div",
        { class: "foliplus-form-control" },
        // Resolving the toggle: clicking the input, the slider span, or the
        // label should all flip the checkbox — the switch is one <label>.
        dom.el(
          "label",
          { class: "foliplus-toggle-switch" },
          showToggle,
          dom.el("span", { class: "foliplus-toggle-slider" }),
        ),
      ),
    ),
    body,
    dom.el(
      "div",
      { class: "foliplus-btn-row" },
      dom.el(
        "button",
        {
          type: "button",
          class: "foliplus-panel-btn foliplus-style-reset-btn",
        },
        ui.T("style_reset"),
      ),
    ),
  );
  return panel;
};

/** Open the annotation style panel for a layer. The panel is anchored to the
 *  layer's own row — the same "drop below the trigger" rule the attributes
 *  panel uses — so it needs no positioning code at all. */
const openStylePanel = (ui: LayerUI, layerId: string): void => {
  closeStylePanel(ui, false);
  if (!layerId) return;
  // The style panel and the attributes panel float from the same ⋮ menu;
  // never show both.
  ui.closeAttrsPanel(false);
  const item = ui.uiContainer.querySelector(
    `${CONST.SEL.LAYER_ITEM}[${CONST.DATA.LAYER_ID}="${CSS.escape(layerId)}"]`,
  ) as HTMLElement | null;
  const panel = renderStylePanel(ui, layerId);
  if (!item || !panel) return;

  finishRename(ui);
  // true returns focus to the row: the menu <li> that held focus is about to
  // be removed, and a cursor parked on <body> would make Escape unreachable
  // (handleKeyDown's container guard).
  ui.closeMoreMenu(true);

  // The panel sits inside a draggable layer row: a press on the panel must
  // neither start a row drag nor inherit `user-select: none` (attrs recipe).
  panel.addEventListener("mousedown", e => e.stopPropagation());
  panel.addEventListener("dragstart", e => {
    if (e.target instanceof Node && panel.contains(e.target)) e.preventDefault();
  });

  // Control changes are handled on the panel itself; stopPropagation keeps
  // them out of the container-level change delegation, which would otherwise
  // re-read them as visibility toggles.
  panel.addEventListener("change", (event: Event) => {
    const t = event.target as HTMLElement;
    if (
      t instanceof HTMLInputElement &&
      t.classList.contains("foliplus-style-toggle-input")
    ) {
      const show = t.checked;
      // Reveal / collapse the body under the toggle. No field is written here:
      // leaving it at the auto sentinel is what makes the picker read "Auto" and
      // what lets the layer keep labelling itself if its columns change.
      const body = panel.querySelector(".foliplus-style-body") as HTMLElement | null;
      if (body) body.classList.toggle("foliplus-hidden", !show);
      const fieldSel = panel.querySelector(
        ".foliplus-style-field-select",
      ) as HTMLSelectElement | null;
      const cfg = ui.m.annotation.getConfig(layerId);
      const fields = layerFields(ui, layerId);
      const chosen = fieldSel?.value ?? cfg.field;
      const fmtRow = panel.querySelector(
        ".foliplus-style-format-row",
      ) as HTMLElement | null;
      if (fmtRow) {
        syncFormatRow(fields, fmtRow, resolveSelectedField(chosen, fields));
      }
      applyPatch(ui, layerId, { show, field: chosen });
    } else if (
      t instanceof HTMLSelectElement &&
      t.classList.contains("foliplus-style-field-select")
    ) {
      const fmtRow = panel.querySelector(
        ".foliplus-style-format-row",
      ) as HTMLElement | null;
      if (fmtRow) {
        syncFormatRow(
          layerFields(ui, layerId),
          fmtRow,
          resolveSelectedField(t.value, layerFields(ui, layerId)),
        );
      }
      const fmtSel = panel.querySelector(
        ".foliplus-style-format-select",
      ) as HTMLSelectElement | null;
      applyPatch(ui, layerId, {
        field: t.value,
        ...(fmtSel ? { format: fmtSel.value as NumberStyle } : {}),
      });
    } else if (
      t instanceof HTMLSelectElement &&
      t.classList.contains("foliplus-style-format-select")
    ) {
      applyPatch(ui, layerId, { format: t.value as NumberStyle });
    } else {
      return;
    }
    event.stopPropagation();
  });

  // Reset restores the default config and closes; the header (or ×) just
  // closes — the same header-dismiss affordance the attrs panel uses.
  panel.addEventListener("click", (event: Event) => {
    const t = event.target as HTMLElement;
    if (t.closest(".foliplus-style-reset-btn")) {
      ui.m.annotation.setConfig(layerId, { ...CONST.DEFAULT_ANNOTATION });
      ui.m.annotation.renderLabels(layerId);
      persistStyleLabel(ui);
      closeStylePanel(ui, true);
      return;
    }
    if (t.closest(".foliplus-panel-header")) closeStylePanel(ui, true);
  });

  item.style.position = "relative";
  item.appendChild(panel);

  // Document capture dismiss (attrs recipe): disableClickPropagation on the
  // layer control stops bubble-phase mousedown from reaching document, so a
  // press on the map or another foliplus control would never close the
  // panel otherwise.
  ui.styleOutsideHandler = (event: MouseEvent) => {
    const t = event.target as HTMLElement | null;
    // Document-level dispatch can name `document` itself —no closest().
    if (!t || typeof t.closest !== "function") {
      closeStylePanel(ui, false);
      return;
    }
    if (t.closest(`.${CONST.CLASSES.STYLE_PANEL}`)) return;
    closeStylePanel(ui, false);
  };
  document.addEventListener("mousedown", ui.styleOutsideHandler, true);

  ui.stylePanelLayerId = layerId;
};

/** Close the style panel. setFocus = true returns focus to the layer row. */
const closeStylePanel = (ui: LayerUI, setFocus: boolean): void => {
  if (ui.styleOutsideHandler) {
    document.removeEventListener("mousedown", ui.styleOutsideHandler, true);
    ui.styleOutsideHandler = null;
  }
  const panel = ui.uiContainer.querySelector(
    `.${CONST.CLASSES.STYLE_PANEL}`,
  ) as HTMLElement | null;
  if (!panel) {
    ui.stylePanelLayerId = null;
    return;
  }
  const item = panel.closest(CONST.SEL.LAYER_ITEM) as HTMLElement | null;
  // The field cache survives close/reopen: it is invalidated by
  // onLayerItemCountChange when a layer's features actually change, not on
  // every close (re-collecting on each open would defeat the cache).
  ui.stylePanelLayerId = null;
  panel.remove();
  if (setFocus) item?.focus();
};

export {
  applyStyleLabelState,
  closeStylePanel,
  invalidateFields,
  layerHasLabelFields,
  openStylePanel,
};
