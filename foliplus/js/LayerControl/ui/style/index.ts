// LayerControl UI — per-layer annotation style panel (entry module).
//
// Opened from a data layer's ⋮ menu. The panel is anchored to the layer's own
// row and built on the shared `foliplus-panel` vocabulary (header bar, content
// scroll, close affordance), exactly like the attributes panel. The shared
// pinRowPanel keeps the fixed-position card under that row while the list
// scrolls, so the whole card stays inside the viewport instead of being clipped
// by the list's scroll box.
//
// Split from ui/style.ts. Owns the panel assembly (renderStylePanel),
// the event-binding skeleton (openStylePanel) and the teardown
// (closeStylePanel). Row builders, the field cache and the delegated drawer
// live in ./label.ts, ./opacity.ts, ./zoomRange.ts, ./delegated.ts;
// frame-level helpers (reset footer, rail positioning) live in ./frame.ts.
import { EVENTS } from "#core/event/index.js";
import { resolveSelectedField } from "#core/label/index.js";
import { createRowPanel, pinRowPanel, unpinRowPanel } from "#core/leaflet/index.js";
import { isInsideOverlay } from "#core/overlay.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import * as SVGs from "#foliplus/LayerControl/icon.js";
import { finishSlidersIn } from "#foliplus/LayerControl/slider.js";
import type { NumberStyle } from "#foliplus/config-schema.js";
import {
  LABEL_SIZE,
  bindLiveColor,
  bindLiveNumber,
  normalizeHexColor,
} from "#common/form.js";
import { SCHEME_PICKER_PORTAL_SELECTOR } from "#common/schemePicker.js";
import { NO_DELTA, type ProjectionDelta, notifyDelta } from "../apply.js";
import type { LayerUI } from "../surface.js";
import { closeOverlays } from "../teardown.js";
import { bindBorderRow, resetLayerBorder } from "./border.js";
import { layerHasStyleDelegation, renderDelegatedStylePanel } from "./delegated.js";
import { bindFillRow, disposeFillRow, resetLayerFill } from "./fill.js";
import { appendResetFooter } from "./frame.js";
import { applyPatch, layerFields, resetStyleLabel, syncFormatRow } from "./label.js";
import { resetLayerOpacity } from "./opacity.js";
import { DIM_ORDER, LABEL_DIM_ORDER, gatedRows } from "./registry.js";
import { bindSizeRow, resetLayerSize } from "./size.js";
import { flushStyleDimApplies } from "./styleBag.js";
import { resetLayerZoomRange, syncZoomRangeRow } from "./zoomRange.js";

/** Build the style panel DOM for a layer. Returns null when the layer owns
 *  neither a capable Label dimension nor a capable Layer dimension. */
