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

  // 1) Repeated pointer toggles must not light the row.
  const clickStates = [];
  for (let i = 0; i < 3; i++) {
    checkbox.click();
    clickStates.push(lit(row));
  }

  // 2) Keyboard still lights the row (Tab/arrow path via the JS class).
  row.focus();
  row.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  const afterArrow = panel.querySelector(".foliplus-layer-focused");
  const keyboardLit = Boolean(afterArrow);

  // 3) A pointer click on another row must drop the stale keyboard cursor.
  otherBox.click();
  const stale = {
    first: lit(row),
    second: lit(other),
    anyClass: Boolean(panel.querySelector(".foliplus-layer-focused")),
  };

  return {
    anyClickCursor: clickStates.some(s => s.focusedClass || s.glow),
    keyboardLit,
    stale,
  };
};
