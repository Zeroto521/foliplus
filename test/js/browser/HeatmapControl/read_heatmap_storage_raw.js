() => {
  // Find the heatmap's localStorage key and return its raw value (or null).
  const k = Object.keys(localStorage).find(x => x.startsWith("foliplus_heatmap_"));
  const raw = k ? localStorage.getItem(k) : null;
  if (!raw) return null;
  // Records are written in the { version, data } envelope; report the payload
  // so a caller parses the same shape the reader restores.
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed && parsed.data ? parsed.data : parsed);
  } catch {
    return raw;
  }
};
