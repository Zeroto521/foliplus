() => {
  // The ordering pass must agree with the birth value: run it here and read
  // every recorded pane's z again. A pane born at its slot z reads identical.
  const z = el => (el ? getComputedStyle(el).zIndex : null);
  const api = window.map && window.map.foliplus && window.map.foliplus.LayerAPI;
  if (api && typeof api.enforceOrder === "function") api.enforceOrder();

  const panes = {};
  for (const e of window.__t203Panes || []) {
    panes[e.name] = {
      zAtCreate: e.zAtCreate,
      zAtMicrotask: e.zAtMicrotask,
      zAfterOrder: z(window.map.getPane(e.name)),
    };
  }
  return { hooked: Boolean(window.__t203Hooked), panes };
};
