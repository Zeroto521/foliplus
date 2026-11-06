// Read the persisted layer record from localStorage, parsed. Returns null when
// absent or unparsable. Read-only: never writes to storage or drives a write
// path, so a reload test can poll this as the real "did persistence land"
// signal instead of sleeping on the storage debounce.
//
// The key is per map container (CONST.STORAGE.KEY = "foliplus_layer_state_<id>"),
// and a test page may hold more than one, so scan for the family and return the
// first record that parses.
() => {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith("foliplus_layer_state_")) continue;
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (e) {
      // A broken record is not a signal; fall through to the next key.
    }
  }
  return null;
};
