() => {
  // Seed one coordinate-mode history entry whose reverse-geocoded address
  // ("Shanghai, China") differs from its canonical query ("121.47,31.23").
  // Reload the page afterwards so the component picks it up on init.
  const KEY = "foliplus.search_history";
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
