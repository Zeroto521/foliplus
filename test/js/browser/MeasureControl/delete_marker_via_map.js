() => {
  const map = window.__map;
  const delMkr = Object.values(map._layers).find(
    l =>
      l instanceof L.Marker &&
      l.options.icon?.options?.className?.includes("foliplus-del-icon"),
  );
  if (delMkr) {
    const icon = delMkr.getElement().querySelector(".foliplus-measure-del-icon");
    if (icon) icon.classList.add("visible");
    delMkr.fire("click", { originalEvent: { target: icon } });
  }
};
