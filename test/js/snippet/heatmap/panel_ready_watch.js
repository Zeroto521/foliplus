() => {
  window.__changes = [];
  const ctrl = document.querySelector(".foliplus-heatmap-ctrl");
  ["layer", "agg"].forEach(key => {
    const select = ctrl.querySelector(`select[data-heatmap-${key}]`);
    if (select) {
      select.addEventListener("change", event => {
        window.__changes.push({ key, value: select.value, bubbles: event.bubbles });
      });
    }
  });
  const layer = ctrl.querySelector("select[data-heatmap-layer]");
  layer.value = [...layer.options].find(option => option.value).value;
  layer.dispatchEvent(new Event("change", { bubbles: true }));
};
