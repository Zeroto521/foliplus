() => {
  // Click the first history panel item and return the input's new value,
  // so the test can assert it matches the panel's display text.
  const item = document.querySelector(".foliplus-search-result-item");
  if (!item) return null;
  item.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  const inp = document.querySelector(".foliplus-search input");
  return inp?.value ?? null;
};
