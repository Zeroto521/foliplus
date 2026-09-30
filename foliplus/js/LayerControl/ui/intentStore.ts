// LayerControl UI — IntentStore: the single per-layer intent carrier.
//
// One `Map<id, IntentRow>` row store replaces the old parallel mirrors
// (`ui.intents` + `ui.intentProvenance`). The row keeps the value axis
// (`intent: LayerIntent`) beside the provenance axis (`provenance: Set<LayerOverride>`),
// so a half-write cannot leave a value with no marker or a marker with no value
// through the cohesive `set` / `clear` surface.
//
// Persistence projections (`toPersisted` / `loadFromPersisted`) own the
// disk-shape bridge; `persistence.ts` still owns parse/serialize.
import type {
  AnnotationConfig,
  IntentRow,
  LayerIntent,
  LayerOverride,
  LoadSource,
  PersistedLayerState,
} from "../type.js";
import { type IntentKey, LIVE, STYLE_KEYS } from "./intent.js";

const isOverrideKey = (key: IntentKey): key is LayerOverride =>
  Object.prototype.hasOwnProperty.call(STYLE_KEYS, key);

const overrideKeys = Object.keys(STYLE_KEYS) as LayerOverride[];

class IntentStore {
  private rows = new Map<string, IntentRow>();

  private ensure(id: string): IntentRow {
    let row = this.rows.get(id);
    if (!row) {
      row = { intent: {}, provenance: new Set() };
      this.rows.set(id, row);
    }
    return row;
  }

  /** Drop the map entry once both axes are empty (name/annotation riders keep
   *  the row alive until their own callers clear them). */
  private prune(id: string): void {
    const row = this.rows.get(id);
    if (!row) return;
    if (Object.keys(row.intent).length === 0 && row.provenance.size === 0) {
      this.rows.delete(id);
    }
  }

  // ── Read ───────────────────────────────────────────────────────────

  get<K extends IntentKey>(id: string, key: K): LayerIntent[K] | undefined {
    return this.rows.get(id)?.intent[key];
  }

  /** Whether the user set this override dimension. */
  isUserSet(id: string, override: LayerOverride): boolean {
    return this.rows.get(id)?.provenance.has(override) ?? false;
  }

  /** Typed-presence check on the current value (0 / "" are live). An unknown
   *  override (future dimension) is treated as live so mark never drops a
   *  new marker — matching the old `hasLiveValue` default arm. */
  hasLive(id: string, override: LayerOverride): boolean {
    const live = LIVE[override];
    return live ? live(this.get(id, override)) : true;
  }

  /** Every id that holds any intent value or provenance marker. */
  ids(): string[] {
    return [...this.rows.keys()];
  }

  /** Ids with a non-empty provenance set. */
  userSetIds(): string[] {
    const out: string[] = [];
    for (const [id, row] of this.rows) {
      if (row.provenance.size > 0) out.push(id);
    }
    return out;
  }

  /** User-assigned names in insertion order (saveNamesState). */
  nameEntries(): [string, string][] {
    const out: [string, string][] = [];
    for (const [id, row] of this.rows) {
      if (typeof row.intent.name === "string") {
        out.push([id, row.intent.name]);
      }
    }
    return out;
  }

  /** Snapshot of every intent record (tests / assertions). */
  dumpIntents(): Record<string, LayerIntent> {
    const out: Record<string, LayerIntent> = {};
    for (const [id, row] of this.rows) {
      out[id] = { ...row.intent };
    }
    return out;
  }

  /** Snapshot of provenance as arrays (tests / assertions). */
  dumpProvenance(): Record<string, LayerOverride[]> {
    const out: Record<string, LayerOverride[]> = {};
    for (const [id, row] of this.rows) {
      if (row.provenance.size > 0) out[id] = [...row.provenance];
    }
    return out;
  }

  // ── Write ──────────────────────────────────────────────────────────

  /** Cohesive user write: store the value and mark provenance in one step
   *  for override keys. `name` / `annotation` ride without a marker. */
  set<K extends IntentKey>(
    id: string,
    key: K,
    value: NonNullable<LayerIntent[K]>,
  ): void {
    this.setValue(id, key, value);
    if (isOverrideKey(key)) this.mark(id, key);
  }

  /** Cohesive write with an untyped value — descriptor patch orchestration
   *  (registry.writeIntentKeys). Same mark rule as {@link set}. */
  setRaw(id: string, key: IntentKey, value: unknown): void {
    if (value === undefined) return;
    (this.ensure(id).intent as Record<string, unknown>)[key] = value;
    if (isOverrideKey(key)) this.mark(id, key);
  }

  /** Cohesive user clear: drop the value and its provenance marker. */
  clear(id: string, key: IntentKey): void {
    this.clearValue(id, key);
    if (isOverrideKey(key)) this.unmark(id, key);
    this.prune(id);
  }

  /** Value-only write — load seed / `setIntent` compat (no provenance). */
  setValue<K extends IntentKey>(
    id: string,
    key: K,
    value: NonNullable<LayerIntent[K]>,
  ): void {
    this.ensure(id).intent[key] = value;
  }

