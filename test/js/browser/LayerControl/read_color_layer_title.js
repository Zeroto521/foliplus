() => {
  const item = document.querySelector(
    '.foliplus-layer-item[data-layer-id="foliplus_color_map"]',
  );
  return item ? item.title : null;
};
