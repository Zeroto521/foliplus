import * as CONST from "./const.js";
import type {
  LabelConfig,
  LayerOverride,
  LayerPersistedRecord,
  PersistedLayerState,
} from "./type.js";
import {
  FILL_MODE,
  type FolderOrder,
  type ValueConfig,
  isIconIntent,
  isValueConfig,
} from "#core/layer/index.js";
import { isGlyphSyntax } from "#core/leaflet/glyphSource.js";
import { VALUE_KIND, isCategoryKind } from "#core/valueKind.js";
import { type Debounced, debounce } from "#platform/debounce.js";
import * as Storage from "#platform/storage.js";
import { BORDER_WEIGHT, normalizeHexColor } from "#ui/index.js";

/** The live sources a write reads. Supply only the dimensions you own -- a
 *  dimension you omit is left exactly as it stands in storage, so a caller that
 *  only knows the layer order cannot wipe the fold, rename, and label state it
 *  never touched. */
type LiveState = {
  order?: () => string[];
  folderOrder?: () => FolderOrder | null;
  removed?: () => string[];
  foldedRoles?: () => string[];
  renamedNames?: () => Record<string, string>;
  layers?: () => Record<string, PersistedLayerState>;
};

// CONFIG is a free variable from the IIFE template wrapper (see BaseControl._template).

/** Compatibility version of the persisted record: bumped only when the stored
 *  shape needs migrating, or when an old record would otherwise read with a
 *  different meaning. Adding an optional field whose absence keeps the old
 *  behavior does not bump it — `fillValue` / `fillMode` keep this at 3, an old
 *  record still reads as solid, and a value record without a mode reads as value
 *  through the compatibility branch. So does a rename-free internal refactor
 *  or a UI-only change.
 *
 *  `parseRecord` is per-segment tolerant, so a stored value that does not
 *  match is left alone (the segment is treated as absent); every write stamps
 *  `RECORD_VERSION`, which is what brings the record up to date. Presence,
 *  not value, is the compatibility marker — a record without a `version` is
 *  read as-is and re-stamped on the next write.
 *
 *  No reader dispatches on the number: nothing migrates on load, so a bump is
 *  not a migration by itself. When a bump is genuinely needed — a field an old
 *  record cannot be safely derived for, a rename or move, a changed default
 *  meaning — ship the old-version read path, an unknown-future-version policy,
 *  and round-trip tests with it.
 *
 *  2 → 3: the label config moved into `layers[id].label` (a style
 *  dimension of the layer, not a parallel segment). There is deliberately no
 *  compatibility read: the legacy top-level `annotations` segment is
 *  dropped, not read (no compatibility migration), so a v2 record still loads
 *  but its label config is discarded, and the next write stamps v3.
 *
 *  3 → 4: `foldedGroups` was renamed to `foldedRoles`. There is deliberately
 *  no compatibility read: the field rename is a breaking change accepted for
 *  this release, so an old v3 record still loads but its fold state is
 *  dropped, and the next write stamps v4.
 *
 *  4 → 5: `layers[id].annotation` was renamed to `layers[id].label` (the label
 *  config's on-wire key). There is deliberately no compatibility read: the
 *  field rename is a breaking change accepted for this release, so an old v4
 *  record still loads but its label config is dropped, and the next write
 *  stamps v5. */
const RECORD_VERSION = 5;

const emptyRecord = (): LayerPersistedRecord => ({
  version: RECORD_VERSION,
  order: null,
  removed: [],
  foldedRoles: [],
  renamedNames: {},
  layers: {},
});

/** A plain object -- the shape every record section is expected to hold. */
const asObject = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** A stored unit-interval opacity (0-1), inclusive — 0 is a real choice. */
const isUnitInterval = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

/** A stored zoom range: two finite numbers with the low end not above the
 *  high. Bounds are the map's business -- the handles are confined to the map's
 *  own range by the UI, so the record does not invent one of its own, and a
 *  range the map could no longer honor is still the user's stated choice. */
const parseZoomRange = (raw: unknown): [number, number] | null => {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const [min, max] = raw as [unknown, unknown];
  return typeof min === "number" &&
    typeof max === "number" &&
    Number.isFinite(min) &&
    Number.isFinite(max) &&
    min <= max
    ? [min, max]
    : null;
};