  /** Value-only clear — `clearIntent` compat (no provenance). */
  clearValue(id: string, key: IntentKey): void {
    const row = this.rows.get(id);
    if (!row) return;
    delete row.intent[key];
    this.prune(id);
  }

  /** Record that the user set this override dimension. Refuses when the
   *  dimension holds no live value (caller logs); returns whether marked. */
  mark(id: string, override: LayerOverride): boolean {
    if (!this.hasLive(id, override)) return false;
    this.ensure(id).provenance.add(override);
    return true;
  }

  /** Drop one dimension's provenance (Reset). */
  unmark(id: string, override: LayerOverride): void {
    const row = this.rows.get(id);
    if (!row) return;
    row.provenance.delete(override);
    this.prune(id);
  }

  /** Drop style dimensions + provenance for one layer (user deleted it).
   *  `name` / `annotation` riders stay for their own callers. */
  dropRow(id: string): void {
    const row = this.rows.get(id);
    if (!row) return;
    for (const key of overrideKeys) {
      delete row.intent[key];
    }
    row.provenance.clear();
    this.prune(id);
  }

  /**
   * Seed bulk values without provenance (tests / bulk restore).
   * @internal Test and bulk-restore surface — not part of the production write API.
   */
  seedValues<K extends IntentKey>(
    key: K,
    record: Record<string, NonNullable<LayerIntent[K]>>,
  ): void {
    for (const [id, value] of Object.entries(record)) {
      this.setValue(id, key, value);
    }
  }

  /**
   * Seed provenance arrays (tests / load). Inserts in array order.
   * @internal Test and load-orchestration surface.
   */
  seedProvenance(id: string, overrides: readonly LayerOverride[]): void {
    const row = this.ensure(id);
    row.provenance.clear();
    for (const override of overrides) {
      row.provenance.add(override);
    }
  }

  /**
   * Replace the whole provenance axis (tests / whole-object setup).
   * @internal Test fixture surface.
   */
  replaceProvenance(map: Record<string, LayerOverride[]>): void {
    for (const row of this.rows.values()) row.provenance.clear();
    for (const [id, overrides] of Object.entries(map)) {
      this.seedProvenance(id, overrides);
    }
    for (const id of [...this.rows.keys()]) this.prune(id);
  }

  /**
   * Replace the whole intent value axis (tests / whole-object setup).
   * @internal Test fixture surface.
   */
  replaceIntents(map: Record<string, LayerIntent>): void {
    this.clearAll();
    for (const [id, intent] of Object.entries(map)) {
      for (const [key, value] of Object.entries(intent)) {
        if (value !== undefined) {
          (this.ensure(id).intent as Record<string, unknown>)[key] = value;
        }
      }
    }
  }

  /**
   * Wipe every row. Used by loadFromPersisted and test fixtures.
   * @internal Test fixture surface.
   */
  clearAll(): void {
    this.rows.clear();
  }

  // ── Persistence projections ────────────────────────────────────────

  /** Project live rows onto the `layers` disk section. `liveAnnotations` is
   *  the annotation manager's current config map (not the load seed). */
  toPersisted(
    liveAnnotations: Record<string, AnnotationConfig> = {},
  ): Record<string, PersistedLayerState> {
    const states: Record<string, PersistedLayerState> = {};
    const ids = new Set([...this.rows.keys(), ...Object.keys(liveAnnotations)]);
    for (const id of ids) {
      const row = this.rows.get(id);
      const declared = row
        ? [...row.provenance].filter(override => this.hasLive(id, override))
        : [];
      const annotation = liveAnnotations[id];
      if (declared.length === 0 && !annotation) continue;
      const state: PersistedLayerState = { overrides: declared };
      for (const override of declared) {
        const value = this.get(id, override);
        const live = LIVE[override];
        if (live && live(value)) {
          (state as Record<LayerOverride, unknown>)[override] = value;
        }
      }
      if (annotation) state.annotation = annotation;
      states[id] = state;
    }
    return states;
  }

  /** Fill the store from a parsed persistence record's intent half.
   *  Read order is the compat contract: `layers[id].annotation` wins over
   *  the legacy top-level `annotations` segment. */
  loadFromPersisted(source: LoadSource): void {
    this.clearAll();
    for (const [id, name] of Object.entries(source.renamedNames ?? {})) {
      this.setValue(id, "name", name);
    }
    for (const [id, raw] of Object.entries(source.annotations ?? {})) {
      if (raw != null) {
        this.setValue(id, "annotation", raw as NonNullable<LayerIntent["annotation"]>);
      }
    }
    for (const [id, entry] of Object.entries(source.layers ?? {})) {
      if (entry.annotation) this.setValue(id, "annotation", entry.annotation);
      this.seedProvenance(id, entry.overrides);
      for (const override of entry.overrides) {
        const value = entry[override];
        const live = LIVE[override];
        if (live && value !== undefined && live(value)) {
          // Disk key == provenance key == intent key (identity map).
          (this.ensure(id).intent as Record<LayerOverride, unknown>)[override] = value;
        }
      }
    }
  }
}

export { IntentStore };
