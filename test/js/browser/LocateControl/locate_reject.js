() => {
  // Stub a geolocation that rejects, then press locate and settle it. The
  // spinner must appear on the request and be gone once the error lands.
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (success, error) => {
        window.__rejectLocate = () => error({ code: 1, message: "denied" });
      },
    },
  });
  const btn = document.querySelector(".foliplus-locate-btn");
  btn.click();
  const pending = {
    loading: btn.classList.contains("loading"),
    iconVisible: visible(btn, ".locate-btn-icon"),
    spinnerVisible: visible(btn, ".locate-btn-loading"),
  };
  window.__rejectLocate();
  return {
    ...pending,
    loadingAfter: btn.classList.contains("loading"),
    spinnerVisibleAfter: visible(btn, ".locate-btn-loading"),
  };
  function visible(el, sel) {
    const node = el.querySelector(sel);
    return node !== null && getComputedStyle(node).display !== "none";
  }
};
