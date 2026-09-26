// Probe: solid-color basemap DOM path after the pane fix.
//
// The colour basemap is a first-class base-group layer: it owns a dedicated
// pane + canvas (created through `factory.createColor`), so it participates
// in the layer z ladder exactly like tile basemaps. Row order = visual stack
// order. The old container-background contract (--color-layer-bg,
// .leaflet-container.active) is retired.
() => {
  const ctrl = document.querySelector(".foliplus-layer-ctrl");
  if (ctrl && !ctrl.classList.contains("is-expanded")) {
    ctrl.querySelector(".foliplus-toggle-btn").click();
  }
  const item = document.querySelector(".foliplus-color-layer-item");
  if (!item) return { itemFound: false };
  item.click();
  // Set the fill color through the style panel (fill row).
  const lc = window.__layerCtrl;
  if (lc && lc.m && lc.m.ui && item) {
    lc.m.ui.openStylePanel("foliplus_color_map");
  }
  const panel = document.querySelector(".foliplus-layer-style-panel");
  const input = panel ? panel.querySelector(".foliplus-style-fill-color-input") : null;
  if (input) {
    input.value = "#3366cc";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const container = document.querySelector(".leaflet-container");
  const tilePane = document.querySelector(".leaflet-tile-pane");
  // Panes that carry a `foliplus-*` marker.
  const foliplusPanes = Array.from(document.querySelectorAll(".leaflet-pane"))
    .filter(p => /foliplus/.test(p.className))
    .map(p => p.className);
  // The color pane and its face canvas.
  const colorPane = foliplusPanes.find(c => c.includes("foliplus-color-"));
  const colorFace = colorPane
    ? Array.from(document.querySelectorAll(".leaflet-pane"))
        .find(p => p.className.includes("foliplus-color-"))
        ?.querySelector(".foliplus-canvas-layer")
    : null;
  // Read the fill color from the canvas pixel data.
  let fillPixel = null;
  if (colorFace) {
    try {
      const ctx = colorFace.getContext("2d");
      const d = ctx.getImageData(0, 0, 1, 1).data;
      fillPixel = `rgba(${d[0]},${d[1]},${d[2]},${d[3]})`;
    } catch {
      fillPixel = "read-failed";
    }
  }
  return {
    itemFound: true,
    itemActive: item.classList.contains("active"),
    containerActive: container.classList.contains("active"),
    cssVar: container.style.getPropertyValue("--color-layer-bg").trim(),
    containerBg: getComputedStyle(container).backgroundColor,
    tileHidden: tilePane.classList.contains("foliplus-layer-tile-hidden"),
    tileVisibility: getComputedStyle(tilePane).visibility,
    foliplusPanes,
    colorPaneFound: !!colorPane,
    colorVisible: colorFace ? !colorFace.classList.contains("hidden") : false,
    fillPixel,
  };
};
