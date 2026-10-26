// Read the overflow-menu state after a keyboard activation on a row's ⋮.
() => {
  const row = document.querySelector(".foliplus-layer-item[data-layer-type=overlay]");
  const cb = row ? row.querySelector('input[type="checkbox"]') : null;
  return {
    menuOpen: !!document.querySelector(".foliplus-layer-more-menu.open"),
    checkboxAfter: cb ? cb.checked : null,
  };
};
