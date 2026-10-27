() => {
  const select = document.querySelector(".foliplus-filter-enum");
  if (!select) return null;
  return Array.from(select.options).map(option => {
    const rect = option.getBoundingClientRect();
    return {
      value: option.value,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      selected: option.selected,
    };
  });
};
