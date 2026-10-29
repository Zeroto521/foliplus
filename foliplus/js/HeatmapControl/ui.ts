// HeatmapControl UI building — standalone functions.
// All internal refs use direct function calls instead of `this.`.
import { CLASS_COUNT, type ClassifyMethod, isClassifyMethod } from "#core/classify.js";
import { EVENTS, ensureEvents, publish } from "#core/event/index.js";
import {
  dropdownSurface,
  fullscreenSurface,
  onFullscreenSurfaceChange,
} from "#core/fullscreen.js";
import { HINT_DURATION } from "#core/hint.js";
import { adjustPanelZIndex } from "#core/leaflet/index.js";
import { safeColorScale } from "#core/palette.js";
import { buildClassesRow, buildFieldRow, buildSchemeRow } from "#core/rampForm.js";
import { dom } from "#common/dom.js";
import { createDropdown, dropdownOf } from "#common/dropdown.js";
import { type SchemePicker, createSchemePicker } from "#common/schemePicker.js";
import * as CONST from "./const.js";
import { type HeatmapManager } from "./manager.js";
import { panelContentHTML } from "./template.js";

/** Shape of the HeatmapControl instance as consumed by UI functions. */
interface HeatmapControlUI {
  mgr: HeatmapManager;
  /** BaseControl.on — DOM listeners bound through the control's mounting
   *  signal, so a removed control tears them down with everything else. */
  on: (
    target: EventTarget,
    type: string,
    fn: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions,
  ) => () => void;
  /** Component config — carried on the state object instead of a module-level
   *  free variable, so every UI function is unit-testable with its own CONFIG. */
  config: ComponentConfig;
  /** Translator bound to `config`, created once by the control / test fixture. */
  T: (key: string) => string;
  ctrl: HTMLElement;
  /** Shared scheme picker instance. */
  schemePicker: SchemePicker | null;
  /** Kept for backward compat — mirrors the picker's dropdown element. */
  schemeDropdown: HTMLElement | null;
  expandHookDone: boolean;
  /** Kept for backward compat — the picker's destroy function. */
  schemeBarCleanup: (() => void) | null;
  /** Destroy the scheme picker (called by HeatmapControl.destroy()). */
  schemePickerCleanup: (() => void) | null;
  toggleDropdown: (() => void) | null;
  selectScheme: ((idx: number) => void) | null;
  observer: MutationObserver | null;
  layerSelect: HTMLSelectElement;
  extraBody: HTMLElement;
  aggSelect: HTMLSelectElement;
  fieldWrap: HTMLElement;
  fieldSelect: HTMLSelectElement;
  methodSelect: HTMLSelectElement;
  classSelect: HTMLSelectElement;
  schemeControlWrap: HTMLElement;
  schemeBar: HTMLElement;
  schemeBarInner: HTMLElement;
  schemeSelectHidden: HTMLSelectElement;
  /** Kept for backward compat — delegated to the picker's close(). */
  closeSchemeDropdown: (event: Event) => void;
  /** Kept for backward compat — delegated to the picker's toggle(). */
  toggleSchemeDropdown: () => void;
}

/** Clamp a manager scheme to the configured list. A value persisted under an
 *  older Python `schemes` kwarg (or hand-edited storage) can name a palette
 *  this render does not offer; the shared picker throws on such a value, so
 *  resolve it to the list's first entry instead of failing the whole build. */
const resolveScheme = (ctrl: HeatmapControlUI): string => {
  const schemes = ctrl.config.schemes ?? [];
  const current = ctrl.mgr.scheme;
  return schemes.length === 0 || schemes.includes(current) ? current : schemes[0];
};

/** Save the current config after any user-initiated change. */
const persist = (ctrl: HeatmapControlUI) => {
  ctrl.mgr.saveConfig();
  // Field/layer changes rewrite the canvas — mirror source layer + field into
  // the attrs panel and stamp Updated so the panel tracks the latest render.
  ctrl.mgr.syncSourceMeta();
};

