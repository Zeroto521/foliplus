() => {
  const row = document.querySelector(
    '.foliplus-layer-toggle-all[data-group="overlay"]',
  );
  return row ? row.title : null;
};
