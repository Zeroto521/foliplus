() => {
  const ctrl = document.querySelector('.foliplus-heatmap-ctrl');
  const select = ctrl.querySelector('select[data-heatmap-layer]');
  select.value = "";
  select.dispatchEvent(new Event('change', { bubbles: true }));
}
