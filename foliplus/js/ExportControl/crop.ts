// ExportControl crop box editing — pointer drag, keyboard nudge, pixel limit.
// Function expressions are installed on ExportManager.prototype so `this` is
// the manager and instance spies stay interceptable.
import { type RafLoop, rafLoop } from "#common/rafLoop.js";
import * as CONST from "./const.js";
import { registerDrag } from "./interaction.js";
import type { ExportManager } from "./manager.js";

/** A screen-space rectangle. */
interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A lat/lng point. */
interface LatLngPoint {
  lat: number;
  lng: number;
}

/** Geo bounds for the crop area. */
interface GeoBounds {
  nw: LatLngPoint;
  se: LatLngPoint;
}

/** Drag state for interactive crop box adjustment. */
interface DragState {
  dragging: boolean;
  dragType: string | null;
  lastX: number;
  lastY: number;
}

/** Crop box state machine. */
interface CropState {
  overlay: HTMLElement;
  box: HTMLElement;
  rect: CropRect;
  locked: boolean;
  actions: HTMLElement;
  geoBounds?: GeoBounds;
  savedGeoBounds?: GeoBounds;
}

/** Map an arrow-key name to a unit direction vector. Unknown keys → no-op. */
const nudgeDirection = (key: string): { x: number; y: number } =>
  key === "ArrowLeft"
    ? { x: -1, y: 0 }
    : key === "ArrowRight"
      ? { x: 1, y: 0 }
      : key === "ArrowUp"
        ? { x: 0, y: -1 }
        : key === "ArrowDown"
          ? { x: 0, y: 1 }
          : { x: 0, y: 0 };

/** True while the crop box is open and being edited (not locked). */
const isEditing = function (this: ExportManager): boolean {
  return !!this.cropState && !this.cropState.locked;
};

/** Apply a new rect: update state, box style, and (optionally) the size hint. */
const applyRect = function (this: ExportManager, r: CropRect, withHint = true) {
  if (!this.cropState) return;
  this.cropState.rect = r;
  this.updateBoxStyle(this.cropState.box, r);
  if (withHint) this.showHintWithInfo(r, this.T("hint_unlocked"));
};

/** Default centered crop box (same as the no-history branch of showCropBox). */
const defaultRect = function (this: ExportManager): CropRect {
  const mapRect = this.mapContainer.getBoundingClientRect();
  const padW = mapRect.width * CONST.CROP.PADDING_RATIO;
  const padH = mapRect.height * CONST.CROP.PADDING_RATIO;
  return {
    left: padW,
    top: padH,
    width: mapRect.width - padW * 2,
    height: mapRect.height - padH * 2,
  };
};

/** Reset the unlocked crop box to the default centered size. */
const resetCropBox = function (this: ExportManager) {
  if (!this.isEditing()) return;
  this.applyRect(this.defaultRect());
};

/** Apply an already-computed (possibly fractional) delta to the crop box.
 *  Used by the frame-aligned nudge loop: it floors the delta so the DOM
 *  position stays integral while the caller carries the decimal remainder in
 *  an accumulator — giving smooth continuous motion at a controlled speed.
 *  Clamps within the same map bounds as nudgeCropBox(). */
const nudgeCropBoxDelta = function (this: ExportManager, dx: number, dy: number) {
  const st = this.cropState;
  if (!st) return;
  const mapRect = this.nudgeMapRect ?? this.mapContainer.getBoundingClientRect();
  const r = Object.assign({}, st.rect);
  r.left = Math.max(0, Math.min(mapRect.width - r.width, r.left + Math.floor(dx)));
  r.top = Math.max(0, Math.min(mapRect.height - r.height, r.top + Math.floor(dy)));
  st.box.classList.add(CONST.CLASSES.DRAGGING);
  this.applyRect(r, false);
};

/** Nudge the unlocked crop box by NUDGE_STEP px in an arrow direction. */
const nudgeCropBox = function (this: ExportManager, key: string) {
  if (!this.isEditing()) return;
  const d = nudgeDirection(key);
  // Call through the instance so a test that replaces
  // manager.nudgeCropBoxDelta still intercepts.
  this.nudgeCropBoxDelta(d.x * CONST.CROP.NUDGE_STEP, d.y * CONST.CROP.NUDGE_STEP);
};

/** Stop the smooth-nudge loop. Also clears the suppressed-transition
 *  class; when nudgeStart() re-creates a loop (direction switch) the very
 *  next sync tick re-adds it, so there is no visible flicker. */
