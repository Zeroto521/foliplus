() => {
  const row = document.querySelector('.foliplus-layer-toggle-all[data-role="overlay"]');
  const more = row ? row.querySelector(".foliplus-layer-more-btn") : null;
  if (more) more.click();
  const item = document.querySelector('[data-action="clean-empty-folders"]');
  if (!item) return { clicked: false, folderGone: false };
  // Two-step confirm, like every other delete entry: the first activation
  // arms, the second commits.
  item.click();
  const armed = document.querySelector('[data-action="clean-empty-folders"]');
  if (armed) armed.click();
  const folder = document.querySelector(
    '.foliplus-layer-item-folder[data-folder-key="seed folder"]',
  );
  return { clicked: true, folderGone: !folder };
};
