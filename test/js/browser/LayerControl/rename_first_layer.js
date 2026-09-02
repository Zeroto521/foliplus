() => {
  // Open the ⋮ menu on the first data layer (not the color basemap), then
  // click its "rename" item. Returns true when the inline rename input shows.
  const item = document.querySelector(
    '.foliplus-layer-item:not(.foliplus-color-layer-item)',
  );
  if (!item) return false;
  item.querySelector('.foliplus-layer-more-btn')?.click();
  const rename = document.querySelector(
    '.foliplus-layer-more-menu.open li[data-action="rename-layer"]',
  );
  if (!rename) return false;
  rename.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  return !!document.querySelector(".foliplus-layer-rename-input");
}
