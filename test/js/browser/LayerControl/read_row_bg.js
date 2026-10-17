// Computed background-color of the first overlay-type row.
// Never hardcode a hex/rgb in tests — read the design token's own computed
// value and compare against it.
() => {
  const row = document.querySelector(".foliplus-layer-item[data-layer-type=overlay]");
  if (!row) return null;
  return getComputedStyle(row).backgroundColor;
};
