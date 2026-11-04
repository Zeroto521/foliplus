() => {
  const ctrl = document.querySelector(".foliplus-search");
  const panel = document.querySelector(".foliplus-search-result-panel");
  const mapEl = document.querySelector(".foliplus-map, .leaflet-container");
  const rect = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    };
  };
  const cs = panel ? getComputedStyle(panel) : null;
  return {
    viewport: { innerWidth: window.innerWidth, innerHeight: window.innerHeight },
    control: rect(ctrl),
    panel: rect(panel),
    panelClass: panel ? panel.className : null,
    // First result item's height, for the B4 minimum-height floor (2 rows).
    itemHeight: (() => {
      const item = document.querySelector(".foliplus-search-result-item");
      return item ? item.getBoundingClientRect().height : 0;
    })(),
    panelStyle: panel
      ? {
          left: panel.style.left,
          top: panel.style.top,
          maxWidth: panel.style.maxWidth,
          maxHeight: panel.style.maxHeight,
        }
      : null,
    panelComputed: cs ? { maxHeight: cs.maxHeight, overflowY: cs.overflowY } : null,
    panelScroll: panel
      ? { scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight }
      : null,
    mapRect: rect(mapEl),
  };
};