const nudgeStop = function (this: ExportManager) {
  const loop = this.nudgeLoop;
  this.nudgeLoop = undefined;
  this.nudgeMapRect = undefined;
  this.nudgeActiveKey = undefined;
  this.cropState?.box.classList.remove(CONST.CLASSES.DRAGGING);
  loop?.stop();
};

/** Start the smooth-nudge loop for a held arrow key. */
const nudgeStart = function (this: ExportManager, key: string) {
  if (!this.isEditing()) return;
  // Stop any loop running for a previous direction first, so holding Right
  // then pressing Up doesn't leave a stale loop nudging right for ~500ms.
  this.nudgeStop();
  // Cache the map container rect once at loop start. The map can't move
  // while the loop runs (map keyboard drag/zoom are disabled via
  // ModeManager), so getBoundingClientRect() is stable — avoids calling it
  // 60 times per second inside the rafLoop.
  this.nudgeMapRect = this.mapContainer.getBoundingClientRect();
  // Remember which arrow key this loop is for so a fresh press of a
  // different direction re-starts, while OS auto-repeat of the same key is
  // ignored (one tap = exactly one sync frame regardless of repeat rate).
  this.nudgeActiveKey = key;
  // Fractional accumulator so held-key motion is smooth at 60fps: each
  // scheduled frame adds perFrame px, the floored integer is applied, and
  // the remainder carries forward. Running at the loop's native 16ms cadence
  // keeps updates on a steady beat. The sync first frame (the tap) is
  // handled separately so a quick tap still yields exactly NUDGE_STEP.
  const perFrame = CONST.CROP.NUDGE_SPEED / 60;
  let accX = 0;
  let accY = 0;
  let syncFrame = true;
  // Gate the continuous stream behind a hold delay: a quick tap must stop
  // after the single sync step, even though the rafLoop keeps ticking until
  // keyup. Only once the hold passes NUDGE_HOLD_DELAY does per-frame motion
  // begin. This keeps "tap once" = exactly one NUDGE_STEP, independent of
  // OS auto-repeat rate or how quickly the user releases.
  // Capture press time once at entry; the elapsed check lives inside the
  // rafLoop tick so we don't need a separate setTimeout call (which would
  // require calling this.scheduler as a method and throw Illegal invocation
  // in production).
  const pressTime = performance.now();
  this.nudgeLoop = rafLoop(
    (k?: string) => {
      const d = nudgeDirection(k ?? key);
      if (syncFrame) {
        syncFrame = false;
        this.nudgeCropBoxDelta(
          d.x * CONST.CROP.NUDGE_STEP,
          d.y * CONST.CROP.NUDGE_STEP,
        );
      } else if (performance.now() - pressTime > CONST.CROP.NUDGE_HOLD_DELAY) {
        this.nudgeCropBoxDelta(d.x * (accX + perFrame), d.y * (accY + perFrame));
        accX = (accX + perFrame) % 1;
        accY = (accY + perFrame) % 1;
      }
      // Holding but the gate has not yet passed -> stay put (no per-frame
      // motion). A quick tap therefore yields exactly the single sync step.
      // If the box was locked or removed (e.g. Enter, Escape) the nudge
      // returns early, but it doesn't return true — detect it explicitly
      // and stop the loop so we never write to a gone/locked box.
      if (!this.isEditing()) {
        // Clean up the suppressed-transition class on auto-stop. Explicit
        // nudgeStop() (from keyup) also clears it, so this covers the Enter/
        // Escape path where keyup never fires for the arrow key.
        this.cropState?.box?.classList.remove(CONST.CLASSES.DRAGGING);
        return true;
      }
      return false;
    },
    { scheduler: this.scheduler },
  );
  this.nudgeLoop.start(key);
};

/** Check pixel limit and set pixelOverLimit flag. */
const checkPixelLimit = function (this: ExportManager, r: CropRect) {
  // Pixel limit applies to the crop area itself (not scaled by export
  // DPI). The override of r.width/r.height happens in doRender, so the
  // check here matches the actual exported dimensions.
  const totalPixels = Math.round(r.width) * Math.round(r.height);
  this.pixelOverLimit = CONF.max_pixels != null && totalPixels > CONF.max_pixels;
};

