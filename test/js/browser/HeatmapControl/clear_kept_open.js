// Reads the heatmap panel after Clear: it must stay expanded, and focus must
// land on the layer trigger because Clear hides its own row.
() => {
  const shell = document.querySelector(".foliplus-heatmap-ctrl");
  const layer = document.querySelector("[data-heatmap-layer]");
  return {
    expanded: !!shell && shell.classList.contains("foliplus-is-expanded"),
    focusIsLayerTrigger:
      !!layer &&
      document.activeElement === layer.parentElement?.querySelector("button"),
  };
};
