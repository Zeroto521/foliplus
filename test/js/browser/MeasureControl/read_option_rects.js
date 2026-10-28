() => {
  const trigger = document.querySelector(
    ".foliplus-filter-enum .foliplus-dropdown-trigger",
  );
  const list = document.querySelector(".foliplus-dropdown-list");
  if (!trigger || !list) return null;
  if (list.hidden) trigger.click();
  return Array.from(document.querySelectorAll(".foliplus-dropdown-option")).map(el => {
    const rect = el.getBoundingClientRect();
    return {
      value: el.getAttribute("data-value"),
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      selected: el.getAttribute("aria-selected") === "true",
    };
  });
};