const bindControls = (ctrl: HeatmapControlUI, panelContent: HTMLElement) => {
  panelContent.innerHTML = panelContentHTML(ctrl.T);

  // Restore saved configuration before setting initial values.
  const saved = ctrl.mgr.loadSavedConfig();
  if (saved) ctrl.mgr.applySavedConfig(saved);

  // Query key elements from the template using DATA_ATTR constants
  ctrl.layerSelect = panelContent.querySelector(
    `[${CONST.DATA_ATTR.LAYER}]`,
  ) as HTMLSelectElement;
  ctrl.extraBody = panelContent.querySelector(
    `[${CONST.DATA_ATTR.EXTRA_BODY}]`,
  ) as HTMLElement;
  ctrl.aggSelect = panelContent.querySelector(
    `[${CONST.DATA_ATTR.AGG}]`,
  ) as HTMLSelectElement;
  // Both template selects keep their markup and stay the value/change bridge;
  // the visible controls are the shared dropdowns (common/dropdown.ts).
  // Every popup follows the surface covering its trigger (native fullscreen or
  // this control's pseudo-fullscreen fallback), so the list is never parked
  // under the opaque map.
  const surface = dropdownSurface(ctrl.mgr.map.getContainer());
  createDropdown({
    nativeSelect: ctrl.layerSelect,
    ariaLabel: ctrl.T("layer"),
    ...surface,
  });
  createDropdown({
    nativeSelect: ctrl.aggSelect,
    ariaLabel: ctrl.T("agg_method"),
    ...surface,
  });
  // Field / Classes / Scheme are shared row primitives (core/rampForm),
  // mounted into the template's placeholder. The rows keep the heatmap's
  // data-* seams and classes; only the structure is shared with LayerControl.
  const rampHost = panelContent.querySelector(
    `[${CONST.DATA_ATTR.RAMP_ROWS}]`,
  ) as HTMLElement;
  const fieldRow = buildFieldRow({
    label: ctrl.T("field"),
    ariaLabel: ctrl.T("field"),
    fields: [],
    value: "",
    rowClass: "foliplus-heatmap-field foliplus-hidden",
    rowAttributes: { [CONST.DATA_ATTR.FIELD]: "" },
    selectAttributes: { [CONST.DATA_ATTR.FIELD_SELECT]: "" },
    surface,
  });
  // The row has one visible label but two selects: give each its own
  // accessible name so a screen reader does not announce "Classes" twice.
  const classesRow = buildClassesRow({
    label: ctrl.T("classify_method"),
    methodAriaLabel: ctrl.T("classify_method"),
    classesAriaLabel: ctrl.T("class_count"),
    methodValue: ctrl.mgr.method as ClassifyMethod,
    classesValue: ctrl.mgr.numClasses,
    methodLabel: method => ctrl.T(method),
    methodClass: "",
    classesClass: "foliplus-heatmap-class-select",
    methodAttributes: { [CONST.DATA_ATTR.METHOD]: "" },
    classesAttributes: { [CONST.DATA_ATTR.CLASS_COUNT]: "" },
    surface,
  });
  const schemeRow = buildSchemeRow({
    label: ctrl.T("scheme"),
    triggerClass: "foliplus-heatmap-scheme-bar",
    barClass: "foliplus-heatmap-scheme-bar-inner",
    rowAttributes: { [CONST.DATA_ATTR.SCHEME_CTRL]: "" },
    hiddenAttributes: { [CONST.DATA_ATTR.SCHEME_HIDDEN]: "" },
  });
  rampHost.append(fieldRow.row, classesRow.row, schemeRow.row);
  ctrl.fieldWrap = fieldRow.row;
  ctrl.fieldSelect = fieldRow.select;
  ctrl.methodSelect = classesRow.methodSelect;
  ctrl.classSelect = classesRow.classesSelect;
  ctrl.schemeControlWrap = schemeRow.row;
  ctrl.schemeBar = schemeRow.trigger;
  ctrl.schemeBarInner = schemeRow.bar;
  ctrl.schemeSelectHidden = schemeRow.hiddenSelect;

  // Set initial values from manager defaults
  ctrl.classSelect.value = String(
    Math.min(CLASS_COUNT.MAX, Math.max(CLASS_COUNT.MIN, ctrl.mgr.numClasses)),
  );
  ctrl.methodSelect.value = ctrl.mgr.method;
  ctrl.aggSelect.value = ctrl.mgr.agg;
  // The three writes above bypass syncSelect (they run before the rows'
  // listeners exist): re-read the bridged dropdowns once so the closed
  // triggers show the restored values.
  dropdownOf(ctrl.classSelect)?.refresh();
  dropdownOf(ctrl.methodSelect)?.refresh();
  dropdownOf(ctrl.aggSelect)?.refresh();

  // Populate scheme options and set current value. The scheme is clamped
  // first: a restored value can name a palette this render does not offer.
  ctrl.mgr.scheme = resolveScheme(ctrl);
  (ctrl.config.schemes ?? []).forEach(name => {
    dom.el("option", { value: name, parent: ctrl.schemeSelectHidden }, name);
  });
  ctrl.schemeSelectHidden.value = ctrl.mgr.scheme;

  // ── Create the shared scheme picker ──
  ctrl.schemePicker = createSchemePicker({
    trigger: ctrl.schemeBar,
    hiddenSelect: ctrl.schemeSelectHidden,
    schemes: ctrl.config.schemes ?? [],
    value: ctrl.mgr.scheme,
    numClasses: ctrl.mgr.numClasses,
    // Portalled like the style drawer's picker: the shared placement decision
    // (flip above a trigger near the viewport bottom) lives in the portal path,
    // and the injected host contract keeps the list above the surface that
    // covers the trigger — native fullscreen or the pseudo fallback.
    portal: true,
    resolveHost: () => fullscreenSurface(ctrl.mgr.map.getContainer()),
    onSurfaceChange: onFullscreenSurfaceChange,
    colorScale: safeColorScale,
    // The picker has no locale table: the panel's translator names the trigger.
    label: ctrl.T("scheme"),
    classes: {
      open: CONST.CLASSES.SCHEME_BAR_OPEN,
    },
    onChange: (name: string) => {
      ctrl.mgr.scheme = name;
      ctrl.mgr.renderHexagons();
      persist(ctrl);
    },
    onToggle: (open, dropdown) => {
      ctrl.schemeDropdown = open ? dropdown : null;
    },
  });

  // The picker owns its trigger click handler, keyboard handlers, outside-click,
  // and focus management. We only need to expose the delegates for backward
  // compat with tests and the HeatmapControl class.
  // schemeBarCleanup: transient reset (close dropdown) — called by
  // clearHeatmapCanvas when data is cleared. The picker stays alive.
  ctrl.schemeBarCleanup = () => ctrl.schemePicker?.close({ restoreFocus: false });
  // schemePickerCleanup: permanent destroy — called by HeatmapControl.destroy().
  ctrl.schemePickerCleanup = () => {
    ctrl.schemePicker?.destroy();
    ctrl.schemePicker = null;
  };
  ctrl.toggleDropdown = () => ctrl.schemePicker?.toggle();
  ctrl.selectScheme = (idx: number) => {
    const name = (ctrl.config.schemes ?? [])[idx];
    if (name) ctrl.schemePicker?.selectScheme(name);
  };
  ctrl.closeSchemeDropdown = (_event: Event) => {
    ctrl.schemePicker?.close();
  };
  ctrl.toggleSchemeDropdown = () => {
    ctrl.schemePicker?.toggle();
  };

  ctrl.aggSelect.onchange = () => {
    ctrl.mgr.agg = ctrl.aggSelect.value;
    updateFieldSelector(ctrl);
    // Selecting a value aggregation may resolve a concrete field: drop a
    // filter bound to the previous field, then tell the open panel to re-read
    // the model even when the field did not move.
    ctrl.mgr.syncFilterField();
    ctrl.mgr.renderHexagons();
    persist(ctrl);
    publish(ctrl.mgr.events, EVENTS.LAYER_FILTER_CHANGE, {
      id: ctrl.mgr.layerId,
    });
  };

  ctrl.fieldSelect.onchange = () => {
    ctrl.mgr.field = ctrl.fieldSelect.value;
    // Drop the memo with the write: the reads below resolve through
    // effectiveField(), and a memo left over the previous column makes both
    // render caches (points + agg, keyed on that field) hit — the canvas
    // keeps the old colouring until some later repaint.
    ctrl.mgr.invalidateEffectiveField();
    syncSelect(ctrl, ctrl.fieldSelect, ctrl.fieldSelect.value);
    // The filter field is the aggregation field (read-only in the panel): a
    // field change drops a filter bound to the old field and repaints the
    // rail extent. The notification also refreshes an open panel when the
    // old filter happened to be absent (the extent/field still changed).
    ctrl.mgr.syncFilterField();
    ctrl.mgr.renderHexagons();
    persist(ctrl);
    publish(ctrl.mgr.events, EVENTS.LAYER_STYLE_CHANGE, {
      id: ctrl.mgr.layerId,
    });
    publish(ctrl.mgr.events, EVENTS.LAYER_FILTER_CHANGE, {
      id: ctrl.mgr.layerId,
    });
  };

  ctrl.methodSelect.onchange = () => {
    // The select only ever carries an option value, but the field is typed
    // closed: writing an unrecognised name would leave the manager in a state
    // computeBreaks refuses. A hand-edited DOM is the only way to get here.
    const method = ctrl.methodSelect.value;
    if (!isClassifyMethod(method)) return;
    ctrl.mgr.method = method;
    ctrl.mgr.renderHexagons();
    persist(ctrl);
  };

  ctrl.classSelect.onchange = () => {
    ctrl.mgr.numClasses = Math.min(
      CLASS_COUNT.MAX,
      Math.max(
        CLASS_COUNT.MIN,
        parseInt(ctrl.classSelect.value, 10) || CLASS_COUNT.DEFAULT,
      ),
    );
    // The picker owns the colour bar rendering — setNumClasses already
    // refreshes the dropdown items.
    ctrl.schemePicker?.setNumClasses(ctrl.mgr.numClasses);
    ctrl.mgr.renderHexagons();
    persist(ctrl);
  };

  ctrl.schemeSelectHidden.onchange = () => {
    const name = ctrl.schemeSelectHidden.value;
    ctrl.schemePicker?.setValue(name);
    ctrl.mgr.scheme = name;
    ctrl.mgr.renderHexagons();
    persist(ctrl);
  };

  const clearBtn = panelContent.querySelector(
    `[${CONST.DATA_ATTR.BTN_CLEAR}]`,
  ) as HTMLButtonElement;
  clearBtn.onclick = () => {
    resetPanel(ctrl);
    ctrl.mgr.clearSavedConfig();
    ctrl.mgr.clearLayerState();
    ctrl.ctrl.classList.remove(CONST.CLASSES.EXPANDED);
    ctrl.ctrl.classList.add(CONST.CLASSES.COLLAPSED);
    adjustPanelZIndex({ container: ctrl.ctrl, expanded: false });
  };

  // Initial colour bar render is handled by the picker's constructor.

  // Nothing is selected yet, but the aggregation options still need their
  // initial availability. With a restored source selected, wait for initScan:
  // the field list is not known here, and degrading now would rewrite a valid
  // saved aggregation before its layer is scanned.
  if (!ctrl.mgr.selectedLayerId) updateFieldSelector(ctrl);
};

