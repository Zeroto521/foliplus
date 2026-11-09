// Value-based fill rendering and its editable "按值着色 / Color by value" UI — the
// FILL declaration and the value mode's presentation share this file. The paint
// engine (the shared by-value mode) lives in valuePaint.ts.
import { INTENT, getIntent } from "../intent.js";
import type { LayerUI } from "../surface.js";
import { authorFill, methodLabel } from "./fillAuthor.js";
import { layerFields } from "./label.js";
import { getDimension } from "./registry.js";
import { FACE, walkFillLeaves } from "./styleBag.js";
import { type ValueFaceDecl, applyValuePaint } from "./valuePaint.js";
import { CLASS_COUNT, CLASS_COUNT_VALUES } from "#core/classify.js";
import {
  categoricalPropertiesKeys,
  inferFieldKind,
  numericPropertiesKeys,
  resolveField,
} from "#core/field.js";
import {
  DIM,
  FILL_MODE,
  type FillMode,
  type FillValueConfig,
} from "#core/layer/index.js";
import { OVERLAY_IDS, ensureOverlayRegistry } from "#core/overlayRegistry.js";
import { DEFAULT_SCHEMES, getColorScale } from "#core/palette.js";
import { buildClassesRow, buildFieldRow, buildSchemeRow } from "#core/rampForm.js";
import {
  dropdownSurface,
  fullscreenSurface,
  onFullscreenSurfaceChange,
} from "#platform/fullscreen.js";
import { createLogger } from "#platform/log.js";
import {
  type SchemePicker,
  createSchemePicker,
  dropdownOf,
  dropdownOverlay,
} from "#ui/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { readDeclaredFill } from "#control/LayerControl/declaredFill.js";

const resolveFillMode = (
  ui: LayerUI,
  layerId: string,
  value: FillValueConfig | undefined,
): FillMode =>
  getIntent(ui, layerId, INTENT.FILL_MODE) ??
  (value !== undefined ? FILL_MODE.VALUE : FILL_MODE.SOLID);

/** The fill face's declaration — the specific surface the shared mode
 *  consumes. Every value here is a fill fact; the mode body carries none. */
const FILL_FACE_DECL: ValueFaceDecl = {
  dim: DIM.FILL,
  face: FACE.FILL,
  colorKey: "fillColor",
  opacity: {
    key: "fillOpacity",
    read: (ui, layerId) => getIntent(ui, layerId, INTENT.FILL_OPACITY),
  },
  walkLeaves: walkFillLeaves,
  isValueActive: (ui, layerId, value) =>
    resolveFillMode(ui, layerId, value) === FILL_MODE.VALUE,
  readValueConfig: (ui, layerId) => getIntent(ui, layerId, INTENT.FILL_VALUE),
  logLabel: "value-based fill:",
};

/** Apply a value-based fill to one layer. This is the fill face's call
 *  through the shared mode: the mode collects, builds, writes and pins; the
 *  declaration above tells it what the fill face is. The two optional
 *  readers are the fill face's own (they default to the declaration's). */
const applyValueFill = (
  ui: LayerUI,
  layerId: string,
  value: FillValueConfig,
  /** Resolve a stored config's field against the layer's current fields. The
   *  caller resolves the config it paints with, so the mode's highlight pin
   *  must resolve the live record the same way before comparing. Identity by
   *  default — a caller with no field list has nothing to resolve. */
  resolveStored: (stored: FillValueConfig) => FillValueConfig = stored => stored,
  /** The config the highlight pin replays on mouseout: the live fillValue
   *  intent, or the author's declared value fill when the user has not
   *  chosen one. */
  liveValue: () => FillValueConfig | undefined = () =>
    FILL_FACE_DECL.readValueConfig(ui, layerId),
): void => {
  applyValuePaint(ui, layerId, value, FILL_FACE_DECL, resolveStored, liveValue);
};

export {
  applyValueFill,
  resolveFillMode,
  buildValueDetail,
  bindValueDetail,
  disposeFillRow,
  declaredFill,
  declaredValue,
  effectiveFillValue,
  hasDeclaredValue,
  numericFields,
  resolvedValue,
  valueForUi,
  writeFillMode,
};

