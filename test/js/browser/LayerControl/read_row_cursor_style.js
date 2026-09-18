() => {
  const panel = document.querySelector(".foliplus-panel-content");
  if (!panel) return null;
  const items = Array.from(
    panel.querySelectorAll(
      ".foliplus-layer-item:not(.foliplus-color-layer-item), .foliplus-layer-toggle-all",
    ),
  );
  if (items.length < 2) return null;
  // Drive the keyboard cursor onto the next navigable row (the fold row's
  // ArrowDown land on the first data item), the same path the user's arrow
  // keys trigger. The row the cursor lands on carries .foliplus-layer-focused.
  const first = items[0];
  first.focus();
  first.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  const focused = panel.querySelector(".foliplus-layer-focused");
  if (!focused) return { error: "no .foliplus-layer-focused row after ArrowDown" };
  const pick = el => {
    const cs = getComputedStyle(el);
    const drag = el.querySelector(".drag-handle");
    return {
      bg: cs.backgroundColor,
      shadow: cs.boxShadow,
      outline: cs.outlineStyle,
      drag: drag ? getComputedStyle(drag).opacity : null,
    };
  };
  return pick(focused);
};
