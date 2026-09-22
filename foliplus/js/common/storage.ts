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
 * @param key - localStorage key.
 * @param data - Rows to persist (must be JSON-serializable).
 * @param version - Shape version to stamp on the write.
 * @param name - Caller component name, used as the log prefix.
 * @param dataField - Name of the field that holds the rows.
 * @returns Whether the value was actually written.
 */
const saveVersioned = <T>(
  key: string,
  data: readonly T[],
  version: number,
  name = "foliplus",
  dataField = "data",
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
 * helper changing.
 *
 * @param key - localStorage key.
 * @param name - Caller component name, used as the log prefix.
 * @param dataField - Name of the field that holds the rows.
 * @returns The stored rows, or null when the record is absent or unusable.
 */
const loadVersioned = <T>(
  key: string,
  name = "foliplus",
  dataField = "data",
): readonly T[] | null => {
  const data = load<unknown>(key, name);
  if (Array.isArray(data)) return data as readonly T[];
  if (data && typeof data === "object") {
    const rows = (data as Record<string, unknown>)[dataField];
    if (Array.isArray(rows)) return rows as readonly T[];
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
  /** Write the current state now. Idempotent and teardown-safe. */
  flush: () => void;
  /** Drop any pending write without writing. */
  cancel: () => void;
};

/**
 * Options for {@link makePersisted}.
 * @property version - Shape version the component stamps on its records.
 * @property load - Restore persisted state into memory. Called by
 *  {@link Persisted.load}.
 * @property save - Write the current state. Called by {@link Persisted.schedule}
 *  and {@link Persisted.flush}. The component calls `saveVersioned` or
 *  `Storage.save` here and handles its own side effects (quota hint, event
 *  emission, UI sync).
 * @property debounceMs - Coalescing window. 0 writes through synchronously,
 *  which is what a caller that needs every change durable immediately wants;
 *  a window > 0 batches a high-frequency source (drag, keyboard) and is only
 *  safe when the caller also calls `flush` on teardown.
 * @property onFlushError - Called when `save` throws during {@link Persisted.flush}.
 *  Components that lose user data on a failed write (an unbounded list against
 *  a fixed quota) surface it here.
 */
type PersistedOpts = {
  version: number;
  load: () => void;
  save: () => void;
  debounceMs?: number;
  onFlushError?: (err: unknown) => void;
};

/**
 * Build a persisted binding over one localStorage key.
 *
 * One shape every write-through component shares: a versioned record, a single
 * write entry point, and an idempotent teardown flush. The window is optional —
 * 0 writes through so a change is durable the moment it happens, and a positive
 * window batches a high-frequency source behind a timer that a teardown must
 * flush or the last change is lost.
 */
const makePersisted = (
  key: string,
  { version, load, save, debounceMs = 0, onFlushError }: PersistedOpts,
): Persisted => {
  void key;
  void version;
  const doSave = (): void => {
    try {
      save();
    } catch (e) {
      onFlushError?.(e);
    }
  };
  const timer = debounceMs > 0 ? debounce(() => doSave(), debounceMs) : null;
  return {
    load,
    schedule: () => (timer ? timer() : doSave()),
    flush: () => {
      timer?.cancel();
      doSave();
    },
    cancel: () => {
      timer?.cancel();
    },
  };
};

export { load, loadVersioned, makePersisted, save, saveVersioned };
export type { Persisted, PersistedOpts };
