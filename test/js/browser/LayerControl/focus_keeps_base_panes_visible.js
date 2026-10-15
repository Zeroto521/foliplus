() => {
  // Trigger focus by dblclicking the first overlay layer row, then report
  // the visibility of every foliplus-layer-pane as focus.css + the
  // .foliplus-focus-basemap exclusion class leave it. The active basemap
  // (topmost base layer that is effectiveShown) must stay `visibility: visible`
  // so the dim mask on top preserves spatial context; other base panes and
  // overlay data panes must be `visibility: hidden` so the focused layer
  // stands out. The focused layer's pane carries foliplus-focus-pane and
  // is also visible.
  const map = window.map;
  const ctrl = window.__layerCtrl;
  if (!map || !ctrl) return { error: "missing map or ctrl" };

  // dblclick the first overlay layer row (skip the base-group rows).
  const rows = Array.from(document.querySelectorAll(".foliplus-layer-item"));
  const overlayRow = rows.find(row => row.dataset.layerType !== "base");
  if (!overlayRow) return { error: "no overlay row found", rows: rows.length };
  overlayRow.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

  return new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const container = map.getContainer();
        if (!container.classList.contains("foliplus-is-focus-mode")) {
          return resolve({ error: "focus mode did not activate" });
        }
        const panes = Array.from(document.querySelectorAll(".foliplus-layer-pane")).map(
          el => ({
            name: (el.id && el.id.replace(/^leaflet-/, "")) || el.className,
            base: el.classList.contains("foliplus-layer-pane"),
            baseExcl: el.classList.contains("foliplus-base-pane"),
            focusBasemap: el.classList.contains("foliplus-focus-basemap"),
            focusExcl: el.classList.contains("foliplus-focus-pane"),
            visibility: getComputedStyle(el).visibility,
          }),
        );
        const maskPane = map.getPane("foliplus-focus-overlay");
        resolve({
          focusActive: true,
          maskPanePresent: Boolean(maskPane),
          panes,
        });
      });
    });
  });
};
