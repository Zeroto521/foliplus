() => {
  const panel = document.querySelector(".foliplus-panel-content");
  if (!panel) return null;
  const items = Array.from(
    panel.querySelectorAll(".foliplus-layer-item:not(.foliplus-color-layer-item)"),
  );
  if (items.length < 2) return null;
  const row = items[0];
  const other = items[1];
  const checkbox = row.querySelector('input[type="checkbox"]');
  const otherBox = other.querySelector('input[type="checkbox"]');
  if (!checkbox || !otherBox) return null;

  const lit = el => ({
    focusedClass: el.classList.contains("foliplus-layer-focused"),
    glow: getComputedStyle(el).boxShadow !== "none",
  });

  // 1) Click lights the row and keeps it (until Escape / another row / outside).
  checkbox.click();
  const afterClick = lit(row);

  // 2) Repeated clicks stay on the same row.
  checkbox.click();
  const afterAgain = lit(row);

  // 3) Clicking another row hands the visual over.
  otherBox.click();
  const handedOver = {
    first: lit(row),
    second: lit(other),
    anyClass: Boolean(panel.querySelector(".foliplus-layer-focused")),
  };

  return { afterClick, afterAgain, handedOver };
};
