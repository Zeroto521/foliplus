// common/floating — the shared floating-layer lifecycle.
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
import { bindWheelContainment } from "#common/dom.js";

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

/** Wheel containment over a floating root. "always" stops propagation
 *  unconditionally (the listbox rule); "contain" stops only a wheel that can
 *  actually scroll the root (the search panel's boundary-aware rule).
 *  Attached once for the root's lifetime — it must be in place whether the
 *  layer mounts inline (CSS-anchored) or portalled, so the caller binds it at
 *  element creation, not per mount. */
const bindFloatingWheel = (root: HTMLElement, mode: "always" | "contain" = "always"): void => {
  if (mode === "contain") {
    bindWheelContainment(root);
    return;
  }
  root.addEventListener("wheel", event => event.stopPropagation());
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

export { bindFloatingWheel, mountFloating };
export type { Floating };
