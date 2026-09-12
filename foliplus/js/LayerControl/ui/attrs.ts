// LayerControl UI —Layer attributes panel.
import { getGeometryType } from "#core/layer/index.js";
import { dom } from "#common/dom.js";
import { formatNumber } from "#common/format.js";
import * as Icons from "#common/icon.js";
import * as CONST from "../const.js";
import * as SVGs from "../icon.js";
import * as Util from "../util.js";
import { ATTRS_ROW_WRAP_CHARS } from "./context.js";
import { T } from "./context.js";
import { formatTimestamp } from "./context.js";
import type { LayerUI } from "./index.js";
import { colorLayerName } from "./list.js";
import { closeMoreMenu } from "./menu.js";
import { finishRename } from "./rename.js";

/**
 * Open the attributes panel for a given layer row: display-only metadata
 * (name, provenance, feature count, last update, visibility) plus any
 * third-party `meta` entries passed to registerLayer.
 *
 * Rows are omitted when they carry no value —a panel is not padded with
 * "—. The color basemap is included (it carries no provider data, but the
 * fixed rows still read).
 */
const openAttrsPanel = (ui: LayerUI, item: HTMLElement) => {
  finishRename(ui);
  closeMoreMenu(ui, true);
  closeAttrsPanel(ui, false);

  const layerId = item.getAttribute(CONST.DATA.LAYER_ID) ?? "";
  const isColor = item.classList.contains(CONST.CLASSES.COLOR_ITEM);
  const layerInfo = isColor ? null : ui.manager.layerRegistry.get(layerId);

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
  const layer = layerInfo?.layer ?? null;
  // getGeometryType returns EMPTY for a container with no data geometry and
  // UNKNOWN for mixed/unrecognisable data —both have locale keys.
  const rawGtype = layerInfo?.type ?? (layer ? getGeometryType(layer) : null);
  const gtype = !rawGtype ? "unknown" : rawGtype;
  // A basemap has no data geometry, so name it by what it is rather than by
  // a geometry type it never had.
  const isBase = layerInfo?.isBase ?? item.dataset.layerType === "base";
  const typeKey = isColor ? "type_color_map" : isBase ? "type_base" : `type_${gtype}`;
  addRow(T("attr_type"), T(typeKey));
  if (!isColor) {
    const count = layerInfo ? ui.manager.getFeatureCount(layerId) : null;
    // The panel is the detail view, so the count is grouped (1,234) rather
    // than compacted —and `comma` defaults to one fraction digit, which
    // would render a whole number as "1,234.0", so pass 0 explicitly.
    addRow(
      T("attr_feature_count"),
      count == null
        ? T("attr_empty")
        : formatNumber(count, "comma", CONF.locale_code, 0),
    );
  }
  addRow(
    T("attr_source"),
    layerInfo?.source ?? "",
    isLong(layerInfo?.source ?? "") ? "wide" : "",
  );
  if (!isColor) {
    // First-registration time, recorded by the registry itself.
    addRow(T("attr_created_at"), formatTimestamp(layerInfo?.registeredAt ?? ""));
    addRow(T("attr_updated_at"), formatTimestamp(layerInfo?.updatedAt ?? ""));
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
  const metaEntries = Object.entries(layerInfo?.meta ?? {}).filter(
    ([, v]) => v != null && v !== "",
  );
  const metaRows: AttrRow[] = metaEntries.map(([key, value]) => [
    key,
    typeof value === "number"
      ? // Integers group without a trailing ".0"; decimals keep one digit.
        formatNumber(value, "comma", CONF.locale_code, Number.isInteger(value) ? 0 : 1)
      : String(value),
    "",
  ]);

  const displayName = isColor ? colorLayerName(ui) : (layerInfo?.name ?? layerId);
  // iconSvg is the layer's own logo (basemaps and custom layers ship one);
  // otherwise fall back to the geometry glyph the layer row shows.
  const typeSvg =
    layerInfo?.iconSvg ??
    (isColor ? SVGs.COLOR : layer ? Util.getTypeSVG(layer, gtype) : SVGs.UNKNOWN);

  const closeBtn = dom.el(
    "button",
    {
      // The shared header close affordance —same classes as the layer
      // panel's own 脳, so position, size and hover are identical.
      class: "foliplus-ctrl-btn foliplus-close-btn",
      type: "button",
      title: T("close_title"),
      "aria-label": T("close_title"),
    },
    // The same CLOSE glyph the layer panel's header uses (not a text "脳").
    { html: Icons.CLOSE },
  );

  const panel = dom.el(
    "div",
    {
      // `foliplus-panel` pulls in the shared panel vocabulary, so the
      // attributes surface is styled by the same rules as every other panel
      // (header bar, content scroll) instead of a lookalike.
      class: `${CONST.CLASSES.ATTRS_PANEL} foliplus-panel`,
      role: "dialog",
      "aria-label": T("attributes_layer"),
    },
    // Header bar —literally the shared panel header: the type logo sits
    // inside the title (as in the layer panel) and the 脳 is the shared
    // close button, so both line up with every other foliplus panel.
    // Hover title is close_title (鏀惰捣 / Collapse), same as the main panel.
    dom.el(
      "div",
      { class: "foliplus-panel-header", title: T("close_title") },
      dom.el(
        "span",
        { class: "foliplus-header-title" },
        dom.el(
          "span",
          {
            class: `${CONST.CLASSES.ATTRS_ICON} foliplus-header-icon`,
            "aria-hidden": "true",
          },
          { html: typeSvg },
        ),
        displayName,
      ),
      closeBtn,
    ),
    // One flat list: third-party meta rows continue the same rhythm instead
    // of opening a second group, so the panel reads as one column of facts.
    dom.el(
      "div",
      { class: "foliplus-panel-content" },
      renderList([...rows, ...metaRows]),
    ),
  );

  // Header click dismisses, matching bindPanelToggle on the main panels.
  // The 脳 sits inside the header, so one listener covers both.
  panel
    .querySelector(".foliplus-panel-header")
    ?.addEventListener("click", () => closeAttrsPanel(ui, true));

  // The panel sits inside a draggable layer row: a press on the panel must
  // neither start a row drag nor inherit `user-select: none`. Capture-phase
  // stop keeps HTML5 drag from treating the press as a drag candidate.
  panel.addEventListener("mousedown", e => e.stopPropagation());
  panel.addEventListener("dragstart", e => {
    if (e.target instanceof Node && panel.contains(e.target)) e.preventDefault();
  });

  item.style.position = "relative";
  item.appendChild(panel);

  // Document capture dismiss: disableClickPropagation on the layer control
  // stops bubble-phase mousedown from reaching document, so a press on the
  // map or another foliplus control would never close the panel otherwise.
  ui.attrsOutsideHandler = (event: MouseEvent) => {
    const t = event.target as HTMLElement | null;
    // Document-level dispatch can name `document` itself —no closest().
    if (!t || typeof t.closest !== "function") {
      closeAttrsPanel(ui, false);
      return;
    }
    if (t.closest(`.${CONST.CLASSES.ATTRS_PANEL}`)) return;
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
