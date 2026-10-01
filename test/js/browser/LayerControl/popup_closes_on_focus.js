() => {
  const map = window.map;
  const ctrl = window.__layerCtrl;
  if (!map || !ctrl) return { error: "map or ctrl not found" };

  return new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const path = map.getContainer().querySelector("path.leaflet-interactive");
        if (!path) return resolve({ error: "no clickable path found" });
        path.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        requestAnimationFrame(() => {
          const popupOpenBefore = !!map.getContainer().querySelector(".leaflet-popup");

          const ui = ctrl.m && ctrl.m.ui;
          if (!ui || !ui.focusLayer || !ui.isFocusing) {
            return resolve({ error: "LayerUI not reachable", popupOpenBefore });
          }
          const rows = Array.from(document.querySelectorAll(".foliplus-layer-item"));
          const target = rows.find(el => {
            const t = el.getAttribute("data-layer-type");
            const id = el.getAttribute("data-layer-id");
            return id && t !== "group.base";
          });
          if (!target) {
            return resolve({
              error: "no non-base layer row",
              popupOpenBefore,
              rows: rows.map(el => ({
                id: el.getAttribute("data-layer-id"),
                type: el.getAttribute("data-layer-type"),
              })),
            });
          }
          const layerId = target.getAttribute("data-layer-id");
          ui.focusLayer(layerId);

          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve({
                popupOpenBefore,
                popupStillOpen: !!map.getContainer().querySelector(".leaflet-popup"),
                focusing: ui.isFocusing(),
                layerId,
              });
            });
          });
        });
      });
    });
  });
};