const setupObserver = (ctrl: HeatmapControlUI) => {
  ctrl.observer = new MutationObserver(() => {
    if (ctrl.ctrl.classList.contains(CONST.CLASSES.EXPANDED) && !ctrl.expandHookDone) {
      ctrl.expandHookDone = true;
      rebuildLayerDropdown(ctrl);
    }
    if (ctrl.ctrl.classList.contains(CONST.CLASSES.COLLAPSED)) {
      ctrl.expandHookDone = false;
      // The scheme list is portalled to the map surface (not into the panel),
      // so collapsing the panel does not hide it: the header, the close button
      // and the clear button all collapse through this class, and each would
      // leave the list floating over the map. Close it here — the same
      // observation that resets the expand hook, so no extra listener exists
      // for it and every collapse path is covered at once.
      ctrl.schemePicker?.close({ restoreFocus: false });
    }
  });
  ctrl.observer.observe(ctrl.ctrl, { attributes: true });
};

const buildLayerListItems = (ctrl: HeatmapControlUI, sel: HTMLSelectElement) => {
  ctrl.mgr.scanMapLayers();
  sel.innerHTML = "";
  dom.el(
    "option",
    {
      value: "",
      disabled: true,
      class: CONST.CLASSES.PLACEHOLDER_OPTION,
      parent: sel,
      selected: !ctrl.mgr.selectedLayerId ? "" : undefined,
    },
    ctrl.T("layer_placeholder"),
  );

  ctrl.mgr.pointLayers.forEach(info => {
    dom.el("option", { value: info.id, parent: sel }, info.name);
  });

  // Python declaration: `HeatmapControl(layer=...)` names the point layer to
  // start on. resolveDeclaredLayer answers null once a persisted record has
  // consumed the hasScanned guard, so the user's earlier choice (or explicit
  // clear) wins over the declaration.
  if (!ctrl.mgr.selectedLayerId) {
    const declaredId = ctrl.mgr.resolveDeclaredLayer();
    if (declaredId) ctrl.mgr.selectedLayerId = declaredId;
  }

  // Auto-select a single point layer only on the very first scan, so the
  // initial map load shows its heatmap without user input.  Rebuilds
  // triggered later (zoomend, layeradd/layerremove, map reload) must not
  // re-fire this — otherwise a user's manual clear keeps being overridden.
  if (
    !ctrl.mgr.hasScanned &&
    ctrl.mgr.pointLayers.length === 1 &&
    !ctrl.mgr.selectedLayerId
  ) {
    ctrl.mgr.selectedLayerId = ctrl.mgr.pointLayers[0].id;
    if (ctrl.extraBody) ctrl.extraBody.classList.remove(CONST.CLASSES.HIDDEN);
    syncSelect(ctrl, sel, ctrl.mgr.selectedLayerId);
    updateFieldSelector(ctrl);
    // Declared filter: the source and its field list are settled, and this is
    // the last point before the first render — the same slot the persisted
    // record would have been restored into.
    ctrl.mgr.seedDeclaredFilter();
    ctrl.mgr.renderHexagons();
  } else if (ctrl.mgr.selectedLayerId) {
    // Restored selection (localStorage / rebuild): resolve and persist the
    // field first so syncSourceMeta reads a concrete name.
    updateFieldSelector(ctrl);
    // Same slot on the restore path: a declared filter seeds before the draw
    // so the first paint already reflects it.
    ctrl.mgr.seedDeclaredFilter();
    // A rebuild can be the only thing that re-applies a selection after the
    // canvas was wiped — Clear deletes the record, then reopening the panel
    // rebuilds the dropdown and the Python declaration selects the layer
    // again. The selection alone is not enough: without a cache the panel
    // would claim a source while the map stayed empty until the user nudged
    // a control, so draw once here (initScan's own restore pass then sees the
    // cache and skips its duplicate draw).
    if (!ctrl.mgr.cachedFeatures) ctrl.mgr.renderHexagons();
  }

  // Selection (automatic, restored, or user) and field resolution are settled
  // here — publish source-layer / agg-field so the attrs panel is current
  // without a further user edit.
  ctrl.mgr.syncSourceMeta();

  if (ctrl.mgr.selectedLayerId) sel.value = ctrl.mgr.selectedLayerId;
  else sel.selectedIndex = 0;

  sel.onchange = () => {
    ctrl.mgr.selectedLayerId = sel.value || null;
    if (ctrl.extraBody) {
      ctrl.extraBody.classList.toggle(CONST.CLASSES.HIDDEN, !ctrl.mgr.selectedLayerId);
    }
    syncSelect(ctrl, sel, sel.value);
    updateFieldSelector(ctrl);
    if (ctrl.mgr.selectedLayerId) ctrl.mgr.renderHexagons();
    else ctrl.mgr.clearHeatmapCanvas();
    // Source identity changes the whole filter model (field, extent, kept);
    // an open filter panel re-reads it through this notification.
    publish(ctrl.mgr.events, EVENTS.LAYER_FILTER_CHANGE, {
      id: ctrl.mgr.layerId,
    });
    persist(ctrl);
  };

  syncSelect(ctrl, sel, sel.value);
  if (ctrl.extraBody) {
    ctrl.extraBody.classList.toggle(CONST.CLASSES.HIDDEN, !ctrl.mgr.selectedLayerId);
  }
};

