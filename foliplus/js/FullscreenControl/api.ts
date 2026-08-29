// Fullscreen API detection re-export — the shared implementation lives in
// common/fullscreen.ts (also used by the hint system). Kept here so
// FullscreenControl-internal imports stay stable.
export { nativeAPI, isEnabled, getFullscreenEl } from "#common/fullscreen.js";
