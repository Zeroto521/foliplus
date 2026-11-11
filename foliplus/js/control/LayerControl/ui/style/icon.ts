// LayerControl UI — per-layer marker icon dimension (DOM/panel layer).
//
// The icon dimension has two modes, like the fill: a WHOLE-LAYER single glyph
// (one glyph for every marker leaf) or a field-driven glyph ramp (by value).
// A single-layer icon is the original icon dimension; by value classifies a
// numeric or categorical field and paints one glyph per class.
//
// The write is a direct Leaflet call rather than a `setStyle` face: a
// marker's icon is `options.icon`, not a style slice. `FACE.ICON` rides the
// same frame coalescer as `FACE.SIZE` (both are non-`setStyle` faces), so a
// burst of edits lands one walk.
//
// The Leaflet-facing half (capture / derive / apply / reset walks) lives in
// core/leaflet/markerIcon.ts; this file keeps only the intent slot, the FACE
// schedule and the panel/mode/detail DOM.
import {
  ICON_KIND,
  ICON_MODE,
  INTENT,
  type IconIntent,
  type IconMode,
  type IconValueConfig,
  type IntentKey,
  getIntent,
} from "../intent.js";
import type { LayerUI } from "../surface.js";
import { layerFields } from "./label.js";
import {
  getDimension,
  registerDimension,
  resetIntentKeys,
  writeIntentKeys,
} from "./registry.js";
import { buildModeRow } from "./row.js";
import { FACE, cancelStyleDimApply, scheduleStyleDimApply } from "./styleBag.js";
import { ListCursor, claimKeys } from "#core/interaction/index.js";
import { CAP_TIER, DIM } from "#core/layer/index.js";
import {
  type AuthorGlyph,
  GLYPH_SCHEME_DEFAULT,
  GLYPH_SCHEME_ORDER,
  type GlyphPrefix,
  PICKER_GLYPHS,
  applyIconByValueToLeaves,
  applyIconColorToLeaves,
  applyIconToLeaves,
  authorGlyphName as authorGlyphNameOnLayer,
  authorGlyphPrefix as authorGlyphPrefixOnLayer,
  coerceGlyphPrefix,
  glyphAvailable,
  glyphHtml,
  glyphScheme,
  resetIconLeaves,
  resolveGlyph,
} from "#core/leaflet/index.js";
import { ensureOverlayRegistry } from "#core/overlay/index.js";
import {
  CLASS_COUNT,
  CLASS_COUNT_VALUES,
  METHOD,
  VALUE_KIND,
  buildClassesRow,
  buildFieldRow,
  numericPropertiesKeys,
  resolveField,
} from "#core/value/index.js";
import { dom } from "#platform/dom.js";
import { dropdownSurface } from "#platform/fullscreen.js";
import {
  POPUP_OVERLAY_RANK,
  createDropdown,
  dropdownOverlay,
  formRow,
  nextOptionId,
  selectInput,
} from "#ui/index.js";
import * as CONST from "#control/LayerControl/const.js";

/** Grid columns for the glyph picker popup. */
const GLYPH_GRID_COLS = 8;

/** The icon dimension's three intent keys — one cohesive reset (single glyph
 *  + by-value config + mode) so a reset cannot leave a stale mode/value pair. */
const ICON_INTENT_KEYS = [INTENT.ICON, INTENT.ICON_VALUE, INTENT.ICON_MODE];

/** The row gate: the layer must be in the registry, then its surface must
 *  declare the icon capability (a marker icon is not a `setStyle` face, so
 *  the capability slot is the one honest answer). */
const layerCanIcon = (ui: LayerUI, layerId: string): boolean => {
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (!layerInfo) return false;
  return ui.c.surfaceFor(layerInfo).capabilities.icon === CAP_TIER.NATIVE;
};

/** Numeric field names offered by the by-value field picker. The label
 *  panel's field cache is the primary source (it is already computed and
 *  invalidated with the layer's features); a tree walk is the fallback for a
 *  layer whose cache has not been populated yet. Order is first-seen, so the
 *  default option is stable across opens. */
const iconFields = (ui: LayerUI, layerId: string): string[] => {
  const cached = layerFields(ui, layerId)
    .filter(field => field.numeric)
    .map(field => field.name);
  if (cached.length > 0) return cached;
  // Snapshot-then-resolve, the same late-binding defense the fill apply
  // uses: the registry's reference is stable once populated, and findLayer
  // re-resolves a folium layer whose registry reference is still null.
  /* v8 ignore next -- defensive: the registry reference is stable once populated; a null layerInfo/.layer is the same late-binding guard the fill applies, never a state this flow produces */
  const layerInfo = ui.c.layerRegistry.get(layerId);
  /* v8 ignore next -- defensive: a null layerInfo/.layer and an unknown layer id both read as no fields; never a state a registered layer reaches */
  const layer = (layerInfo?.layer ?? ui.c.findLayer(layerId)) as L.Layer | null;
  /* v8 ignore next -- defensive: an unknown layer id reads as no fields, not a state a registered layer reaches */
  return layer ? numericPropertiesKeys(layer) : [];
};

