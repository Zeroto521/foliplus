() => {
  const ctrl = document.querySelector(".foliplus-heatmap-ctrl");
  const select = ctrl.querySelector("select[data-heatmap-layer]");
  const option = [...select.options].find(option => option.value);
  select.value = option.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
};
