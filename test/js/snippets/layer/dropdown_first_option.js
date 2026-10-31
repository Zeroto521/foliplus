() => {
  const list = [...document.querySelectorAll(".foliplus-dropdown-list")].find(
    l => !l.hidden,
  );
  const option = list
    ? list.querySelector(".foliplus-dropdown-option:not([disabled])")
    : null;
  if (!option) return null;
  const r = option.getBoundingClientRect();
  return {
    label: (option.textContent || "").trim(),
    x: Math.round(r.left + r.width / 2),
    y: Math.round(r.top + r.height / 2),
  };
};