const onPointerDown = function (this: ExportManager, event: PointerEvent) {
  const st = this.cropState;
  if (!st || st.locked) return;
  const target = event.target as HTMLElement;
  let type: string | null = null;
  if (target.classList.contains(CONST.CLASSES.HANDLE)) {
    type = target.dataset.pos ?? null;
  } else if (
    target.classList.contains(CONST.CLASSES.CENTER) ||
    target.classList.contains(CONST.CLASSES.BOX)
  ) {
    type = "move";
  } else return;

  // Claim the press. This must come after the target check: the handler also
  // runs for presses on the map outside the box, and preventing those would
  // swallow native behaviour (map drag, tile click, focus move) for every
  // pointerdown on the page while a crop box is open.
  //
  // stopImmediatePropagation, not stopPropagation: the pointerdown wrapper in
  // core/interaction.ts has already preventDefault+stopPropagation'd the event
  // *before* calling this handler, so stopPropagation here is a no-op and a
  // second listener on the same box element would still run. The mouse
  // compatibility event the browser queues for this pointerdown is a separate
  // event entirely — what actually keeps LayerControl's document-level
  // mousedown (drop-the-cursor-on-outside-press) from firing mid-drag is
  // preventDefault above: mouse* compatibility events are only dispatched
  // when the pointerdown was not prevented.
  event.preventDefault();
  event.stopImmediatePropagation();

  // Claim the pointer: every later pointermove/pointerup for this pointer
  // arrives at `target` and bubbles to the document drag listener even when
  // the cursor is over another element. Mouse events have no capture
  // contract, so a single move event routed to a different target
  // (crossing the Leaflet controls above the crop overlay, or a tile
  // boundary) is silently dropped and the box lands short of the cursor.
  if (event.pointerId !== null && target.setPointerCapture) {
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // best-effort — some browsers reject capture during the same
      // gesture that started it; the incremental-delta fallback below
      // still works, just without the anti-drop guarantee.
    }
  }

  this.dragState.dragging = true;
  this.dragState.dragType = type;
  // Disable the box transition during drag so it tracks the cursor
  // instantly (the 0.15s lag made the box feel "behind" the cursor and
  // caused accidental drags). Re-enabled in onPointerUp.
  st.box.classList.add(CONST.CLASSES.DRAGGING);
  // Anchor the first delta to the pointer position at press time so the
  // box doesn't lurch by the distance already travelled before
  // registerDrag's document listeners fire.
  this.dragState.lastX = event.clientX;
  this.dragState.lastY = event.clientY;
  this.dragCleanup = registerDrag(this);
};

const onPointerMove = function (this: ExportManager, event: PointerEvent) {
  const st = this.cropState;
  if (!st || !this.dragState.dragging) return;
  // Resolve the box before consuming the anchor: an event arriving after
  // the crop box was removed must not advance lastX/lastY, or the next
  // drag's first move would measure from a stale point.
  const type = this.dragState.dragType;
  // Incremental delta from the last pointer position, applied to the
  // *current* rect. The deltas telescope into the total displacement, so
  // clamping one frame never accumulates into a jump on the next.
  const dx = event.clientX - this.dragState.lastX;
  const dy = event.clientY - this.dragState.lastY;
  this.dragState.lastX = event.clientX;
  this.dragState.lastY = event.clientY;
  const mapRect = this.mapContainer.getBoundingClientRect();
  const cur = st.rect;
  const r = Object.assign({}, cur);
  if (type === "move") {
    r.left = Math.max(0, Math.min(mapRect.width - r.width, cur.left + dx));
    r.top = Math.max(0, Math.min(mapRect.height - r.height, cur.top + dy));
  } else if (type) {
    if (["tl", "l", "bl"].includes(type)) {
      const maxDx = cur.width - CONST.CROP.MIN_SIZE;
      const a = Math.max(-cur.left, Math.min(dx, maxDx));
      r.left = cur.left + a;
      r.width = cur.width - a;
    }
    if (["tr", "r", "br"].includes(type)) {
      const maxDx = mapRect.width - (cur.left + cur.width);
      const minDx = CONST.CROP.MIN_SIZE - cur.width;
      const a = Math.max(minDx, Math.min(dx, maxDx));
      r.width = cur.width + a;
    }
    if (["tl", "t", "tr"].includes(type)) {
      const maxDy = cur.height - CONST.CROP.MIN_SIZE;
      const a = Math.max(-cur.top, Math.min(dy, maxDy));
      r.top = cur.top + a;
      r.height = cur.height - a;
    }
    if (["bl", "b", "br"].includes(type)) {
      const maxDy = mapRect.height - (cur.top + cur.height);
      const minDy = CONST.CROP.MIN_SIZE - cur.height;
      const a = Math.max(minDy, Math.min(dy, maxDy));
      r.height = cur.height + a;
    }
  }
  st.rect = r;
  this.updateBoxStyle(st.box, r);
  // Only update the hint when the size changes (resize), not on pure move
  if (type !== "move") this.showHintWithInfo(r, this.T("hint_unlocked"));
};

