// platform/dragSession — one live pointer drag, ended however it ends.
// Every drag in the tree has the same shape: a press turns "dragging" on and
// (often) disables something, moves apply deltas, and a release turns it off
// and restores what the press changed. The shape is simple; the problem is
// that the release is the ONLY thing that ends it, and the release is not
// always delivered:
//
//   - it can happen over another window (alt-tab), so this page never sees it;
//   - the window may never blur either (a second monitor, a window that keeps
//     the focus), so no focus-loss signal arrives to stand in for it.
//
// A drag left in that state keeps following the pointer, and whatever the
// press disabled stays disabled — the measure nodes keep moving after a
// release elsewhere, and the export crop box keeps resizing.
//
// Listening harder does not fix it: when the release is not delivered, nothing
// announces it. Two signals do, and both live here so every drag gets them the
// same way instead of re-deriving them:
//
//   1. the pointer's own button state — a move with `buttons === 0` cannot be
//      part of a drag, and every move carries it;
//   2. the page-level interrupt (platform/gesture) for the endings that arrive
//      with no move at all (blur, hidden tab, a cancelled pointer).
//
// A session is ended exactly once, whichever signal wins first, so the
// consumer's restore path cannot run twice and cannot be skipped.
import { onGestureRetire } from "./gesture.js";

/** What a session watches on each move. Only `buttons` is read; a full
 *  PointerEvent or a Leaflet originalEvent both satisfy it. */
interface DragMoveEvent {
  buttons?: number;
}

interface DragSession {
  /** Whether the drag is still live. */
  readonly active: boolean;
  /** Offer a move to the session. Returns false when this move *ended* it
   *  (no button is down), so the caller skips applying that move. */
  track: (event: DragMoveEvent) => boolean;
  /** End it now — the explicit release path. Idempotent. */
  end: () => void;
}

interface DragSessionOptions {
  /** The pointer that owns the gesture. A cancel naming a different pointer
   *  belongs to somebody else's gesture and must not end this one. */
  pointerId?: number | null;
}

/** Begin a drag session. *onEnd* runs exactly once, from whichever signal
 *  ends the session first, and must restore whatever the press changed. */
const beginDragSession = (
  onEnd: () => void,
  options: DragSessionOptions = {},
): DragSession => {
  let active = true;
  /** Set by the registration below; declared first so `finish` can call it. */
  let release: (() => void) | null = null;
  const ownerId = options.pointerId ?? null;

  const finish = (): void => {
    if (!active) return;
    active = false;
    release?.();
    release = null;
    onEnd();
  };

  /** An interrupt may name the pointer it took away; one that names another
   *  pointer is not this gesture's ending. */
  const onInterrupt = (event: Event): void => {
    if (
      event instanceof PointerEvent &&
      event.type === "pointercancel" &&
      ownerId !== null &&
      event.pointerId !== ownerId
    ) {
      return;
    }
    finish();
  };

  // Registered after `finish` exists so an interrupt can call it; the module
  // keeps one page-level listener set for every live session.
  release = onGestureRetire(onInterrupt);

  return {
    get active() {
      return active;
    },
    track(event: DragMoveEvent): boolean {
      if (!active) return false;
      // Strict 0, not falsy: a synthetic event with no `buttons` reports
      // undefined and must not be read as "released".
      if (event.buttons === 0) {
        finish();
        return false;
      }
      return true;
    },
    end: finish,
  };
};

export { beginDragSession };
export type { DragSession };
