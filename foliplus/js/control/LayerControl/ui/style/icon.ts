// LayerControl UI — per-layer marker icon dimension.
//
// One categorical field → one symbol per category, written by `setIcon` on
// every marker leaf. Mirrors the fill dimension's shape (a field selector
// plus a per-category legend), but the write is a direct Leaflet call rather
// than a `setStyle` face: a marker's icon is `options.icon`, not a style
// slice. `FACE.ICON` rides the same frame coalescer as `FACE.SIZE` (both
// are non-`setStyle` faces), so a burst of category edits lands one walk.
//
// v1 (this PR) produces two of the four forward-compatible sources:
// "author" (keep the author's icon — the row's default) and "symbol" (a
// built-in geometric shape from `SYMBOL_SHAPES`). "url" and "class" land in
// task-73. A category absent from the mapping keeps the author's icon —
// honest degradation, the same rule as the fill row's no-field default.
//
// The authored icon is captured, not cloned. `setIcon` mutates
// `options.icon`, so reading it back after a write would feed the leaf its
// own last write; the author's icon is captured once per leaf on the first
// write (a WeakMap keyed by leaf, so a re-rendering GeoJSON recaptures
// honestly) and is what Reset restores from. A leaf with no explicit icon
// falls back to `L.Icon.Default.prototype` (Leaflet's shared default), so
// Reset always has a target.
//
// The legend reuses the fill row's many-category pattern (必补 2): a
// scrollable per-category list with a "show all / collapse" affordance once
// the category count passes `ICON_LEGEND_BUDGET` — one row per category
// inline would grow unbounded.
import { categoricalPropertiesKeys, categoryDomain } from "#core/field.js";
import { CAP_TIER, DIM, walkLeaf } from "#core/layer/index.js";
import { buildFieldRow } from "#core/rampForm.js";
import { dom } from "#common/dom.js";
import { formRow } from "#ui/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { INTENT, type IconConfig, type IconIntent, getIntent } from "../intent.js";
import type { LayerUI } from "../surface.js";
import { layerFields } from "./label.js";
import { registerDimension, resetIntentKeys, writeIntentKeys } from "./registry.js";
import { FACE, cancelStyleDimApply, scheduleStyleDimApply } from "./styleBag.js";

/** Category count shown inline before the legend collapses (必补 2). */
const ICON_LEGEND_BUDGET = 8;

/** The curated geometric shapes, each an SVG divIcon with an explicit
 *  `fill` (no external CSS), `width` and `height`. The className
 *  `foliplus-marker-symbol--<shape>` is the test hook (browser tests assert
 *  on it); the shape itself carries the visual, not the class. */
const SYMBOL_SHAPES = [
  "circle",
  "square",
  "triangle",
  "diamond",
  "star",
  "pin",
  "flag",
  "cross",
] as const;
type SymbolShape = (typeof SYMBOL_SHAPES)[number];

// The fill colour is inlined (not `${...}` interpolated) because the build's
// SVGO pass rewrites SVG template literals and would mangle an interpolation.
const SYMBOL_SVG: Record<SymbolShape, string> = {
  circle: `<svg width="24" height="24" viewBox="0 0 24 24" fill="#3388ff"><circle cx="12" cy="12" r="9"/></svg>`,
  square: `<svg width="24" height="24" viewBox="0 0 24 24" fill="#3388ff"><rect x="4" y="4" width="16" height="16"/></svg>`,
  triangle: `<svg width="24" height="24" viewBox="0 0 24 24" fill="#3388ff"><polygon points="12,3 22,21 2,21"/></svg>`,
  diamond: `<svg width="24" height="24" viewBox="0 0 24 24" fill="#3388ff"><polygon points="12,2 22,12 12,22 2,12"/></svg>`,
  star: `<svg width="24" height="24" viewBox="0 0 24 24" fill="#3388ff"><polygon points="12,2 15,9 22,9 16,14 18,21 12,17 6,21 8,14 2,9 9,9"/></svg>`,
  pin: `<svg width="24" height="24" viewBox="0 0 24 24" fill="#3388ff"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/></svg>`,
  flag: `<svg width="24" height="24" viewBox="0 0 24 24" fill="#3388ff"><path d="M5 3v18h2v-7h10l-2-4 2-4H7V3z"/></svg>`,
  cross: `<svg width="24" height="24" viewBox="0 0 24 24" fill="#3388ff"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/></svg>`,
};

