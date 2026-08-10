// Fullscreen API detection — extracts the correct native method names
// (standard vs. webkit prefix) for the current browser.
const methodMap = [
  [
    "requestFullscreen",
    "exitFullscreen",
    "fullscreenElement",
    "fullscreenEnabled",
    "fullscreenchange",
    "fullscreenerror",
  ],
  [
    "webkitRequestFullscreen",
    "webkitExitFullscreen",
    "webkitFullscreenElement",
    "webkitFullscreenEnabled",
    "webkitfullscreenchange",
    "webkitfullscreenerror",
  ],
];

const nativeAPI = (() => {
  const base = methodMap[0];
  for (const m of methodMap)
    if (m[1] in document) return Object.fromEntries(base.map((k, i) => [k, m[i]]));
  return null;
})();

const isEnabled = nativeAPI && Boolean((document as any)[nativeAPI.fullscreenEnabled]);
const getFullscreenEl = () =>
  nativeAPI && (document as any)[nativeAPI.fullscreenElement];

export { nativeAPI, isEnabled, getFullscreenEl };
