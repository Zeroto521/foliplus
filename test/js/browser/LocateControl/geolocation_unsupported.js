() => {
  // Disable navigator.geolocation so clicking the locate button shows an
  // error hint instead of trying to locate.
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: undefined,
  });
  document.querySelector(".foliplus-locate-btn").click();
};