const renderStylePanel = (ui: LayerUI, layerId: string): HTMLElement | null => {
  // Third-party canvas layers (heatmap, measure) declare their own controls
  // via styleSetters — render those instead of the label panel.
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
  // annotation dimension's gate — so the panel honors them rather than
  // demanding both.
  const layerRows = gatedRows(ui, layerId, DIM_ORDER);
  const labelRows = gatedRows(ui, layerId, LABEL_DIM_ORDER);
  if (layerRows.length === 0 && labelRows.length === 0) return null;

  // Shell (surface, header, content scroll) comes from the shared row-panel
  // factory — the attributes panel's twin, built by the same code, so the
  // width, header and card chrome cannot drift from it.
  const { panel, content } = createRowPanel({
    cssClass: CONST.CLASSES.STYLE_PANEL,
    title: ui.T("style_layer"),
    iconSvg: SVGs.ICON_STYLE,
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
 *  panel uses — through the shared fixed-position pin, so it is not clipped by
 *  the row list's scroll box. */
const openStylePanel = (ui: LayerUI, layerId: string): void => {
  if (!layerId) return;

  // The row-lookup guard runs before teardown: an unknown id would clear
  // whatever the user had open and then fail to open anything. The panel
  // render stays after closeOverlays — `renderDelegatedStylePanel` sets
  // `ui.overlayPanel.styleRefresh` on this call, which `closeStylePanel` would wipe.
  const item = ui.uiContainer?.querySelector(
    `${CONST.SEL.LAYER_ITEM}[${CONST.DATA.LAYER_ID}="${CSS.escape(layerId)}"]`,
  ) as HTMLElement | null;
  if (!item) return;

  closeOverlays(ui);
  const panel = renderStylePanel(ui, layerId);
  if (!panel) return;

  // The panel sits inside a draggable layer row: a press on the panel must
  // neither start a row drag nor inherit `user-select: none` (attrs recipe).
  // The mousedown is stopped here; whether the press landed inside the panel is
  // recorded by the outside handler below, because `dragstart` is dispatched on
  // the draggable row and so cannot answer it.
  ui.overlayPanel.stylePanelEl = panel;
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
    // ui.intentStore fillColor + setStyle. Same live-recipe as label color.
    const fillRow = panel.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_ROW}`,
    ) as HTMLElement | null;
    if (fillRow) bindFillRow(ui, layerId, fillRow);
    // Size rides the same flavour as fill: the delegated drawer never renders it.
    const sizeRow = panel.querySelector(
      `.${CONST.CLASSES.STYLE_SIZE_ROW}`,
    ) as HTMLElement | null;
    if (sizeRow) bindSizeRow(ui, layerId, sizeRow);
  }

  // The slider rows wire their own live/commit callbacks when the primitive is
  // built, so the panel no longer translates input/change events into values.
  // What remains here is the annotation toggle and the delegated rows.

  panel.addEventListener("change", (event: Event) => {
    const t = event.target as HTMLElement;
    // Delegated label controls handle their own changes (stopPropagation on
    // the shared root). Only the label panel's changes reach here.
    if (delegated) return;
    if (
      t instanceof HTMLInputElement &&
      t.classList.contains(CONST.CLASSES.STYLE_TOGGLE_INPUT)
    ) {
      const show = t.checked;
      // Reveal / collapse the body under the toggle. No field is written here:
      // the picker already shows a concrete field, and leaving the stored value
      // untouched is what lets a fieldless config keep resolving to the layer's
      // default as its columns change.
      const body = panel.querySelector(
        `.${CONST.CLASSES.STYLE_BODY}`,
      ) as HTMLElement | null;
      if (body) body.classList.toggle("foliplus-hidden", !show);
      const fieldSel = panel.querySelector(
        ".foliplus-style-field-select",
      ) as HTMLSelectElement | null;
      const cfg = ui.c.annotation.getConfig(layerId);
      const fields = layerFields(ui, layerId);
      const chosen = fieldSel?.value ?? cfg.field;
      const fmtRow = panel.querySelector(
        `.${CONST.CLASSES.STYLE_FORMAT_ROW}`,
      ) as HTMLElement | null;
      if (fmtRow) {
        syncFormatRow(fields, fmtRow, resolveSelectedField(chosen, fields));
      }
      applyPatch(ui, layerId, { show });
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
      // The whole Reset is one operation: every dimension restores first, then
      // the delegated defaults (or the label config drop), then the panel
      // closes, and only then does the single notify go out. A notify fired by
      // one dimension mid-operation would hand a subscriber a panel that is
      // still open, and a subscriber that tears the control down would take
      // this handler's own closeStylePanel lookup with it.
      // Fill is LayerControl-owned on the annotation flavour only (the gate
      // excludes delegated layers).
      resetLayerFill(ui, layerId);
      // Size is LayerControl-owned too: restore the author's radius and drop
      // the persisted value, so a reload does not re-apply it.
      resetLayerSize(ui, layerId);
      // Border is LayerControl-owned too: restore the author's stroke and drop
      // the persisted color / width, so a reload does not re-apply them.
      resetLayerBorder(ui, layerId);
      // Opacity and zoom range are LayerControl-owned in both flavours.
      // publish = false keeps their notify here, at the operation boundary.
      const moved: ProjectionDelta[] = [];
      for (const delta of [
        resetLayerOpacity(ui, layerId, false),
        resetLayerZoomRange(ui, layerId, false),
      ]) {
        if (delta) moved.push(delta);
      }
      if (delegated) {
        // Call each setter with its Python CONFIG default. The components own
        // the values — never write localStorage or annotation config here.
        const layerInfo = ui.c.layerRegistry.get(layerId);
        const setters = layerInfo?.styleSetters;
        const defaults = layerInfo?.styleDefaultsProvider?.() ?? {};
        if (setters) {
          for (const [key, setter] of Object.entries(setters)) {
            if (key in defaults) setter(defaults[key]);
          }
        }
      } else {
        // Labels are a LayerControl-owned dimension too: the reset drops the
        // layer's config entry rather than writing the defaults back in, so the
        // author's declared annotation shows through again and the drop is what
        // gets persisted (a reload does not restore the user's choice).
        resetStyleLabel(ui, layerId);
      }
      closeStylePanel(ui, true);
      // One notify for the whole operation, merged across its dimensions and
      // resolved against the registry at publish time: if the entry is gone
      // by then, the lookup returns nothing and nothing goes out.
      const settled = moved.reduce<ProjectionDelta>(
        (acc, d) => ({
          wroteVisible: acc.wroteVisible || d.wroteVisible,
          intentMoved: acc.intentMoved || d.intentMoved,
        }),
        NO_DELTA,
      );
      notifyDelta(ui, ui.c.layerRegistry.get(layerId), settled);
      return;
    }
    if (t.closest(".foliplus-panel-header")) closeStylePanel(ui, true);
  });

  item.style.position = "relative";
  item.appendChild(panel);
  pinRowPanel(panel, item);

  // Document capture dismiss (attrs recipe): disableClickPropagation on the
  // layer control stops bubble-phase mousedown from reaching document, so a
  // press on the map or another foliplus control would never close the
  // panel otherwise.
  ui.overlayPanel.styleOutsideHandler = (event: MouseEvent) => {
    // The drawer's overlay includes the scheme picker's portalled list: it is
    // mounted on <body> to paint above the drawer, so it is outside the panel's
    // subtree while still being part of the interaction. A press there must not
    // dismiss the drawer — that press is what selects a colour.
    if (isInsideOverlay(event.target, panel, SCHEME_PICKER_PORTAL_SELECTOR)) {
      ui.listPanel.pressInPanel = true;
      return;
    }
    ui.listPanel.pressInPanel = false;
    closeStylePanel(ui, false);
  };
  document.addEventListener("mousedown", ui.overlayPanel.styleOutsideHandler, true);

  // When the component's own panel changes a style value while this drawer is
  // open, pull the fresh values and refresh the controls. The shared module's
  // refresh reads from styleProvider and writes every control, skipping the
  // one under activeElement.
  if (delegated) {
    const bus = ui.c.events;
    const refresh = ui.overlayPanel.styleRefresh;
    ui.overlayPanel.styleUnsubscribe = bus.on(
      EVENTS.LAYER_STYLE_CHANGE,
      (payload: { id: string }) => {
        if (payload.id !== layerId) return;
        refresh?.();
      },
    );
  }

  // While the panel is open, a zoom change must move the current-zoom marker
  // on the zoom-range row and refresh its out-of-range state. The map-level
  // zoomend handler (ui.onZoomEnd) drives the sweep; it calls this hook after
  // the sweep settles so the notify below reads the new chrome. The same
  // hook also serves basemap switches, which re-price every layer's range
  // without firing zoomend — see listPanel/visibility.js.
  const zoomRangeRow = panel.querySelector(
    `.${CONST.CLASSES.STYLE_ZOOM_RANGE_ROW}`,
  ) as HTMLElement | null;
  if (zoomRangeRow) {
    ui.overlayPanel.styleZoomEndHandler = () => {
      if (zoomRangeRow.isConnected) syncZoomRangeRow(ui, layerId, zoomRangeRow);
    };
  }

  ui.overlayPanel.stylePanelLayerId = layerId;
};

/** Close the style panel. setFocus = true returns focus to the layer row. */
const closeStylePanel = (ui: LayerUI, setFocus: boolean): void => {
  // A pending apply frame (any face — fill / stroke / size / label) must land
  // before the panel disappears: closing is a commit boundary, not a cancel
  // (reset cancels explicitly). One hook covers every face, scoped to this UI
  // so another map's same-id frame is never flushed or dropped.
  if (ui.overlayPanel.stylePanelLayerId) {
    flushStyleDimApplies(ui.overlayPanel.stylePanelLayerId, ui);
  }
  if (ui.overlayPanel.styleOutsideHandler) {
    document.removeEventListener(
      "mousedown",
      ui.overlayPanel.styleOutsideHandler,
      true,
    );
    ui.overlayPanel.styleOutsideHandler = null;
  }
  ui.overlayPanel.stylePanelEl = null;
  ui.overlayPanel.styleUnsubscribe?.();
  ui.overlayPanel.styleUnsubscribe = null;
  ui.overlayPanel.styleRefresh = null;
  ui.overlayPanel.styleZoomEndHandler = null;
  // No panel, no panel press: a stale verdict would block the next real drag.
  ui.listPanel.pressInPanel = false;
  // Flushing the panel's live slider sessions can announce, and a subscriber
  // that destroys the manager mid-notify has already nulled the container.
  // Skip the lookup rather than deref null; the DOM is gone either way.
  const container = ui.uiContainer;
  const panel = container?.querySelector(
    `.${CONST.CLASSES.STYLE_PANEL}`,
  ) as HTMLElement | null;
  if (!panel) {
    ui.overlayPanel.stylePanelLayerId = null;
    return;
  }
  const item = panel.closest(CONST.SEL.LAYER_ITEM) as HTMLElement | null;
  // The ramp detail's scheme picker owns document-level listeners while its
  // listbox is open; the panel is being removed, so destroy it first or the
  // next open would leave a picker answering clicks for a dead trigger.
  disposeFillRow(ui);
  // The field cache survives close/reopen: it is invalidated by
  // onLayerItemCountChange when a layer's features actually change, not on
  // every close (re-collecting on each open would defeat the cache).
  // A live drag is a commit boundary too: the pointer already produced the
  // value, and removing the panel (and with it the pointer capture) would drop
  // the change event. Only a session that actually moved emits.
  finishSlidersIn(panel);
  ui.overlayPanel.stylePanelLayerId = null;
  unpinRowPanel(item);
  panel.remove();
  if (setFocus) item?.focus();
};

export { closeStylePanel, openStylePanel };

// Re-exports for external callers (menu.ts, attr.ts, ui/index.ts, tests):
// the style barrel still surfaces the same six symbols the pre-split
// ui/style.ts did — the split is invisible to consumers. The Label
// dimension rides along too: importing this barrel registers it.
export {
  applyStyleLabelState,
  invalidateFieldCache,
  invalidateFields,
  layerHasLabelFields,
} from "./label.js";
export { ANNOTATION_DIMENSION, layerCanLabel } from "./annotation.js";
export { layerHasStyleDelegation } from "./delegated.js";
export { replayFillState } from "./fill.js";
