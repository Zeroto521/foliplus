// Fullscreen API — standard names. All modern browsers ship the unprefixed
// Fullscreen API; the webkit prefix (last needed by Safari < 16.4, 2023) is
// dropped, so the standard DOM properties are used directly.
const FULLSCREEN_CHANGE = "fullscreenchange";

const isEnabled = Boolean(document.fullscreenEnabled);
const getFullscreenEl = (): Element | null => document.fullscreenElement ?? null;

export { FULLSCREEN_CHANGE, isEnabled, getFullscreenEl };