/** Resolve a stored value config's field against the fields the layer offers
 *  right now. Display, the dimension's value and the paint path all go through
 *  this, so a stale stored name cannot make the panel show one column while
 *  the map paints by the author's face. The stored record keeps its name until
 *  the next write — the column may come back. */
const resolvedIconValue = (
  ui: LayerUI,
  layerId: string,
  value: IconValueConfig | undefined,
): IconValueConfig | undefined =>
  value === undefined
    ? undefined
    : {
        ...value,
        field: resolveField(value.field, iconFields(ui, layerId)),
      };

/** The current glyph name for the row, or null when the layer still shows
 *  the author's icon (uncovered). */
const currentGlyph = (ui: LayerUI, layerId: string): string | null => {
  const intent = getIntent(ui, layerId, INTENT.ICON);
  return intent?.kind === ICON_KIND.GLYPH ? intent.value : null;
};

/** The author's own glyph name when the layer's marker icon declares one
 *  (awesome-markers/Leaflet put the name in
 *  `leaf.options.icon.options.icon`). Used for the row preview only — the
 *  write semantics are unchanged: an uncovered layer keeps the author icon.
 *  Walks leaves and returns the first declared name with its syntax verdict
 *  (a valid name wins, else the first invalid declaration so a typo is never
 *  silently dropped), or null when no leaf declares a string icon name. */
const authorGlyphName = (ui: LayerUI, layerId: string): AuthorGlyph | null => {
  const layer = ui.c.findLayer(layerId);
  if (!layer) return null;
  return authorGlyphNameOnLayer(layer);
};
/** The author's FontAwesome family prefix for the layer (see authorGlyphPrefixOnLayer).
 *  Returns null when the layer declares no prefix — callers then fall back to
 *  the panel's fa-solid family. */
const authorGlyphPrefix = (ui: LayerUI, layerId: string): string | null => {
  const layer = ui.c.findLayer(layerId);
  if (!layer) return null;
  return authorGlyphPrefixOnLayer(layer);
};

/** The active icon mode. Absence reads as single: a record written before the
 *  by-value mode existed has no iconMode, and its icon (single) is what it
 *  painted. A stored value config with no explicit mode is the pre-mode
 *  record shape (the user already classified). */
const displayIconMode = (ui: LayerUI, layerId: string): IconMode => {
  const stored = getIntent(ui, layerId, INTENT.ICON_MODE);
  if (stored !== undefined) return stored;
  return getIntent(ui, layerId, INTENT.ICON_VALUE) !== undefined
    ? ICON_MODE.BY_VALUE
    : ICON_MODE.SINGLE;
};

/** The config the value detail displays and writes from — one chain:
 *  the user's intent, else the seed. A stored field the current data no
 *  longer offers is resolved to the first offered field through the shared
 *  resolveField rule — the same rule the paint side uses, so the row and
 *  the map cannot disagree about which column is in use. */
const valueForIconValue = (
  ui: LayerUI,
  layerId: string,
  fields: readonly string[],
): IconValueConfig => {
  const stored = resolvedIconValue(
    ui,
    layerId,
    getIntent(ui, layerId, INTENT.ICON_VALUE),
  );
  if (stored) return stored;
  // Every caller reaches this line with a non-empty list: the detail only
  // renders the by-value mode when a numeric field exists, and the mode write
  // bails first when it does not.
  return {
    kind: VALUE_KIND.NUMERIC,
    field: fields[0],
    method: METHOD.JENKS,
    classes: CLASS_COUNT.DEFAULT,
    glyphs: [...glyphScheme(GLYPH_SCHEME_DEFAULT)!],
  };
};

/** Clamp a stored class count to the editable 2..9 vocabulary. A persisted
 *  value with an out-of-range count is a stale record; the row shows the
 *  clamped count (and the map paints by it). */
const persistedIconValue = (value: IconValueConfig): IconValueConfig => ({
  ...value,
  classes: Math.min(CLASS_COUNT.MAX, Math.max(CLASS_COUNT.MIN, value.classes)),
});

/** Display label for one classification method. Written as literal T()
 *  calls rather than `T(`style_method_${method}`)`: the locale-usage scanner
 *  only sees literal keys, and a template-built key would let a renamed locale
 *  entry pass silently. */
