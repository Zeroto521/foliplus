() => {
  const data = [
    {
      id: "foliplus_measure_marker_1",
      type: "marker",
      lng: 119.3,
      lat: 26.08,
      address: "Test Address",
    },
  ];
  localStorage.setItem(window.__measureStorageKey, JSON.stringify(data));
};
