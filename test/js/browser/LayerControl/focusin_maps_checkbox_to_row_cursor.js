() => {
  const panel = document.querySelector(".foliplus-panel-content");
  if (!panel) return null;
  const items = Array.from(
    panel.querySelectorAll(".foliplus-layer-item:not(.foliplus-color-layer-item)"),
  );
  if (items.length === 0) return null;
  const row = items[0];
  const checkbox = row.querySelector('input[type="checkbox"]');
  if (!checkbox) return null;

  // Chrome supports focus({ focusVisible }) — force the keyboard modality so
  // :focus-visible matches at the moment focusin fires, the same path Tab
  // takes. The delegate samples that once and maps it onto the row class.
  checkbox.focus({ focusVisible: true });
  checkbox.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  const litByKeyboard = row.classList.contains("foliplus-layer-focused");

  // Mouse-like focus must not light the recipe — :focus-visible is false, so
  // the delegate leaves the class off.
  checkbox.blur();
  row.classList.remove("foliplus-layer-focused");
  checkbox.focus({ focusVisible: false });
  checkbox.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  const litByMouse = row.classList.contains("foliplus-layer-focused");

  return {
    litByKeyboard,
    litByMouse,
    suppressLeft: Boolean(panel.querySelector(".foliplus-layer-focus-suppressed")),
  };
};
