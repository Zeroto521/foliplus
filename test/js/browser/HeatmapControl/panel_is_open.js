() => {
  // True while the heatmap panel is expanded, not collapsed.
  const c = document.querySelector(".foliplus-heatmap-ctrl");
  return (
    !!c &&
    c.classList.contains("foliplus-is-expanded") &&
    !c.classList.contains("foliplus-is-collapsed")
  );
};
