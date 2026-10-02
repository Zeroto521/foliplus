// LayerControl UI —Layer attributes panel.
import { EVENTS } from "#core/event/index.js";
import { GEOM_TYPE, GROUP } from "#core/layer/index.js";
import { createRowPanel } from "#core/leaflet/panel.js";
import { dom } from "#common/dom.js";
import { formatNumber, formatTimestamp } from "#common/format.js";
import * as CONST from "../const.js";
import * as SVGs from "../icon.js";
import * as Util from "../util.js";
import { ATTRS_ROW_WRAP_CHARS } from "./context.js";
import type { LayerUI } from "./index.js";
import { displayName } from "./rowView.js";
import { closeOverlays } from "./teardown.js";

/**
 * Open the attributes panel for a given layer row: display-only metadata
 * (name, provenance, feature count, last update, visibility) plus any
 * third-party `meta` entries passed to registerLayer.
 *
 * Rows are omitted when they carry no value —a panel is not padded with
 * "�? The color basemap is included (it carries no provider data, but the
 * fixed rows still read).
 */
const openAttrsPanel = (ui: LayerUI, item: HTMLElement) => {
  closeOverlays(ui);

  const layerId = item.getAttribute(CONST.DATA.LAYER_ID) ?? "";
  const isColor = layerId === CONST.SOLID_BASEMAP_ID;
  const layerInfo = ui.manager.layerRegistry.get(layerId);

  // Row kind: a value that runs long (a URL source) drops below its label
  // and takes the full panel width instead of squeezing the label column.
  // Width is measured in the panel's own fixed type size, so a short
  // filename like `roads.shp` stays in the right-aligned value column.
  type AttrRow = [string, string, "wide" | ""];

  const isLong = (value: string): boolean => value.length > ATTRS_ROW_WRAP_CHARS;

  const rows: AttrRow[] = [];

  // Every row is built as label + resolved value; a row whose value is an
  // empty string is dropped. That covers both "no data registered" and
  // "updatedAt parses to nothing" —formatTimestamp returns "" for invalid
  // input, so an unparsable timestamp vanishes instead of leaving an
  // empty-value row.
  const addRow = (label: string, value: string, kind: AttrRow[2] = ""): void => {
    if (value) rows.push([label, value, kind]);
  };

  // Every field is listed by default; addRow drops a row whose value is
  // empty. The order mirrors how the layer row reads: type, feature count,
  // then provenance (source / created / updated).
  // Explicit no-carrier: color rows short-circuit above; a null here means
  // the entry declared no Leaflet layer (canvas/solid/custom), not a lazy miss.
  const layer = layerInfo?.layer ?? null;
  // The surface is the authority for the geometry probe; reading it here is
  // the snapshot sync, not a second source of truth. EMPTY means a container
  // with no data geometry; UNKNOWN means mixed/unrecognisable data.
  const rawGtype = layerInfo ? ui.manager.surfaceFor(layerInfo).geometryType() : null;
  const gtype = !rawGtype ? "unknown" : rawGtype;
  // A basemap has no data geometry, so name it by what it is rather than by
  // a geometry type it never had; a custom layer ships its own logo instead
  // of a geometry glyph —same rowView decision tree, same labels.
  const isBaseLayer = layerInfo
    ? layerInfo.group === GROUP.BASE
    : item.dataset.layerType === GROUP.BASE;
  const typeKey = isColor
    ? "type_color_map"
    : isBaseLayer
      ? "type_base"
      : layerInfo?.iconSvg
        ? "type_custom"
        : `type_${gtype}`;
  addRow(ui.T("attr_type"), ui.T(typeKey));
  if (!isColor) {
    const count = layerInfo ? ui.manager.getFeatureCount(layerId) : null;
    // The panel is the detail view, so the count is grouped (1,234) rather
    // than compacted —and `comma` defaults to one fraction digit, which
    // would render a whole number as "1,234.0", so pass 0 explicitly.
    addRow(
      ui.T("attr_feature_count"),
      count == null
        ? ui.T("attr_empty")
        : formatNumber(count, "comma", ui.config.locale_code, 0),
    );
  }
  addRow(
    ui.T("attr_source"),
    layerInfo?.source ?? "",
    isLong(layerInfo?.source ?? "") ? "wide" : "",
  );
  if (!isColor) {
    // First-registration time, recorded by the registry itself.
    addRow(ui.T("attr_created_at"), formatTimestamp(layerInfo?.registeredAt ?? ""));
    addRow(ui.T("attr_updated_at"), formatTimestamp(layerInfo?.updatedAt ?? ""));
  }

  const renderList = (listRows: AttrRow[]): HTMLElement =>
    dom.el(
      "dl",
      {},
      ...listRows.map(([label, value, kind]) =>
        dom.el(
          "div",
          {
            // Shared label/control geometry (common/panel.css), same as the
            // heatmap's form rows; the attrs class stays as the hook.
            class: ["foliplus-form-row", kind].filter(Boolean).join(" "),
          },
          // Label/value pair; `wide` drops the control onto its own line.
          dom.el("dt", { class: "foliplus-form-label" }, label),
          dom.el(
            "dd",
            {
              class: ["foliplus-form-control", kind].filter(Boolean).join(" "),
              title: value,
            },
            value,
          ),
        ),
      ),
    );

  // Third-party meta rows continue the same list —no heading, no separator:
  // the panel is one flat column of facts, in the same order every time.
  // Dynamic `metaProvider` entries override static `meta` for the same key
  // (dynamic wins, static is fallback).
  const buildMetaRows = (): AttrRow[] => {
    const merged: Record<string, string | number> = {
      ...(layerInfo?.meta ?? {}),
      ...(layerInfo?.metaProvider?.() ?? {}),
    };
    return Object.entries(merged)
      .filter(([, v]) => v != null && v !== "")
      .map(([key, value]) => [
        key,
        typeof value === "number"
          ? formatNumber(
              value,
              "comma",
              ui.config.locale_code,
              Number.isInteger(value) ? 0 : 1,
            )
          : String(value),
        "",
      ]);
  };
  const metaRows = buildMetaRows();

  const label = displayName(ui, layerId) || layerId;
  // iconSvg is the layer's own logo (basemaps and custom layers ship one);
  // otherwise fall back to the geometry glyph the layer row shows.
  const typeSvg =
    layerInfo?.iconSvg ??
    (isColor ? SVGs.COLOR : layer ? Util.getTypeSVG(gtype) : SVGs.UNKNOWN);

  // Shell (surface, header, content scroll) comes from the shared row-panel
  // factory, so this surface is built by the same code as the per-layer style
  // panel and neither can drift into a lookalike. Hover title is close_title
  // (Collapse), same as the main panel.
  const { panel, header, content } = createRowPanel({
    cssClass: CONST.CLASSES.ATTRS_PANEL,
    title: label,
    // The header names the layer; the dialog itself is named by what the
    // surface is, so a screen reader announces the panel, not the layer twice.
    ariaLabel: ui.T("attributes_layer"),
    iconSvg: typeSvg,
    closeTitle: ui.T("close_title"),
    iconClass: `${CONST.CLASSES.ATTRS_ICON} foliplus-header-icon`,
  });
  // One flat list: third-party meta rows continue the same rhythm instead
  // of opening a second group, so the panel reads as one column of facts �?
  // the same unheaded row flow the style panel uses.
  const dlEl = renderList([...rows, ...metaRows]);
  content.appendChild(dlEl);

  // Live update: subscribe to LAYER_ITEM_COUNT_CHANGE (filtered by layerId)
  // so meta rows refresh in place when the store mutates.
  if (!isColor && layerId && layerInfo?.metaProvider) {
    ui.attrsUnsubscribe = ui.events.on(EVENTS.LAYER_ITEM_COUNT_CHANGE, ({ id }) => {
      if (id !== layerId) return;
      dlEl.replaceWith(renderList([...rows, ...buildMetaRows()]));
    });
  }

  // Header click dismisses, matching bindPanelToggle on the main panels.
  // The × sits inside the header, so one listener covers both.
  header.addEventListener("click", () => closeAttrsPanel(ui, true));

  // The panel sits inside a draggable layer row: a press on the panel must
  // neither start a row drag nor inherit `user-select: none`. The mousedown is
  // stopped here (the row's own handlers live on the container), and which side
  // of the panel the press landed on is recorded by the outside handler below �?
  // `dragstart` is dispatched on the draggable row, so it cannot answer that.
  panel.addEventListener("mousedown", e => e.stopPropagation());

  item.style.position = "relative";
  item.appendChild(panel);

  // Document capture dismiss (attrs recipe): disableClickPropagation on the
  // layer control stops bubble-phase mousedown from reaching document, so a
  // press on the map or another foliplus control would never close the
  // panel otherwise. Capture also gives this handler the first look at every
  // press, which is what makes it the right place to record the drag verdict.
  ui.attrsOutsideHandler = (event: MouseEvent) => {
    const t = event.target as HTMLElement | null;
    // Document-level dispatch can name `document` itself —no closest().
    if (!t || typeof t.closest !== "function") {
      closeAttrsPanel(ui, false);
      return;
    }
    if (t.closest(`.${CONST.CLASSES.ATTRS_PANEL}`)) {
      ui.pressInPanel = true;
      return;
    }
    ui.pressInPanel = false;
    closeAttrsPanel(ui, false);
  };
  document.addEventListener("mousedown", ui.attrsOutsideHandler, true);

  ui.activeAttrsPanel = { item, panel, layerId };
};

/** Close the attributes panel. setFocus = true returns focus to the row. */

const closeAttrsPanel = (ui: LayerUI, setFocus: boolean) => {
  if (ui.attrsOutsideHandler) {
    document.removeEventListener("mousedown", ui.attrsOutsideHandler, true);
    ui.attrsOutsideHandler = null;
  }
  if (ui.attrsUnsubscribe) {
    ui.attrsUnsubscribe();
    ui.attrsUnsubscribe = null;
  }
  // No panel, no panel press: a stale verdict would block the next real drag.
  ui.pressInPanel = false;
  if (!ui.activeAttrsPanel) return;
  const item = ui.activeAttrsPanel.item;
  ui.activeAttrsPanel.panel.remove();
  ui.activeAttrsPanel = null;
  if (setFocus) item.focus();
};

/**
 * Turn the layer's label into an inline editable input so the user can
 * rename it. Enter/blur commits (non-empty), Escape cancels.
 *
 * The input replaces only the label's text node (the `<label>` element
 * stays in place), so layout / keyboard cursor focus is preserved. A
 * trailing space in the committed name would otherwise render as a zero-width
 * gap, so the value is trimmed on commit.
 */

export { openAttrsPanel, closeAttrsPanel };
