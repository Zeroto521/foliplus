values => {
  const trigger = document.querySelector(
    ".foliplus-filter-enum .foliplus-dropdown-trigger",
  );
  const list = document.querySelector(".foliplus-dropdown-list");
  if (!trigger || !list) return { ok: false, reason: "no-dropdown" };
  if (list.hidden) trigger.click();
  const optionEls = () =>
    Array.from(document.querySelectorAll(".foliplus-dropdown-option"));
  const isSelected = el => el.getAttribute("aria-selected") === "true";
  // Toggle only the rows whose state differs from the requested set: each press
  // writes through the owner, and a pick keeps the popup open by design.
  for (const el of optionEls()) {
    const value = el.getAttribute("data-value");
    if (values.includes(value) !== isSelected(el)) el.click();
  }
  return { ok: true };
};
