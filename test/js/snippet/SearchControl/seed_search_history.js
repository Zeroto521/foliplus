() => {
  const KEY = "foliplus_search_" + document.querySelector(".folium-map").id;
  const items = [];
  for (let i = 0; i < 25; i++) {
    items.push({
      query: "Shanghai addr " + i,
      type: "addr",
      coordDisplay: "121.4700, 31.2300",
      addrDisplay: "Shanghai addr " + i,
      lng: 121.47,
      lat: 31.23,
      ts: 1000 + i,
      count: 1,
    });
  }
  localStorage.setItem(KEY, JSON.stringify({ version: 2, entries: items }));
};
