// Late-binding regression gate for bad script order. LayerControl's own
// script lands before a folium layer's JS global, so the registry entry
// starts with `layer: null` and a pending `kind`. The late-binding hook
// must rewrite the entry when the real object arrives via `layeradd`,
// otherwise every consumer that reads `layerInfo.layer` directly — the
// fill swatch first — keeps falling back to Leaflet's own default
// `#3388ff`.
//
// This probe runs the whole chain end-to-end: open the row's style panel,
// read the fill color input, then cross-check `LayerAPI.layers` for any
// entry still at `layer: null`. Both halves must be green, otherwise the
// fix is silent in one and broken in the other.
() => {
  const ctrl = document.querySelector(".foliplus-layer-ctrl");
  if (ctrl && !ctrl.classList.contains("foliplus-is-expanded")) {
    ctrl.querySelector(".foliplus-toggle-btn").click();
  }
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  const byName =
    api && Array.isArray(api.layers)
      ? api.layers.find(l => l.name === "Zone")
      : undefined;
  let row = document.querySelector(
    `[data-layer-id="${CSS.escape("Zone")}"][data-layer-type]`,
  );
  if (!row && byName && byName.id) {
    row = document.querySelector(
      `[data-layer-id="${CSS.escape(byName.id)}"][data-layer-type]`,
    );
  }
  if (!row) {
    return {
      row: false,
      layers: api ? api.layers.map(l => l.id) : null,
    };
  }
  row.querySelector(".foliplus-layer-more-btn").click();
  const styleItem = row.querySelector(
    '.foliplus-layer-more-menu button[data-action="style-layer"]',
  );
  if (!styleItem) return { row: true, styleItem: false };
  styleItem.click();
  const panel = row.querySelector(".foliplus-layer-style-panel");
  if (!panel) return { row: true, styleItem: true, panel: false };
  const fillInput = panel.querySelector(".foliplus-style-fill-color-input");
  const fillValue = fillInput ? fillInput.value : null;
  // A layer entry at `layer: null` with a non-"no-carrier" kind is
  // genuinely pending — the fix's write-back did not run. Entries whose
  // kind is `canvas` / `solid` / `custom` carry no Leaflet layer by
  // design (the color basemap, the Heatmap canvas, a third-party
  // payload) and are not "unresolved" in the sense that matters here.
  const noCarrierKinds = new Set(["canvas", "solid", "custom"]);
  const unresolved = api
    ? api.layers.filter(l => !l.layer && !noCarrierKinds.has(l.kind)).map(l => l.id)
    : null;
  return {
    row: true,
    panel: true,
    id: row.getAttribute("data-layer-id"),
    fillValue,
    unresolved,
  };
};
