() => {
  // Stub a geolocation that never settles, then press locate. The button must
  // report busy while the request is in flight.
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: success => {
        window.__resolveLocate = success;
      },
    },
  });
  const btn = document.querySelector(".foliplus-locate-btn");
  btn.click();
  return {
    loading: btn.classList.contains("loading"),
    // display cascades, so measure the wrapper spans — the children report
    // block even when their parent is hidden.
    iconVisible: visible(btn, ".locate-btn-icon"),
    spinnerVisible: visible(btn, ".locate-btn-loading"),
    // The shared foliplus spinner animation must be running, not just present.
    spinnerAnimating: animating(btn, ".locate-btn-loading .foliplus-spin"),
  };
  function visible(el, sel) {
    const node = el.querySelector(sel);
    return node !== null && getComputedStyle(node).display !== "none";
  }
  function animating(el, sel) {
    const node = el.querySelector(sel);
    return node !== null && getComputedStyle(node).animationName === "foliplus-spin";
  }
};
