() => {
  // Release the reverse request parked by hold_reverse_geocode.js. Returns
  // false when nothing is parked: the prelude was not installed, or the flow
  // never issued the request.
  if (typeof window.__releaseReverseGeocode !== "function") return false;
  window.__releaseReverseGeocode();
  return true;
};
