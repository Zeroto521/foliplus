// localStorage helpers for foliplus components.
// Imported via `import * as Storage from "#common/storage.js"`.
// Stateless over window.localStorage, so it is safe to inline per-component.
import { createLogger } from "./log.js";

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
    createLogger(name).warn(`failed to load saved data (key=${key})`, e);
    return null;
  }
};

/**
 * Serialize and write a value to localStorage.
 * @param key - localStorage key.
 * @param data - Value to persist (must be JSON-serializable).
 * @param name - Caller component name, used as the log prefix.
 */
const save = (key: string, data: unknown, name = "foliplus"): void => {
  try {
    window.localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    createLogger(name).warn(`failed to save data (key=${key})`, e);
  }
};

export { load, save };
