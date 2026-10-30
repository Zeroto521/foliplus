() => {
  const active = document.activeElement;
  const agg = document.querySelector(".foliplus-heatmap-ctrl select[data-heatmap-agg]");
  const aggTrigger = agg
    .closest(".foliplus-form-row")
    .querySelector(".foliplus-dropdown-trigger");
  return {
    onBody: active === document.body,
    onAggTrigger: active === aggTrigger,
    openLists: [...document.querySelectorAll(".foliplus-dropdown-list")].filter(
      list => !list.hidden,
    ).length,
  };
};
