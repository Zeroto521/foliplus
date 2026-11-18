// Pins the RTD tile gridline regression (#151 / task-199).
// Leaflet's own CSS declares `.leaflet-container img { display: block }`
// to suppress the inline-image baseline gap that appears as white
// gridlines between tile rows. #1173 added `.leaflet-container {
// font-size: var(--foliplus-font-size-xs) }` to reset.css, which changed
// the line-box metrics inside the container. The fix restates the
// `display: block` rule in our reset.css so it wins the cascade
// regardless of RTD theme CSS load order.
//
// This probe asserts the computed display of the first tile <img> is
// "block" — the invariant that prevents the gridline regression.
async () => {
  const img = document.querySelector(".leaflet-container img");
  if (!img) return { ok: false, reason: "no-tile-img" };
  const display = getComputedStyle(img).display;
  return { ok: display === "block", display };
};