/** A stored value-based-fill config: non-empty field / method / scheme
 *  strings, a whole class count inside the picker's 2-9 bounds, and a `kind`
 *  this client can build. The defaults live on the UI side, so the record
 *  carries only an explicit choice — a record missing one is dropped rather
 *  than guessed at. All three names are tested for non-whitespace and all
 *  three are stored verbatim. `field` is a data key, and a GeoJSON property
 *  called " score " is a different key from "score" (RFC 7946 section 3.2 with
 *  RFC 8259 section 4: a member name is a string and its whitespace is part
 *  of it), so rewriting the key on read would silently miss every feature
 *  after a reload, or read the other column when both spellings exist.
 *  `method` and `scheme` are protocol names that no caller writes with
 *  padding; keeping them as stored leaves any stray space visible in the
 *  record instead of normalising it away.
 *
 *  The bounds themselves live in `isValueConfig`, shared with the LIVE
 *  presence rule. `kind` accepts absence, "numeric" or "category". An
 *  explicit "numeric" is the default and is stripped, so the stored record
 *  keeps reading "kindless = numeric"; a category record keeps its kind so
 *  the apply path dispatches on it after a reload. */
const parseFillValue = (raw: unknown): ValueConfig | null => {
  if (!isValueConfig(raw)) return null;
  return {
    kind: isCategoryKind(raw.kind) ? VALUE_KIND.CATEGORY : undefined,
    field: raw.field,
    method: raw.method,
    scheme: raw.scheme,
    classes: raw.classes,
  } as ValueConfig;
};

/** A border width inside the shared bounds — the same constants the number
 *  field is confined to, so a stored value can never ask for a width the UI
 *  cannot display. */
const isBorderWeight = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= BORDER_WEIGHT.MIN &&
  value <= BORDER_WEIGHT.MAX;

/** A stored size: a finite pixel radius the panel's number field can display.
 *  Rounded first because the field steps by one, then confined to the shared
 *  [SIZE.MIN, SIZE.MAX] bounds — outside them the value is dropped (its
 *  provenance marker with it) rather than clamped, so a corrupt entry cannot
 *  silently resize the layer. */
const parseSize = (raw: unknown): number | null => {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const rounded = Math.round(raw);
  return rounded >= CONST.SIZE.MIN && rounded <= CONST.SIZE.MAX ? rounded : null;
};
/** A hex color the panel's border and fill rows would accept: `#rgb` or
 *  `#rrggbb`. Longer / shorter strings and non-hex characters are dropped so a
 *  corrupt entry cannot leak a broken value into <input type=color>. */
const isHexColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value);

/** Disk parser per provenance key: normalizes the stored value or returns
 *  `null` to drop a corrupt one (its marker is dropped with it).
 *
 *  `Record<LayerOverride, …>` is the extension pin — a new dimension without
 *  a parser is a compile error, and {@link OVERRIDE_VALUES} derives from this
 *  table so the vocabulary cannot drift. */
const PARSE_OVERRIDE: Record<
  LayerOverride,
  (data: Record<string, unknown>) => unknown | null
> = {
  visible: data => (typeof data.visible === "boolean" ? data.visible : null),
  fillColor: data =>
    isHexColor(data.fillColor) ? normalizeHexColor(data.fillColor) : null,
  fillOpacity: data => (isUnitInterval(data.fillOpacity) ? data.fillOpacity : null),
  fillValue: data => parseFillValue(data.fillValue),
  fillMode: data =>
    data.fillMode === FILL_MODE.SOLID ||
    data.fillMode === FILL_MODE.VALUE ||
    data.fillMode === FILL_MODE.ORIGINAL
      ? data.fillMode
      : null,
  borderColor: data =>
    isHexColor(data.borderColor) ? normalizeHexColor(data.borderColor) : null,
  borderWeight: data => (isBorderWeight(data.borderWeight) ? data.borderWeight : null),
  borderValue: data => parseFillValue(data.borderValue),
  borderStyleMode: data =>
    data.borderStyleMode === FILL_MODE.SOLID ||
    data.borderStyleMode === FILL_MODE.VALUE ||
    data.borderStyleMode === FILL_MODE.ORIGINAL
      ? data.borderStyleMode
      : null,
  opacity: data => (isUnitInterval(data.opacity) ? data.opacity : null),
  zoomRange: data => parseZoomRange(data.zoomRange),
  size: data => parseSize(data.size),
  icon: data => {
    const icon = data.icon as { kind?: unknown; value?: unknown } | undefined;
    return isIconIntent(icon) && isGlyphSyntax(icon?.value) ? icon : null;
  },
  iconColor: data =>
    isHexColor(data.iconColor) ? normalizeHexColor(data.iconColor) : null,
};

const OVERRIDE_VALUES = Object.keys(PARSE_OVERRIDE) as LayerOverride[];

/** One stored label (label) config: an object, color-normalized the
 *  same way in `layers[id].label`. Field-level coercion (size clamps,
 *  format enums, collide) belongs to the reader that applies it —
 *  `applyStyleLabelState`; this keeps a non-object from reaching the config
 *  map, nothing more. */