const rebuildLayerDropdown = (ctrl: HeatmapControlUI) => {
  if (ctrl.layerSelect) buildLayerListItems(ctrl, ctrl.layerSelect);
};

/** Express whether value aggregations are currently usable. Disabling only the
 *  options is not enough — the selected value must also move to COUNT, or the
 *  browser reselects COUNT for display while `mgr.agg` keeps the old value. */
const setValueAggregationsEnabled = (ctrl: HeatmapControlUI, enabled: boolean) => {
  for (const opt of ctrl.aggSelect.options) {
    opt.disabled = !enabled && opt.value !== CONST.AGG.COUNT;
  }
  // The explanation belongs on the visible control: the select itself is
  // hidden behind the dropdown, so a tooltip set there would never show. The
  // hint is a dropdown-level state so the label renderer cannot overwrite it
  // on the next refresh.
  dropdownOf(ctrl.aggSelect)?.setHint(enabled ? "" : ctrl.T("needs_numeric_field"));
};

const updateFieldSelector = (ctrl: HeatmapControlUI) => {
  if (!ctrl.fieldWrap || !ctrl.fieldSelect) return;

  const selected = ctrl.mgr.pointLayers.filter(
    info => info.id === ctrl.mgr.selectedLayerId,
  );
  const fields = ctrl.mgr.collectFields(selected);
  // Hand the scan's field list to the manager and let it resolve the effective
  // field once. The row renders that value and every other reader
  // (getPointValue, the filter model, the render key) answers from the same
  // cached resolution — the panel and the map cannot disagree, and nothing
  // here writes the resolution back into the manager or the record.
  const effective = ctrl.mgr.setAvailableFields(fields);

  // No numeric field: SUM/AVG/MIN/MAX have nothing to weigh by. Disable the
  // options, explain why, AND move the value itself to COUNT — one value for
  // display, render and persistence, so the select never shows one aggregation
  // while the render uses another. Leaving `mgr.agg` at SUM/AVG here splits
  // them: the browser silently reselects COUNT for display, while the render
  // still aggregates by the stale value — every cell then falls back to 1.
  if (fields.length === 0) {
    setValueAggregationsEnabled(ctrl, false);
    // Only a SELECTED source can prove it has no numeric field. Before the
    // first scan (no layer yet) the field list is empty for a different
    // reason, and rewriting the aggregation here would (a) discard the
    // Python-declared agg before its layer is known and (b) persist an
    // empty-selection record that consumes the hasScanned guard — so the
    // next reload would skip the declaration entirely.
    if (ctrl.mgr.selectedLayerId && ctrl.mgr.agg !== CONST.AGG.COUNT) {
      ctrl.mgr.agg = CONST.AGG.COUNT;
      syncSelect(ctrl, ctrl.aggSelect, CONST.AGG.COUNT);
      ctrl.mgr.saveConfig();
    }
    rebuildFieldOptions(ctrl, fields, "");
    ctrl.fieldWrap.classList.add(CONST.CLASSES.HIDDEN);
    return;
  }

  setValueAggregationsEnabled(ctrl, true);

  // The Python declaration (`HeatmapControl(field=...)`) and the first-numeric
  // guess are both folded into `effective` by the manager: the user's stored
  // pick wins while the data offers it, then the declaration, then the first
  // field. Neither default is written to `mgr.field` or to the record — the
  // record only ever holds a field the user picked, so a data-derived default
  // can never outlive the data that produced it.
  if (ctrl.mgr.agg === CONST.AGG.COUNT) {
    // COUNT needs no field; the row appears once a value aggregation is picked.
    // Keep the hidden select on a valid option rather than the empty string —
    // the effective field stays selected so switching aggregation keeps it.
    rebuildFieldOptions(ctrl, fields, effective);
    ctrl.fieldWrap.classList.add(CONST.CLASSES.HIDDEN);
    return;
  }
  ctrl.fieldWrap.classList.remove(CONST.CLASSES.HIDDEN);

  // A stored field the data no longer offers displays the fallback (declaration
  // or first numeric field) while the stored pick stays untouched in the
  // manager and the record: it is the user's intent, and it comes back when
  // the data does.
  rebuildFieldOptions(ctrl, fields, effective);
  syncSelect(ctrl, ctrl.fieldSelect, effective);
};

