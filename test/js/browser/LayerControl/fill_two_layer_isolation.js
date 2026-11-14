// Multi-layer isolation: drive a solid fill write on layer A through the real
// user path (row more btn -> Style -> fill mode solid -> color input). The map
// is read by grouping every SVG path by its owning .leaflet-pane (each layer is
// migrated to its own pane), so the "no cross-layer bleed" evidence is that the
// pane NOT touched keeps byte-identical fill/stroke after A is restyled.
arg => {
  const { targetLayer, color } = arg ?? {};
  if (!targetLayer || !color) return { error: "missing-arg" };
  const ctrl = window.__layerCtrl;
  const map = ctrl && ctrl.mgr && ctrl.mgr.map;
  if (!map) return { error: "no-map" };
  if (ctrl.mgr.enforceOrder) ctrl.mgr.enforceOrder();
  const readPanes = () => {
    const groups = {};
    document.querySelectorAll(".leaflet-pane svg path").forEach(p => {
      let pane = p.closest(".leaflet-pane");
      if (!pane) return;
      const cls = pane.className;
      const key = (groups[cls] = groups[cls] || { cls, fills: [], strokes: [] });
      key.fills.push(p.getAttribute("fill"));
      key.strokes.push(p.getAttribute("stroke"));
    });
    return Object.values(groups);
  };
  const rows = [
    ...document.querySelectorAll(".foliplus-layer-item[data-layer-type=overlay]"),
  ];
  const rowA = rows.find(
    r => (r.querySelector(".foliplus-layer-label") || {}).textContent === targetLayer,
  );
  if (!rowA)
    return {
      error: "no-row-A",
      rows: rows.map(r => (r.querySelector(".foliplus-layer-label") || {}).textContent),
    };
  rowA.querySelector(".foliplus-layer-more-btn").click();
  const menu = rowA.querySelector(".foliplus-layer-more-menu.open");
  if (!menu) return { error: "no-menu" };
  const item = menu.querySelector('button[data-action="style-layer"]');
  if (!item) return { error: "no-style-item" };
  item.click();
  const panel = rowA.querySelector(".foliplus-layer-style-panel");
  if (!panel) return { error: "no-panel" };
  const modeSelect = panel.querySelector(".foliplus-style-fill-mode-select");
  if (modeSelect) {
    modeSelect.value = "solid";
    modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }
  // The mode switch rebuilds the detail slot in place: re-query the color
  // input AFTER the switch (the pre-switch render was the original-colours
  // read-only row, which has no input).
  const colorInput = panel.querySelector(".foliplus-style-fill-color-input");
  if (!colorInput) return { error: "no-color-input" };
  colorInput.value = color;
  colorInput.dispatchEvent(new Event("input", { bubbles: true }));
  colorInput.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, panes: readPanes() };
};
