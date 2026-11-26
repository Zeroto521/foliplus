// Focuses a row through the keyboard modality.
//
// The panel's focusin delegate samples :focus-visible once and maps it onto the
// row's .foliplus-is-focused-row class; Chrome's focus({ focusVisible }) forces
// that modality, the same path Tab takes.
selector => {
  const row = document.querySelector(selector);
  if (!row) return false;
  row.focus({ focusVisible: true });
  row.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  return row.classList.contains("foliplus-is-focused-row");
};
