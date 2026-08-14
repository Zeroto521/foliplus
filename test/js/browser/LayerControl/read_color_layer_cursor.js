() => {
  const el = document.querySelector(".foliplus-color-layer-item");
  return el ? getComputedStyle(el).cursor : null;
};
