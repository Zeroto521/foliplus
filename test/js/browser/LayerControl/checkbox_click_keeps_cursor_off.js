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
  // The class is sticky — nothing on the press path clears it — so a plain
  // toggle must not leave the row white + glow long after the pointer moved
  // on. Re-asserted in step 2 to catch a click handler that only skipped the
  // first press.
  checkbox.click();
  const afterClick = lit(row);

  // 2) Repeated toggles stay quiet.
  checkbox.click();
  const afterAgain = lit(row);

  // 3) The press contract rests on one browser fact: the focus a mouse press
  // causes reports :focus-visible false, so focusin never lights the class. If
  // Chromium ever changes that, step 3 would go false and steps 1-2 would stop
  // being meaningful — measure the precondition instead of assuming it.
  checkbox.click();
  const pressFocusVisible = checkbox.matches(":focus-visible");

  // 4) Keyboard focus still lights the row — the recipe itself is intact, only
  // the pointer path stopped reaching for it. Real Chromium focus after a
  // mouse press reports :focus-visible false, so this is the only route into
  // the class from a press; the press contract in steps 1-2 rests on that.
  checkbox.focus({ focusVisible: true });
  checkbox.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  const litByKeyboard = lit(row);

  // 5) The other row's press lights neither row. The class is dropped here to
  // isolate step 5 from step 4's positive assertion.
  checkbox.blur();
  row.classList.remove("foliplus-layer-focused");
  otherBox.click();
  const otherClick = {
    first: lit(row),
    second: lit(other),
    anyClass: Boolean(panel.querySelector(".foliplus-layer-focused")),
  };

  return {
    afterClick,
    afterAgain,
    pressFocusVisible,
    litByKeyboard,
    otherClick,
  };
};
