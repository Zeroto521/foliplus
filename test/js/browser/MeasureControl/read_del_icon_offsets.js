() => {
  const mm = window.__measureManager;
  const map = window.__map;
  const P = (lat, lng) => L.latLng(lat, lng);

  // distance: two clicks + contextmenu to finish
  mm.setMode("distance");
  map.fire("click", { latlng: P(26.08, 119.3) });
  map.fire("click", { latlng: P(26.09, 119.31) });
  map.fire("contextmenu", { latlng: P(26.09, 119.31) });

  // circle: center + edge clicks
  mm.setMode("circle");
  map.fire("click", { latlng: P(26.05, 119.28) });
  map.fire("click", { latlng: P(26.06, 119.29) });

  // polygon: 4 clicks + contextmenu to finish
  mm.setMode("polygon");
  map.fire("click", { latlng: P(26.1, 119.35) });
  map.fire("click", { latlng: P(26.11, 119.36) });
  map.fire("click", { latlng: P(26.09, 119.37) });
  map.fire("click", { latlng: P(26.08, 119.36) });
  map.fire("contextmenu", { latlng: P(26.08, 119.36) });

  // Show all delete icons so they get DOM elements
  document.querySelectorAll("[data-del-icon]").forEach(i => i.classList.add("visible"));
  map.invalidateSize();

  // Collect every delIcon's offset relative to its anchor point.
  // A delIcon is a Leaflet marker whose wrapper is `.foliplus-del-icon`
  // (0×0); the visible ✕ is the inner `[data-del-icon]`.
  const result = { modes: {} };
  const dels = [];
  const walk = node => {
    if (!node) return;
    if (typeof node.eachLayer === "function") node.eachLayer(walk);
    if (node._layers && typeof node._layers === "object")
      Object.values(node._layers).forEach(walk);
    if (node instanceof L.Marker) {
      const cls = node.options?.icon?.options?.className || "";
      if (String(cls).includes("foliplus-del-icon")) dels.push(node);
    }
  };
  walk(mm.layers.mainLayer);

  const seenLL = new Set();
  for (const l of dels) {
    const ll = l.getLatLng();
    if (!ll) continue;
    const llKey = `${ll.lat.toFixed(6)},${ll.lng.toFixed(6)}`;
    if (seenLL.has(llKey)) continue; // 递归会重复访问嵌套 group，去重
    seenLL.add(llKey);
    const wrap = l.getElement();
    const inner = wrap?.querySelector?.("[data-del-icon]") || wrap;
    if (!inner) continue;
    const rect = inner.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue; // 不可见
    const anchor = map.latLngToContainerPoint(ll);
    result.modes[llKey] = {
      title: l.options.title || "x",
      dx: rect.left + rect.width / 2 - anchor.x,
      dy: rect.top + rect.height / 2 - anchor.y,
    };
  }
  return result;
};
