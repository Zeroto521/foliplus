// Shared browser prelude: park the reverse-geocode request until released.
//
// Installed via page.add_init_script (before the page's own scripts), so the
// geocoder's fetch wrapper captures this function. A Nominatim reverse request
// is held until `window.__releaseReverseGeocode()` runs, which answers it with
// a canned payload instead of the network.
//
// Why: test_popup_spinner_stays_bounded asserts on the popup's *pending* state
// (the loading spinner). That state lasts exactly as long as the reverse
// round-trip, so a fast answer lands the address before the test reads the
// popup and the assertion flips. Measured on main 7b2b943d with the reverse
// request answered immediately: 5/5 failures. Holding the request makes the
// pending state deterministic and keeps the case off the network.
//
// The canned reply keeps the release assertion offline too: it proves the held
// state is the live pending state of a real flow (the popup transitions to an
// address once the request settles), not a frozen DOM.
(function () {
  if (window.__geoHold) return;
  const real = window.fetch;
  const reply = {
    display_name: "Test Street, Test City",
    lon: "119.3",
    lat: "26.08",
  };
  window.__geoHold = { seen: 0, urls: [] };
  window.fetch = function (input) {
    const url = String((input && input.url) || input);
    if (!/nominatim\.openstreetmap\.org\/reverse/.test(url)) {
      return real.apply(this, arguments);
    }
    window.__geoHold.seen += 1;
    window.__geoHold.urls.push(url);
    return new Promise(function (resolve) {
      window.__releaseReverseGeocode = function () {
        resolve(
          new Response(JSON.stringify(reply), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
        window.__releaseReverseGeocode = null;
      };
    });
  };
})();
