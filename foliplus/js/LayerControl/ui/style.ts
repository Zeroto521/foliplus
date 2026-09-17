// LayerControl UI —per-layer annotation style panel.
//
// Opened from a data layer's ⋮ menu. The panel is anchored to the layer's own
// row and built on the shared `foliplus-panel` vocabulary (header bar, content
// scroll, close affordance), exactly like the attributes panel — so there is
// no JS positioning and no scroll/resize bookkeeping to clean up.
import { EVENTS } from "#core/event/index.js";
import {
  AUTO_FIELD,
  type LabelField,
  isNumericField,
  resolveSelectedField,
} from "#core/labelField.js";
import { dom } from "#common/dom.js";
import { type NumberStyle } from "#common/format.js";
import { createRowPanel } from "#common/panel.js";
import type { AnnotationConfig } from "../annotation/index.js";
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

/** Whether the layer delegates its style to the drawer via styleSetters
 *  (third-party canvas layers: Heatmap, Measure). The ⋮ menu's Style item
 *  also enables for these. */
const layerHasStyleDelegation = (ui: LayerUI, layerId: string): boolean => {
  const li = ui.m.layerRegistry.get(layerId);
  return !!li?.styleSetters && Object.keys(li.styleSetters).length > 0;
};

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
  ui.m.persistence.saveAnnotations(() =>
    Object.fromEntries(ui.m.annotation.configEntries()),
  );
};

/** Shared Reset footer — divider + button, same vocabulary for the annotation
 *  and the delegated panel. */
