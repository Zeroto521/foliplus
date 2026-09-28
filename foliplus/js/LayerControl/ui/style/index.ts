// LayerControl UI — per-layer annotation style panel (entry module).
//
// Opened from a data layer's ⋮ menu. The panel is anchored to the layer's own
// row and built on the shared `foliplus-panel` vocabulary (header bar, content
// scroll, close affordance), exactly like the attributes panel — so there is
// no JS positioning and no scroll/resize bookkeeping to clean up.
//
// Split from ui/style.ts. Owns the panel assembly (renderStylePanel),
// the event-binding skeleton (openStylePanel) and the teardown
// (closeStylePanel). Row builders, the field cache and the delegated drawer
// live in ./label.ts, ./opacity.ts, ./zoomRange.ts, ./delegated.ts;
// frame-level helpers (reset footer, rail positioning) live in ./frame.ts.
import { EVENTS } from "#core/event/index.js";
import { resolveSelectedField } from "#core/labelField.js";
import { dom } from "#common/dom.js";
import {
  LABEL_SIZE,
  bindLiveColor,
  bindLiveNumber,
  normalizeHexColor,
} from "#common/form.js";
import { type NumberStyle } from "#common/format.js";
import { createRowPanel } from "#common/panel.js";
import * as CONST from "../../const.js";
import * as SVGs from "../../icon.js";
import type { LayerDimension } from "../../type.js";
import { authorZoomBoundsForLayer } from "../apply.js";
import type { LayerUI } from "../index.js";
import { finishRename } from "../rename.js";
import { bindBorderRow, resetLayerBorder } from "./border.js";
import { layerHasStyleDelegation, renderDelegatedStylePanel } from "./delegated.js";
import { bindFillRow, replayFillState, resetLayerFill } from "./fill.js";
import { appendResetFooter, railPos } from "./frame.js";
import { applyPatch, layerFields, syncFormatRow } from "./label.js";
import { clampPct, commitOpacityPct, resetLayerOpacity } from "./opacity.js";
import { DIM_ORDER, LABEL_DIM_ORDER, getDimension } from "./registry.js";
import {
  applyZoomRangeLive,
  clampZoom,
  commitZoomRange,
  resetLayerZoomRange,
  syncZoomRangeRow,
  zoomToPct,
} from "./zoomRange.js";

/** Build the style panel DOM for a layer. Returns null when the layer owns
 *  neither a capable Label dimension nor a capable Layer dimension. */
