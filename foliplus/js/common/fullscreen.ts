// Fullscreen API detection — extracts the correct native method/property names
// (standard vs. webkit prefix) for the current browser.
//
// Shared by FullscreenControl (request/exit/toggle) and the hint system, which
// migrates toasts into the fullscreen element so they stay visible while the
// map is fullscreen.
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

const isEnabled =
  nativeAPI && Boolean(Reflect.get(document, nativeAPI.fullscreenEnabled));
const getFullscreenEl = (): Element | null =>
  (nativeAPI &&
    (Reflect.get(document, nativeAPI.fullscreenElement) as Element | null)) ??
  null;

export { nativeAPI, isEnabled, getFullscreenEl };
