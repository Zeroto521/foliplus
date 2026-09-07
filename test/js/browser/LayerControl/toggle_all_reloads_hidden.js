() => {
  const cb = document.querySelector(
    '.foliplus-layer-toggle-all[data-group="overlay"] [data-role="toggle-all"]',
  );
  if (!cb) return "no-cb";
  // Same selector getLayerItems("overlay") uses: non-base layer items,
  // excluding the color swatches.
  const rows = Array.from(
    document.querySelectorAll(
      '.foliplus-layer-item:not([data-layer-type="base"]):not(.foliplus-color-layer-item) input[type="checkbox"]',
    ),
  );
  return { toggleAll: cb.checked, rows: rows.map(r => r.checked) };
};
