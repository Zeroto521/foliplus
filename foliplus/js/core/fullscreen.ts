// core/fullscreen — the "covering surface" contract for body-level overlays.
//
// Native fullscreen renders only the fullscreen element's subtree, and
// foliplus's pseudo-fullscreen (FullscreenControl.css) covers the viewport
// with the opaque map at --foliplus-z-index-fullscreen. Overlays portaled to
// <body> — hint toasts, the slider bubble — are invisible in both cases, so
// they must attach to the surface itself while it is active. Both consumers
// resolve the host through fullscreenSurface() instead of re-deriving it.

/** Class FullscreenControl puts on the map container in pseudo mode;
 *  styled by FullscreenControl.css (position: fixed, fullscreen z-index). */
const PSEUDO_FULLSCREEN_CLASS = "leaflet-pseudo-fullscreen";

/** The element currently covering the viewport: the native fullscreen
 *  element, else a pseudo-fullscreen container, else <body>. <html> as the
 *  fullscreen element is normalized to <body> — appending there is
 *  equivalent, and it keeps overlays out of the root element. */
const fullscreenSurface = (): HTMLElement => {
  const fs = document.fullscreenElement as HTMLElement | null;
  if (fs) return fs === document.documentElement ? document.body : fs;
  return (
    document.querySelector<HTMLElement>(`.${PSEUDO_FULLSCREEN_CLASS}`) ?? document.body
  );
};

export { PSEUDO_FULLSCREEN_CLASS, fullscreenSurface };
