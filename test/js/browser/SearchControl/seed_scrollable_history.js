() => {
  // Seed enough coordinate-mode history entries to overflow the panel's
  // 240px max-height (30 items at ~40px each ≈ 1200px), so the panel becomes
  // internally scrollable. Reload the page afterwards so the component picks
  // the history up on init. `HISTORY.STORAGE_KEY` is built from the map
  // container id; the container div is created by folium before the map script
  // runs.
  const KEY = `foliplus_search_${document.querySelector(".folium-map").id}`;
  const entries = [];
  for (let i = 0; i < 30; i++) {
    entries.push({
      query: `${(121.47 + i / 1000).toFixed(5)},${(31.23 + i / 1000).toFixed(5)}`,
      type: "coord",
      coordDisplay: `${(121.47 + i / 1000).toFixed(4)}, ${(31.23 + i / 1000).toFixed(4)}`,
      addrDisplay: `Place ${i}`,
      lng: 121.47 + i / 1000,
      lat: 31.23 + i / 1000,
      ts: 1000 + i,
      count: 1,
    });
  }
  localStorage.setItem(KEY, JSON.stringify(entries));
  return KEY;
};
