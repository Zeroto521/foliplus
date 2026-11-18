// Pins the RTD tile gridline regression: host page CSS loading after
// Leaflet's stylesheet can revert tile <img> to inline, and the baseline
// gap under each tile row shows up as white gridlines. reset.css
// restates `display: block` so it wins the cascade regardless of the
// host's stylesheet order. This probe asserts the computed display of
// the first tile <img> is "block" — the invariant that prevents the
// gridline regression.
async () => {
  const img = document.querySelector(".leaflet-container img");
  if (!img) return { ok: false, reason: "no-tile-img" };
  const display = getComputedStyle(img).display;
  return { ok: display === "block", display };
};
