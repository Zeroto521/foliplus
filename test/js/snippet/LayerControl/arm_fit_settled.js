() => {
  window.__fitSettled = false;
  window.map.once("moveend", () => {
    window.__fitSettled = true;
  });
}
