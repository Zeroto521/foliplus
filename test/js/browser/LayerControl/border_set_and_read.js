// Opens the ⋮ → Style panel for one layer row, writes the border colour and
// width through the row's own inputs when given, and reports the panel
// contents, the persisted record, and what the map is actually drawing.
//
// Passing colour and weight through the row's inputs instead of calling
// setStyle is the point: this is the exact path a user takes. A null colour
// or weight leaves that input untouched, so the same snippet reads the panel
// back after a reload.
//
// One round trip: the panel opens synchronously on the menu click, so there is
// no driver-side wait between opening it and writing to it. Rows are matched
// by id first, then by the name a folium layer was declared with — folium names
// its ids independently of the label the panel shows.
//
// Page.evaluate takes one argument, so the three arrive as a list. An omitted
// tail stays undefined, which is what the read-only calls rely on.
([layerName, color, weight] = []) => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  const byName =
    api && Array.isArray(api.layers)
      ? api.layers.find(l => l.name === layerName)
      : undefined;

  let row = document.querySelector(
    `[data-layer-id="${CSS.escape(layerName)}"][data-layer-type]`,
  );
  if (!row && byName && byName.id) {
    row = document.querySelector(
      `[data-layer-id="${CSS.escape(byName.id)}"][data-layer-type]`,
    );
  }
  if (!row) {
    const rows = document.querySelectorAll(
      `[data-layer-type]:not([data-layer-type="base"])`,
    );
    row = Array.from(rows).find(r => r.textContent.includes(layerName));
  }
  if (!row) return { row: false, layers: api ? api.layers.map(l => l.id) : null };

  row.querySelector(".foliplus-layer-more-btn").click();
  const styleItem = row.querySelector(
    '.foliplus-layer-more-menu li[data-action="style-layer"]',
  );
  if (!styleItem) return { row: true, styleItem: false };
  styleItem.click();

  const panel = row.querySelector(".foliplus-layer-style-panel");
  if (!panel) return { row: true, styleItem: true, panel: false };

  const setColor = panel.querySelector(".foliplus-style-border-color-input");
  const setWeight = panel.querySelector(".foliplus-style-border-weight-input");
  if (setColor && color) {
    setColor.value = color;
    setColor.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (setWeight && weight !== null && weight !== undefined) {
    setWeight.value = String(weight);
    setWeight.dispatchEvent(new Event("input", { bubbles: true }));
    setWeight.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // The storage key carries the map's own suffix, so the test never has to
  // know it.
  const storage = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.includes("layer_state")) storage[key] = localStorage.getItem(key);
  }

  return {
    row: true,
    panel: true,
    id: row.getAttribute("data-layer-id"),
    borderRows: panel.querySelectorAll(".foliplus-style-border-row").length,
    color: setColor ? setColor.value : null,
    weight: setWeight ? setWeight.value : null,
    labels: Array.from(panel.querySelectorAll(".foliplus-form-label")).map(
      el => el.textContent,
    ),
    storage,
    strokes: Array.from(
      document.querySelectorAll(".leaflet-container path[stroke]"),
    ).map(el => ({
      stroke: el.getAttribute("stroke"),
      strokeWidth: el.getAttribute("stroke-width"),
    })),
  };
};