const log = createLogger("foliplus");

/** The record a user write may persist: the class count is clamped to the
 *  range the persistence validator accepts, so a declared or seeded config can
 *  never produce a record the next load rejects. */
const persistedValue = (value: FillValueConfig): FillValueConfig =>
  value.kind === "category"
    ? {
        kind: "category",
        field: value.field,
        // method/classes are type-required (the union stays assignable to
        // the numeric ValueConfig) but unused at runtime on a category.
        method: value.method,
        classes: value.classes,
        scheme: value.scheme,
      }
    : {
        kind: "numeric",
        field: value.field,
        method: value.method,
        classes: Math.min(CLASS_COUNT.MAX, Math.max(CLASS_COUNT.MIN, value.classes)),
        scheme: value.scheme,
      };

/** The scheme picker owned by the open style panel. It installs
 *  document-level listeners while its listbox is open, so the panel must
 *  destroy it when it closes or rebuilds the value detail; one entry per UI
 *  because a map owns one LayerControl instance. */
const schemePickerByUi = new WeakMap<LayerUI, SchemePicker>();

/** Unregister for the picker's overlay-registry entry (one per UI). */
const schemePickerOverlayByUi = new WeakMap<LayerUI, () => void>();

/** Destroy the panel's scheme picker, if any. Idempotent; also called when a
 *  mode switch rebuilds the value detail so a stale picker cannot answer the
 *  next click. */
const disposeFillRow = (ui: LayerUI): void => {
  schemePickerOverlayByUi.get(ui)?.();
  schemePickerOverlayByUi.delete(ui);
  schemePickerByUi.get(ui)?.destroy();
  schemePickerByUi.delete(ui);
};

/** Numeric field names offered by the value field picker. The label
 *  panel's field cache is the primary source (it is already computed and
 *  invalidated with the layer's features); a tree walk is the fallback for a
 *  layer whose cache has not been populated yet. Order is first-seen, so the
 *  default option is stable across opens. */
const numericFields = (ui: LayerUI, layerId: string): string[] => {
  const cached = layerFields(ui, layerId)
    .filter(field => field.numeric)
    .map(field => field.name);
  if (cached.length > 0) return cached;
  // Snapshot-then-resolve, the same late-binding defense the fill applies
  // use: the registry's reference is stable once populated, and findLayer
  // re-resolves a folium layer whose registry reference is still null.
  const layerInfo = ui.c.layerRegistry.get(layerId);
  const layer = (layerInfo?.layer ?? ui.c.findLayer(layerId)) as L.Layer | null;
  return layer ? numericPropertiesKeys(layer) : [];
};

/** Categorical field names offered by the category fill mode. Same cache
 *  source as the numeric mode — the label panel field cache first, a
 *  tree walk as the fallback — so a layer whose cache has not been
 *  populated yet still sees its categorical columns. */
const categoryFields = (ui: LayerUI, layerId: string): string[] => {
  const cached = layerFields(ui, layerId)
    .filter(field => !field.numeric)
    .map(field => field.name);
  if (cached.length > 0) return cached;
  const layerInfo = ui.c.layerRegistry.get(layerId);
  const layer = (layerInfo?.layer ?? ui.c.findLayer(layerId)) as L.Layer | null;
  return layer ? categoricalPropertiesKeys(layer) : [];
};

/** Resolve a stored value config's field against the fields the layer offers
 *  right now. Display (`valueForUi`), the dimension's value and the paint path
 *  all go through this, so a stale stored name cannot make the panel show one
 *  column while the map paints by the author's face. The stored record keeps
 *  its name until the next write — the column may come back. The candidate
 *  list follows the value kind: a category value fill resolves against the
 *  categorical columns, a numeric value fill against the numeric ones — the kind
 *  is part of the record, so a same-named column in the other set must not
 *  be re-pointed at. */
const resolvedValue = (
  ui: LayerUI,
  layerId: string,
  value: FillValueConfig | undefined,
): FillValueConfig | undefined =>
  value === undefined
    ? undefined
    : {
        ...value,
        field: resolveField(
          value.field,
          (value.kind ?? "numeric") === "category"
            ? categoryFields(ui, layerId)
            : numericFields(ui, layerId),
        ),
      };