const parseLabelConfig = (raw: unknown): LabelConfig | null => {
  const cfg = asObject(raw);
  if (!cfg) return null;
  const out = { ...cfg };
  if (typeof out.color === "string") {
    out.color = normalizeHexColor(out.color);
  }
  // Structural tolerance, not a lie: only the object shape and the color
  // are checked here — the field-level coercion is `applyStyleLabelState`'s
  // (it clamps sizes, normalizes formats, defaults collide), which is where
  // the value is actually applied. The cast says "reader validates", the
  // same contract the legacy segment had.
  return out as unknown as LabelConfig;
};

/**
 * Coerce one entry of `layers`. Validates value and provenance together, so a
 * value with no matching override -- and an override with no value -- is
 * dropped: keeping the value would persist a choice the record itself says was
 * never made, and failing closed sends the layer back to its declared default.
 *
 * `label` is the exception to the provenance rule — it is a style
 * configuration, not an override the user "marked": there is no
 * `markOverride` for it and none is wanted. It is parsed on its own and
 * survives with an empty `overrides` array (a layer configured only for
 * labels is still a stored layer).
 */
const parseLayerState = (raw: unknown): PersistedLayerState | null => {
  const data = asObject(raw);
  if (!data) return null;
  const declaredRaw = data.overrides;
  const declared = Array.isArray(declaredRaw)
    ? OVERRIDE_VALUES.filter(override => declaredRaw.includes(override))
    : [];
  const out: PersistedLayerState = { overrides: [] };
  for (const override of declared) {
    // The disk key is the provenance key; `null` means "drop this marker".
    const value = PARSE_OVERRIDE[override](data);
    if (value !== null) {
      (out as Record<LayerOverride, unknown>)[override] = value;
      out.overrides.push(override);
    }
  }
  const label = parseLabelConfig(data.label);
  if (label) out.label = label;
  return out.overrides.length > 0 || out.label ? out : null;
};

/**
 * Coerce storage into a canonical record, dropping invalid entries rather than
 * failing closed as a whole: each section is independent, so a corrupt one must
 * not take the rest of the user's saved state down with it.
 */
/** Tolerant read of the persisted folder order: shape must be
 *  `{ version: 1, sections: { [overlay|base]: string[] } }`. Any other shape
 *  reads as absent (the section then runs on the anchor-derived order). */
const isFolderOrder = (raw: unknown): raw is FolderOrder => {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return false;
  const sections = o.sections;
  if (!sections || typeof sections !== "object") return false;
  for (const [sec, names] of Object.entries(sections)) {
    if (sec !== "overlay" && sec !== "base") return false;
    if (!Array.isArray(names) || !names.every(n => typeof n === "string")) return false;
  }
  return true;
};
const parseFolderOrder = (raw: unknown): FolderOrder | null =>
  isFolderOrder(raw) ? raw : null;

const parseRecord = (raw: unknown): LayerPersistedRecord => {
  const data = asObject(raw);
  if (!data) return emptyRecord();
  const record = emptyRecord();

  if (typeof data.version === "number" && data.version === RECORD_VERSION) {
    record.version = data.version;
  }
  if (Array.isArray(data.order) && data.order.every(id => typeof id === "string")) {
    record.order = data.order as string[];
  }
  if (Array.isArray(data.removed) && data.removed.every(id => typeof id === "string")) {
    record.removed = data.removed as string[];
  }
  const parsed = parseFolderOrder(data.folderOrder);
  if (parsed) record.folderOrder = parsed;
  if (
    Array.isArray(data.foldedRoles) &&
    data.foldedRoles.every(role => typeof role === "string")
  ) {
    record.foldedRoles = data.foldedRoles as string[];
  }
  for (const [id, name] of Object.entries(asObject(data.renamedNames) ?? {})) {
    if (typeof name === "string") record.renamedNames[id] = name;
  }
  for (const [id, rawState] of Object.entries(asObject(data.layers) ?? {})) {
    if (record.removed.includes(id)) continue;
    const state = parseLayerState(rawState);
    if (state) record.layers[id] = state;
  }
  return record;
};

/** Overwrite only the dimensions a caller scheduled; the rest are copied
 *  through from what storage already holds, so a caller that knows only the
 *  layer order cannot wipe the fold, rename, or label state it never read.
 *
 *  Named per dimension rather than keyed generically: LayerPersistedRecord is a
 *  literal type, so adding a field without adding it here is a compile error.
 *
 *  The label config writes through `layers[id].label`; the legacy
 *  `annotations` segment no longer exists, so it is not copied through. */
