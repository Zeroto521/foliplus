values => {
  const details = document.querySelector(".foliplus-filter-enum");
  const summary = document.querySelector(".foliplus-filter-enum-trigger");
  if (!details || !summary) return { ok: false, reason: "no-disclosure" };
  if (!details.open) summary.click();
  // Re-query after every click: a filter write can rebuild the row/panel, so a
  // stale NodeList would dispatch on detached nodes.
  const valuesNow = () =>
    Array.from(
      document.querySelectorAll(".foliplus-filter-enum-option input[data-value]"),
    ).map(box => box.dataset.value);
  for (const value of valuesNow()) {
    const box = document.querySelector(
      '.foliplus-filter-enum-option input[data-value="' + value + '"]',
    );
    if (box && box.checked !== values.includes(value)) box.click();
  }
  const current = document.querySelector(".foliplus-filter-enum");
  if (current) current.open = false;
  return { ok: true };
};
