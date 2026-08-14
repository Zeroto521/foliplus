() => {
  // Click the locate button with a stubbed geolocation; report whether
  // getCurrentPosition was invoked.
  let invoked = false;
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (s, e, o) => {
        invoked = true;
        s({ coords: { longitude: 119.3, latitude: 26.08 } });
      },
    },
  });
  document.querySelector(".foliplus-locate-btn").click();
  return invoked;
};