/** One-time inference-drop warnings, keyed by layer:field so a declaration
 *  re-read (apply / panel / Reset) does not repeat the line. The inference
 *  result itself is cached in core/field.ts (declaration-lifetime, not
 *  re-inferred on contentChange); this only dedups the message. */
const inferredKindWarned = new Set<string>();

/** Warn once that a declaration was dropped because its field cannot drive a
 *  single fill kind — the values mix number and category kinds ("mixes"), or
 *  no usable value exists to infer the kind from (all null / no feature). */
const warnDeclaredFillInference = (
  layerId: string,
  field: string,
  inferred: "mixed" | "empty",
): void => {
  const scope = `${layerId}:${field}`;
  if (inferredKindWarned.has(scope)) return;
  inferredKindWarned.add(scope);
  log.warn(
    inferred === "mixed"
      ? `declared fill: field "${field}" on layer "${layerId}" mixes number and category values; dropping the declaration`
      : `declared fill: no usable value to infer the fill kind from field "${field}" on layer "${layerId}"; dropping the declaration`,
  );
};

/** The author's fill declaration in force on this layer, or undefined.
 *
 *  A declaration is a read-time default, not user intent: any fill value or
 *  mode intent means the user owns the mode and the declaration steps aside
 *  (the same rule the detected per-feature state follows). A declared value fill is
 *  only in force while the data still offers its column — a declaration whose
 *  field vanished is not silently re-pointed at another column; the whole
 *  declaration falls back to the per-feature paint / built-in default
 *  instead. */
const declaredFill = (ui: LayerUI, layerId: string): FillValueConfig | undefined => {
  if (getIntent(ui, layerId, INTENT.FILL_VALUE) !== undefined) return undefined;
  if (getIntent(ui, layerId, INTENT.FILL_MODE) !== undefined) return undefined;
  const layerInfo = ui.c.layerRegistry.get(layerId);
  const layer = layerInfo?.layer ?? ui.c.findLayer(layerId);
  const declared = readDeclaredFill(layer, layerId).declared;
  if (!declared) return undefined;
  // Resolve the mode kind. An explicit kind is the author's override and is
  // never re-inferred (the parse layer already validated it against its
  // scheme); an absent kind is inferred from the layer's own values — a
  // declaration is a read-time default, so the data is the truth about which
  // mode the values can drive. A field that cannot drive one kind (mixed
  // number/category values) or drives none (all null / no feature) drops the
  // declaration whole rather than painting one mode over a mismatched column.
  let config: FillValueConfig = declared;
  if (declared.kind === undefined) {
    const inferred = inferFieldKind(layer, declared.field);
    if (inferred === "mixed" || inferred === "empty") {
      warnDeclaredFillInference(layerId, declared.field, inferred);
      return undefined;
    }
    config =
      inferred === "category"
        ? {
            ...declared,
            kind: "category",
            // An inferred categorical column needs a qualitative palette. The
            // author who named none gets the category default; a named scheme
            // is the author's choice and is kept verbatim on either mode.
            scheme:
              declared.scheme === CONST.FILL_VALUE.SCHEME_DEFAULT
                ? CONST.FILL_VALUE.CATEGORY_SCHEME_DEFAULT
                : declared.scheme,
          }
        : { ...declared, kind: "numeric" };
  }
  // The declaration kind selects the candidate set: a category value fill
  // needs its column among the categorical fields, a numeric value fill among
  // the numeric ones. A declaration whose field vanished from the matching
  // set is not re-pointed — the whole declaration steps aside, same as a
  // numeric declaration whose column is gone.
  const fields =
    (config.kind ?? "numeric") === "category"
      ? categoryFields(ui, layerId)
      : numericFields(ui, layerId);
  return fields.includes(config.field) ? config : undefined;
};

/** A fill value the layer *declares* from Python (#789).
 *
 *  The declaration sits in the same chain as the user's intent, not beside
 *  it: it is a read-time default the panel and the paint both read, so a
 *  later panel edit always wins and Reset — which clears the intent — shows
 *  the declaration through again. The author scale deliberately sits outside
 *  this chain — it feeds the read-only original-colors state and the seed,
 *  never the user's by-value record. */
