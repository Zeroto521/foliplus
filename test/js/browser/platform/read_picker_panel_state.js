// Reads the scheme list together with the panel that owns it, after an
// interaction that may have collapsed or removed that panel.
() => {
  const list = document.querySelector(".foliplus-scheme-picker-portal");
  const layerCtrl = document.querySelector(".foliplus-layer-ctrl");
  const heatCtrl = document.querySelector(".foliplus-heatmap-ctrl");
  const state = el => {
    if (!el) return null;
    const cls = el.classList;
    return {
      expanded: cls.contains("foliplus-is-expanded"),
      collapsed: cls.contains("foliplus-is-collapsed"),
      visible: el.getBoundingClientRect().height > 0,
    };
  };
  return {
    open: !!list,
    portalCount: document.querySelectorAll(".foliplus-scheme-picker-portal").length,
    hostTag:
      list && list.parentElement ? list.parentElement.tagName.toLowerCase() : null,
    hostClass: list && list.parentElement ? list.parentElement.className : null,
    layer: state(layerCtrl),
    heatmap: state(heatCtrl),
    stylePanelOpen: !!document.querySelector(".foliplus-layer-style-panel"),
    styleDrawerVisible: (() => {
      const drawer = document.querySelector(".foliplus-layer-style-panel");
      return !!drawer && drawer.getBoundingClientRect().height > 0;
    })(),
  };
};
