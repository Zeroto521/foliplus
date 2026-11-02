() => {
  const select = document.querySelector(".foliplus-style-fill-mode-select");
  if (!select) return false;
  select.value = "ramp";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
};
