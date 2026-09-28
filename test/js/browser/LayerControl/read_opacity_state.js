() => {
  // Read the heatmap's stored opacity and the two projections of it: what its
  // canvas is actually painted at, and what the panel's slider shows. Each
  // half is reported separately, so a storage-only, a render-only, or a
  // UI-only mishap cannot slip past the guard.
  const el = document.querySelector(".leaflet-container");
  const map = (el && window[el.id]) || window.map;
  const row = document.querySelector(
    '.foliplus-layer-item[data-layer-id^="foliplus_heatmap"]',
  );
  if (!row) return { error: "heatmap row not found" };
  const id = row.getAttribute("data-layer-id");
  const key = Object.keys(localStorage).find(k =>
    k.startsWith("foliplus_layer_state_"),
  );
  const record = key ? JSON.parse(localStorage.getItem(key)) : null;
  const entry = record && record.layers ? record.layers[id] : null;
  const pane = map && map.getPane ? map.getPane(`foliplus-canvas-${id}`) : null;
  const canvas = pane ? pane.querySelector("canvas.foliplus-canvas-layer") : null;
  // The slider is rebuilt each time the style panel opens, so it reports the
  // value the panel loaded from storage rather than a stale input.
  const slider = document.querySelector(".foliplus-style-opacity-range");
  return {
    id,
    key,
    stored: entry ? entry.opacity : null,
    overrides: entry ? entry.overrides : null,
    canvasRegistered: Boolean(canvas),
    canvasOpacity: canvas ? canvas.style.opacity : null,
    sliderValue: slider ? Number(slider.value) : null,
  };
};
