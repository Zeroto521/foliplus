() => {
  const lc = window.__layerCtrl;
  if (!lc || !lc.m) return { ok: false, reason: "no layer ctrl" };

  // Expand the layer panel if needed.
  const ctrl = document.querySelector(".foliplus-layer-ctrl");
  if (ctrl && !ctrl.classList.contains("is-expanded")) {
    ctrl.querySelector(".foliplus-toggle-btn").click();
  }

  // Show the color basemap through the public API.
  const ok = lc.m.setVisible("foliplus_color_map", true);
  if (!ok) return { ok: false, reason: "setVisible returned false" };

  // Set the color directly through the surface.
  const surface = lc.m.ui.colorSurface;
  if (surface) {
    surface.setColor("#dc1e1e");
  }

  const container = document.querySelector(".leaflet-container");
  const panes = container.querySelectorAll("[class*='foliplus-color-']");
  const li = lc.m.layerRegistry.get("foliplus_color_map");
  return {
    ok: true,
    colorPaneCount: panes.length,
    liVisible: li ? li.visible : "no-li",
    liCanvas: li ? !!li.canvas : "no-li",
    liColor: li ? li.color : "no-li",
    surfaceColor: surface ? "has-surface" : "no-surface",
  };
};
