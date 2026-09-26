() => {
  // MeasureControl registers through createLayers: a real Leaflet layer group,
  // so its zoom-range write lands on map membership rather than on an onToggle
  // callback. That surface was never excluded by the canvas gate, so this probe
  // pins the row as a regression guard rather than a new capability.
  const el = document.querySelector(".leaflet-container");
  const map = (el && window[el.id]) || window.__map || window.map;
  const api = map.foliplus.LayerAPI;
  const li = api.layers.find(l => l.id.startsWith("foliplus_measure"));
  if (!li) {
    return { error: "measure layer not registered", ids: api.layers.map(l => l.id) };
  }
  if (!li.layer) return { error: "measure layer has no Leaflet layer", id: li.id };

  // ⋮ → Style, the same two clicks a user makes.
  const row = document.querySelector(`.foliplus-layer-item[data-layer-id="${li.id}"]`);
  if (!row) return { error: "measure row not found", id: li.id };
  row.querySelector(".foliplus-layer-more-btn").click();
  const menuItem = document.querySelector(
    `.foliplus-layer-item[data-layer-id="${li.id}"] li[data-action="style-layer"]`,
  );
  if (!menuItem) return { error: "Style menu item not enabled", id: li.id };
  menuItem.click();
  const panel = document.querySelector(".foliplus-layer-style-panel");
  if (!panel) return { error: "style panel not opened", id: li.id };

  const zoomRow = panel.querySelector(".foliplus-style-zoom-range-row");
  if (!zoomRow) return { error: "zoom range row not rendered", id: li.id };
  const minInput = zoomRow.querySelector(".foliplus-style-zoom-range-min");

  const mapMin = Number(map.getMinZoom());
  const mapMax = Number(map.getMaxZoom());
  const current = Number(map.getZoom());
  const outMin = Math.min(mapMax, current + 1);

  const onMapBefore = map.hasLayer(li.layer);
  minInput.value = String(outMin);
  minInput.dispatchEvent(new Event("input", { bubbles: true }));
  const onMapOut = map.hasLayer(li.layer);

  minInput.value = String(mapMin);
  minInput.dispatchEvent(new Event("input", { bubbles: true }));
  const onMapBack = map.hasLayer(li.layer);

  return {
    id: li.id,
    onMapBefore,
    onMapOut,
    onMapBack,
    sections: [...panel.querySelectorAll(".foliplus-section-heading")].map(
      h => h.textContent,
    ),
  };
};
