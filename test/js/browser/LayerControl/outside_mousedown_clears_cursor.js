() => {
  const panel = document.querySelector(".foliplus-panel-content");
  if (!panel) return null;
  const items = Array.from(
    panel.querySelectorAll(
      ".foliplus-layer-item:not(.foliplus-color-layer-item), .foliplus-layer-toggle-all",
    ),
  );
  if (items.length < 2) return null;
  const first = items[0];
  first.focus();
  first.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  const before = Boolean(panel.querySelector(".foliplus-layer-focused"));
  // mousedown on the document body (outside the layer control) must drop the
  // keyboard cursor: it is a panel-local navigation marker, not a persistent
  // selection. mousedown (not click) is used so a click that rebuilds the list
  // (e.g. a fold button inside the panel) never hits this path.
  document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  const after = Boolean(panel.querySelector(".foliplus-layer-focused"));
  return { before, after };
};
