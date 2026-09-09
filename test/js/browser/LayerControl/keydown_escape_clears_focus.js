() => {
  const panel = document.querySelector(".foliplus-panel-content");
  if (!panel) return null;
  const items = Array.from(
    panel.querySelectorAll(".foliplus-layer-item:not(.foliplus-color-layer-item)"),
  );
  if (items.length === 0) return null;
  // The style half of this probe needs a CHECKED row: the selected styling
  // (accent wash, black type icon) only exists on .active rows, and Escape
  // must restore that rest state once the JS cursor class is lifted.
  const checked = items.find(i => i.classList.contains("active")) ?? items[0];
  checked.focus();
  const rowStyles = el => {
    const cs = getComputedStyle(el);
    const icon = el.querySelector(".foliplus-type-icon-col");
    return {
      bg: cs.backgroundColor,
      shadow: cs.boxShadow,
      outline: cs.outlineStyle,
      icon: icon ? getComputedStyle(icon).color : null,
    };
  };
  const beforeStyles = rowStyles(checked);
  checked.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  const afterStyles = rowStyles(checked);
  const checkedRetainedFocus = document.activeElement === checked;
  // Navigation half: establish the cursor with ArrowDown, then Escape it, so
  // the class-level contract is asserted on the real keyboard path too.
  checked.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  const beforeEscape = panel.querySelector(".foliplus-layer-focused");
  const beforeActive = document.activeElement;
  checked.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  const afterEscape = panel.querySelector(".foliplus-layer-focused");
  const afterActive = document.activeElement;
  return {
    beforeEscape: !!beforeEscape,
    afterEscape: !!afterEscape,
    focusCleared: !afterEscape,
    // Escape must not blur to <body> — the cursor is lifted in place by
    // removing the JS class; the CSS recipe never keys on :focus-visible.
    focusRetained: beforeActive === afterActive,
    // Sanity for the style assertions below: the cursor recipe must have been
    // drawn before Escape (the JS class was on the row), otherwise the
    // comparisons would pass vacuously.
    glowVisibleBefore: beforeStyles.shadow !== "none",
    // Escape restores the selected wash: on a checked row the accent wash is
    // the only surface a row paints, so once the glow clears the computed
    // background must be the wash again — neither the clear (unchecked) surface
    // nor any white override.
    washRestored:
      afterStyles.bg !== "rgba(0, 0, 0, 0)" && afterStyles.bg !== "rgb(255, 255, 255)",
    // The type icon stays black: the cursor recipe and the selected state
    // both wake it to text-primary, so cancelling must not mute it.
    iconKeptBlack: afterStyles.icon === beforeStyles.icon,
    // The cursor-only glow is gone.
    glowCleared: afterStyles.shadow === "none",
    // Escape keeps DOM focus on the row; the browser's default dark outline
    // must stay suppressed there too — the glow is the only focus signal.
    outlineCleared: afterStyles.outline === "none",
    checkedRetainedFocus,
  };
};
