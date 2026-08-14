() => {
  const data = [
    {
      id: "foliplus_measure_distance_1",
      type: "distance",
      points: [
        { lng: 119.3, lat: 26.08 },
        { lng: 119.31, lat: 26.09 },
      ],
      segments: [{ lng: 119.305, lat: 26.085, distance: 1234.56 }],
    },
  ];
  localStorage.setItem(window.__measureStorageKey, JSON.stringify(data));
};
