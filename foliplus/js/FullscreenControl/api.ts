// Fullscreen API — standard names. All modern browsers ship the unprefixed
// Fullscreen API; the webkit prefix (last needed by Safari < 16.4, 2023) is
// dropped, so the standard DOM properties are used directly.
const FULLSCREEN_CHANGE = "fullscreenchange";

// Read lazily: `document.fullscreenEnabled` is document-level state that can flip
// (iframe policy, embedder restrictions) after this module is evaluated — a
// load-time snapshot would pin the branch choice for every later toggle, and
// could disagree with `getFullscreenEl()` within a single click.
const isEnabled = (): boolean =>
  "fullscreenEnabled" in document && document.fullscreenEnabled === true;
const getFullscreenEl = (): Element | null => document.fullscreenElement ?? null;

export { FULLSCREEN_CHANGE, isEnabled, getFullscreenEl };
