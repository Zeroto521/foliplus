() => {
  // Expand, ArrowDown onto the seeded coord history entry, then return the
  // input value — must be the canonical query, not the reverse-geocoded
  // address. The panel must show history on focus (empty input).
  const inp = document.querySelector(".foliplus-search input");
  if (!inp) return { value: null, error: "no input" };
  inp.focus();
  const panel = document.querySelector(".foliplus-search-result-panel");
  if (!panel) return { value: null, error: "no history panel" };
  const item = panel.querySelector(".foliplus-search-result-item");
  if (!item) return { value: null, error: "no result item" };
  inp.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  return {
    value: inp.value,
    dataQuery: item.getAttribute("data-query"),
    error: null,
  };
};