const methodLabel = (ui: LayerUI, method: IconValueConfig["method"]): string => {
  switch (method) {
    case METHOD.JENKS:
      return ui.T("style_method_jenks");
    case METHOD.QUANTILE:
      return ui.T("style_method_quantile");
    case METHOD.EQUAL:
      return ui.T("style_method_equal");
    case METHOD.HEADS:
      return ui.T("style_method_heads");
  }
  /* v8 ignore next -- exhaustive: every ClassifyMethod case returns above */
  return ui.T("style_method_jenks");
};

/** The scheme name for a glyph list: the scheme whose glyph table deep-equals
 *  the stored list, else the default. A user-built glyph list that is not one
 *  of the three schemes still reads as the default — the next scheme write
 *  replaces it. */
const schemeOf = (glyphs: readonly string[]): string => {
  for (const name of GLYPH_SCHEME_ORDER) {
    const scheme = glyphScheme(name);
    if (
      scheme?.length === glyphs.length &&
      scheme.every((glyph, index) => glyph === glyphs[index])
    ) {
      return name;
    }
  }
  return GLYPH_SCHEME_DEFAULT;
};

/** Merge one value-detail change into the stored config and schedule the
 *  per-leaf repaint through the dimension write. Returns the config that was
 *  written so the caller can keep the controls in sync. */
const writeIconValue = (
  ui: LayerUI,
  layerId: string,
  patch: Partial<IconValueConfig>,
): IconValueConfig => {
  const fields = iconFields(ui, layerId);
  const next: IconValueConfig = persistedIconValue({
    ...valueForIconValue(ui, layerId, fields),
    ...patch,
  });
  getDimension(DIM.ICON)!.write!(ui, layerId, {
    mode: ICON_MODE.BY_VALUE,
    value: next,
  });
  return next;
};

/** Write the mode intent, seeding the value config when the user switches to
 *  the by-value mode and none is stored yet. Single keeps whatever value config
 *  the other mode holds — a mode alone — so a switch back to by-value restores
 *  its own state. */
const writeIconMode = (ui: LayerUI, layerId: string, mode: IconMode): boolean => {
  if (mode !== ICON_MODE.BY_VALUE) {
    getDimension(DIM.ICON)!.write!(ui, layerId, { mode });
    return true;
  }
  const fields = iconFields(ui, layerId);
  /* v8 ignore next -- defensive: the by-value mode is only offered when the layer has a numeric field, so zero fields here is an impossible panel state */
  if (fields.length === 0) return false;
  getDimension(DIM.ICON)!.write!(ui, layerId, {
    mode,
    value: persistedIconValue(valueForIconValue(ui, layerId, fields)),
  });
  return true;
};

/** Apply the layer's stored icon mode to every marker leaf, capturing each
 *  leaf's author icon on first write. A missing intent is a no-op — a layer
 *  the user never touched keeps exactly what the author declared.
 *
 *  The two modes are mutually exclusive on apply: the stored iconMode decides
 *  which one runs, and a stored value config with no explicit mode (the
 *  pre-mode record shape) runs the by-value mode. */
const applyIconToLayer = (ui: LayerUI, layerId: string): void => {
  const layer = ui.c.findLayer(layerId);
  if (!layer) return;
  const mode = displayIconMode(ui, layerId);
  // Merge the current marker color + opacity into the SAME derived-icon
  // construction (the color is a separate dimension, but setIcon
  // replaces the whole icon, so a glyph edit must carry the current
  // color and a color edit must carry the current glyph).
  const color = getIntent(ui, layerId, INTENT.ICON_COLOR);
  const opacity = getIntent(ui, layerId, INTENT.ICON_COLOR_OPACITY);

  if (mode === ICON_MODE.BY_VALUE) {
    const value = resolvedIconValue(
      ui,
      layerId,
      getIntent(ui, layerId, INTENT.ICON_VALUE),
    );
    if (value) {
      applyIconByValueToLeaves(
        layer,
        value,
        typeof color === "string" ? color : undefined,
        typeof opacity === "number" ? opacity : undefined,
      );
    }
    return;
  }

  const intent = getIntent(ui, layerId, INTENT.ICON);
  if (intent?.kind === ICON_KIND.GLYPH) {
    applyIconToLeaves(
      layer,
      intent.value,
      typeof color === "string" ? color : undefined,
      typeof opacity === "number" ? opacity : undefined,
      coerceGlyphPrefix(ui.config.icon_prefix ?? undefined),
    );
    return;
  }
  // No single glyph is stored. A switch back from the by-value mode must
  // restore the author icons — the by-value walk already painted the leaves,
  // and a bare return would leave them by-value coloured with no single glyph
  // to paint over them.
  resetIconLeaves(layer);
};