const appendResetFooter = (ui: LayerUI, content: HTMLElement): void => {
  content.append(
    dom.el("hr", { class: "foliplus-section-divider" }),
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
      format: typeof cfg.format === "string" ? cfg.format : CONST.FORMAT.AUTO,
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

/** Build the style panel DOM for a layer that delegates its style via
 *  styleSetters (third-party canvas layers). Renders only the controls the
 *  component declared. Reset is present only when the layer also supplies
 *  styleDefaults (the Python CONF snapshot). Returns null when the layer has
 *  no delegation (falls through to the annotation panel). */
const renderDelegatedStylePanel = (
  ui: LayerUI,
  layerId: string,
): HTMLElement | null => {
  const li = ui.m.layerRegistry.get(layerId);
  const setters = li?.styleSetters;
  if (!setters || Object.keys(setters).length === 0) return null;

  const values = li.styleProvider?.() ?? {};
  const showChecked = !!values.labelShow;
  const bodyRows: HTMLElement[] = [];

  // Number format lives under the label toggle — same collapse rule as the
  // annotation panel's format row (hidden when labels are off).
  if (setters.labelFormat) {
    const fmtLabel = (f: string) => ui.T(`style_label_format_${f}`) || f;
    const formatSelect = dom.el(
      "select",
      {
        class: `foliplus-form-select ${CONST.CLASSES.STYLE_FORMAT_SELECT}`,
        "aria-label": ui.T("style_label_format"),
      },
      ...[
        CONST.FORMAT.AUTO,
        CONST.FORMAT.INT,
        CONST.FORMAT.COMMA,
        CONST.FORMAT.PERCENT,
      ].map(f => dom.el("option", { value: f }, fmtLabel(f))),
    );
    (formatSelect as HTMLSelectElement).value =
      typeof values.labelFormat === "string" ? values.labelFormat : CONST.FORMAT.AUTO;
    bodyRows.push(
      dom.el(
        "div",
        { class: `${CONST.CLASSES.FORM_ROW} ${CONST.CLASSES.STYLE_FORMAT_ROW}` },
        dom.el(
          "label",
          { class: CONST.CLASSES.FORM_LABEL },
          ui.T("style_label_format"),
        ),
        dom.el("div", { class: CONST.CLASSES.FORM_CONTROL }, formatSelect),
      ),
    );
  }

  if (setters.labelCollide) {
    const toggle = dom.el("input", {
      type: "checkbox",
      class: CONST.CLASSES.STYLE_COLLIDE_INPUT,
      checked: values.labelCollide !== false ? "" : null,
      "aria-label": ui.T("style_label_collide_tooltip"),
    });
    bodyRows.push(
      dom.el(
        "div",
        { class: CONST.CLASSES.FORM_ROW },
        dom.el(
          "label",
          { class: CONST.CLASSES.FORM_LABEL },
          ui.T("style_label_collide"),
        ),
        dom.el(
          "div",
          { class: CONST.CLASSES.FORM_CONTROL },
          dom.el(
            "label",
            { class: CONST.CLASSES.TOGGLE_SWITCH },
            toggle,
            dom.el("span", { class: CONST.CLASSES.TOGGLE_SLIDER }),
          ),
        ),
      ),
    );
  }

  const rows: HTMLElement[] = [];

  if (setters.labelShow) {
    const toggle = dom.el("input", {
      type: "checkbox",
      class: CONST.CLASSES.STYLE_TOGGLE_INPUT,
      checked: showChecked ? "" : null,
      "aria-label": ui.T("style_label_tooltip"),
    });
    rows.push(
      dom.el(
        "div",
        { class: CONST.CLASSES.FORM_ROW },
        dom.el("label", { class: CONST.CLASSES.FORM_LABEL }, ui.T("style_label")),
        dom.el(
          "div",
          { class: CONST.CLASSES.FORM_CONTROL },
          dom.el(
            "label",
            { class: CONST.CLASSES.TOGGLE_SWITCH },
            toggle,
            dom.el("span", { class: CONST.CLASSES.TOGGLE_SLIDER }),
          ),
        ),
      ),
    );
  }

  // Body: avoid-overlap, collapsed when the label toggle is off —
  // same "switch off → hide body" rule the annotation panel uses.
  if (bodyRows.length) {
    const body = dom.el("div", { class: CONST.CLASSES.STYLE_BODY }, ...bodyRows);
    body.classList.toggle("foliplus-hidden", !showChecked);
    rows.push(body);
  }

  if (!rows.length) return null;

  const { panel, content } = createRowPanel({
    cssClass: CONST.CLASSES.STYLE_PANEL,
    title: ui.T("style_layer"),
    iconSvg: SVGs.STYLE,
    closeTitle: ui.T("close_title"),
    iconClass: "foliplus-layer-style-icon foliplus-header-icon",
  });
  content.append(...rows);

  // Reset only when the component published its Python CONF defaults.
  if (li.styleDefaults) appendResetFooter(ui, content);
  return panel;
};

/** Build the style panel DOM for a layer. Returns null when there are no
 *  labelable fields (defensive: the menu item should have been disabled). */
const renderStylePanel = (ui: LayerUI, layerId: string): HTMLElement | null => {
  // Third-party canvas layers (heatmap, measure) declare their own controls
  // via styleSetters — render those instead of the annotation panel.
  if (layerHasStyleDelegation(ui, layerId)) {
    return renderDelegatedStylePanel(ui, layerId);
  }
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
  // the select's own empty value, so it is what a fresh panel shows, and it is
  // a disabled placeholder exactly like the heatmap's `field_auto`. Disabled
  // rather than merely first, so it reads as the current state instead of an
  // option to pick: the way back to auto is Reset, which restores the default
  // config. The per-field <option>s are appended to the select itself —
  // appending them into the first option would nest <option> inside <option>,
  // and the browser skips nested options when it builds the options list.
  const fieldSelect = dom.el(
    "select",
    {
      class: `foliplus-form-select ${CONST.CLASSES.STYLE_FIELD_SELECT}`,
      "aria-label": ui.T("style_label_field"),
    },
    dom.el(
      "option",
      { value: AUTO_FIELD, disabled: true },
      ui.T("style_label_field_auto"),
    ),
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
    class: CONST.CLASSES.STYLE_TOGGLE_INPUT,
    checked: showChecked ? "" : null,
    "aria-label": ui.T("style_label_tooltip"),
  });
  // "Avoid overlap": thins this layer's own labels where they collide. Labels
  // from *different* layers never avoid each other — the layers are stacked, so
  // an upper layer simply covers the lower one's.
  const collideToggle = dom.el("input", {
    type: "checkbox",
    class: CONST.CLASSES.STYLE_COLLIDE_INPUT,
    checked: cfg.collide ? "" : null,
    "aria-label": ui.T("style_label_collide_tooltip"),
  });
  const formatSelect = dom.el(
    "select",
    {
      class: `foliplus-form-select ${CONST.CLASSES.STYLE_FORMAT_SELECT}`,
      "aria-label": ui.T("style_label_format"),
    },
    ...formatOpts,
  );
  (formatSelect as HTMLSelectElement).value = cfg.format || CONST.FORMAT.AUTO;

  // Numeric-only: hide the format dropdown when the picked field is not a
  // number — comma/percent/int all render the same as auto in that case.
  const formatRow = dom.el(
    "div",
    { class: `${CONST.CLASSES.FORM_ROW} ${CONST.CLASSES.STYLE_FORMAT_ROW}` },
    dom.el("label", { class: CONST.CLASSES.FORM_LABEL }, ui.T("style_label_format")),
    dom.el("div", { class: CONST.CLASSES.FORM_CONTROL }, formatSelect),
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
    { class: CONST.CLASSES.STYLE_BODY },
    dom.el(
      "div",
      { class: CONST.CLASSES.FORM_ROW },
      dom.el("label", { class: CONST.CLASSES.FORM_LABEL }, ui.T("style_label_field")),
      dom.el("div", { class: CONST.CLASSES.FORM_CONTROL }, fieldSelect),
    ),
    formatRow,
    dom.el(
      "div",
      { class: CONST.CLASSES.FORM_ROW },
      dom.el("label", { class: CONST.CLASSES.FORM_LABEL }, ui.T("style_label_collide")),
      dom.el(
        "div",
        { class: CONST.CLASSES.FORM_CONTROL },
        dom.el(
          "label",
          { class: CONST.CLASSES.TOGGLE_SWITCH },
          collideToggle,
          dom.el("span", { class: CONST.CLASSES.TOGGLE_SLIDER }),
        ),
      ),
    ),
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
      { class: CONST.CLASSES.FORM_ROW },
      dom.el("label", { class: CONST.CLASSES.FORM_LABEL }, ui.T("style_label")),
      dom.el(
        "div",
        { class: CONST.CLASSES.FORM_CONTROL },
        // Resolving the toggle: clicking the input, the slider span, or the
        // label should all flip the checkbox — the switch is one <label>.
        dom.el(
          "label",
          { class: CONST.CLASSES.TOGGLE_SWITCH },
          showToggle,
          dom.el("span", { class: CONST.CLASSES.TOGGLE_SLIDER }),
        ),
      ),
    ),
    body,
  );
  appendResetFooter(ui, content);
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
  // The mousedown is stopped here; whether the press landed inside the panel is
  // recorded by the outside handler below, because `dragstart` is dispatched on
  // the draggable row and so cannot answer it.
  panel.addEventListener("mousedown", e => e.stopPropagation());

  // Control changes are handled on the panel itself; stopPropagation keeps
  // them out of the container-level change delegation, which would otherwise
  // re-read them as visibility toggles.
  const delegated = layerHasStyleDelegation(ui, layerId);
  panel.addEventListener("change", (event: Event) => {
    const t = event.target as HTMLElement;
    if (delegated) {
      // Third-party layer: dispatch to the component's own setters.
      const li = ui.m.layerRegistry.get(layerId);
      const setters = li?.styleSetters;
      if (!setters) return;
      if (
        t instanceof HTMLInputElement &&
        t.classList.contains(CONST.CLASSES.STYLE_TOGGLE_INPUT) &&
        setters.labelShow
      ) {
        const body = panel.querySelector(
          `.${CONST.CLASSES.STYLE_BODY}`,
        ) as HTMLElement | null;
        if (body) body.classList.toggle("foliplus-hidden", !t.checked);
        setters.labelShow(t.checked);
      } else if (
        t instanceof HTMLInputElement &&
        t.classList.contains(CONST.CLASSES.STYLE_COLLIDE_INPUT) &&
        setters.labelCollide
      ) {
        setters.labelCollide(t.checked);
      } else if (
        t instanceof HTMLSelectElement &&
        t.classList.contains(CONST.CLASSES.STYLE_FORMAT_SELECT) &&
        setters.labelFormat
      ) {
        setters.labelFormat(t.value);
      } else {
        return;
      }
      event.stopPropagation();
      return;
    }
    if (
      t instanceof HTMLInputElement &&
      t.classList.contains(CONST.CLASSES.STYLE_TOGGLE_INPUT)
    ) {
      const show = t.checked;
      // Reveal / collapse the body under the toggle. No field is written here:
      // leaving it at the auto sentinel is what makes the picker read "Auto" and
      // what lets the layer keep labelling itself if its columns change.
      const body = panel.querySelector(
        `.${CONST.CLASSES.STYLE_BODY}`,
      ) as HTMLElement | null;
      if (body) body.classList.toggle("foliplus-hidden", !show);
      const fieldSel = panel.querySelector(
        ".foliplus-style-field-select",
      ) as HTMLSelectElement | null;
      const cfg = ui.m.annotation.getConfig(layerId);
      const fields = layerFields(ui, layerId);
      const chosen = fieldSel?.value ?? cfg.field;
      const fmtRow = panel.querySelector(
        `.${CONST.CLASSES.STYLE_FORMAT_ROW}`,
      ) as HTMLElement | null;
      if (fmtRow) {
        syncFormatRow(fields, fmtRow, resolveSelectedField(chosen, fields));
      }
      applyPatch(ui, layerId, { show, field: chosen });
    } else if (
      t instanceof HTMLInputElement &&
      t.classList.contains(CONST.CLASSES.STYLE_COLLIDE_INPUT)
    ) {
      applyPatch(ui, layerId, { collide: t.checked });
    } else if (
      t instanceof HTMLSelectElement &&
      t.classList.contains(CONST.CLASSES.STYLE_FIELD_SELECT)
    ) {
      const fmtRow = panel.querySelector(
        `.${CONST.CLASSES.STYLE_FORMAT_ROW}`,
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
      t.classList.contains(CONST.CLASSES.STYLE_FORMAT_SELECT)
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
      if (delegated) {
        // Call each setter with its Python CONF default. The components own
        // the values — never write localStorage or annotation config here.
        const li = ui.m.layerRegistry.get(layerId);
        const setters = li?.styleSetters;
        const defaults = li?.styleDefaults?.() ?? {};
        if (setters) {
          for (const [key, setter] of Object.entries(setters)) {
            if (key in defaults) setter(defaults[key]);
          }
        }
      } else {
        // Through applyPatch, so the reset writes config, re-renders and persists
        // in the same order as every other control on this panel. defaultConfig
        // carries collide — DEFAULT_ANNOTATION alone would leave a user-toggled
        // collide switch untouched.
        applyPatch(ui, layerId, { ...ui.m.annotation.defaultConfig() });
      }
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
    if (t.closest(`.${CONST.CLASSES.STYLE_PANEL}`)) {
      ui.pressInPanel = true;
      return;
    }
    ui.pressInPanel = false;
    closeStylePanel(ui, false);
  };
  document.addEventListener("mousedown", ui.styleOutsideHandler, true);

  // When the component's own panel changes a style value while this drawer is
  // open, pull the fresh values and refresh the controls. The event carries
  // only the id — the drawer reads from styleProvider. An input being edited
  // is never overwritten (activeElement guard).
  if (delegated) {
    const bus = ui.m.events;
    ui.styleUnsubscribe = bus.on(EVENTS.LAYER_STYLE_CHANGE, ((payload: {
      id: string;
    }) => {
      if (payload.id !== layerId) return;
      const li = ui.m.layerRegistry.get(layerId);
      const values = li?.styleProvider?.();
      if (!values) return;
      const showInput = panel.querySelector(
        `.${CONST.CLASSES.STYLE_TOGGLE_INPUT}`,
      ) as HTMLInputElement | null;
      if (showInput && document.activeElement !== showInput) {
        showInput.checked = !!values.labelShow;
      }
      const collideInput = panel.querySelector(
        `.${CONST.CLASSES.STYLE_COLLIDE_INPUT}`,
      ) as HTMLInputElement | null;
      if (collideInput && document.activeElement !== collideInput) {
        collideInput.checked = values.labelCollide !== false;
      }
      const formatSelect = panel.querySelector(
        `.${CONST.CLASSES.STYLE_FORMAT_SELECT}`,
      ) as HTMLSelectElement | null;
      if (formatSelect && document.activeElement !== formatSelect) {
        formatSelect.value =
          typeof values.labelFormat === "string"
            ? values.labelFormat
            : CONST.FORMAT.AUTO;
      }
    }) as never);
  }

  ui.stylePanelLayerId = layerId;
};

/** Close the style panel. setFocus = true returns focus to the layer row. */
const closeStylePanel = (ui: LayerUI, setFocus: boolean): void => {
  if (ui.styleOutsideHandler) {
    document.removeEventListener("mousedown", ui.styleOutsideHandler, true);
    ui.styleOutsideHandler = null;
  }
  ui.styleUnsubscribe?.();
  ui.styleUnsubscribe = null;
  // No panel, no panel press: a stale verdict would block the next real drag.
  ui.pressInPanel = false;
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
  layerHasStyleDelegation,
  openStylePanel,
};
