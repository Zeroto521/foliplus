() => {
  const el = document.querySelector(
    '.foliplus-layer-item[data-layer-id="foliplus_color_map"]',
  );
  return el ? getComputedStyle(el).cursor : null;
};
