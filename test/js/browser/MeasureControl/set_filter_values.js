values => {
  const select = document.querySelector(".foliplus-filter-enum");
  if (!select) return { ok: false, reason: "no-listbox" };
  for (const option of Array.from(select.options)) {
    option.selected = values.includes(option.value);
  }
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true };
};
