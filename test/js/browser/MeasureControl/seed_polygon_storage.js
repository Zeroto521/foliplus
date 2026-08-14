() => {
  const data = [
    {
      id: "foliplus_measure_polygon_1",
      type: "polygon",
      points: [
        { lng: 119.3, lat: 26.08 },
        { lng: 119.31, lat: 26.09 },
        { lng: 119.32, lat: 26.07 },
      ],
      segments: [
        { lng: 119.305, lat: 26.085, distance: 1234 },
        { lng: 119.315, lat: 26.08, distance: 2345 },
        { lng: 119.31, lat: 26.075, distance: 3456 },
      ],
      area: 500000,
    },
  ];
  localStorage.setItem(window.__measureStorageKey, JSON.stringify(data));
};
