// localStorage helpers for foliplus components.
// Imported via `import * as Storage from "#common/storage.js"`.
// Stateless over window.localStorage, so it is safe to inline per-component.
import { debounce } from "./debounce.js";
import { createLogger } from "./log.js";

// `name` is a caller-supplied parameter here (no module-level CONF), so the
// logger is created per call — bound to a local first so the call reads as an
// ordinary statement instead of a chain.
const logWarn = (name: string, message: string, err: unknown): void => {
  const log = createLogger(name);
  log.warn(message, err);
};

/**
 * Read and parse a value from localStorage.
 * @param key - localStorage key.
 * @param name - Caller component name, used as the log prefix.
 * @returns Parsed value, or null when missing/unreadable.
 */
const load = <T>(key: string, name = "foliplus"): T | null => {
  try {
    const data = window.localStorage.getItem(key);
    return data ? (JSON.parse(data) as T) : null;
  } catch (e) {
    logWarn(name, `failed to load saved data (key=${key})`, e);
    return null;
  }
};

/**
 * Serialize and write a value to localStorage.
 * @param key - localStorage key.
 * @param data - Value to persist (must be JSON-serializable).
 * @param name - Caller component name, used as the log prefix.
 * @returns Whether the value was actually written. False means the storage
 *  backend rejected the write (quota exhausted, private-mode restrictions) —
 *  callers that lose user data on a failed write can surface it.
 */
const save = (key: string, data: unknown, name = "foliplus"): boolean => {
  try {
    window.localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch (e) {
    logWarn(name, `failed to save data (key=${key})`, e);
    return false;
  }
};

/**
 * Persist `data` behind a versioned envelope: `{ version, [dataField]: data }`.
 * The envelope is the compatibility marker every reader relies on: the
 * component bumps `version` when the record's shape changes, and the field name
 * differs per component (`items` for a list of measurements, `entries` for a
 * list of search history rows), so it is supplied rather than assumed.
 *
 * Args are grouped into an options object rather than five positional parameters
 * because `name` and `dataField` are adjacent and both `string`; passing them
 * reversed compiles cleanly and silently writes `{ version, MeasureControl: [...] }`.
 *
 * @param key - localStorage key.
 * @param opts.data - Rows to persist (must be JSON-serializable).
 * @param opts.version - Shape version the component stamps on its records.
 * @param opts.name - Caller component name, used as the log prefix.
 * @param opts.dataField - Name of the field that holds the rows.
 * @returns Whether the value was actually written.
 */
const saveVersioned = <T>(
  key: string,
  {
    data,
    version,
    name = "foliplus",
    dataField = "data",
  }: {
    data: readonly T[];
    version: number;
    name?: string;
    dataField?: string;
  },
): boolean => save(key, { version, [dataField]: data }, name);

/**
 * Read and unwrap a versioned envelope, tolerating three shapes:
 *   - the new format `{ version, [dataField]: [...] }` — return those rows;
 *   - the legacy bare array — return as-is (no migration; the next write
 *     re-wraps it, so the old shape disappears on the next persist);
 *   - anything else (null, a string, a number, an object whose `dataField` is
 *     missing or not an array) — return `null` so the caller falls back to its
 *     own default.
 *
 * Readers stay tolerant forever: an older record is upgraded on the next write
 * rather than migrated in place, so no reader can lose rows it does not
 * understand, and the field name may differ between components without this
 * helper changing. The returned array is the parsed object from `JSON.parse`,
 * so callers may mutate it (a subsequent `load()` re-parses anyway).
 *
 * Args are grouped into an options object to mirror {@link saveVersioned} — a
 * positional `name`/`dataField` pair of adjacent strings is easy to reverse and
 * would silently read the wrong field.
 *
 * @param key - localStorage key.
 * @param opts.name - Caller component name, used as the log prefix.
 * @param opts.dataField - Name of the field that holds the rows.
 * @returns The stored rows, or null when the record is absent or unusable.
 */
const loadVersioned = <T>(
  key: string,
  { name = "foliplus", dataField = "data" }: { name?: string; dataField?: string } = {},
): T[] | null => {
  const data = load<unknown>(key, name);
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const rows = (data as Record<string, unknown>)[dataField];
    if (Array.isArray(rows)) return rows as T[];
  }
  return null;
};

/**
 * The write surface a persisted binding hands back to its caller. The helper
 * owns the lifecycle (debounce, flush, cancel); the component owns the data
 * (what to write, what to restore, how to surface a failure).
 */
type Persisted = {
  /** Restore persisted state into memory. Called on mount. */
  load: () => void;
  /** Queue a write. Immediate when `debounceMs` is 0, otherwise coalesced. */
  schedule: () => void;
  /**
   * Write any pending state now. No-op when nothing is pending (write-through
   * components, or a caller that has not scheduled since the last write).
   * Idempotent and teardown-safe — the timer is null after flush, so calling
   * flush twice is equivalent to calling it once.
   */
  flush: () => void;
  /** Drop any pending write without writing. */
  cancel: () => void;
};

/**
 * Options for {@link makePersisted}.
 * @property load - Restore persisted state into memory. Called by
 *  {@link Persisted.load}.
 * @property save - Write the current state. Called by {@link Persisted.schedule}
 *  and {@link Persisted.flush}. Return `true` on success, `false` when the
 *  storage backend rejected the write (quota exhausted, private-mode restrictions).
 *  A `false` return routes through `onFlushError`; a throw does too.
 * @property debounceMs - Coalescing window. 0 writes through synchronously,
 *  which is what a caller that needs every change durable immediately wants;
 *  a window > 0 batches a high-frequency source (drag, keyboard) and is only
 *  safe when the caller also calls `flush` on teardown.
 * @property onFlushError - Called when `save` throws or returns `false` during
 *  {@link Persisted.schedule} or {@link Persisted.flush}. Components that lose
 *  user data on a failed write (an unbounded list against a fixed quota)
 *  surface it here.
 */
type PersistedOpts = {
  load: () => void;
  save: () => boolean;
  debounceMs?: number;
  onFlushError?: (err: unknown) => void;
};

/**
 * Build a persisted binding. The helper owns timing — when to write and when to
 * coalesce; the component owns the record shape (which key, which version, which
 * envelope). Version and key stay in the component because the four components'
 * records are heterogeneous: Measure/Search use an envelope, Heatmap uses a flat
 * record with an inline version, LayerControl uses a 5-dimension composite. A
 * shared version constant would couple their independent bump cadences.
 *
 * One shape every write-through component shares: a versioned record, a single
 * write entry point, and a conditional teardown flush. The window is optional —
 * 0 writes through so a change is durable the moment it happens, and a positive
 * window batches a high-frequency source behind a timer that a teardown must
 * flush or the last change is lost.
 */
const makePersisted = ({
  load,
  save,
  debounceMs = 0,
  onFlushError,
}: PersistedOpts): Persisted => {
  const doSave = (): void => {
    try {
      const ok = save();
      if (!ok) onFlushError?.(new Error("persist write failed"));
    } catch (e) {
      onFlushError?.(e);
    }
  };
  const timer = debounceMs > 0 ? debounce(() => doSave(), debounceMs) : null;
  return {
    load,
    schedule: () => (timer ? timer() : doSave()),
    flush: () => timer?.flush(),
    cancel: () => timer?.cancel(),
  };
};

export { load, loadVersioned, makePersisted, save, saveVersioned };
export type { Persisted, PersistedOpts };
