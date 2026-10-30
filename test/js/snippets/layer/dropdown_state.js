() => {
  const rowPanel = document.querySelector('.foliplus-layer-ctrl');
  const drawer = document.querySelector('.foliplus-layer-style-panel');
  return {
    rowPanelExpanded: rowPanel ? rowPanel.classList.contains('foliplus-is-expanded') : null,
    drawerVisible: !!drawer && drawer.getBoundingClientRect().height > 0,
    openLists: [...document.querySelectorAll('.foliplus-dropdown-list')].filter(l => !l.hidden).length,
  };
}
