// Drops the keyboard cursor: blurs the active element and removes the row
// class the focusin delegate set, so the next read measures a resting row.
() => {
  const active = document.activeElement;
  if (active && typeof active.blur === "function") active.blur();
  document
    .querySelectorAll(".foliplus-is-focused-row")
    .forEach(row => row.classList.remove("foliplus-is-focused-row"));
  return true;
};
