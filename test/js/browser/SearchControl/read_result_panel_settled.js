() => {
  const panel = document.querySelector(".foliplus-search-result-panel");
  return !!panel && getComputedStyle(panel).transform === "none";
};