const declaredValue = (ui: LayerUI, layerId: string): FillValueConfig | undefined =>
  declaredFill(ui, layerId);

/** The value config the fill paints and reports when the user has not chosen:
 *  the stored intent, else the author's declared value fill. */
const effectiveFillValue = (
  ui: LayerUI,
  layerId: string,
): FillValueConfig | undefined =>
  getIntent(ui, layerId, INTENT.FILL_VALUE) ?? declaredValue(ui, layerId);

/** Whether a declaration names a value mode — the cheap form for gates that run
 *  before an apply allocates its scheduler box (no field resolution). */
const hasDeclaredValue = (ui: LayerUI, layerId: string): boolean => {
  const layerInfo = ui.c.layerRegistry.get(layerId);
  return (
    readDeclaredFill(layerInfo?.layer ?? ui.c.findLayer(layerId), layerId).declared !==
    undefined
  );
};

/** The value config a first switch to the by-value mode starts from. The field
 *  is the caller's seed field; method/classes/scheme come from the shared
 *  bounds, so the first render and the persistence validator agree on what a
 *  legal record looks like. */
const defaultValueConfig = (
  field: string,
  classes: number = CLASS_COUNT.DEFAULT,
): FillValueConfig => ({
  kind: "numeric",
  field,
  method: CONST.FILL_VALUE.METHOD_DEFAULT,
  classes,
  scheme: CONST.FILL_VALUE.SCHEME_DEFAULT,
});

/** The column the first user classification starts from: the author's scale
 *  column when it is a numeric field of this layer, else the first numeric
 *  field. The scale names the column the author actually drew, which is the
 *  one a user is most likely to keep classifying. */
const seedField = (ui: LayerUI, layerId: string, fields: readonly string[]): string => {
  const column = authorFill(ui, layerId)?.scale?.column;
  return column !== undefined && fields.includes(column) ? column : fields[0];
};

/** The class count the first user classification starts from: the author's own
 *  stepped class count when the panel's vocabulary can carry it (2..9), else
 *  the shared default. A continuous scale has no class count to honour, so it
 *  starts at the default six — never at the author's color count. */
const seedClasses = (ui: LayerUI, layerId: string): number => {
  const scale = authorFill(ui, layerId)?.scale;
  if (scale?.kind !== "stepped") return CLASS_COUNT.DEFAULT;
  const levels = scale.levels ?? 0;
  return levels >= CLASS_COUNT.MIN && levels <= CLASS_COUNT.MAX
    ? levels
    : CLASS_COUNT.DEFAULT;
};

/** The config the value detail displays and writes from — one chain:
 *  the user's intent, then a declared value fill (#789), then the seed. A stored
 *  field the current data no longer offers is resolved to the first offered
 *  field through the shared `resolveField` rule — the same rule the paint side
 *  uses, so the row and the map cannot disagree about which column is in use. */
const valueForUi = (
  ui: LayerUI,
  layerId: string,
  fields: readonly string[],
): FillValueConfig => {
  const stored = resolvedValue(ui, layerId, getIntent(ui, layerId, INTENT.FILL_VALUE));
  if (stored) return stored;
  const declared = resolvedValue(ui, layerId, declaredValue(ui, layerId));
  if (declared) return declared;
  // Every caller reaches this line with a non-empty list: the detail only
  // renders the value mode when a numeric field exists, and the mode write
  // bails first when it does not.
  return defaultValueConfig(seedField(ui, layerId, fields), seedClasses(ui, layerId));
};

/** Write the mode intent, seeding the value config when the user switches to
 *  the by-value mode and none is stored yet. Solid and original keep whatever
 *  value config the other mode holds, and original owns no fill value at all —
 *  a mode alone — so a switch back to either mode restores its own state. */
const writeFillMode = (ui: LayerUI, layerId: string, mode: FillMode): boolean => {
  if (mode !== FILL_MODE.VALUE) {
    getDimension(DIM.FILL)!.write!(ui, layerId, { mode });
    return true;
  }
  const fields = numericFields(ui, layerId);
  if (fields.length === 0) return false;
  getDimension(DIM.FILL)!.write!(ui, layerId, {
    mode,
    value: persistedValue(valueForUi(ui, layerId, fields)),
  });
  return true;
};

