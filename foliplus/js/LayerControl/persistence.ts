import { type Debounced, debounce } from "#common/debounce.js";
import { BORDER_WEIGHT, normalizeHexColor } from "#common/form.js";
import * as Storage from "#common/storage.js";
import * as CONST from "./const.js";
import type {
  AnnotationConfig,
  LayerOverride,
  PersistedLayerState,
  PersistedRecord,
} from "./type.js";

/** The live sources a write reads. Supply only the dimensions you own -- a
 *  dimension you omit is left exactly as it stands in storage, so a caller that
 *  only knows the layer order cannot wipe the fold, rename, and label state it
 *  never touched. */
type LiveState = {
  order?: () => string[];
  removed?: () => string[];
  foldedGroups?: () => string[];
  renamedNames?: () => Record<string, string>;
  layers?: () => Record<string, PersistedLayerState>;
};

// CONFIG is a free variable from the IIFE template wrapper (see BaseControl._template).

/** Shape version of the persisted record: a positive integer, incremented only
 *  when the record's shape changes. `parseRecord` is per-segment tolerant, so a
 *  stored value that does not match is left alone (the segment is treated as
 *  absent); every write stamps `RECORD_VERSION`, which is what brings the
 *  record up to date. Presence, not value, is the compatibility marker — a
 *  record without a `version` is read as-is and re-stamped on the next write.
 *
 *  2 → 3: the label config moved into `layers[id].annotation` (a style
 *  dimension of the layer, not a parallel segment). v2 records still read —
 *  their `annotations[id]` entries are the fallback when the new key is
 *  absent, and the segment is passed through on every write untouched. */
const RECORD_VERSION = 3;

