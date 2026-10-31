() => {
  const ctrl = document.querySelector(".foliplus-heatmap-ctrl");
  return {
    panelExpanded: ctrl.classList.contains("foliplus-is-expanded"),
    openLists: [...document.querySelectorAll(".foliplus-dropdown-list")].filter(
      l => !l.hidden,
    ).length,
    changes: window.__changes || [],
  };
};
