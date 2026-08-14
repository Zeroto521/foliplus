() => {
  const data = [
    {
      id: "foliplus_measure_circle_1",
      type: "circle",
      center: { lng: 119.3, lat: 26.08 },
      target: { lng: 119.31, lat: 26.09 },
      radius: 500,
    },
  ];
  localStorage.setItem(window.__measureStorageKey, JSON.stringify(data));
};