const isSymbolShape = (value: string): value is SymbolShape =>
  (SYMBOL_SHAPES as readonly string[]).includes(value);

/** Build the divIcon for one symbol. The SVG carries its own fill/size, so
 *  no stylesheet rule is required for the shape to paint. */
const buildSymbolIcon = (shape: SymbolShape): L.DivIcon =>
  L.divIcon({
    className: `foliplus-marker-symbol foliplus-marker-symbol--${shape}`,
    html: SYMBOL_SVG[shape],
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

/** The leaf probe for the icon axis: a runtime `setIcon` (a marker). Same
 *  guard as the capability probe — a throwing getter answers nothing. */
const isIconLeaf = (leaf: unknown): leaf is L.Marker =>
  typeof (leaf as { setIcon?: unknown }).setIcon === "function";

/** A leaf's `feature.properties` value for `field`, or undefined when the
 *  leaf carries no feature (or the field is absent). */
const featureValueOf = (leaf: unknown, field: string): unknown => {
  const props = (leaf as { feature?: { properties?: Record<string, unknown> } }).feature
    ?.properties;
  return props ? props[field] : undefined;
};

/** The author's icon per leaf — captured on the layer's first write, and by
 *  reset time the only copy of it (`setIcon` replaces `options.icon` in
 *  place). Keyed by leaf so a tree that replaces its children (a
 *  re-rendering GeoJSON) recaptures honestly. */
const authorIcon = new WeakMap<object, unknown>();

/** Capture a leaf's author icon once. A leaf with no explicit icon falls
 *  back to `L.Icon.Default.prototype` so Reset always has a target. */
const captureAuthorIcon = (leaf: object): void => {
  if (authorIcon.has(leaf)) return;
  const own = (leaf as { options?: { icon?: unknown } }).options?.icon;
  const proto =
    typeof L !== "undefined"
      ? ((L as { Icon?: { Default?: { prototype?: unknown } } }).Icon?.Default
          ?.prototype ?? undefined)
      : undefined;
  authorIcon.set(leaf, own ?? proto);
};

/** Resolve an icon source to a concrete Leaflet icon, or null when the
 *  source keeps the author's icon ("author") or is a later source
 *  ("url"/"class" — task-73). */
const iconFromIntent = (intent: IconIntent): L.DivIcon | null =>
  intent.kind === "symbol" && isSymbolShape(intent.value)
    ? buildSymbolIcon(intent.value)
    : null;

/** Whether the layer's surface can honestly carry a marker icon write. Same
 *  two-layer gate every other dimension uses: the layer must be in the
 *  registry, then `capabilities.icon === "native"`. */
const layerCanIcon = (ui: LayerUI, layerId: string): boolean => {
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (!layerInfo) return false;
  return ui.c.surfaceFor(layerInfo).capabilities.icon === CAP_TIER.NATIVE;
};

/** Categorical field names offered by the icon field picker. Same cache
 *  source as the fill's category arm — the annotation panel field cache
 *  first, a tree walk as the fallback. */
const categoricalFields = (ui: LayerUI, layerId: string): string[] => {
  const cached = layerFields(ui, layerId)
    .filter(field => !field.numeric)
    .map(field => field.name);
  if (cached.length > 0) return cached;
  const layerInfo = ui.c.layerRegistry.get(layerId);
  const layer = (layerInfo?.layer ?? ui.c.findLayer(layerId)) as L.Layer | null;
  return layer ? categoricalPropertiesKeys(layer) : [];
};

/** The per-category mapping for a field, derived in order so a category's
 *  symbol is stable across opens. */
const deriveMapping = (categories: string[]): Record<string, IconIntent> => {
  const mapping: Record<string, IconIntent> = {};
  categories.forEach((category, index) => {
    mapping[category] = {
      kind: "symbol",
      value: SYMBOL_SHAPES[index % SYMBOL_SHAPES.length],
    };
  });
  return mapping;
};

/** The config the row should show before the user has chosen a field: the
 *  stored config when present, else the first categorical field with its
 *  derived mapping. The map itself is untouched until the user writes (the
 *  stored-intent read in `applyIconToLayer` bails on a derived config), so
 *  an untouched layer keeps its author icons. */
const effectiveIconConfig = (ui: LayerUI, layerId: string): IconConfig => {
  const stored = getIntent(ui, layerId, INTENT.ICON);
  if (stored) return stored;
  const layer = ui.c.findLayer(layerId);
  const field = categoricalFields(ui, layerId)[0] ?? "";
  if (!layer || !field) return { field: "", mapping: {} };
  const { values } = categoryDomain(layer, field);
  return { field, mapping: deriveMapping(values) };
};

/** Apply the layer's stored icon config to every marker leaf, capturing each
 *  leaf's author icon on first write. A missing intent is a no-op — a layer
 *  the user never touched keeps exactly what the author declared. A leaf
 *  whose feature has no value for the field (or no mapping entry) is left
 *  alone, so a null category is honest rather than painted as a shape. */
const applyIconToLayer = (ui: LayerUI, layerId: string): void => {
  const config = getIntent(ui, layerId, INTENT.ICON);
  if (!config) return;
  const layer = ui.c.findLayer(layerId);
  if (!layer) return;
  walkLeaf(layer, leaf => {
    if (!isIconLeaf(leaf)) return;
    const value = featureValueOf(leaf, config.field);
    if (value === undefined || value === null) return;
    const intent = config.mapping[String(value)];
    if (!intent) return;
    const icon = iconFromIntent(intent);
    if (!icon) return;
    captureAuthorIcon(leaf);
    if ((leaf.options as { icon?: unknown } | undefined)?.icon === icon) return;
    leaf.setIcon(icon);
  });
};

/** Re-apply the layer's stored icon config to its current leaves, through
 *  the shared frame coalescer. */
const replayIconIntent = (ui: LayerUI, layerId: string): void => {
  scheduleStyleDimApply(FACE.ICON, layerId, () => applyIconToLayer(ui, layerId), {
    owner: ui,
  });
};

/** Commit the icon field selection: derive a full per-category mapping for
 *  the chosen field and write it. */
const commitIconField = (ui: LayerUI, layerId: string, field: string): void => {
  const layer = ui.c.findLayer(layerId);
  if (!layer) return;
  const { values } = categoryDomain(layer, field);
  writeIntentKeys(ui, layerId, [
    [INTENT.ICON, { field, mapping: deriveMapping(values) }],
  ]);
  replayIconIntent(ui, layerId);
};

/** Cycle one category's symbol to the next in the set (click-to-cycle). */
const cycleIconSymbol = (
  ui: LayerUI,
  layerId: string,
  field: string,
  category: string,
): void => {
  const config = getIntent(ui, layerId, INTENT.ICON) ?? { field, mapping: {} };
  const current = config.mapping[category];
  const currentIndex =
    current?.kind === "symbol"
      ? SYMBOL_SHAPES.indexOf(current.value as SymbolShape)
      : -1;
  const next = SYMBOL_SHAPES[(currentIndex + 1) % SYMBOL_SHAPES.length];
  const mapping = {
    ...config.mapping,
    [category]: { kind: "symbol", value: next } satisfies IconIntent,
  };
  writeIntentKeys(ui, layerId, [[INTENT.ICON, { field, mapping }]]);
  replayIconIntent(ui, layerId);
};

/** Reset the layer's icons to what the author drew and drop the persisted
 *  entry. The authored icons come from the WeakMap, never from a re-read — a
 *  re-read would restore the user's own choice, and a layer that never wrote
 *  has nothing to restore anyway. A walk queued by a trailing edit is
 *  cancelled before the leaves are touched. */
const resetLayerIcon = (ui: LayerUI, layerId: string): void => {
  if (!ui.c.layerRegistry.has(layerId)) return;
  resetIntentKeys(ui, layerId, [INTENT.ICON]);
  cancelStyleDimApply(FACE.ICON, layerId, ui);
  const layer = ui.c.findLayer(layerId);
  if (!layer) return;
  walkLeaf(layer, leaf => {
    if (!isIconLeaf(leaf)) return;
    const captured = authorIcon.get(leaf);
    if (captured !== undefined) {
      leaf.setIcon(captured as Parameters<L.Marker["setIcon"]>[0]);
    }
    authorIcon.delete(leaf);
  });
};

/** Build the per-category legend: a scrollable list of symbol rows, with a
 *  "show all / collapse" affordance once the count passes the budget. */
const buildIconLegend = (
  ui: LayerUI,
  layerId: string,
  config: IconConfig,
): HTMLElement => {
  const categories = Object.keys(config.mapping);
  const overBudget = categories.length > ICON_LEGEND_BUDGET;
  const shown = overBudget ? categories.slice(0, ICON_LEGEND_BUDGET) : categories;

  const list = dom.el("div", {
    class: CONST.CLASSES.STYLE_ICON_LEGEND_LIST,
  });
  for (const category of shown) {
    const intent = config.mapping[category];
    const html = iconFromIntent(intent)?.options?.html;
    const preview = typeof html === "string" ? html : "";
    list.append(
      dom.el(
        "button",
        {
          class: CONST.CLASSES.STYLE_ICON_LEGEND_ROW,
          type: "button",
          title: category,
        },
        { html: preview },
        dom.el("span", { class: CONST.CLASSES.STYLE_ICON_LEGEND_LABEL }, category),
      ),
    );
  }

  const legend = dom.el("div", { class: CONST.CLASSES.STYLE_ICON_LEGEND }, list);

  if (overBudget) {
    const toggle = dom.el(
      "button",
      { class: CONST.CLASSES.STYLE_ICON_LEGEND_TOGGLE, type: "button" },
      ui.T("style_icon_show_all"),
    );
    toggle.onclick = () => {
      const expanded = list.classList.toggle(CONST.CLASSES.STYLE_ICON_LEGEND_EXPANDED);
      toggle.textContent = expanded
        ? ui.T("style_icon_collapse")
        : ui.T("style_icon_show_all");
    };
    legend.append(toggle);
  }
  return legend;
};

/** Build the icon row, or null when the layer cannot carry a marker icon.
 *  A layer with no classifiable field gets an in-row empty state (必补 2
 *  shape), not a dead picker. */
const buildIconRow = (ui: LayerUI, layerId: string): HTMLElement | null => {
  if (!layerCanIcon(ui, layerId)) return null;
  const fields = categoricalFields(ui, layerId);
  if (fields.length === 0) {
    return formRow(
      ui.T("style_icon"),
      dom.el(
        "div",
        { class: CONST.CLASSES.STYLE_ICON_EMPTY },
        ui.T("style_icon_no_field"),
      ),
      CONST.CLASSES.STYLE_ICON_ROW,
    );
  }
  const config = effectiveIconConfig(ui, layerId);
  const { row } = buildFieldRow({
    label: ui.T("style_icon"),
    ariaLabel: ui.T("style_icon"),
    fields,
    value: config.field,
    rowClass: CONST.CLASSES.STYLE_ICON_ROW,
    onChange: field => commitIconField(ui, layerId, field),
  });
  row.append(buildIconLegend(ui, layerId, config));
  return row;
};

/** Register icon as a per-layer dimension. The descriptor owns the
 *  intent+persist slot; `commitIconField` / `resetLayerIcon` stay as thin
 *  delegates so the direct callers keep one entry point. */
const ICON_DIMENSION = registerDimension<IconConfig>({
  key: DIM.ICON,
  gate: layerCanIcon,
  value: (ui, layerId) => effectiveIconConfig(ui, layerId),
  row: (ui, layerId) => buildIconRow(ui, layerId) as HTMLElement,
  write: (ui, layerId, patch) => {
    writeIntentKeys(ui, layerId, [[INTENT.ICON, patch]]);
    replayIconIntent(ui, layerId);
  },
  reset: (ui, layerId) => resetLayerIcon(ui, layerId),
  valueSource: (ui, layerId) => {
    if (!layerCanIcon(ui, layerId)) return "none";
    return ui.intentStore.isUserSet(layerId, INTENT.ICON) ? "user" : "author";
  },
  contentChange: {
    kind: "frame",
    face: FACE.ICON,
    when: (ui, layerId) => getIntent(ui, layerId, INTENT.ICON) !== undefined,
    run: (ui, layerId) => applyIconToLayer(ui, layerId),
  },
});

export {
  ICON_DIMENSION,
  ICON_LEGEND_BUDGET,
  applyIconToLayer,
  buildIconRow,
  commitIconField,
  cycleIconSymbol,
  effectiveIconConfig,
  layerCanIcon,
  replayIconIntent,
  resetLayerIcon,
};
