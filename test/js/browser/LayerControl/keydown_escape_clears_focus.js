() => {
  const panel = document.querySelector(".foliplus-panel-content");
  if (!panel) return null;
  const items = Array.from(
    panel.querySelectorAll(".foliplus-layer-item:not(.foliplus-color-layer-item)"),
  );
  if (items.length === 0) return null;
  // The style half of this probe needs a CHECKED row: the selected styling
  // (accent wash, black type icon) only exists on .active rows, and the bug
  // being pinned is that it must survive Escape while the suppression rule
  // is active (:focus-visible still matching on the row that kept focus).
  const checked = items.find(i => i.classList.contains("active")) ?? items[0];
  checked.focus();
  const rowStyles = el => {
    const cs = getComputedStyle(el);
    const icon = el.querySelector(".foliplus-type-icon-col");
    return {
      bg: cs.backgroundColor,
      shadow: cs.boxShadow,
      icon: icon ? getComputedStyle(icon).color : null,
    };
  };
  const beforeStyles = rowStyles(checked);
  checked.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  const afterStyles = rowStyles(checked);
  const checkedRetainedFocus = document.activeElement === checked;
  const checkedSuppressed = checked.classList.contains(
    "foliplus-layer-focus-suppressed",
  );
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
    // Escape must not blur to <body> — the cursor is lifted in place, and the
    // suppression marker is what makes it visible while :focus-visible still
    // matches on the row that kept DOM focus.
    focusRetained: beforeActive === afterActive,
    suppressed: afterActive?.classList.contains("foliplus-layer-focus-suppressed"),
    // Sanity for the style assertions below: the cursor recipe must have been
    // drawn before Escape (:focus-visible matched), otherwise the comparisons
    // would pass vacuously.
    glowVisibleBefore: beforeStyles.shadow !== "none",
    // Escape restores the selected wash: on a checked row the cursor recipe
    // paints the surface white, and the suppressed reset paints it
    // transparent — the accent wash is the only state left that is neither.
    washRestored:
      afterStyles.bg !== "rgba(0, 0, 0, 0)" && afterStyles.bg !== "rgb(255, 255, 255)",
    // The type icon stays black: the cursor recipe and the selected state
    // both wake it to text-primary, so cancelling must not mute it.
    iconKeptBlack: afterStyles.icon === beforeStyles.icon,
    // The cursor-only glow is gone.
    glowCleared: afterStyles.shadow === "none",
    checkedRetainedFocus,
    checkedSuppressed,
  };
};