/** Rebuild the field <option>s in place: the row element and its bound
 *  onchange live for the control's lifetime, while the field list changes on
 *  every scan. */
const rebuildFieldOptions = (
  ctrl: HeatmapControlUI,
  fields: readonly string[],
  value: string,
) => {
  ctrl.fieldSelect.innerHTML = "";
  fields.forEach(f => {
    dom.el("option", { value: f, parent: ctrl.fieldSelect }, f);
  });
  ctrl.fieldSelect.value = value;
  // The option list was replaced wholesale, so the dropdown has to re-read it
  // even when the value itself did not move.
  dropdownOf(ctrl.fieldSelect)?.refresh();
};

/**
 * Scan the map for point layers. Driven by the ready signal instead of a
 * retry loop: an immediate first pass, a re-scan on every CONTROL_ATTACHED
 * (a control — usually LayerControl — finishing attach), and a final pass
 * one macrotask later to settle the "no point layers" hint — every control
 * attaches in the same synchronous script stack, so by then the layer set is
 * final (dynamic layer changes after that flow through LAYER_CHANGE in the
 * manager). Returns a cleanup that unsubscribes.
 */
const initScan = (ctrl: HeatmapControlUI): (() => void) => {
  let done = false;

  const scan = (final: boolean): void => {
    if (done) return;
    try {
      ctrl.mgr.scanMapLayers();
    } catch {
      // scanMapLayers may throw when LayerControl is missing (e.g.
      // map.foliplus.LayerAPI is the lightweight stub that lacks the
      // full registry methods). The error is harmless — we just
      // treat it as "no layers found" and continue to the hint logic.
    }
    if (ctrl.mgr.pointLayers.length > 0) {
      rebuildLayerDropdown(ctrl);
      // Mark scanned only after the first rebuild completes, so the
      // one-shot single-layer auto-select inside buildLayerListItems can
      // still fire for the initial map load but never again afterwards.
      ctrl.mgr.hasScanned = true;
      // Restore path: rebuild only syncs the dropdown value — refresh the
      // field selector and draw the saved layer so a reload shows the saved
      // configuration without waiting for user input.
      if (ctrl.mgr.selectedLayerId) {
        updateFieldSelector(ctrl);
        if (!ctrl.mgr.cachedFeatures) ctrl.mgr.renderHexagons();
      }
      ctrl.ctrl?.setAttribute("data-ready", "true");
      done = true;
      cleanup();
    } else if (final) {
      // Settle: no point layer showed up. Distinguish the two causes so the
      // hint points the user at the right fix: isLayerControl===false means
      // only the lightweight LayerAPI stub is installed (no LayerControl
      // added), whereas true means LayerControl is present but has no data.
      const missingLayerControl = !ctrl.mgr.map.foliplus?.LayerAPI?.isLayerControl;
      ctrl.mgr.map.foliplus!.showHint(
        ctrl.config.name,
        ctrl.T(missingLayerControl ? "no_layercontrol" : "no_layer"),
        HINT_DURATION.LONG,
      );
      ctrl.mgr.hasScanned = true;
      ctrl.ctrl?.setAttribute("data-ready", "true");
      done = true;
      cleanup();
    }
  };

  const events = ensureEvents(ctrl.mgr.map);
  const cleanup = events.on(EVENTS.CONTROL_ATTACHED, () => scan(false));

  // Settle after the synchronous attach sequence: a control that attached
  // before this subscription (e.g. LayerControl added before Heatmap) is
  // covered by the immediate pass below; the final pass here ends the
  // initial scan. No fixed delay — the attach stack is synchronous.
  setTimeout(() => scan(true), 0);

  scan(false);

  return () => {
    if (done) return;
    done = true;
    cleanup();
  };
};

