() => {
  // Seed one coordinate-mode history entry whose reverse-geocoded address
  // ("Shanghai, China") differs from its stored key ("121.47,31.23").
  // Reload the page afterwards so the component picks it up on init.
  // `HISTORY.STORAGE_KEY` is built from the map container id; the
  // container div is created by folium before the map script runs.
  const KEY = `foliplus_search_${document.querySelector(".folium-map").id}`;
  localStorage.setItem(
    KEY,
    JSON.stringify([
      {
        query: "121.47,31.23",
        type: "coord",
        coordDisplay: "121.4700, 31.2300",
        addrDisplay: "Shanghai, China",
        lng: 121.47,
        lat: 31.23,
        ts: 1000,
        count: 1,
      },
    ]),
  );
  return KEY;
};
