() => {
  const mm = window.__measureManager;
  const layers = mm.layers.mainLayer._layers || {};
  const delMkr = Object.values(layers).find(
    l =>
      l instanceof L.Marker &&
      l.options.icon?.options?.className?.includes("foliplus-del-icon"),
  );
  if (delMkr) {
    const icon = delMkr.getElement().querySelector("[data-del-icon]");
    if (icon) icon.classList.add("visible");
    delMkr.fire("click", { originalEvent: { target: icon } });
  }
};
