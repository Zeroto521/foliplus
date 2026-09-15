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

  // 1) A checkbox press toggles visibility without painting the cursor visual.
  // The cursor recipe is sticky — nothing on the toggle path clears it — so a
  // plain toggle must not leave the row white + glow long after the pointer
  // moved on. The keyboard *index* still re-homes, so the click contract is
  // asserted separately (keydown_after_label_click_targets_clicked_row).
  checkbox.click();
  const afterClick = lit(row);

  // 2) Repeated toggles stay quiet.
  checkbox.click();
  const afterAgain = lit(row);

  // 3) Keyboard-modality focus still lights the row — the recipe itself is
  // intact, only the pointer path stopped reaching for it.
  checkbox.focus({ focusVisible: true });
  checkbox.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  const litByKeyboard = lit(row);

  // 4) The other row's toggle does not light either row.
  checkbox.blur();
  row.classList.remove("foliplus-layer-focused");
  otherBox.click();
  const otherClick = {
    first: lit(row),
    second: lit(other),
    anyClass: Boolean(panel.querySelector(".foliplus-layer-focused")),
  };

  return { afterClick, afterAgain, litByKeyboard, otherClick };
};