const mergeFields = (
  record: LayerPersistedRecord,
  fields: LiveState,
): LayerPersistedRecord => {
  const removed = fields.removed ? fields.removed() : record.removed;
  const dropRemoved = <T>(entries: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(entries).filter(([id]) => !removed.includes(id)));
  return {
    version: RECORD_VERSION,
    order: fields.order ? fields.order() : record.order,
    folderOrder: fields.folderOrder ? fields.folderOrder() : record.folderOrder,
    removed,
    foldedRoles: fields.foldedRoles ? fields.foldedRoles() : record.foldedRoles,
    renamedNames: fields.renamedNames ? fields.renamedNames() : record.renamedNames,
    layers: dropRemoved(fields.layers ? fields.layers() : record.layers),
  };
};

/**
 * Single entry point for all LayerControl persistence (localStorage).
 *
 * One record per map container holds every dimension -- order, fold, names,
 * label config, and the per-layer intent -- behind a single debounced
 * write, so a teardown flush is one call instead of a per-dimension list and
 * adding a dimension cannot silently lose its last write.
 *
 * Reads go through {@link load}, writes through {@link schedule}; both sides
 * name every dimension explicitly (parseRecord and mergeFields), so a new one
 * cannot be wired on one side and forgotten on the other. Storage key:
 * <prefix>_<mapContainerId> -- map-scoped, so multi-map pages keep their per-map
 * state separate. The key lives in const.ts so tests can assert on it without
 * importing this module.
 */
class LayerPersistence {
  private readonly persistName: string;

  private timer: Debounced | undefined;
  /** Live sources registered so far, merged across calls and never cleared.
   *  Every write therefore re-reads every dimension ever scheduled, which is
   *  what stops one caller from writing a record the other caller's dimension
   *  is missing from — a saved value cannot regress to an older one. */
  private fields: LiveState = {};

  constructor() {
    this.persistName = CONFIG.name;
  }

  // ── Read ───────────────────────────────────────────────────────────

  /**
   * Load every dimension. The only read entry point, so a new dimension cannot
   * be missed on load and nothing else calls `Storage.loadRecord`.
   *
   * Nothing here is filtered against the registry. This runs from
   * `LayerController`'s constructor — before any layer is registered — and again
   * from `LayerUI.attachUI`, which loads before HeatmapControl and
   * MeasureControl register in their own constructor, so a registry filter
   * would drop their entries on the very first attach -- showing the default
   * name, re-adding a hidden layer, leaving a reordered layer at its author
   * position, or losing a label config -- and every refresh. Order and
   * label config are user intent exactly like hidden state and names;
   * the only difference is that their replay is deferred until the id
   * resolves. `LayerController.replaySavedOrder` re-applies the order when a
   * layer registers late, and `applyStyleLabelState` re-applies the config on
   * `CONTROL_ATTACHED`.
   *
   * An unknown id is therefore not evidence that a layer is gone. Stale ids are
   * pruned only by `LayerController.deleteLayer`, the one call that knows a layer
   * is gone for good: `unregisterLayer` is a generic teardown that a component's
   * empty-data pass goes through, and no read-time sweep can tell "not
   * registered yet" from "gone". Writes prune themselves through the live
   * registry, so a stored id never stops being written back.
   */
  load(): LayerPersistedRecord {
    return parseRecord(
      Storage.loadRecord<unknown>(CONST.STORAGE.KEY, this.persistName),
    );
  }

  // ── Write ──────────────────────────────────────────────────────────

  /**
   * Persist the given dimensions on the one shared debounce timer. The write
   * rebuilds the whole record at flush time, reading each registered source
   * lazily so a drag / toggleAll / rename batch coalesces into a single write of
   * the final state rather than a write per step.
   *
   * The write overlay is applied on top of what storage already holds, so the
   * caller only needs to supply the dimensions it touched — a caller that only
   * knows the layer order cannot wipe the fold, rename, or label state it never
   * read. A dimension never scheduled in this session is copied through as-is.
   */
  schedule(fields: LiveState): void {
    Object.assign(this.fields, fields);
    this.timer ??= debounce(() => {
      const record = parseRecord(
        Storage.loadRecord<unknown>(CONST.STORAGE.KEY, this.persistName),
      );
      Storage.saveRecord(
        CONST.STORAGE.KEY,
        mergeFields(record, this.fields),
        this.persistName,
      );
    }, CONST.SAVE_DEBOUNCE_MS);
    this.timer();
  }

  /**
   * Write the pending record. Teardown calls this before the timer is cleared --
   * the write is debounced at 100ms, wide enough for the control to be removed
   * before the timer fires, so flush must come first or the last toggle,
   * reorder, or rename is dropped.
   */
  flushAll() {
    this.timer?.flush();
  }

  destroy() {
    // Flush first: cancel() clears the timer and would make a later flush a
    // no-op, so the write is never order-dependent on the caller.
    this.flushAll();
    this.timer?.cancel();
    this.timer = undefined;
  }
}

export { LayerPersistence, RECORD_VERSION };