const emptyRecord = (): PersistedRecord => ({
  version: RECORD_VERSION,
  order: null,
  removed: [],
  foldedGroups: [],
  renamedNames: {},
  annotations: {},
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
 *  range the map could no longer honour is still the user's stated choice. */
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

/** A border width inside the shared bounds — the same constants the number
 *  field is confined to, so a stored value can never ask for a width the UI
 *  cannot display. */
const isBorderWeight = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= BORDER_WEIGHT.MIN &&
  value <= BORDER_WEIGHT.MAX;

/** A hex color the panel's border and fill rows would accept: `#rgb` or
 *  `#rrggbb`. Longer / shorter strings and non-hex characters are dropped so a
 *  corrupt entry cannot leak a broken value into <input type=color>. */
const isHexColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value);

/** Disk parser per provenance key: normalises the stored value or returns
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
  borderColor: data =>
    isHexColor(data.borderColor) ? normalizeHexColor(data.borderColor) : null,
  borderWeight: data => (isBorderWeight(data.borderWeight) ? data.borderWeight : null),
  opacity: data => (isUnitInterval(data.opacity) ? data.opacity : null),
  zoomRange: data => parseZoomRange(data.zoomRange),
};

const OVERRIDE_VALUES = Object.keys(PARSE_OVERRIDE) as LayerOverride[];

/** One stored label (annotation) config: an object, colour-normalised the
 *  same way in the new `layers[id].annotation` key and the legacy
 *  `annotations[id]` segment so both read paths hand the seed identical
 *  shapes. Field-level coercion (size clamps, format enums, collide)
 *  belongs to the reader that applies it — `applyStyleLabelState` — the
 *  same split the legacy segment always had; this keeps a non-object from
 *  reaching the config map, nothing more. */
const parseAnnotationConfig = (raw: unknown): AnnotationConfig | null => {
  const cfg = asObject(raw);
  if (!cfg) return null;
  const out = { ...cfg };
  if (typeof out.color === "string") {
    out.color = normalizeHexColor(out.color);
  }
  // Structural tolerance, not a lie: only the object shape and the colour
  // are checked here — the field-level coercion is `applyStyleLabelState`'s
  // (it clamps sizes, normalizes formats, defaults collide), which is where
  // the value is actually applied. The cast says "reader validates", the
  // same contract the legacy segment had.
  return out as unknown as AnnotationConfig;
};

/**
 * Coerce one entry of `layers`. Validates value and provenance together, so a
 * value with no matching override -- and an override with no value -- is
 * dropped: keeping the value would persist a choice the record itself says was
 * never made, and failing closed sends the layer back to its declared default.
 *
 * `annotation` is the exception to the provenance rule — it is a style
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
  const annotation = parseAnnotationConfig(data.annotation);
  if (annotation) out.annotation = annotation;
  return out.overrides.length > 0 || out.annotation ? out : null;
};

/**
 * Coerce storage into a canonical record, dropping invalid entries rather than
 * failing closed as a whole: each section is independent, so a corrupt one must
 * not take the rest of the user's saved state down with it.
 */
const parseRecord = (raw: unknown): PersistedRecord => {
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
  if (
    Array.isArray(data.foldedGroups) &&
    data.foldedGroups.every(group => typeof group === "string")
  ) {
    record.foldedGroups = data.foldedGroups as string[];
  }
  for (const [id, name] of Object.entries(asObject(data.renamedNames) ?? {})) {
    if (typeof name === "string") record.renamedNames[id] = name;
  }
  // The legacy label segment, read for tolerance (v2 records) and passed
  // through on every write. Entries belonging to a DELETED id are dropped
  // here rather than written back: `removed` is one-way and the segment is
  // never rewritten by a live source, so without this read-side prune a
  // v2 config would resurrect behind `layers[id].annotation`'s absence on
  // the next load. This prunes the read, not storage — no migration.
  for (const [id, config] of Object.entries(asObject(data.annotations) ?? {})) {
    if (record.removed.includes(id)) continue;
    const cfg = parseAnnotationConfig(config);
    if (cfg) record.annotations[id] = cfg;
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
 *  Named per dimension rather than keyed generically: PersistedRecord is a
 *  literal type, so adding a field without adding it here is a compile error.
 *
 *  `annotations` has no live source anymore — the label config writes through
 *  `layers[id].annotation`. The stored segment passes through (write-new /
 *  read-old, no migration), MINUS ids the write itself records as deleted:
 *  deletion is not migration, and a zombie config must not outlive its layer
 *  on disk either. `parseRecord` prunes the same ids on read, so a
 *  record written before this prune still loads clean. */
const mergeFields = (record: PersistedRecord, fields: LiveState): PersistedRecord => {
  const removed = fields.removed ? fields.removed() : record.removed;
  const dropRemoved = <T>(entries: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(entries).filter(([id]) => !removed.includes(id)));
  return {
    version: RECORD_VERSION,
    order: fields.order ? fields.order() : record.order,
    removed,
    foldedGroups: fields.foldedGroups ? fields.foldedGroups() : record.foldedGroups,
    renamedNames: fields.renamedNames ? fields.renamedNames() : record.renamedNames,
    annotations: dropRemoved(record.annotations),
    layers: dropRemoved(fields.layers ? fields.layers() : record.layers),
  };
};

/**
 * Single entry point for all LayerControl persistence (localStorage).
 *
 * One record per map container holds every dimension -- order, fold, names,
 * annotation config, and the per-layer intent -- behind a single debounced
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
   * `LayerManager`'s constructor — before any layer is registered — and again
   * from `LayerUI.attachUI`, which loads before HeatmapControl and
   * MeasureControl register in their own constructor, so a registry filter
   * would drop their entries on the very first attach -- showing the default
   * name, re-adding a hidden layer, leaving a reordered layer at its author
   * position, or losing a label config -- and every refresh. Order and
   * annotation config are user intent exactly like hidden state and names;
   * the only difference is that their replay is deferred until the id
   * resolves. `LayerManager.replaySavedOrder` re-applies the order when a
   * layer registers late, and `applyStyleLabelState` re-applies the config on
   * `CONTROL_ATTACHED`.
   *
   * An unknown id is therefore not evidence that a layer is gone. Stale ids are
   * pruned only by `LayerManager.deleteLayer`, the one call that knows a layer
   * is gone for good: `unregisterLayer` is a generic teardown that a component's
   * empty-data pass goes through, and no read-time sweep can tell "not
   * registered yet" from "gone". Writes prune themselves through the live
   * registry, so a stored id never stops being written back.
   */
  load(): PersistedRecord {
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
    if (!this.timer) {
      this.timer = debounce(() => {
        const record = parseRecord(
          Storage.loadRecord<unknown>(CONST.STORAGE.KEY, this.persistName),
        );
        Storage.saveRecord(
          CONST.STORAGE.KEY,
          mergeFields(record, this.fields),
          this.persistName,
        );
      }, CONST.SAVE_DEBOUNCE_MS);
    }
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
