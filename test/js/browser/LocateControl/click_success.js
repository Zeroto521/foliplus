() => {
  // Stub a successful geolocation and click the locate button.
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (s) => {
        s({ coords: { longitude: 119.3, latitude: 26.08 } });
      },
    },
  });
  document.querySelector(".foliplus-locate-btn").click();
};
