// platform/floating — the shared floating-layer lifecycle.
//
// A floating layer leaves its owning panel's clip box and mounts on a covering
// surface (native/pseudo fullscreen or <body>), re-pins on scroll/resize
// instead of dismissing, re-seats when the covering surface changes, and stops
// a wheel from reaching the map (Leaflet's scrollWheelZoom would zoom it).
//
// This module owns only the mount/lifecycle mechanics. The consumer owns the
// coordinate algorithm (the `position` callback, re-run on every re-pin), the
// value/aria model, and dismissal. The listbox engine and the search panel
// share one implementation so a listener-lifecycle fix lands once.

/** The covering surface contract: where an open popup mounts and how it hears
 *  that the surface changed (native fullscreen, pseudo-fullscreen). */
interface FloatingSurface {
  resolveHost?: (() => HTMLElement | null) | null;
  onSurfaceChange?: ((cb: () => void) => () => void) | null;
}

interface FloatingOptions {
  /** The element that floats (the list / the result panel). */
  root: HTMLElement;
  /** The trigger/anchor the popup follows (also the portal-root owner). */
  anchor: HTMLElement;
  /** Coordinate algorithm; re-run on every re-pin and re-seat. The consumer
   *  owns the numbers (S2 deliberately does not touch them). */
  position: () => void;
  /** The covering surface. Default: <body> (or the native fullscreen element). */
  surface?: FloatingSurface | null;
  /** Register the portalled root under the anchor (portal-root ownership).
   *  Default: no registration (the search panel does not portal). */
  registerPortalRoot?: (root: HTMLElement, anchor: HTMLElement) => () => void;
  /** Targets whose scroll re-pins. Default [window]. */
  scrollTargets?: Array<Element | Window>;
}

interface Floating {
  /** Re-pin in place (re-run the coordinate algorithm). */
  repin: () => void;
  /** Idempotent teardown: detach listeners, release the portal root. */
  release: () => void;
}

/** The covering host for a floating root. */
const hostFor = (opts: FloatingOptions): HTMLElement =>
  opts.surface?.resolveHost?.() ??
  (document.fullscreenElement as HTMLElement | null) ??
  document.body;

/** Unified gesture containment over a floating root: one call binds both the
 *  wheel and the touch/pointer containment (a popup or a panel scroll body
 *  must never pan or zoom the map beneath it). This is the ONLY gesture-entry
 *  point for floating layers; callers bind either here or via mountFloating
 *  (which auto-binds it). Returns a cleanup that removes every listener, so a
 *  mount lifecycle can pair the bind with an exact release.
 *  The unified wheel rule is "always" (the listbox rule): a wheel over the
 *  root never bubbles to the map, so the map's scrollWheelZoom can't fire.
 *  The unified touch rule stops propagation only, never preventDefault, so
 *  the root's own native scroll keeps working. */
const bindFloatingGestures = (root: HTMLElement): (() => void) => {
  // Wheel containment: unconditionally swallow so the map's scrollWheelZoom
  // can't fire. Named so the cleanup can remove it exactly.
  const stopWheel = (event: Event): void => event.stopPropagation();
  root.addEventListener("wheel", stopWheel);
  // Touch/pointer containment: stop propagation only (never preventDefault),
  // so the root's own native scroll keeps working.
  const stopPointer = (event: Event): void => event.stopPropagation();
  root.addEventListener("touchstart", stopPointer, { passive: true });
  root.addEventListener("touchmove", stopPointer, { passive: true });
  root.addEventListener("touchend", stopPointer, { passive: true });
  root.addEventListener("pointerdown", stopPointer);
  root.addEventListener("pointermove", stopPointer);
  root.addEventListener("pointerup", stopPointer);
  return () => {
    root.removeEventListener("wheel", stopWheel);
    root.removeEventListener("touchstart", stopPointer);
    root.removeEventListener("touchmove", stopPointer);
    root.removeEventListener("touchend", stopPointer);
    root.removeEventListener("pointerdown", stopPointer);
    root.removeEventListener("pointermove", stopPointer);
    root.removeEventListener("pointerup", stopPointer);
  };
};
/** Mount a floating layer and start its re-pin / re-seat lifecycle.
 *  Returns a release that is safe to call more than once. */
const mountFloating = (opts: FloatingOptions): Floating => {
  const { root, anchor, position } = opts;
  let released = false;
  const cleanups: (() => void)[] = [];

  // Mount on the covering host before any measurement so the first read has a
  // laid-out box (a detached element reports 0x0).
  const host = hostFor(opts);
  if (root.parentElement !== host) host.appendChild(root);

  // Unified gesture containment: a popup or floating panel must never pan or
  // zoom the map beneath it. Bound here (once per mount) so every floating
  // layer that goes through mountFloating gets it automatically; released
  // exactly on teardown (the cleanup is paired with the bind).
  const releaseGestures = bindFloatingGestures(root);
  cleanups.push(releaseGestures);

  // Re-pin on scroll/resize instead of dismissing. A scroll that starts inside
  // the root is the root's own overflow-y scroll — it must not re-pin (and the
  // shared containment already stopped it from reaching the map).
  const onScroll = (event: Event): void => {
    if (released) return;
    const target = event.target;
    if (target instanceof Node && (root === target || root.contains(target))) {
      return;
    }
    position();
  };
  const scrollTargets = opts.scrollTargets ?? [window];
  for (const target of scrollTargets) {
    target.addEventListener("scroll", onScroll, true);
    cleanups.push(() => target.removeEventListener("scroll", onScroll, true));
  }
  window.addEventListener("resize", onScroll, { passive: true });
  cleanups.push(() => window.removeEventListener("resize", onScroll));

  // Re-seat when the covering surface changes: re-mount on the new host and
  // re-pin. The engine hears surface changes; the search panel (no surface) is
  // covered by the default fullscreenchange listener, which is inert when the
  // root already sits on the right host.
  const onReseat = (): void => {
    if (released) return;
    const next = hostFor(opts);
    if (root.parentElement !== next) next.appendChild(root);
    position();
  };
  const unsubscribeSurface = opts.surface?.onSurfaceChange
    ? opts.surface.onSurfaceChange(onReseat)
    : (() => {
        document.addEventListener("fullscreenchange", onReseat);
        return () => document.removeEventListener("fullscreenchange", onReseat);
      })();
  cleanups.push(unsubscribeSurface);

  // Portal-root ownership (the engine registers; the search panel does not).
  const releasePortalRoot = opts.registerPortalRoot
    ? opts.registerPortalRoot(root, anchor)
    : null;

  return {
    repin: () => {
      if (!released) position();
    },
    release: () => {
      if (released) return;
      released = true;
      cleanups.forEach(fn => fn());
      cleanups.length = 0;
      releasePortalRoot?.();
    },
  };
};

export { bindFloatingGestures, mountFloating };
export type { Floating };