/** Write the layer's glyph and replay the walk (single mode). Also records the
 *  mode so a later switch to by-value and back restores the single glyph. */
const commitGlyph = (ui: LayerUI, layerId: string, glyph: string): void => {
  writeIntentKeys(ui, layerId, [
    [INTENT.ICON, { kind: ICON_KIND.GLYPH, value: glyph }],
    [INTENT.ICON_MODE, ICON_MODE.SINGLE],
  ]);
  scheduleStyleDimApply(FACE.ICON, layerId, () => applyIconToLayer(ui, layerId), {
    owner: ui,
  });
};

/** Reset the layer's icons to what the author drew and drop the persisted
 *  entry. The authored icons come from the core capture table, never from a
 *  re-read — a re-read would restore the user's own choice, and a layer that
 *  never wrote has nothing to restore anyway. A walk queued by a trailing
 *  edit is cancelled before the leaves are touched.
 *
 *  The color is a separate dimension — it is NOT cleared here. A user-set
 *  marker color survives a glyph reset: the author icons are restored first,
 *  then the surviving color is re-derived on them so the color and the glyph
 *  never split across two writes. */
const resetLayerIcon = (ui: LayerUI, layerId: string): void => {
  if (!ui.c.layerRegistry.has(layerId)) return;
  resetIntentKeys(ui, layerId, ICON_INTENT_KEYS);
  cancelStyleDimApply(FACE.ICON, layerId, ui);
  const layer = ui.c.findLayer(layerId);
  if (!layer) return;
  resetIconLeaves(layer);
  const color = getIntent(ui, layerId, INTENT.ICON_COLOR);
  const opacity = getIntent(ui, layerId, INTENT.ICON_COLOR_OPACITY);
  if (typeof color === "string") {
    applyIconColorToLeaves(
      layer,
      color,
      currentGlyph(ui, layerId),
      typeof opacity === "number" ? opacity : undefined,
      authorGlyphPrefix(ui, layerId) ??
        coerceGlyphPrefix(ui.config.icon_prefix ?? undefined),
    );
  }
};

/** Build the by-value detail: field row + method/classes row + glyph scheme
 *  row. The field row offers the layer's numeric fields; the glyph scheme row
 *  is a simple select over the shared scheme table (SHAPES / DIRECTIONS /
 *  STATUS). Returns the DOM rows so the caller can append them to the detail
 *  slot. */
const buildValueDetail = (
  ui: LayerUI,
  layerId: string,
  fields: readonly string[],
  value: IconValueConfig,
): HTMLElement[] => {
  const field = buildFieldRow({
    label: ui.T("style_icon_field"),
    ariaLabel: ui.T("style_icon_field"),
    fields,
    value: resolveField(value.field, fields),
    rowClass: CONST.CLASSES.STYLE_ICON_ROW,
    selectClass: CONST.CLASSES.STYLE_ICON_FIELD_SELECT,
    surface: dropdownSurface(ui.c.map.getContainer()),
    overlay: dropdownOverlay(ensureOverlayRegistry(ui.c.map)),
  });

  const classes = buildClassesRow({
    label: ui.T("style_method"),
    methodAriaLabel: ui.T("style_method"),
    classesAriaLabel: ui.T("style_icon_classes"),
    methodValue: value.method,
    classesValue: value.classes,
    methodLabel: method => methodLabel(ui, method),
    rowClass: CONST.CLASSES.STYLE_ICON_ROW,
    methodClass: CONST.CLASSES.STYLE_ICON_METHOD_SELECT,
    classesClass: CONST.CLASSES.STYLE_ICON_CLASSES_SELECT,
    surface: dropdownSurface(ui.c.map.getContainer()),
  });
  // The stored record may carry a class count outside the editable 2..9
  // vocabulary: show that count as its own option so the row states the count
  // the map paints. The first user pick replaces it with a normal 2..9 value.
  if (!CLASS_COUNT_VALUES.includes(value.classes)) {
    const option = document.createElement("option");
    option.value = String(value.classes);
    option.textContent = String(value.classes);
    option.title = ui.T("style_icon_classes_out_of_range");
    classes.classesSelect.append(option);
    classes.classesSelect.value = String(value.classes);
    classes.classesDropdown.refresh();
    classes.classesDropdown.setHint(ui.T("style_icon_classes_out_of_range"));
  }

  // Glyph scheme: a simple native select (like the field row) over the shared
  // scheme table. Its value is the scheme whose glyph table equals the stored
  // glyphs, else the default. A scheme pick replaces the glyph list wholesale.
  const schemeSelect = selectInput({
    className: CONST.CLASSES.STYLE_ICON_SCHEME_SELECT,
    ariaLabel: ui.T("style_icon_scheme"),
    value: schemeOf(value.glyphs),
    options: GLYPH_SCHEME_ORDER.map(name => ({ value: name, label: name })),
  });
  const schemeDropdown = createDropdown({
    nativeSelect: schemeSelect,
    ariaLabel: ui.T("style_icon_scheme"),
    ...dropdownSurface(ui.c.map.getContainer()),
  });
  const schemeRow = formRow(
    ui.T("style_icon_scheme"),
    schemeDropdown.element,
    CONST.CLASSES.STYLE_ICON_ROW,
  );

  return [field.row, classes.row, schemeRow];
};