/** Reset the panel to its initial state — manager state back to the declared
 *  defaults, canvas wiped, every dropdown on its placeholder. Shared by the
 *  panel's Clear button and the LAYER_DELETED path (LayerControl's more-menu
 *  clear) so clearing the heatmap reads the same way from either entry. */
const resetPanel = (ctrl: HeatmapControlUI) => {
  ctrl.mgr.resetState(ctrl.config);
  ctrl.mgr.clearHeatmapCanvas();
  // Read the reset values off the manager instead of recomputing the defaults —
  // resetState is the single source, and bindControls' initial clamp (see above)
  // is the one the class select needs.
  syncSelect(ctrl, ctrl.layerSelect, "");
  syncSelect(ctrl, ctrl.aggSelect, ctrl.mgr.agg);
  syncSelect(
    ctrl,
    ctrl.classSelect,
    String(Math.min(CLASS_COUNT.MAX, Math.max(CLASS_COUNT.MIN, ctrl.mgr.numClasses))),
  );
  syncSelect(ctrl, ctrl.methodSelect, ctrl.mgr.method);
  // resetState restores the config default, which may not be in `schemes`.
  ctrl.mgr.scheme = resolveScheme(ctrl);
  ctrl.schemeSelectHidden.value = ctrl.mgr.scheme;
  // The picker owns the colour bar — just tell it the new value and count.
  ctrl.schemePicker?.setValue(ctrl.mgr.scheme);
  ctrl.schemePicker?.setNumClasses(ctrl.mgr.numClasses);
  updateFieldSelector(ctrl);
  // Drop the published source rows — the canvas unregisters on clear, but the
  // shared meta object outlives it and would repopulate stale values on re-register.
  ctrl.mgr.syncSourceMeta();
  ctrl.extraBody.classList.add(CONST.CLASSES.HIDDEN);
};

const syncSelect = (ctrl: HeatmapControlUI, el: HTMLSelectElement, value: string) => {
  el.value = value;
  el.classList.toggle(CONST.CLASSES.CLASS_PLACEHOLDER, !value);
  // A property write fires no change event: the dropdown's closed trigger has
  // to be re-read here, which is also why every programmatic value write in
  // this module goes through syncSelect.
  dropdownOf(el)?.refresh();
};

export { bindControls, initScan, rebuildLayerDropdown, resetPanel, setupObserver };
export type { HeatmapControlUI };
