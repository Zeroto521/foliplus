// Replace the container's `requestFullscreen` with a promise that always
// rejects. This is the shape of a realistic browser-policy denial: the
// API is available, but the container refuses the request. Reject must
// not run `updateUI`, which would announce "Entered fullscreen" for a
// click that just failed.
() => {
  document.querySelector(".leaflet-container").requestFullscreen = function () {
    return Promise.reject(new Error("simulated browser policy"));
  };
};