const renderStylePanel = (ui: LayerUI, layerId: string): HTMLElement | null => {
  // Third-party canvas layers (heatmap, measure) declare their own controls
  // via styleSetters — render those instead of the annotation panel.
  if (layerHasStyleDelegation(ui, layerId)) {
    return renderDelegatedStylePanel(ui, layerId);
  }
  // Both sections are discovered through the dimension registry: the Layer
  // section by `DIM_ORDER`, the Label section by `LABEL_DIM_ORDER` — one
  // gate pass per dimension, and the same rows that render also decide the
  // panel exists at all. A plain vector shape has no labelable content
  // (capability "none") but still owns the Layer section; a fielded layer
  // owns the Label section even when no Layer dimension applies. The ⋮ menu
  // enables Style on the same two signals — `layerCanLabel` IS the
  // annotation dimension's gate — so the panel honours them rather than
  // demanding both.
  const gatedRows = (keys: readonly string[]): LayerDimension[] => {
    const rows: LayerDimension[] = [];
    for (const key of keys) {
      // Every key in a section order is registered — `registry.test` locks
      // the union of both orders against the built-ins — so the lookup
      // cannot miss; the cast states that contract instead of branching on
      // a null arm no test can reach.
      const dim = getDimension(key) as LayerDimension;
      if (dim.gate(ui, layerId)) rows.push(dim);
    }
    return rows;
  };
  const layerRows = gatedRows(DIM_ORDER);
  const labelRows = gatedRows(LABEL_DIM_ORDER);
  if (layerRows.length === 0 && labelRows.length === 0) return null;

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
  // The Layer section renders only when the layer owns a capable dimension;
  // a layer without any of them reaches the panel for the Label section
  // alone. Layer comes first: it is the primary surface (what the user
  // drew), and the Label section is a decoration of it. High-frequency
  // operations lead. Row order inside each section is its declared order
  // array, never the registry's insertion order — registration order
  // tracks the ES module import graph (see the `DIM_ORDER` /
  // `LABEL_DIM_ORDER` comments in `./registry.js`). Neither group carries a
  // heading any more: the panel reads as one flat row list, and Layer before
  // Label is what document order alone conveys.
  for (const dim of layerRows) content.append(dim.row(ui, layerId));
  // The Label section's gate is a pure capability bit (layer exists +
  // `capabilities.annotation !== "none"`) — the labelable-fields probe that
  // keeps the row honest lives at the surface declaration edge, so the panel
  // never re-asks it here.
  for (const dim of labelRows) content.append(dim.row(ui, layerId));
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

  // Border row: a self-managed dimension that writes `setStyle` directly, so
  // its live binders attach to the row instead of going through the panel's
  // change delegation — that only knows opacity, zoom range and the annotation
  // rows. A delegated drawer never renders this row (its gate excludes
  // styleSetters), so the lookup alone is the discriminator.
  const borderRow = panel.querySelector(
    `.${CONST.CLASSES.STYLE_BORDER_ROW}`,
  ) as HTMLElement | null;
  if (borderRow) bindBorderRow(ui, layerId, borderRow);

  const delegated = layerHasStyleDelegation(ui, layerId);
  // Annotation color/size commit live, same bindLive* recipe as the
  // heatmap panel and the delegated drawer.
  if (!delegated) {
    const colorEl = panel.querySelector(
      `.${CONST.CLASSES.STYLE_LABEL_COLOR_INPUT}`,
    ) as HTMLInputElement | null;
    if (colorEl) {
      bindLiveColor(colorEl, value => {
        applyPatch(ui, layerId, { color: normalizeHexColor(value) });
      });
    }
    const sizeEl = panel.querySelector(
      `.${CONST.CLASSES.STYLE_LABEL_SIZE_INPUT}`,
    ) as HTMLInputElement | null;
    if (sizeEl) {
      bindLiveNumber(sizeEl, {
        min: LABEL_SIZE.SIZE_MIN,
        max: LABEL_SIZE.SIZE_MAX,
        fallback: LABEL_SIZE.SIZE_DEFAULT,
        onCommit: value => applyPatch(ui, layerId, { size: value }),
      });
    }
    // Fill is a self-managed dimension (not part of the executor's
    // visible/opacity/zoomRange family): bindLiveColor commits straight to
    // ui.fillColorMap + setStyle. Same live-recipe as label color.
    const fillRow = panel.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_ROW}`,
    ) as HTMLElement | null;
    if (fillRow) bindFillRow(ui, layerId, fillRow);
  }

  // Control changes are handled on the panel itself; stopPropagation keeps
  // them out of the container-level change delegation, which would otherwise
  // re-read them as visibility toggles.

  /** Shared opacity handler for both panel flavours (LayerControl-owned).
   *  `commit` separates the live pass from the settle pass a drag ends with. */
  const handleOpacityTarget = (t: EventTarget | null, commit: boolean): boolean => {
    if (!(t instanceof HTMLInputElement)) return false;
    if (!t.classList.contains(CONST.CLASSES.STYLE_OPACITY_RANGE)) return false;
    const raw = parseFloat(t.value);
    if (!commit && !(raw >= 0 && raw <= 100)) return true;

    // Live value above the handle, the same affordance the zoom range uses.
    const rail = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_RAIL}`,
    ) as HTMLElement | null;
    let bubble = rail?.querySelector(
      `.${CONST.CLASSES.SLIDER_BUBBLE}`,
    ) as HTMLElement | null;
    if (commit) {
      bubble?.remove();
    } else if (rail) {
      if (!bubble) {
        bubble = dom.el("div", { class: CONST.CLASSES.SLIDER_BUBBLE });
        rail.appendChild(bubble);
      }
      const pct = clampPct(raw);
      bubble.style.left = railPos(pct);
      bubble.textContent = String(pct);
    }

    commitOpacityPct(ui, layerId, panel, raw, commit);
    return true;
  };

  /** Shared zoom-range handler for both panel flavours. The live pass
   *  (`input` event) updates the map and visual state in real-time so the
   *  layer responds as the user drags a thumb. The commit pass (`change`
   *  event) persists the value to localStorage. */
  const handleZoomRangeTarget = (t: EventTarget | null, commit: boolean): boolean => {
    if (!(t instanceof HTMLInputElement)) return false;
    if (
      !t.classList.contains(CONST.CLASSES.STYLE_ZOOM_RANGE_MIN) &&
      !t.classList.contains(CONST.CLASSES.STYLE_ZOOM_RANGE_MAX)
    ) {
      return false;
    }
    const row = panel.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_ROW}`,
    ) as HTMLElement | null;
    if (!row) return true;

    const minInput = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MIN}`,
    ) as HTMLInputElement;
    const maxInput = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MAX}`,
    ) as HTMLInputElement;
    const [mapMin, mapMax] = authorZoomBoundsForLayer(ui, layerId);
    let min = clampZoom(parseFloat(minInput.value), mapMin, mapMax);
    let max = clampZoom(parseFloat(maxInput.value), mapMin, mapMax);

    // Two thumbs never cross: dragging min at max clamps min to max,
    // and vice versa. This is the 31.5 "two thumbs never cross" rule.
    if (min > max) {
      if (t === minInput) {
        min = max;
        minInput.value = String(min);
      } else {
        max = min;
        maxInput.value = String(max);
      }
    }

    // The values row already tracks the drag live, so the end being held is
    // marked there rather than by a bubble: a bubble has to clear the rail,
    // which puts it over the row above (measured: it covered the opacity row's
    // number field), and it duplicates a readout that is already on screen.
    // Live readout: a bubble above the handle being held. The numbers below the
    // rail belong to the fixed limits and the current level, so the range's own
    // value has to come from the drag.
    const track = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_TRACK}`,
    ) as HTMLElement | null;
    let bubble = track?.querySelector(
      `.${CONST.CLASSES.SLIDER_BUBBLE}`,
    ) as HTMLElement | null;
    if (commit) {
      bubble?.remove();
    } else if (track) {
      if (!bubble) {
        bubble = dom.el("div", { class: CONST.CLASSES.SLIDER_BUBBLE });
        track.appendChild(bubble);
      }
      bubble.style.left = railPos(
        zoomToPct(t === minInput ? min : max, mapMin, mapMax),
      );
      bubble.textContent = String(t === minInput ? min : max);
    }

    applyZoomRangeLive(ui, layerId, row, min, max);

    if (commit) {
      commitZoomRange(ui, layerId);
    }
    return true;
  };

  panel.addEventListener("input", (event: Event) => {
    // Live slider updates while dragging; stop so the container's color
    // input handler never sees the range.
    if (handleOpacityTarget(event.target, false)) event.stopPropagation();
    if (handleZoomRangeTarget(event.target, false)) event.stopPropagation();
  });

  panel.addEventListener("change", (event: Event) => {
    const t = event.target as HTMLElement;
    if (handleOpacityTarget(t, true)) {
      event.stopPropagation();
      return;
    }
    if (handleZoomRangeTarget(t, true)) {
      event.stopPropagation();
      return;
    }
    // Delegated label controls handle their own changes (stopPropagation on
    // the shared root). Only the annotation panel's changes reach here.
    if (delegated) return;
    if (
      t instanceof HTMLInputElement &&
      t.classList.contains(CONST.CLASSES.STYLE_TOGGLE_INPUT)
    ) {
      const show = t.checked;
      // Reveal / collapse the body under the toggle. No field is written here:
      // leaving it at the auto sentinel is what makes the picker read "Auto" and
      // what lets the layer keep labeling itself if its columns change.
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
      // Fill is LayerControl-owned on the annotation flavour only (the gate
      // excludes delegated layers).
      resetLayerFill(ui, layerId);
      // Border is LayerControl-owned too: restore the author's stroke and drop
      // the persisted color / width, so a reload does not re-apply them.
      resetLayerBorder(ui, layerId);
      // Opacity is LayerControl-owned in both flavours: always restore 1.
      resetLayerOpacity(ui, layerId);
      // Zoom range is LayerControl-owned: reset to the full map range.
      resetLayerZoomRange(ui, layerId);
      if (delegated) {
        // Call each setter with its Python CONF default. The components own
        // the values — never write localStorage or annotation config here.
        const li = ui.m.layerRegistry.get(layerId);
        const setters = li?.styleSetters;
        const defaults = li?.styleDefaultsProvider?.() ?? {};
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
    // Document-level dispatch can name `document` itself — no closest().
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
  // open, pull the fresh values and refresh the controls. The shared module's
  // refresh reads from styleProvider and writes every control, skipping the
  // one under activeElement.
  if (delegated) {
    const bus = ui.m.events;
    const refresh = ui.styleRefresh;
    ui.styleUnsubscribe = bus.on(
      EVENTS.LAYER_STYLE_CHANGE,
      (payload: { id: string }) => {
        if (payload.id !== layerId) return;
        refresh?.();
      },
    );
  }

  // While the panel is open, a zoom change must move the current-zoom marker
  // on the zoom-range row and refresh its out-of-range state. The map-level
  // zoomend handler (ui.onZoomEnd) updates the effective-shown for every
  // layer; this one only updates the row's visual state.
  const zoomRangeRow = panel.querySelector(
    `.${CONST.CLASSES.STYLE_ZOOM_RANGE_ROW}`,
  ) as HTMLElement | null;
  if (zoomRangeRow) {
    ui.styleZoomEndHandler = () => {
      syncZoomRangeRow(ui, layerId, zoomRangeRow);
    };
    ui.m.map.on("zoomend", ui.styleZoomEndHandler);
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
  ui.styleRefresh = null;
  if (ui.styleZoomEndHandler) {
    ui.m.map.off("zoomend", ui.styleZoomEndHandler);
    ui.styleZoomEndHandler = null;
  }
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

export { closeStylePanel, openStylePanel, renderStylePanel };

// Re-exports for external callers (menu.ts, attr.ts, ui/index.ts, tests):
// the style barrel still surfaces the same six symbols the pre-split
// ui/style.ts did — the split is invisible to consumers. The Label
// dimension rides along too: importing this barrel registers it.
export {
  applyStyleLabelState,
  invalidateFields,
  layerHasLabelFields,
} from "./label.js";
export { ANNOTATION_DIMENSION, layerCanLabel } from "./annotation.js";
export { layerHasStyleDelegation } from "./delegated.js";
export { replayFillState } from "./fill.js";
