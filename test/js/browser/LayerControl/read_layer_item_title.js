() => {
  const item = document.querySelector(
    ".foliplus-layer-item:not(.foliplus-color-layer-item)",
  );
  return item ? item.title : null;
};
