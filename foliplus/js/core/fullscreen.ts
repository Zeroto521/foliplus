// core/fullscreen — the "covering surface" contract for body-level overlays.
//
// Native fullscreen renders only the fullscreen element's subtree, and
// foliplus's pseudo-fullscreen (FullscreenControl.css) covers the viewport
// with the opaque map at --foliplus-z-index-fullscreen. Overlays portaled to
// <body> — hint toasts, the slider bubble — are invisible in both cases, so
// they must attach to the surface itself while it is active. Both consumers
// resolve the host through fullscreenSurface() instead of re-deriving it.
//
// `map.isFullscreen` follows the same contract: it is true for either kind of
// session. Pseudo mode has no native API state to read, so the class on the
// container is the only source of truth for it — and a transition has no DOM
// event. announceFullscreenSurface() is therefore the one notification point:
// native fullscreenchange and pseudo enter/exit both go through it, and every
// overlay that is already on screen re-seats itself instead of waiting for
// the next interaction.

/** Class FullscreenControl puts on the map container in pseudo mode;
 *  styled by FullscreenControl.css (position: fixed, fullscreen z-index). */
const PSEUDO_FULLSCREEN_CLASS = "leaflet-pseudo-fullscreen";

type SurfaceListener = () => void;

const surfaceListeners = new Set<SurfaceListener>();

/** The covering surface for *scope*: the native fullscreen element when it
 *  relates to the scope, else a pseudo-fullscreen container in the scope's
 *  ancestor chain, else <body>. <html> as the fullscreen element is
 *  normalized to <body> — appending there is equivalent, and it keeps
 *  overlays out of the root element.
 *
 *  Passing a scope keeps one map's overlay out of a sibling map's pseudo
 *  container (the class is global, the maps are not). Omitting it keeps the
 *  document-wide answer for page-level callers; with several maps in pseudo
 *  mode at once that answer is the first container in document order, which
 *  is acceptable only for an overlay that has no map of its own. */
const fullscreenSurface = (scope?: Element | null): HTMLElement => {
  const fs = document.fullscreenElement as HTMLElement | null;
  if (fs && (!scope || fs === scope || fs.contains(scope) || scope.contains(fs))) {
    return fs === document.documentElement ? document.body : fs;
  }
  if (scope) {
    // Scoped lookup: only a container that owns this scope may host its
    // overlays. A pseudo surface on another map does not cover this one.
    return scope.closest<HTMLElement>(`.${PSEUDO_FULLSCREEN_CLASS}`) ?? document.body;
  }
  return (
    document.querySelector<HTMLElement>(`.${PSEUDO_FULLSCREEN_CLASS}`) ?? document.body
  );
};

/** Native transitions are the third source of a surface change (alongside
 *  pseudo enter/exit). Bind one document listener while consumers exist, so a
 *  page with no overlays pays nothing. */
let nativeBound = false;
const onNativeFullscreenChange = (): void => announceFullscreenSurface();

/** Subscribe to surface changes. Returns the unsubscribe function; callers
 *  must route it through their own lifecycle teardown (control signal or
 *  finalize step) or the subscription outlives the overlay. */
const onFullscreenSurfaceChange = (listener: SurfaceListener): (() => void) => {
  surfaceListeners.add(listener);
  if (!nativeBound) {
    nativeBound = true;
    document.addEventListener("fullscreenchange", onNativeFullscreenChange);
  }
  return () => {
    surfaceListeners.delete(listener);
    if (surfaceListeners.size === 0 && nativeBound) {
      nativeBound = false;
      document.removeEventListener("fullscreenchange", onNativeFullscreenChange);
    }
  };
};

/** Notify every overlay that it should re-resolve its host. The call itself is
 *  unconditional: it does not deduplicate, because a native event can arrive
 *  alongside a pseudo transition. Each listener must therefore be safe to run
 *  when the surface has not actually changed. */
const announceFullscreenSurface = (): void => {
  for (const listener of surfaceListeners) {
    try {
      listener();
    } catch {
      // One broken overlay must not strand the rest of the page: native
      // fullscreen would otherwise leave them all under the opaque surface.
    }
  }
};

/** Toggle pseudo mode on *container* and announce it. The class is the only
 *  signal pseudo mode exists (there is no Fullscreen API state), so every
 *  write goes through here — FullscreenControl never touches the class
 *  directly. No-op (and no announcement) when the state already matches. */
const setPseudoFullscreen = (container: HTMLElement, active: boolean): void => {
  if (container.classList.contains(PSEUDO_FULLSCREEN_CLASS) === active) return;
  container.classList.toggle(PSEUDO_FULLSCREEN_CLASS, active);
  announceFullscreenSurface();
};

/** The popup-host contract common/dropdown takes: resolve the covering surface
 *  for *scope*, and subscribe to its changes. Consumers pass the result as the
 *  dropdown's `surface`, so a portalled list follows the same contract the
 *  slider bubble and hint toasts use instead of re-deriving it. */
const dropdownSurface = (
  scope: Element | null,
): {
  resolveHost: () => HTMLElement;
  onSurfaceChange: (listener: SurfaceListener) => () => void;
} => ({
  resolveHost: () => fullscreenSurface(scope),
  onSurfaceChange: onFullscreenSurfaceChange,
});

export {
  PSEUDO_FULLSCREEN_CLASS,
  announceFullscreenSurface,
  dropdownSurface,
  fullscreenSurface,
  onFullscreenSurfaceChange,
  setPseudoFullscreen,
};