/** Build the single-glyph detail: the trigger button (shows the current glyph
 *  or the author-original label) plus the grid picker popup. */
const buildSingleDetail = (ui: LayerUI, layerId: string): HTMLElement => {
  const trigger = dom.el("button", {
    class: `${CONST.CLASSES.STYLE_ICON_TRIGGER} foliplus-input-skin foliplus-form-select`,
    type: "button",
    "aria-haspopup": "grid",
    "aria-label": ui.T("style_icon"),
  }) as HTMLButtonElement;

  const glyphBox = dom.el("span", {
    class: CONST.CLASSES.STYLE_ICON_TRIGGER_GLYPH,
  }) as HTMLSpanElement;
  const nameBox = dom.el("span", {
    class: CONST.CLASSES.STYLE_ICON_TRIGGER_NAME,
  }) as HTMLSpanElement;
  trigger.append(glyphBox, nameBox);

  const renderTrigger = () => {
    // Covered: the user's glyph. Uncovered: the author's declared glyph
    // (preview only — the write is still the author icon), else the
    // author-original label.
    const userGlyph = currentGlyph(ui, layerId);
    const author = userGlyph ? null : authorGlyphName(ui, layerId);
    const authorPrefix = userGlyph ? null : authorGlyphPrefix(ui, layerId);
    const value = userGlyph ?? author?.name ?? null;
    const panelPrefix: string =
      authorPrefix ?? coerceGlyphPrefix(ui.config.icon_prefix ?? undefined);
    const glyph = value ? resolveGlyph(value) : null;
    // The user's picked/persisted glyph renders in the panel's fa-solid family;
    // an author-declared glyph renders under the author's own prefix
    // (awesome-markers paints `prefix + " " + icon`) — probe the SAME stack so
    // a name the map actually draws is never reported unavailable.
    const available = glyph ? glyphAvailable(glyph, panelPrefix) : false;
    // An author-declared name that fails glyph syntax is NEVER renderable, no
    // matter what the stylesheet paints — it gets its own unavailable state
    // rather than silently reading as the author-original label.
    const authorInvalid = !userGlyph && author !== null && !author.valid;
    if (value && glyph && available && !authorInvalid) {
      // The name is syntactically valid AND the loaded stylesheet paints it:
      // the happy path — show the glyph and its name.
      glyphBox.innerHTML = glyphHtml(glyph, "", "", panelPrefix);
      nameBox.textContent = glyph;
      trigger.title = value;
      trigger.classList.remove(CONST.CLASSES.STYLE_ICON_TRIGGER_UNAVAILABLE);
    } else if (value) {
      // A name we cannot render. Two distinct reasons, two messages: an
      // author-invalid name (syntax failed — a typo, never paintable) vs a
      // syntactically valid name the loaded stylesheet does not paint.
      // Never silently show "Original" or a blank tofu — surface the actual
      // name in an explicit unavailable state (dashed-outline circle preview)
      // with a title/aria-label explaining the fallback.
      glyphBox.innerHTML = `<span class="${CONST.CLASSES.STYLE_ICON_UNAVAILABLE_GLYPH}" aria-hidden="true"></span>`;
      nameBox.textContent = value;
      const hint = (
        authorInvalid ? ui.T("style_icon_invalid") : ui.T("style_icon_unavailable")
      ).replace("{name}", value);
      trigger.title = hint;
      trigger.setAttribute("aria-label", hint);
      trigger.classList.add(CONST.CLASSES.STYLE_ICON_TRIGGER_UNAVAILABLE);
    } else {
      // No user glyph and no author-declared name: the true author-original
      // label. (An author-invalid declaration never reaches here — author.name
      // is non-null, so value is non-null and the unavailable branch above owns it.)
      glyphBox.innerHTML = "";
      nameBox.textContent = ui.T("style_icon_original");
      trigger.title = ui.T("style_icon_original");
      trigger.classList.remove(CONST.CLASSES.STYLE_ICON_TRIGGER_UNAVAILABLE);
    }
  };
  renderTrigger();

  const row = formRow(ui.T("style_icon"), trigger, CONST.CLASSES.STYLE_ICON_ROW);
  bindGlyphGrid(ui, layerId, trigger, row, renderTrigger);
  return row;
};

