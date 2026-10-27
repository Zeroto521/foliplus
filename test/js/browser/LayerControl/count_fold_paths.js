() => {
  const btn = document.querySelector(
    '.foliplus-layer-toggle-all[data-role="overlay"] .foliplus-layer-fold-btn',
  );
  return btn.querySelectorAll("path").length;
};
