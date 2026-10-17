// True while the panel at *selector* is expanded, not collapsed.
sel => {
  const c = document.querySelector(sel);
  return (
    !!c &&
    c.classList.contains("foliplus-is-expanded") &&
    !c.classList.contains("foliplus-is-collapsed")
  );
};
