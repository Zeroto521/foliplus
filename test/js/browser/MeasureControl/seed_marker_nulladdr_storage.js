() => {
  const data = [
    {
      id: "foliplus_measure_marker_nulladdr",
      type: "marker",
      lng: 119.3,
      lat: 26.08,
      address: null,
    },
  ];
  localStorage.setItem(window.__measureStorageKey, JSON.stringify(data));
};
