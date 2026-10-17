() => {
  // Toggle a base layer's visibility via its row checkbox, wait for the
  // debounced enforceOrder + syncAttribution, and return the current
  // attribution entry table plus the map's max zoom.
  //
  // Every syncAttribution is a full clear + rebuild of the entry table, so
  // the assertions in the caller pin the invariant "exactly one entry"
  // through a real browser sequence that the mock-only unit tests cannot
  // exercise (Leaflet's own `layeradd` handler fires before the debounced
  // sync, which is what made the "stack two entries" bug visible).
  //
  // The sequence toggles A and B through several visible/hidden
  // combinations so every intermediate state exercises the full rebuild
  // with a real Leaflet attribution control.
  const map = window.map;
  if (!map) return { error: "no window.map" };

  const toggleByName = name => {
    const row = [...document.querySelectorAll(".foliplus-layer-item")].find(
      r => r.querySelector(".foliplus-layer-label")?.textContent?.trim() === name,
    );
    if (!row) return { ok: false, reason: `no row for ${name}` };
    const cb = row.querySelector('input[type="checkbox"]');
    if (!cb) return { ok: false, reason: `no checkbox for ${name}` };
    cb.click();
    return { ok: true, checked: cb.checked };
  };

  const read = () => ({
    entries: { ...map.attributionControl._attributions },
    maxZoom: map.getMaxZoom(),
  });

  return new Promise(async resolve => {
    const result = { steps: [] };
    result.initial = read();
    for (const [action, name] of [
      ["uncheck", "A"],
      ["uncheck", "B"],
      ["check", "B"],
      ["check", "A"],
      ["uncheck", "A"],
      ["uncheck", "B"],
    ]) {
      const r = toggleByName(name);
      await new Promise(res => setTimeout(res, 250));
      result.steps.push({ action, name, r, state: read() });
    }
    resolve(result);
  });
};