/** Build the icon row. The row is a mode row (single / by value) with the
 *  active mode's detail beneath it. A layer with no numeric field offers only
 *  the single mode — there is nothing to classify, so offering a disabled
 *  "Icon by value" option would just be noise. */
const buildIconRow = (ui: LayerUI, layerId: string): HTMLElement | null => {
  if (!layerCanIcon(ui, layerId)) return null;

  const fields = iconFields(ui, layerId);
  const mode = displayIconMode(ui, layerId);
  const options = [
    { value: ICON_MODE.SINGLE, label: ui.T("style_icon_single") },
    ...(fields.length > 0
      ? [{ value: ICON_MODE.BY_VALUE, label: ui.T("style_icon_by_value") }]
      : []),
  ];

  const { block: modeRow, detail } = buildModeRow({
    label: ui.T("style_icon_mode"),
    selectClass: CONST.CLASSES.STYLE_ICON_MODE_SELECT,
    rowClass: CONST.CLASSES.STYLE_ICON_ROW,
    detailClass: CONST.CLASSES.STYLE_ICON_DETAIL,
    value: mode,
    options,
    surface: dropdownSurface(ui.c.map.getContainer()),
  });

  renderIconDetail(ui, layerId, detail, mode);
  const block = dom.el(
    "div",
    { class: CONST.CLASSES.STYLE_ICON_BLOCK },
    modeRow,
    detail,
  );
  // Self-managed mode switch: compare against the DISPLAY mode (what the
  // select shows) so re-selecting the same mode does not re-write it. A
  // switch re-renders and re-binds the detail slot in place.
  const select = block.querySelector(
    `.${CONST.CLASSES.STYLE_ICON_MODE_SELECT}`,
  ) as HTMLSelectElement | null;
  if (select) {
    select.onchange = () => {
      const previous = displayIconMode(ui, layerId);
      const next = select.value as IconMode;
      if (next === previous) return;
      /* v8 ignore next -- defensive: by-value is only offered with a numeric field, so zero fields here is an impossible panel state */
      if (!writeIconMode(ui, layerId, next)) return;
      renderIconDetail(ui, layerId, detail, next);
      if (next === ICON_MODE.BY_VALUE) {
        bindValueDetail(ui, layerId, detail);
      }
    };
  }
  return block;
};

/** Fill one detail slot for the active mode. The single mode builds the glyph
 *  trigger + grid; the by-value mode builds the field/classes/scheme rows. */
const renderIconDetail = (
  ui: LayerUI,
  layerId: string,
  detail: HTMLElement,
  mode: IconMode,
): void => {
  detail.innerHTML = "";
  if (mode === ICON_MODE.BY_VALUE) {
    const fields = iconFields(ui, layerId);
    if (fields.length > 0) {
      detail.append(
        ...buildValueDetail(
          ui,
          layerId,
          fields,
          valueForIconValue(ui, layerId, fields),
        ),
      );
      return;
    }
  }
  detail.append(buildSingleDetail(ui, layerId));
};

/** Bind the by-value detail's three controls (field / method+classes /
 *  glyph scheme). Every element is built by `buildValueDetail` immediately
 *  above, so the queries cast instead of re-testing for null: a guard here
 *  could never take its false mode (the markup is a private contract) and
 *  would just read as an uncovered branch. */
const bindValueDetail = (ui: LayerUI, layerId: string, detail: HTMLElement): void => {
  const fieldSelect = detail.querySelector(
    `.${CONST.CLASSES.STYLE_ICON_FIELD_SELECT}`,
  ) as HTMLSelectElement;
  fieldSelect.onchange = () =>
    writeIconValue(ui, layerId, { field: fieldSelect.value });

  const methodSelect = detail.querySelector(
    `.${CONST.CLASSES.STYLE_ICON_METHOD_SELECT}`,
  ) as HTMLSelectElement;
  methodSelect.onchange = () =>
    writeIconValue(ui, layerId, {
      method: methodSelect.value as IconValueConfig["method"],
    });

  const classesSelect = detail.querySelector(
    `.${CONST.CLASSES.STYLE_ICON_CLASSES_SELECT}`,
  ) as HTMLSelectElement;
  classesSelect.onchange = () => {
    writeIconValue(ui, layerId, {
      classes: parseInt(classesSelect.value, 10),
    });
  };

  const schemeSelect = detail.querySelector(
    `.${CONST.CLASSES.STYLE_ICON_SCHEME_SELECT}`,
  ) as HTMLSelectElement;
  schemeSelect.onchange = () => {
    const scheme = glyphScheme(schemeSelect.value);
    if (scheme) {
      writeIconValue(ui, layerId, { glyphs: [...scheme] });
    }
  };
};

