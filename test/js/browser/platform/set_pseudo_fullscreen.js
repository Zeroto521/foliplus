// Toggles foliplus's pseudo-fullscreen on the map container, the way
// FullscreenControl does when the native API is unavailable, and reports where
// the scheme list is hosted afterwards.
// #900 moved fullscreen from core/ to platform/ (now foliplus.platform.fullscreen).
active => {
  const platform = window.foliplus && window.foliplus.platform;
  const fullscreen = platform && platform.fullscreen;
  if (!fullscreen || !fullscreen.setPseudoFullscreen) {
    return { ok: false, reason: "no-setPseudoFullscreen" };
  }
  const container = window.map.getContainer();
  fullscreen.setPseudoFullscreen(container, active);
  const list = document.querySelector(".foliplus-scheme-picker-portal");
  return {
    ok: true,
    pseudo: container.classList.contains(fullscreen.PSEUDO_FULLSCREEN_CLASS),
    hostTag:
      list && list.parentElement ? list.parentElement.tagName.toLowerCase() : null,
    hostedInContainer: !!list && container.contains(list),
  };
};
