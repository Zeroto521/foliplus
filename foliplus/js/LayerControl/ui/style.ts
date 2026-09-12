// LayerControl UI —per-layer annotation style panel.
//
// Opened from a data layer's ⋮ menu. The panel is anchored to the layer's own
// row and built on the shared `foliplus-panel` vocabulary (header bar, content
// scroll, close affordance), exactly like the attributes panel — so there is
// no JS positioning and no scroll/resize bookkeeping to clean up.
import { dom } from "#common/dom.js";
import type { NumberStyle } from "#common/format.js";
import * as Icons from "#common/icon.js";
import type { AnnotationConfig } from "../annotation.js";
import * as CONST from "../const.js";
import * as SVGs from "../icon.js";
import { T } from "./context.js";
import type { LayerUI } from "./index.js";
import { finishRename } from "./rename.js";

/** Field list for a layer (cached on the UI shell). collectFields walks every
 *  feature, so the answer is cached per layer id; invalidateFields drops a
 *  layer's entry whenever its features can change at runtime. */
const layerFields = (ui: LayerUI, layerId: string): string[] => {
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
 *  change (runtime createLayers) or when the layer is removed. */
const invalidateFields = (ui: LayerUI, layerId: string): void => {
  ui.fieldCache.delete(layerId);
};

/** Persist the current per-layer annotation config map. */
const persistAnnotation = (ui: LayerUI): void => {
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
  persistAnnotation(ui);
};

/** Load persisted per-layer annotation config and re-render labels. Called
 *  from the deferred init passes in attachUI, so the layers are resolvable
 *  and labels can be drawn at their anchors. Idempotent. */
const applyAnnotationState = (ui: LayerUI): void => {
  for (const [id, raw] of Object.entries(ui.annotationConfigs)) {
    const cfg = raw as Partial<AnnotationConfig>;
    if (!layerHasLabelFields(ui, id)) continue; // stale / no fields
    ui.m.annotation.setConfig(id, {
      show: !!cfg.show,
      field: typeof cfg.field === "string" ? cfg.field : "",
      format: typeof cfg.format === "string" ? cfg.format : CONST.FORMAT.AUTO,
    });
    if (cfg.show && cfg.field) ui.m.annotation.renderLabels(id);
  }
};

/** Build the style panel DOM for a layer. Returns null when there are no
 *  labelable fields (defensive: the menu item should have been disabled). */
const renderStylePanel = (ui: LayerUI, layerId: string): HTMLElement | null => {
  const fields = layerFields(ui, layerId);
  if (!fields.length) return null;

  const cfg = ui.m.annotation.getConfig(layerId);
  const fmtLabel = (f: string) => T(`label_format_${f}`) || f;

  // Field options; the placeholder doubles as the "no field" choice.
  const fieldOpts = dom.el("option", { value: "" }, T("label_field_placeholder"));
  fields.forEach(f => fieldOpts.appendChild(dom.el("option", { value: f }, f)));

  const formatOpts = [
    CONST.FORMAT.AUTO,
    CONST.FORMAT.INT,
    CONST.FORMAT.COMMA,
    CONST.FORMAT.PERCENT,
  ].map(f => dom.el("option", { value: f }, fmtLabel(f)));

  const showToggle = dom.el("input", {
    type: "checkbox",
    class: "foliplus-style-toggle-input",
    checked: cfg.show ? "" : null,
    "aria-label": T("label_tooltip"),
  });
  const fieldSelect = dom.el(
    "select",
    { class: "foliplus-form-select foliplus-style-field-select" },
    fieldOpts,
  );
  (fieldSelect as HTMLSelectElement).value = cfg.field || "";
  const formatSelect = dom.el(
    "select",
    { class: "foliplus-form-select foliplus-style-format-select" },
    ...formatOpts,
  );
  (formatSelect as HTMLSelectElement).value = cfg.format || CONST.FORMAT.AUTO;

  return dom.el(
    "div",
    {
      // `foliplus-panel` pulls in the shared panel vocabulary, so the style
      // surface is styled by the same rules as every other panel — the
      // attributes panel being the sibling case.
      class: `${CONST.CLASSES.STYLE_PANEL} foliplus-panel`,
      role: "dialog",
      "aria-label": T("style_layer"),
    },
    // Shared header: the label glyph sits inside the title (as in the attrs
    // panel) and the × is the shared close button, so both line up with
    // every other foliplus panel.
    dom.el(
      "div",
      { class: "foliplus-panel-header", title: T("close_title") },
      dom.el(
        "span",
        { class: "foliplus-header-title" },
        dom.el(
          "span",
          {
            class: "foliplus-layer-style-icon foliplus-header-icon",
            "aria-hidden": "true",
          },
          { html: SVGs.LABEL },
        ),
        T("style_layer"),
      ),
      dom.el(
        "button",
        {
          class: "foliplus-ctrl-btn foliplus-close-btn",
          type: "button",
          title: T("close_title"),
          "aria-label": T("close_title"),
        },
        { html: Icons.CLOSE },
      ),
    ),
    dom.el(
      "div",
      { class: "foliplus-panel-content" },
      dom.el(
        "div",
        { class: "foliplus-form-row" },
        dom.el("label", { class: "foliplus-form-label" }, T("label")),
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
      dom.el(
        "div",
        { class: "foliplus-form-row" },
        dom.el("label", { class: "foliplus-form-label" }, T("label_field")),
        dom.el("div", { class: "foliplus-form-control" }, fieldSelect),
      ),
      dom.el(
        "div",
        { class: "foliplus-form-row" },
        dom.el("label", { class: "foliplus-form-label" }, T("label_format")),
        dom.el("div", { class: "foliplus-form-control" }, formatSelect),
      ),
      dom.el(
        "div",
        { class: "foliplus-btn-row" },
        dom.el(
          "button",
          { type: "button", class: "foliplus-style-reset-btn" },
          T("style_reset"),
        ),
      ),
    ),
  );
};

/** Open the annotation style panel for a layer. The panel is anchored to the
 *  layer's own row — the same "drop below the trigger" rule the attributes
 *  panel uses — so it needs no positioning code at all. */
const openStylePanel = (ui: LayerUI, layerId: string): void => {
  closeStylePanel(ui, false);
  if (!layerId) return;
  // The style panel and the attributes panel float from the same ⋮ menu;
  // never show both. ui.* delegates here (not direct imports) to keep the
  // style ↔ attrs module pair cycle-free.
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
      applyPatch(ui, layerId, { show: t.checked });
    } else if (
      t instanceof HTMLSelectElement &&
      t.classList.contains("foliplus-style-field-select")
    ) {
      applyPatch(ui, layerId, { field: t.value });
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
      persistAnnotation(ui);
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
  // A reopen re-collects the field list: a runtime createLayers may have
  // added features while the panel was open.
  if (ui.stylePanelLayerId) invalidateFields(ui, ui.stylePanelLayerId);
  ui.stylePanelLayerId = null;
  panel.remove();
  if (setFocus) item?.focus();
};

export {
  applyAnnotationState,
  closeStylePanel,
  invalidateFields,
  layerHasLabelFields,
  openStylePanel,
};