/** Merge one value-detail change into the stored config and schedule the
 *  per-leaf repaint through the dimension write. Returns the config that was
 *  written so the caller can keep the controls in sync. */
const writeFillValue = (
  ui: LayerUI,
  layerId: string,
  patch: Partial<FillValueConfig>,
): FillValueConfig => {
  const fields = numericFields(ui, layerId);
  const next: FillValueConfig = persistedValue({
    ...valueForUi(ui, layerId, fields),
    ...patch,
  });
  getDimension(DIM.FILL)!.write!(ui, layerId, { mode: FILL_MODE.VALUE, value: next });
  return next;
};

/** The value mode's detail rows, built from the shared `core/rampForm`
 *  primitives: the heatmap panel and this panel therefore share the row
 *  structure, the control types (native selects) and the option vocabularies
 *  (method order + 2..9 class counts from #core/classify). The scheme trigger
 *  shows the color strip only, matching the heatmap trigger. */
const buildValueDetail = (
  ui: LayerUI,
  layerId: string,
  fields: readonly string[],
  value: FillValueConfig,
): HTMLElement[] => {
  const field = buildFieldRow({
    label: ui.T("style_fill_field"),
    ariaLabel: ui.T("style_fill_field"),
    fields,
    value: resolveField(value.field, fields),
    rowClass: CONST.CLASSES.STYLE_FILL_ROW,
    selectClass: CONST.CLASSES.STYLE_FILL_FIELD_SELECT,
    surface: dropdownSurface(ui.c.map.getContainer()),
    overlay: dropdownOverlay(ensureOverlayRegistry(ui.c.map)),
  });

  const classes = buildClassesRow({
    // The row reads by its primary control: the classification method, the same
    // visible label the heatmap panel uses (classify_method). The class count
    // keeps its own accessible name (see classesAriaLabel below) so the two
    // selects stay distinguishable.
    label: ui.T("style_method"),
    methodAriaLabel: ui.T("style_method"),
    classesAriaLabel: ui.T("style_fill_classes"),
    methodValue: value.method,
    classesValue: value.classes,
    methodLabel: method => methodLabel(ui, method),
    rowClass: CONST.CLASSES.STYLE_FILL_ROW,
    methodClass: CONST.CLASSES.STYLE_FILL_METHOD_SELECT,
    classesClass: CONST.CLASSES.STYLE_FILL_CLASSES_SELECT,
    surface: dropdownSurface(ui.c.map.getContainer()),
    overlay: dropdownOverlay(ensureOverlayRegistry(ui.c.map)),
  });
  // The author palette may have more classes than the picker vocabulary
  // offers: show that count as its own option so the row states the class
  // count the author drew. The first user pick replaces it with a normal
  // 2..9 value.
  if (!CLASS_COUNT_VALUES.includes(value.classes)) {
    const option = document.createElement("option");
    option.value = String(value.classes);
    option.textContent = String(value.classes);
    option.title = ui.T("style_fill_classes_out_of_range");
    classes.classesSelect.append(option);
    classes.classesSelect.value = String(value.classes);
    // #793: the bridged select is hidden and the trigger is the control the
    // user sees, so the explanation rides the dropdown's own hint channel
    // (a `title` on the select is invisible and would be overwritten by the
    // label render) and `refresh()` re-reads the option list just rewritten.
    classes.classesDropdown.refresh();
    classes.classesDropdown.setHint(ui.T("style_fill_classes_out_of_range"));
  }

  const scheme = buildSchemeRow({
    label: ui.T("style_fill_scheme"),
    triggerClass: CONST.CLASSES.STYLE_FILL_SCHEME_TRIGGER,
    barClass: CONST.CLASSES.STYLE_FILL_SCHEME_BAR,
    hiddenClass: CONST.CLASSES.STYLE_FILL_SCHEME_HIDDEN,
    rowClass: CONST.CLASSES.STYLE_FILL_ROW,
  });

  return [field.row, classes.row, scheme.row];
};