/** Open the glyph grid popup under the trigger and wire its interactions.
 *  The grid is built lazily on first open and re-rendered on every open so
 *  the current selection stays highlighted. */
const bindGlyphGrid = (
  ui: LayerUI,
  layerId: string,
  trigger: HTMLButtonElement,
  row: HTMLElement,
  renderTrigger: () => void,
): void => {
  let grid: HTMLElement | null = null;
  let unbind: (() => void) | null = null;
  let releaseClaim: (() => void) | null = null;
  const close = () => {
    // Pair the dismissal teardown with the close path (never a synthetic
    // `remove` event): unbind is captured once per open.
    unbind?.();
    unbind = null;
    // The grid owns the keyboard while it is open: release on close so the
    // layer list regains its arrows / Enter / Space.
    releaseClaim?.();
    releaseClaim = null;
    grid?.remove();
    grid = null;
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-activedescendant");
  };

  const open = () => {
    /* v8 ignore next -- defensive: trigger handler closes before re-opening */
    if (grid) return;
    const built = buildGlyphGrid(ui, layerId, trigger, close, renderTrigger);
    grid = built.grid;
    // While the grid is open it owns the arrow / Home / End / Enter / Space
    // keys: a press on a focused cell must move the grid cursor, not toggle a
    // layer row behind the popup. The claim makes the central dispatcher and
    // every other handler stand aside; released in close().
    releaseClaim = claimKeys(grid);
    trigger.setAttribute("aria-expanded", "true");
    row.appendChild(grid);
    // Put focus INTO the grid now that it is in the document — the real
    // ownership is DOM focus, the claim is only the dispatcher guard.
    built.focusInitial();
    // The overlay registry is the single Escape/outside-press dispatcher:
    // register the grid as a floating surface ranked above the style panel,
    // so one Escape closes the grid and the next closes the panel (one layer
    // at a time). The close path runs the same teardown the registry calls.
    unbind = ensureOverlayRegistry(ui.c.map).register({
      id: "layer.style.icon-grid",
      isOpen: () => grid !== null,
      panels: () => (grid ? [grid] : []),
      close: ({ restoreFocus }) => {
        close();
        if (restoreFocus) trigger.focus();
      },
      dismissOn: "mousedown",
      pressPriority: POPUP_OVERLAY_RANK,
      escapeRank: POPUP_OVERLAY_RANK,
    });
    grid.dataset.closeOnDoc = "1";
    grid.dataset.closeOnKey = "1";
  };

  trigger.onclick = () => {
    if (grid) close();
    else open();
  };
};
/** Build the glyph grid popup DOM: a 2D matrix of cells, current highlighted,
 *  hover tooltip = name, click applies + closes, arrows + Enter navigate. */
