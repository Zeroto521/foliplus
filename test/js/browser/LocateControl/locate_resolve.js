() => {
  // Settle the pending geolocation from locate_pending.js; the spinner must
  // give way to the crosshair again.
  window.__resolveLocate({ coords: { longitude: 119.3, latitude: 26.08 } });
  const btn = document.querySelector(".foliplus-locate-btn");
  return {
    loading: btn.classList.contains("loading"),
    // display cascades, so measure the wrapper spans.
    iconVisible: visible(btn, ".locate-btn-icon"),
    spinnerVisible: visible(btn, ".locate-btn-loading"),
  };
  function visible(el, sel) {
    const node = el.querySelector(sel);
    return node !== null && getComputedStyle(node).display !== "none";
  }
};