/** State the committed class count on the value row.
 *
 *  The write path clamps to the editable 2..9 vocabulary, so an author-declared
 *  count (12, say) stops describing the row the moment the user edits it.
 *  Rewriting the select alone would not be enough: the bridged dropdown cannot
 *  see a property write, and the retired option keeps its own explanation, so
 *  the trigger, its tooltip and the open list would disagree with the map until
 *  the panel was reopened. Retire the out-of-range option, state the committed
 *  count and re-read the trigger in place — re-rendering the detail instead
 *  would drop focus from the control the user is still holding (the #793 rule).
 *  A row that never showed an out-of-range count needs nothing: the select
 *  already states the count the user picked. */
const convergeClassesRow = (select: HTMLSelectElement, classes: number): void => {
  const extra = Array.from(select.options).find(
    option => !CLASS_COUNT_VALUES.includes(Number(option.value)),
  );
  if (!extra) return;
  extra.remove();
  select.value = String(classes);
  const dropdown = dropdownOf(select);
  dropdown?.setHint("");
  dropdown?.refresh();
};

/** Bind the value mode's three controls, including the shared scheme picker.
 *
 *  Every element is built by `buildValueDetail` immediately above, so the
 *  queries cast instead of re-testing for null: a guard here could never take
 *  its false mode (the markup is a private contract) and would just read as an
 *  uncovered branch. The picker is created first so the class-count commit can
 *  update it directly (its strip has one block per class). */
const bindValueDetail = (ui: LayerUI, layerId: string, detail: HTMLElement): void => {
  const trigger = detail.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_SCHEME_TRIGGER}`,
  ) as HTMLElement;
  const hidden = detail.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_SCHEME_HIDDEN}`,
  ) as HTMLSelectElement;
  const fields = numericFields(ui, layerId);
  const value = valueForUi(ui, layerId, fields);
  const picker = createSchemePicker({
    trigger,
    hiddenSelect: hidden,
    schemes: DEFAULT_SCHEMES,
    value: value.scheme,
    // Every scheme this panel offers is a registered chroma scale; the author
    // scale is no longer one of them, so the picker needs no consumer hook.
    colorScale: getColorScale,
    numClasses: value.classes,
    portal: true,
    // The list mounts into the surface that actually covers the trigger:
    // native fullscreen, or this control's pseudo-fullscreen fallback (which
    // the native API never reports and which emits no fullscreenchange).
    resolveHost: () => fullscreenSurface(ui.c.map.getContainer()),
    onSurfaceChange: onFullscreenSurfaceChange,
    label: ui.T("style_fill_scheme"),
    onChange: name => writeFillValue(ui, layerId, { scheme: name }),
  });
  schemePickerByUi.set(ui, picker);
  schemePickerOverlayByUi.set(
    ui,
    ensureOverlayRegistry(ui.c.map).register({
      id: OVERLAY_IDS.LAYER_PICKER_DROPDOWN,
      isOpen: () => picker.getDropdown() !== null,
      panels: () => [trigger],
      close: ({ restoreFocus }) => picker.close({ restoreFocus }),
      dismissOn: "click",
      pressPriority: 850,
    }),
  );

  const fieldSelect = detail.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`,
  ) as HTMLSelectElement;
  fieldSelect.onchange = () =>
    writeFillValue(ui, layerId, { field: fieldSelect.value });

  const methodSelect = detail.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_METHOD_SELECT}`,
  ) as HTMLSelectElement;
  methodSelect.onchange = () =>
    writeFillValue(ui, layerId, {
      method: methodSelect.value as FillValueConfig["method"],
    });

  const classesSelect = detail.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_CLASSES_SELECT}`,
  ) as HTMLSelectElement;
  classesSelect.onchange = () => {
    const next = writeFillValue(ui, layerId, {
      classes: parseInt(classesSelect.value, 10),
    });
    // The strip has one block per class: keep the picker's preview in step
    // with the count the map is now using.
    picker.setNumClasses(next.classes);
    // The row states what the map now paints — trigger label, tooltip and open
    // list together — instead of leaving the declared count's presentation
    // behind on a control the user has already overridden.
    convergeClassesRow(classesSelect, next.classes);
  };
};
