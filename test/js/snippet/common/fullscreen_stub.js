Object.defineProperty(document, "fullscreenEnabled", {
  value: false,
  configurable: true,
});
document.exitFullscreen = undefined;
document.documentElement.requestFullscreen = undefined;
