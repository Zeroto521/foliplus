() => {
  const agg = document.querySelector(".foliplus-heatmap-ctrl select[data-heatmap-agg]");
  agg.value = "sum";
  agg.dispatchEvent(new Event("change", { bubbles: true }));
};
