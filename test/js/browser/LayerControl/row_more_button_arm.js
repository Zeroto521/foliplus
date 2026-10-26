// Focus the first overlay row's ⋮ button and record the owning layer's
// checkbox state, so the caller can press a real activation key and read what
// the browser did with it.
() => {
  const row = document.querySelector(".foliplus-layer-item[data-layer-type=overlay]");
  if (!row) return { error: "no overlay row" };
  const more = row.querySelector(".foliplus-layer-more-btn");
  if (!more) return { error: "no more button" };
  const cb = row.querySelector('input[type="checkbox"]');
  more.focus();
  return {
    checkboxBefore: cb ? cb.checked : null,
    focusedClass: String(document.activeElement.className),
  };
};
