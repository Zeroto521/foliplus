() => {
  // Reads what the panel actually painted for the heatmap row plus what the
  // persisted record still holds, so a reload test can tell "stored rename
  // dropped" apart from "row painted the author default".
  const id = "foliplus_heatmap";
  const row = document.querySelector(`.foliplus-layer-item[data-layer-id="${id}"]`);
  const container = document.querySelector(".leaflet-container");
  const key = `foliplus_layer_state_${container ? container.id : ""}`;
  let storedRename = null;
  const raw = localStorage.getItem(key);
  if (raw) {
    try {
      const record = JSON.parse(raw);
      storedRename = record?.renamedNames?.[id] ?? null;
    } catch {
      storedRename = null;
    }
  }
  return {
    rowPresent: !!row,
    label: row?.querySelector(".foliplus-layer-label")?.textContent ?? "",
    ariaLabel:
      row?.querySelector('input[type="checkbox"]')?.getAttribute("aria-label") ?? null,
    storageKey: key,
    storedRename,
    hasStoredEntry: !!storedRename,
  };
};
