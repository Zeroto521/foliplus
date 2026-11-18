// Read the fold-panel + overflow-menu exclusion state after an interaction.
// Each control answers {expanded, collapsed} (or null when not on the page);
// menuOpen tells whether the ⋮ overflow menu is up.
() => {
  const cls = sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const c = el.classList;
    return {
      expanded: c.contains("foliplus-is-expanded"),
      collapsed: c.contains("foliplus-is-collapsed"),
    };
  };
  return {
    heatmap: cls(".foliplus-heatmap-ctrl"),
    layer: cls(".foliplus-layer-ctrl"),
    measure: cls(".foliplus-measure-ctrl"),
    search: cls(".foliplus-search"),
    menuOpen: !!document.querySelector(".foliplus-layer-more-menu.open"),
    attrsOpen: !!document.querySelector(".foliplus-layer-attrs-panel"),
  };
};
