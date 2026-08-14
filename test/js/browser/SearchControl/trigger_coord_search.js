() => {
  // Expand the control and run a coordinate search (default mode).
  // SearchControl expects "longitude,latitude" order.
  const toggle = document.querySelector(".foliplus-search .foliplus-toggle-btn");
  if (toggle) toggle.click();
  const inp = document.querySelector("input");
  if (!inp) return false;
  inp.value = "119.30,26.08";
  inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  return true;
};
