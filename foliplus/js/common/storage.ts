// localStorage helpers for foliplus components.
// Imported via `import * as Storage from "#common/storage.js"`.
// Stateless over window.localStorage, so it is safe to inline per-component.
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

export { load, save };