const onPointerUp = function (this: ExportManager, event: PointerEvent) {
  const wasDragging = this.dragState.dragging;
  this.dragState.dragging = false;
  this.dragState.dragType = null;
  // Drop the document-level drag listeners — the gesture is over. Every
  // pointerdown registered a fresh set via registerDrag, so without this
  // each drag accumulates three more entries (shortcuts array growth, and
  // every pointer event re-sorting them) until the crop box closes.
  if (wasDragging) {
    this.dragCleanup?.();
    this.dragCleanup = undefined;
  }
  // Give the pointer back. Skip it when the gesture never started — a
  // synthetic pointerup with no matching down must not strip the .dragging
  // class off a box that is mid-drag by another pointer.
  if (wasDragging && event.pointerId !== null) {
    // event.target can be document or any non-element (jsdom, synthetic
    // events) — only Elements have hasPointerCapture. Browsers also
    // release capture automatically on pointerup, so this is belt and
    // braces for pointercancel, which has no such guarantee.
    const target = event.target;
    if (target instanceof Element && target.hasPointerCapture?.(event.pointerId)) {
      try {
        target.releasePointerCapture(event.pointerId);
      } catch {
        // capture already gone
      }
    }
  }
  // Re-enable transition so the box animates smoothly to its final
  // position on the next non-drag style update (e.g. after unlock).
  if (wasDragging && this.cropState?.box) {
    this.cropState.box.classList.remove(CONST.CLASSES.DRAGGING);
  }
};

const onPointerCancel = function (this: ExportManager, event: PointerEvent) {
  // Fires when the browser takes the pointer away (touch pinch, an OS
  // drag, a browser gesture) and never delivers a matching pointerup.
  // Without this the gesture would leave `dragging` set and the listeners
  // registered, so the next drag inherited the stale lastX/lastY anchor
  // and its first move jumped.
  this.onPointerUp(event);
};

const onKeyDown = function (this: ExportManager, event: KeyboardEvent) {
  if (event.key === "Escape") {
    if (this.cropState?.locked) this.unlockCropBox();
    else this.removeCropBox();
  } else if (event.key === "Enter") {
    if (this.isEditing()) this.lockCropBox();
    else if (this.cropState?.locked) this.doExport();
  } else if (event.key === "r" || event.key === "R") {
    // R: reset the crop box to the default centered size. Stop any
    // running nudge loop first so the box stays put after reset instead
    // of being shoved off by an ongoing rafLoop.
    this.nudgeStop();
    if (this.isEditing()) this.resetCropBox();
  } else if (CONST.NUDGE_KEYS.includes(event.key)) {
    // Arrow keys: start continuous smooth nudging while the key is held.
    // On initial press the loop nudges one step synchronously (so the box
    // moves the moment the key is pressed), then keeps nudging at ~60Hz
    // so holding the key feels continuous. Stop on keyup.
    if (this.isEditing() && event.key !== this.nudgeActiveKey) {
      this.nudgeStart(event.key);
    }
  }
};

/** Key release: restore the box transition suppressed during arrow-key nudging. */
const onKeyUp = function (this: ExportManager, event: KeyboardEvent) {
  if (CONST.NUDGE_KEYS.includes(event.key)) {
    // Stop the smooth-nudge loop — keyup is the release signal. The rafLoop
    // keeps ticking at ~60Hz until stopped, so without this the box would
    // drift forever after a single press. nudgeStop() clears the
    // suppressed-transition class, so there's nothing left to do here.
    this.nudgeStop();
  }
};

/** Method table installed on ExportManager.prototype. */
const cropMethods = {
  applyRect,
  checkPixelLimit,
  defaultRect,
  isEditing,
  nudgeCropBox,
  nudgeCropBoxDelta,
  nudgeStart,
  nudgeStop,
  onKeyDown,
  onKeyUp,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  resetCropBox,
};

export {
  cropMethods,
  type CropRect,
  type CropState,
  type DragState,
  type GeoBounds,
  type LatLngPoint,
};
