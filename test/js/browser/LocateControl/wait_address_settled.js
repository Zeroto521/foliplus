() => {
  // The popup has left the pending state: the parked reverse request was
  // released and the canned address painted. Used as a wait_for_function
  // predicate after release_reverse_geocode.js.
  const p = document.querySelector(".foliplus-popup-content");
  return !!p && p.textContent.includes("Test Street");
};
