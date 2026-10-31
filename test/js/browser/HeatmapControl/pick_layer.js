name => {
  // Pick a source by hand through the panel's dropdown — the path a user takes
  // when the declaration does not name a layer. The dropdown's options are
  // portalled out of the panel, so they are read from the document.
  const ctrl = window.__heatmapCtrl;
  const info = ctrl.mgr.pointLayers.find(layer => layer.name === name);
  if (!info) {
    return {
      ok: false,
      reason: "no-layer",
      layers: ctrl.mgr.pointLayers.map(layer => layer.name),
    };
  }
  const select = document.querySelector(
    ".foliplus-heatmap-ctrl select[data-heatmap-layer]",
  );
  const row = select ? select.closest(".foliplus-form-row") : null;
  const trigger = row ? row.querySelector(".foliplus-dropdown-trigger") : null;
  if (!trigger) return { ok: false, reason: "no-trigger" };
  const list = document.querySelector(".foliplus-dropdown-list");
  if (!list || list.hidden) trigger.click();
  const option = [...document.querySelectorAll(".foliplus-dropdown-option")].find(
    el => el.getAttribute("data-value") === info.id,
  );
  if (!option) return { ok: false, reason: "no-option", id: info.id };
  option.click();
  return { ok: true, id: info.id, name: info.name };
};
