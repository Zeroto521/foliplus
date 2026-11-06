count => {
  const KEY = `foliplus_search_${document.querySelector(".folium-map").id}`;
  const entries = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      query: `121.47,${31.23 + i}`,
      type: "coord",
      coordDisplay: `121.4700, ${(31.23 + i).toFixed(2)}`,
      addrDisplay: `Shanghai, China #${i}`,
      lng: 121.47,
      lat: 31.23 + i,
      ts: 1000 + i,
      count: 1,
    });
  }
  localStorage.setItem(KEY, JSON.stringify(entries));
  return KEY;
};
