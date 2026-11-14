// platform/gesture — retire a page-level drag when the window loses the pointer.
//
// A pointerup is only delivered to a focused page. Alt-tab, a browser tab
// switch, a native context menu or an OS drag all take the pointer away
// without one, and no release is ever dispatched: the drag session stays
// "live" (the next press finds `this.drag` set and is swallowed), and any
// chrome the gesture left on <body> — the slider's value bubble — is still
// painted when the user comes back. The symptom is a readout that reappears
// out of nowhere on a row the user has not touched since.
//
// This module is the one place that answers "the gesture is over even though
// no release will arrive". A consumer registers one retire callback; the
// module keeps a single blur / visibilitychange / pointercancel trio for the
// whole page (the same shared-subscription shape platform/fullscreen uses for
// surface changes), so N consumers cost one pair of listeners, not N. The
// listeners are installed with the first registration and removed with the
// last, so a page whose consumers all tore down pays nothing.
//
// The retire callback must be idempotent. Several reasons can describe one
// interruption (a blur followed by visibilitychange), the callback may run
// with no gesture live, and a consumer is free to have already retired the
// gesture on its own pointerup path.

/** One consumer's "the pointer is gone" handler. The event is passed through
 *  because a pointercancel carries the pointerId that identifies which
 *  gesture really ended. */
type GestureRetire = (event: Event) => void;

/** Registrations are weakly held.
 *
 *  A consumer that owns a DOM node cannot always be asked to unregister: a
 *  panel drops its rows with `replaceChildren`/`remove()` and never calls the
 *  row's own destroy, so a strong Set would keep one closure — and through it
 *  the whole removed row and its slider — alive for the life of the page,
 *  once per panel open. A WeakRef keeps the entry only while somebody else
 *  still references the callback, which is the same lifetime the consumer
 *  already relies on for its own DOM. */
type Registration = { ref: WeakRef<GestureRetire> };

const retires = new Set<Registration>();
let bound = false;

/** Call every live registration, dropping the ones whose consumer is gone.
 *  Failures are isolated: one consumer throwing must not leave another
 *  holding a stale drag. */
const retireAll = (event: Event): void => {
  let live = 0;
  for (const registration of [...retires]) {
    const retire = registration.ref.deref();
    if (!retire) {
      // The consumer was collected without unregistering (a panel that
      // dropped its rows): forget the entry rather than keep testing it.
      retires.delete(registration);
      continue;
    }
    live += 1;
    try {
      retire(event);
    } catch {
      // A broken consumer cannot be allowed to strand the rest of the page.
    }
  }
  if (live === 0) unbind();
};

const onWindowBlur = (event: Event): void => retireAll(event);

/** Only the transition to hidden matters: becoming visible is the return, and
 *  there is nothing left to retire then. */
const onVisibilityChange = (event: Event): void => {
  if (document.visibilityState === "hidden") retireAll(event);
};

const onPointerCancel = (event: Event): void => retireAll(event);

const bind = (): void => {
  if (bound) return;
  bound = true;
  window.addEventListener("blur", onWindowBlur);
  document.addEventListener("visibilitychange", onVisibilityChange);
  // Capture phase: the interruption has to reach every consumer even when the
  // element that owned the gesture stopped propagation — a thumb press does
  // exactly that to keep the track from beginning a second session.
  window.addEventListener("pointercancel", onPointerCancel, true);
};

const unbind = (): void => {
  if (!bound) return;
  bound = false;
  window.removeEventListener("blur", onWindowBlur);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("pointercancel", onPointerCancel, true);
};

/** Register a retire callback. Returns the unregister function; a consumer
 *  with a teardown must pair the two (its own destroy path), exactly like the
 *  surface subscription in platform/fullscreen. */
const onGestureRetire = (retire: GestureRetire): (() => void) => {
  const registration: Registration = { ref: new WeakRef(retire) };
  retires.add(registration);
  bind();
  return () => {
    retires.delete(registration);
    if (retires.size === 0) unbind();
  };
};

/** How many registrations are still live. Exposed for the guard test that
 *  pins the weak-holding contract: a consumer that is collected without
 *  unregistering must not be counted after the next retire. */
const liveGestureRetires = (): number => {
  let live = 0;
  for (const registration of retires) {
    if (registration.ref.deref()) live += 1;
    else retires.delete(registration);
  }
  return live;
};

export { liveGestureRetires, onGestureRetire };
