// localStorage helpers for foliplus components.
// Imported via `import * as Storage from "#common/storage.js"`.
// Stateless over window.localStorage, so it is safe to inline per-component.

/**
 * Read and parse a value from localStorage.
 * @param key - localStorage key.
 * @param name - Caller component name, used as the log prefix.
 * @returns Parsed value, or null when missing/unreadable.
 */
const load = (key: string, name = "foliplus"): any => {
  try {
    const data = window.localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    console.warn(`[${name}] Failed to load saved data (key=${key})`, e);
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
    console.warn(`[${name}] Failed to save data (key=${key})`, e);
  }
};

export { load, save };