const buildGlyphGrid = (
  ui: LayerUI,
  layerId: string,
  trigger: HTMLButtonElement,
  close: () => void,
  renderTrigger: () => void,
): { grid: HTMLElement; focusInitial: () => void } => {
  const current = currentGlyph(ui, layerId);
  const gridPrefix: GlyphPrefix = coerceGlyphPrefix(ui.config.icon_prefix ?? undefined);
  const grid = dom.el("div", {
    class: CONST.CLASSES.STYLE_ICON_GRID,
    role: "grid",
    "aria-label": ui.T("style_icon"),
  }) as HTMLElement;
  const cells: HTMLButtonElement[] = [];

  for (const glyph of PICKER_GLYPHS) {
    const cell = dom.el(
      "button",
      {
        class: CONST.CLASSES.STYLE_ICON_CELL,
        type: "button",
        role: "gridcell",
        title: glyph,
        "data-glyph": glyph,
        id: nextOptionId("icon-cell"),
        ...(glyph === current ? { "aria-current": "true" } : {}),
      },
      { html: glyphHtml(glyph, "", "", gridPrefix) },
    ) as HTMLButtonElement;
    if (glyph === current) {
      cell.classList.add(CONST.CLASSES.STYLE_ICON_CELL_SELECTED);
    }
    cell.onclick = () => {
      commitGlyph(ui, layerId, glyph);
      renderTrigger();
      close();
      // The grid is gone: hand focus back to the trigger, the element that
      // opened it (a keyboard commit must not leave focus on a removed cell).
      trigger.focus();
    };
    cells.push(cell);
    grid.appendChild(cell);
  }

  // Keyboard: 2D walk via the shared ListCursor (arrows move row/column,
  // Home/End first/last, Enter/Space activate the focused cell — a <button>
  // fires its own click natively, which commits + closes). Esc is handled by
  // the dismissal primitive above. The grid keeps its own ARIA roles: the
  // cursor paints focus, not a listbox selection.
  const cursor = new ListCursor({
    root: grid,
    itemSelector: `.${CONST.CLASSES.STYLE_ICON_CELL}`,
    activeClass: "foliplus-icon-grid-cursor",
    mode: "roving",
    cols: GLYPH_GRID_COLS,
    roles: { list: "grid", item: "gridcell" },
    // Cells carry their own role/id from the shared id source below; the
    // cursor only paints focus + aria-activedescendant.
    paintOptionContract: false,
    // Enter/Space on a focused cell commits + closes (the cell's click).
    onActivate: (_, el) => (el as HTMLButtonElement).click(),
  });
  cursor.bindKeys(grid);
  // The popup must hold DOM focus on open: without it the key press goes to
  // the element that had focus (a row checkbox, a slider thumb) and toggles
  // the layer behind the popup — the claim alone cannot redirect a browser's
  // key, it only stands the dispatcher aside. Focus the current cell (or the
  // first) once the grid is appended; the cell is a real button so the
  // roving tabindex contract puts tabindex=0 on it.
  const focusInitial = (): void => {
    const initial = current
      ? cells.findIndex(cell => cell.getAttribute("data-glyph") === current)
      : -1;
    cursor.set(initial >= 0 ? initial : 0);
  };
  return { grid, focusInitial };
};
/** The icon dimension's value. For the single mode it is the stored glyph
 *  intent (compatible with the pre-by-value descriptor shape); for the
 *  by-value mode it is the stored value config. A layer the user never
 *  touched has neither and reads as undefined. */
type IconDimensionValue = IconIntent | { mode: IconMode; value?: IconValueConfig };

/** Register icon as a per-layer dimension. The descriptor owns the
 *  intent+persist slot; `commitGlyph` / `resetLayerIcon` stay as thin
 *  delegates so the direct callers keep one entry point. */
const ICON_DIMENSION = registerDimension<IconDimensionValue>({
  key: DIM.ICON,
  gate: layerCanIcon,
  value: (ui, layerId) => {
    const mode = displayIconMode(ui, layerId);
    if (mode === ICON_MODE.BY_VALUE) {
      const value = getIntent(ui, layerId, INTENT.ICON_VALUE);
      return value ? { mode, value } : undefined;
    }
    return getIntent(ui, layerId, INTENT.ICON);
  },
  row: (ui, layerId) => buildIconRow(ui, layerId) as HTMLElement,
  write: (ui, layerId, patch) => {
    const writes: Array<readonly [key: IntentKey, value: unknown]> = [];
    // The single-mode patch is the pre-by-value descriptor shape
    // ({kind, value}); the mode patch is {mode, value?}. The two are
    // discriminated by the kind key — a single glyph write always carries
    // kind: "glyph".
    if ("kind" in patch && "value" in patch) {
      writes.push([INTENT.ICON, { kind: patch.kind, value: patch.value }]);
      writes.push([INTENT.ICON_MODE, ICON_MODE.SINGLE]);
    } else if ("mode" in patch) {
      writes.push([INTENT.ICON_MODE, patch.mode]);
      if (patch.value !== undefined) {
        writes.push([INTENT.ICON_VALUE, patch.value]);
      }
    }
    writeIntentKeys(ui, layerId, writes);
    scheduleStyleDimApply(FACE.ICON, layerId, () => applyIconToLayer(ui, layerId), {
      owner: ui,
    });
  },
  reset: (ui, layerId) => resetLayerIcon(ui, layerId),
  valueSource: (ui, layerId) => {
    if (!layerCanIcon(ui, layerId)) return "none";
    return ui.intentStore.isUserSet(layerId, INTENT.ICON) ||
      ui.intentStore.isUserSet(layerId, INTENT.ICON_VALUE) ||
      ui.intentStore.isUserSet(layerId, INTENT.ICON_MODE)
      ? "user"
      : "author";
  },
  contentChange: {
    kind: "frame",
    face: FACE.ICON,
    when: (ui, layerId) =>
      getIntent(ui, layerId, INTENT.ICON) !== undefined ||
      getIntent(ui, layerId, INTENT.ICON_VALUE) !== undefined,
    run: (ui, layerId) => applyIconToLayer(ui, layerId),
  },
});
export {
  ICON_DIMENSION,
  applyIconToLayer,
  buildIconRow,
  commitGlyph,
  currentGlyph,
  layerCanIcon,
  resetLayerIcon,
};
