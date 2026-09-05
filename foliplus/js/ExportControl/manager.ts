// ExportControl manager — crop box state machine, export orchestration.
import { COMPONENTS } from "#core/component.js";
import { EVENTS, ensureEvents } from "#core/event/index.js";
import { HINT_DURATION } from "#core/hint.js";
import { ensureModes, guardBlocked } from "#core/mode.js";
import { COORD_BOUNDS } from "#common/coord.js";
import { dom } from "#common/dom.js";
import { download } from "#common/download.js";
import { createScopedTranslator } from "#common/locale.js";
import { type RafLoop, rafLoop } from "#common/rafLoop.js";
import * as Storage from "#common/storage.js";
import * as CONST from "./const.js";
import { registerDrag, registerInteractions } from "./interaction.js";
import { ExportRenderer } from "./renderer.js";
import {
  lockCropBox,
  removeCropBox,
  showCropBox,
  showGlobalHint,
  showHintWithInfo,
  unlockCropBox,
  updateBoxStyle,
} from "./ui.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const T = createScopedTranslator(CONF);

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

/** A screen-space rectangle. */
export interface Rect {
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
  startX: number;
  startY: number;
  startRect: Rect | null;
  lastX: number;
  lastY: number;
}

/** Crop box state machine. */
interface CropState {
  overlay: HTMLElement;
  box: HTMLElement;
  rect: Rect;
  locked: boolean;
  actions: HTMLElement;
  geoBounds?: GeoBounds;
  savedGeoBounds?: GeoBounds;
}

/** Loaded saved bounds from storage. */
interface SavedBounds {
  nw: LatLngPoint;
  se: LatLngPoint;
}

// ==================== ExportManager ====================

class ExportManager {
  map: L.Map;
  dragCleanup?: () => void;
  interactionCleanup?: () => void;
  escapeCleanup?: () => void;
  cropMousedownCleanup?: () => void;
  mapContainer: HTMLElement;
  cropState: CropState | null;
  exportCtrl: HTMLElement | null;
  exportToolBar: HTMLElement | null;
  exportOverlay: HTMLElement | null;
  isExporting: boolean;
  pixelOverLimit: boolean;
  lastScreenRect: Rect | null;
  savedBounds: SavedBounds | null;
  dragState: DragState;
  nudgeLoop?: RafLoop;
  private nudgeMapRect?: DOMRect;
  private nudgeActiveKey?: string;
  /**
   * Overridable timer function for the smooth-nudge rafLoop. Defaults to
   * setTimeout (production). Browser tests inject a no-op so each rafLoop
   * runs exactly one synchronous tick, making the one-step-per-keydown
   * behavior deterministic without touching global state.
   */
  private scheduler: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  declare mapMoveCleanup: (() => void) | null;

  // Mounted UI helpers (assigned in constructor).
  declare showCropBox: () => void;
  declare lockCropBox: (skipHint?: boolean) => void;
  declare unlockCropBox: () => void;
  declare removeCropBox: () => void;
  declare updateBoxStyle: (el: HTMLElement, r: Rect) => void;
  declare showHintWithInfo: (r: Rect, instruction?: string) => void;
  declare showGlobalHint: (
    text: string,
    duration: number,
    withLoadingIcon?: boolean,
  ) => void;

  constructor(
    mapInstance: L.Map,
    scheduler: (
      fn: () => void,
      ms: number,
    ) => ReturnType<typeof setTimeout> = setTimeout,
  ) {
    this.map = mapInstance;
    this.mapContainer = this.map.getContainer();
    this.scheduler = scheduler;

    this.cropState = null;
    this.exportCtrl = null;
    this.exportToolBar = null;
    this.exportOverlay = null;
    this.isExporting = false;
    this.pixelOverLimit = false;
    this.lastScreenRect = null;
    this.savedBounds = null;
    this.loadSavedBounds();

    this.dragState = {
      dragging: false,
      dragType: null,
      startX: 0,
      startY: 0,
      startRect: null,
      lastX: 0,
      lastY: 0,
    };

    this.onMapChange = this.onMapChange.bind(this);

    // Mount UI functions directly on this instance
    this.showCropBox = () => showCropBox(this);
    this.lockCropBox = (skipHint?: boolean) => lockCropBox(this, skipHint);
    this.unlockCropBox = () => unlockCropBox(this);
    this.removeCropBox = () => removeCropBox(this);
    this.updateBoxStyle = (el: HTMLElement, r: Rect) => updateBoxStyle(this, el, r);
    this.showHintWithInfo = (r: Rect, instruction?: string) =>
      showHintWithInfo(this, r, instruction);
    this.showGlobalHint = (text: string, duration: number, withLoadingIcon?: boolean) =>
      showGlobalHint(this, text, duration, withLoadingIcon);
  }

  attachUI(ctrl: HTMLElement, toolBar: HTMLElement) {
    this.exportCtrl = ctrl;
    this.exportToolBar = toolBar;
  }

  loadSavedBounds() {
    const data = Storage.load<SavedBounds | null>(CONST.STORAGE.KEY, CONF.name);
    if (!data || !data.nw || !data.se) return;
    const nw = data.nw,
      se = data.se;
    const validLat =
      nw.lat >= -COORD_BOUNDS.LAT &&
      nw.lat <= COORD_BOUNDS.LAT &&
      se.lat >= -COORD_BOUNDS.LAT &&
      se.lat <= COORD_BOUNDS.LAT;
    const validLng =
      nw.lng >= -COORD_BOUNDS.LON &&
      nw.lng <= COORD_BOUNDS.LON &&
      se.lng >= -COORD_BOUNDS.LON &&
      se.lng <= COORD_BOUNDS.LON;
    if (!validLat || !validLng) return;
    const mapB = this.map.getBounds();
    const overlap =
      nw.lat >= mapB.getSouth() &&
      se.lat <= mapB.getNorth() &&
      nw.lng <= mapB.getEast() &&
      se.lng >= mapB.getWest();
    if (!overlap) return;
    this.savedBounds = data;
  }

  saveBounds(bounds: GeoBounds) {
    Storage.save(
      CONST.STORAGE.KEY,
      {
        nw: { lat: bounds.nw.lat, lng: bounds.nw.lng },
        se: { lat: bounds.se.lat, lng: bounds.se.lng },
      },
      CONF.name,
    );
  }

  /** Restore and lock crop box from saved geo bounds. */
  restoreFromSavedBounds() {
    this.showCropBox();
    requestAnimationFrame(() => {
      if (!this.cropState || this.cropState.locked) return;
      if (!this.savedBounds) return;
      this.cropState.savedGeoBounds = {
        nw: { lat: this.savedBounds.nw.lat, lng: this.savedBounds.nw.lng },
        se: { lat: this.savedBounds.se.lat, lng: this.savedBounds.se.lng },
      };
      this.lockCropBox(true);
      map.foliplus!.showHint(CONF.name, T("hint_restore"), HINT_DURATION.MEDIUM, true);
    });
  }

  onMouseDown(event: MouseEvent) {
    const st = this.cropState;
    if (!st || st.locked) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.target as HTMLElement;
    if (target.classList.contains(CONST.CLASSES.HANDLE))
      this.dragState.dragType = target.dataset.pos ?? null;
    else if (
      target.classList.contains(CONST.CLASSES.CENTER) ||
      target.classList.contains(CONST.CLASSES.BOX)
    )
      this.dragState.dragType = "move";
    else return;

    this.dragState.dragging = true;
    // Disable the box transition during drag so it tracks the cursor
    // instantly (the 0.15s lag made the box feel "behind" the mouse and
    // caused accidental drags). Re-enabled in onMouseUp.
    st.box.classList.add(CONST.CLASSES.DRAGGING);
    // Track the last mouse position for incremental deltas (avoids
    // sudden jumps from cumulative errors or stale startRect).
    this.dragState.lastX = event.clientX;
    this.dragState.lastY = event.clientY;
    this.dragState.startRect = Object.assign({}, st.rect);
    this.dragCleanup = registerDrag(this);
  }

  onMouseMove(event: MouseEvent) {
    if (!this.dragState.dragging) return;
    // Incremental delta from the last mouse position. Applying this to the
    // *current* rect (not the startRect) avoids sudden jumps from cumulative
    // error and keeps the box glued to the cursor.
    const dx = event.clientX - this.dragState.lastX;
    const dy = event.clientY - this.dragState.lastY;
    this.dragState.lastX = event.clientX;
    this.dragState.lastY = event.clientY;
    const mapRect = this.mapContainer.getBoundingClientRect();
    const st = this.cropState;
    if (!st) return;
    const cur = st.rect;
    const r = Object.assign({}, cur);
    const type = this.dragState.dragType;
    if (type === "move") {
      r.left = Math.max(0, Math.min(mapRect.width - r.width, cur.left + dx));
      r.top = Math.max(0, Math.min(mapRect.height - r.height, cur.top + dy));
    } else {
      if (["tl", "l", "bl"].includes(type!)) {
        const maxDx = cur.width - CONST.CROP.MIN_SIZE;
        const a = Math.max(-cur.left, Math.min(dx, maxDx));
        r.left = cur.left + a;
        r.width = cur.width - a;
      }
      if (["tr", "r", "br"].includes(type!)) {
        const maxDx = mapRect.width - (cur.left + cur.width);
        const minDx = CONST.CROP.MIN_SIZE - cur.width;
        const a = Math.max(minDx, Math.min(dx, maxDx));
        r.width = cur.width + a;
      }
      if (["tl", "t", "tr"].includes(type!)) {
        const maxDy = cur.height - CONST.CROP.MIN_SIZE;
        const a = Math.max(-cur.top, Math.min(dy, maxDy));
        r.top = cur.top + a;
        r.height = cur.height - a;
      }
      if (["bl", "b", "br"].includes(type!)) {
        const maxDy = mapRect.height - (cur.top + cur.height);
        const minDy = CONST.CROP.MIN_SIZE - cur.height;
        const a = Math.max(minDy, Math.min(dy, maxDy));
        r.height = cur.height + a;
      }
    }
    st.rect = r;
    this.updateBoxStyle(st.box, r);
    // Only update the hint when the size changes (resize), not on pure move
    if (type !== "move") this.showHintWithInfo(r, T("hint_unlocked"));
  }

  onMouseUp() {
    this.dragState.dragging = false;
    this.dragState.dragType = null;
    // mousemove/mouseup auto-cleaned by dragCleanup
    // Re-enable transition so the box animates smoothly to its final position
    // on the next non-drag style update (e.g. after unlock).
    if (this.cropState?.box)
      this.cropState.box.classList.remove(CONST.CLASSES.DRAGGING);
  }

  registerShortcuts(): void {
    this.interactionCleanup = registerInteractions(this);
  }

  unregisterShortcuts(): void {
    this.interactionCleanup?.();
    this.interactionCleanup = undefined;
  }

  onKeyDown(event: KeyboardEvent) {
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
      if (this.isEditing() && event.key !== this.nudgeActiveKey)
        this.nudgeStart(event.key);
    }
  }

  /** Start the smooth-nudge loop for a held arrow key. */
  private nudgeStart(key: string) {
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
  }

  /** Stop the smooth-nudge loop. Also clears the suppressed-transition
   * class; when nudgeStart() re-creates a loop (direction switch) the very
   * next sync tick re-adds it, so there is no visible flicker. */
  private nudgeStop() {
    const loop = this.nudgeLoop;
    this.nudgeLoop = undefined;
    this.nudgeMapRect = undefined;
    this.nudgeActiveKey = undefined;
    this.cropState?.box.classList.remove(CONST.CLASSES.DRAGGING);
    loop?.stop();
  }

  /** True while the crop box is open and being edited (not locked). */
  private isEditing(): boolean {
    return !!this.cropState && !this.cropState.locked;
  }

  /** Apply a new rect: update state, box style, and (optionally) the size hint. */
  private applyRect(r: Rect, withHint = true) {
    if (!this.cropState) return;
    this.cropState.rect = r;
    this.updateBoxStyle(this.cropState.box, r);
    if (withHint) this.showHintWithInfo(r, T("hint_unlocked"));
  }

  /** Reset the unlocked crop box to the default centered size. */
  resetCropBox() {
    if (!this.isEditing()) return;
    this.applyRect(this.defaultRect());
  }

  /** Nudge the unlocked crop box by NUDGE_STEP px in an arrow direction. */
  nudgeCropBox(key: string) {
    if (!this.isEditing()) return;
    const d = nudgeDirection(key);
    this.nudgeCropBoxDelta(d.x * CONST.CROP.NUDGE_STEP, d.y * CONST.CROP.NUDGE_STEP);
  }

  /** Apply an already-computed (possibly fractional) delta to the crop box.
   * Used by the frame-aligned nudge loop: it floors the delta so the DOM
   * position stays integral while the caller carries the decimal remainder in
   * an accumulator — giving smooth continuous motion at a controlled speed.
   * Clamps within the same map bounds as nudgeCropBox(). */
  private nudgeCropBoxDelta(dx: number, dy: number) {
    const st = this.cropState;
    if (!st) return;
    const mapRect = this.nudgeMapRect ?? this.mapContainer.getBoundingClientRect();
    const r = Object.assign({}, st.rect);
    r.left = Math.max(0, Math.min(mapRect.width - r.width, r.left + Math.floor(dx)));
    r.top = Math.max(0, Math.min(mapRect.height - r.height, r.top + Math.floor(dy)));
    st.box.classList.add(CONST.CLASSES.DRAGGING);
    this.applyRect(r, false);
  }

  /** Key release: restore the box transition suppressed during arrow-key nudging. */
  onKeyUp(event: KeyboardEvent) {
    if (CONST.NUDGE_KEYS.includes(event.key)) {
      // Stop the smooth-nudge loop — keyup is the release signal. The rafLoop
      // keeps ticking at ~60Hz until stopped, so without this the box would
      // drift forever after a single press. nudgeStop() clears the
      // suppressed-transition class, so there's nothing left to do here.
      this.nudgeStop();
    }
  }

  /** Default centered crop box (same as the no-history branch of showCropBox). */
  defaultRect(): Rect {
    const mapRect = this.mapContainer.getBoundingClientRect();
    const padW = mapRect.width * CONST.CROP.PADDING_RATIO;
    const padH = mapRect.height * CONST.CROP.PADDING_RATIO;
    return {
      left: padW,
      top: padH,
      width: mapRect.width - padW * 2,
      height: mapRect.height - padH * 2,
    };
  }

  onMapChange(skipHint?: boolean) {
    if (!this.cropState || !this.cropState.locked) return;
    const nw = this.cropState.geoBounds!.nw;
    const se = this.cropState.geoBounds!.se;
    const tl = this.map.latLngToContainerPoint(L.latLng(nw.lat, nw.lng));
    const br = this.map.latLngToContainerPoint(L.latLng(se.lat, se.lng));
    const newRect: Rect = {
      left: tl.x,
      top: tl.y,
      width: Math.abs(br.x - tl.x),
      height: Math.abs(br.y - tl.y),
    };
    this.cropState.rect = newRect;
    this.updateBoxStyle(this.cropState.box, newRect);
    // Always check pixel limit regardless of hint visibility.
    this.checkPixelLimit(newRect);
    // Update hint text on zoom (rect changes), skip on pan (rect unchanged).
    if (!skipHint) this.showHintWithInfo(newRect, T("hint_locked"));
  }

  /** Check pixel limit and set pixelOverLimit flag. */
  checkPixelLimit(r: Rect) {
    // Pixel limit applies to the crop area itself (not scaled by export
    // DPI). The override of r.width/r.height happens in doRender, so the
    // check here matches the actual exported dimensions.
    const totalPixels = Math.round(r.width) * Math.round(r.height);
    this.pixelOverLimit = CONF.max_pixels != null && totalPixels > CONF.max_pixels;
  }

  doExport() {
    if (this.isExporting || !this.cropState) return;
    // Symmetric lock with the other interactive components (measure / focus).
    if (
      guardBlocked(this.map, CONF.name, T("blocked"), [
        { blockedBy: COMPONENTS.MeasureControl, text: T("blocked_measure") },
        { blockedBy: COMPONENTS.LayerControl, text: T("blocked_layer") },
        { blockedBy: COMPONENTS.SearchControl, text: T("blocked_search") },
        { blockedBy: COMPONENTS.LocateControl, text: T("blocked_locate") },
      ])
    )
      return;
    this.isExporting = true;
    ensureModes(this.map).setMode(CONF.name, "exporting");
    ensureEvents(this.map).emit(EVENTS.BEFORE_EXPORT, { component: CONF.name });
    const r = Object.assign({}, this.cropState.rect);
    const geoBounds = this.cropState.geoBounds;
    if (geoBounds) {
      this.saveBounds(geoBounds);
      this.savedBounds = geoBounds;
    }
    this.removeCropBox();

    // Place a physical overlay on document.body (NOT inside the map
    // container, because pointer-events:none on a parent blocks child
    // elements from receiving events regardless of their own setting).
    // This overlay catches ALL mouse events (hover, click, drag)
    // during export so Leaflet's JS event listeners on SVG paths
    // cannot trigger hover highlights.
    this.exportOverlay = dom.el("div", {
      class: "foliplus-export-blocker",
      parent: document.body,
    });
    // Lock map interactions (pan/zoom) so layer positions stay stable.
    this.lockMap();

    let scaleValue = CONF.scale;
    if (typeof scaleValue !== "number" || isNaN(scaleValue))
      scaleValue = window.devicePixelRatio || 1;
    const bg = CONF.background;

    // Abort if pixel limit is exceeded (warning already shown by showHintWithInfo).
    if (this.pixelOverLimit) {
      this.isExporting = false;
      ensureModes(this.map).setMode(CONF.name, null);
      ensureEvents(this.map).emit(EVENTS.AFTER_EXPORT, { component: CONF.name });
      this.removeExportOverlay();
      return;
    }

    this.showGlobalHint(T("status_exporting"), HINT_DURATION.PERSIST, true);

    const vpW = this.mapContainer.clientWidth;
    const vpH = this.mapContainer.clientHeight;
    const needsBigger =
      r.width > vpW * 1.02 ||
      r.height > vpH * 1.02 ||
      r.left < -vpW * 0.02 ||
      r.top < -vpH * 0.02 ||
      r.left + r.width > vpW * 1.02 ||
      r.top + r.height > vpH * 1.02;

    if (needsBigger && geoBounds && geoBounds.nw)
      this.enlargeAndRender(r, scaleValue, bg, geoBounds, vpW, vpH);
    else this.doRender(r, scaleValue, bg, geoBounds);
  }

  /** Render the crop area to a canvas and trigger download.  Returns the
   *  render promise so callers (e.g. enlargeAndRender) can chain work
   *  after the render completes. */
  doRender(
    r: Rect,
    scaleValue: number,
    bg: string | undefined,
    geoBounds: GeoBounds | undefined,
  ) {
    const hideEls = this.mapContainer.querySelectorAll(CONST.SEL.CONTROL);
    hideEls.forEach(el => el.classList.add(CONST.CLASSES.HIDDEN));
    // Force a synchronous layout so getBoundingClientRect() in the
    // render passes sees the final positions after hiding controls.
    this.mapContainer.offsetHeight;

    if (geoBounds && geoBounds.nw) {
      const nw = this.map.latLngToContainerPoint(
        L.latLng(geoBounds.nw.lat, geoBounds.nw.lng),
      );
      const se = this.map.latLngToContainerPoint(
        L.latLng(geoBounds.se.lat, geoBounds.se.lng),
      );
      r.left = Math.min(nw.x, se.x);
      r.top = Math.min(nw.y, se.y);
      r.width = Math.abs(se.x - nw.x);
      r.height = Math.abs(se.y - nw.y);
    }

    return new ExportRenderer(this.map)
      .render(r, scaleValue, bg || undefined, geoBounds)
      .then(canvas => {
        this.onRenderSuccess(canvas, hideEls);
      })
      .catch(err => {
        this.onRenderError(err, hideEls);
      });
  }

  /** Enlarge the container for over-size exports and render. */
  enlargeAndRender(
    r: Rect,
    scaleValue: number,
    bg: string | undefined,
    geoBounds: GeoBounds,
    vpW: number,
    vpH: number,
  ) {
    const savedStyles: Record<string, string> = {};
    const style = this.mapContainer.style;
    const styleProps = ["width", "height", "min-height", "max-height", "overflow"];
    styleProps.forEach(p => {
      savedStyles[p] = style.getPropertyValue(p);
    });
    const savedCenter = this.map.getCenter();
    const savedZoom = this.map.getZoom();
    const savedAnim = this.map.options.zoomAnimation;
    this.map.options.zoomAnimation = false;

    const bigW = Math.max(vpW, r.left + r.width) + CONST.CROP.CONTAINER_PADDING;
    const bigH = Math.max(vpH, r.top + r.height) + CONST.CROP.CONTAINER_PADDING;
    this.mapContainer.style.width = `${Math.ceil(bigW)}px`;
    this.mapContainer.style.height = `${Math.ceil(bigH)}px`;
    this.mapContainer.style.minHeight = `${Math.ceil(bigH)}px`;
    this.mapContainer.style.overflow = "hidden";

    const cropCenter = L.latLngBounds(
      L.latLng(geoBounds.nw.lat, geoBounds.nw.lng),
      L.latLng(geoBounds.se.lat, geoBounds.se.lng),
    ).getCenter();

    const restore = () => {
      this.map.options.zoomAnimation = savedAnim;
      Object.keys(savedStyles).forEach(p => {
        this.mapContainer.style.setProperty(p, savedStyles[p]);
      });
      this.map.invalidateSize(false);
      this.map.setView(savedCenter, savedZoom, { animate: false });
    };

    // Resize container and centre the map on the crop area.
    // Both invalidateSize and setView are synchronous (animate: false),
    // so the map state is updated immediately.  A single rAF ensures the
    // browser has applied the layout changes before we render.
    this.map.invalidateSize(false);
    this.map.setView(cropCenter, savedZoom, { animate: false });
    requestAnimationFrame(() => {
      this.mapContainer.offsetHeight; // Force synchronous reflow
      this.doRender(r, scaleValue, bg, geoBounds).finally(restore);
    });
  }

  /** Handle successful render: show preview and trigger downloads. */
  onRenderSuccess(canvas: HTMLCanvasElement, hideEls: NodeListOf<Element>) {
    hideEls.forEach(el => el.classList.remove(CONST.CLASSES.HIDDEN));
    this.removeExportOverlay();
    this.unlockMap();
    const format = CONST.currentFormat();
    const prevImg = document.createElement("img");
    prevImg.src = canvas.toDataURL(format.mime);
    prevImg.className = CONST.CLASSES.PREVIEW;
    document.body.appendChild(prevImg);
    // Click to dismiss the preview early; otherwise auto-dismiss after SHORT.
    const dismissPreview = () => prevImg.remove();
    prevImg.addEventListener("click", dismissPreview);
    setTimeout(() => {
      prevImg.removeEventListener("click", dismissPreview);
      prevImg.remove();
    }, HINT_DURATION.SHORT);
    canvas.toBlob(
      async blob => {
        if (!blob) {
          this.showGlobalHint(T("status_fail") + T("err_gen_fail"), HINT_DURATION.LONG);
          this.endExport();
          return;
        }
        const name = CONF.filename || "map";
        try {
          if (format.geotiff) {
            // Export as a single GeoTIFF file with embedded georeferencing.
            await this.downloadGeoTiff(canvas, name);
          } else {
            download(blob, `${name}.${format.ext}`);
          }
        } catch (err) {
          // The download step can throw (e.g. createObjectURL failure) — a thrown
          // error would otherwise skip endExport below and leave the map locked
          // with the blocker overlay on screen.
          console.warn(`[${CONF.name}] export failed:`, err);
        } finally {
          this.showGlobalHint(T("status_success"), HINT_DURATION.LONG);
          this.endExport();
        }
      },
      format.mime,
      CONF.quality,
    );
  }

  /** Release the export state: unlock interaction, emit AFTER_EXPORT, remove
   *  the blocker overlay. Runs on both the success and failure paths —
   *  forgetting it strands `isExporting === true` with map interaction
   *  disabled and the overlay still on screen. */
  endExport() {
    this.isExporting = false;
    ensureModes(this.map).setMode(CONF.name, null);
    ensureEvents(this.map).emit(EVENTS.AFTER_EXPORT, { component: CONF.name });
    this.removeExportOverlay();
  }

  /**
   * Export a GeoTIFF file with embedded georeferencing.
   * Canvas pixel data is written as an RGB GeoTIFF with ModelTiepoint
   * and ModelPixelScale tags for WGS84 (EPSG:4326).
   * Falls back to a plain image download if geo bounds are unavailable.
   */
  async downloadGeoTiff(canvas: HTMLCanvasElement, name: string) {
    // doExport() clears cropState via removeCropBox() before the render
    // callback fires, so cropState.geoBounds is gone by the time we
    // reach downloadGeoTiff.  Use the geoBounds saved in doExport
    // (this.savedBounds) as the primary source, falling back to
    // cropState.geoBounds for programmatic/called-outside-export use.
    const geoBounds = this.savedBounds ?? this.cropState?.geoBounds;
    if (!geoBounds?.nw || !geoBounds?.se) {
      // GeoTIFF requires geo bounds — without them we can't embed
      // georeferencing.  Show a hint instead of silently falling back.
      this.showGlobalHint(T("err_geotiff_geo"), HINT_DURATION.LONG);
      return;
    }
    if (canvas.width <= 0 || canvas.height <= 0) {
      this.showGlobalHint(T("err_gen_fail"), HINT_DURATION.LONG);
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      this.showGlobalHint(T("err_gen_fail"), HINT_DURATION.LONG);
      return;
    }
    let imageData;
    try {
      imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch {
      // Canvas may be tainted by cross-origin images (e.g. tiles from a
      // server without CORS headers).  getImageData throws SecurityError
      // and we cannot extract pixel data for the GeoTIFF.
      this.showGlobalHint(T("err_geotiff_canvas"), HINT_DURATION.LONG);
      return;
    }
    const rgba = imageData.data;

    const rgb = new Uint8Array(canvas.width * canvas.height * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      rgb[j] = rgba[i];
      rgb[j + 1] = rgba[i + 1];
      rgb[j + 2] = rgba[i + 2];
    }

    const pixelWidth = (geoBounds.se.lng - geoBounds.nw.lng) / canvas.width;
    const pixelHeight = (geoBounds.se.lat - geoBounds.nw.lat) / canvas.height;

    // geotiff.js 3.x's writeArrayBuffer writes pixel data verbatim — the
    // Compression tag is stored but the data is not actually encoded, so
    // raw RGB GeoTIFFs are 3 bytes/pixel and very large for HD exports
    // (e.g. 1920×1080 ≈ 6 MB).  Compress the RGB buffer ourselves with
    // DEFLATE (TIFF code 8, native in QGIS/GDAL/ArcGIS) and hand the
    // pre-compressed bytes to writeArrayBuffer, which treats them as the
    // image's strip data.
    const compressed = pako.deflateRaw(rgb);
    const tiffBuffer = GeoTIFF.writeArrayBuffer(compressed, {
      width: canvas.width,
      height: canvas.height,
      ModelTiepoint: [0, 0, 0, geoBounds.nw.lng, geoBounds.nw.lat, 0],
      ModelPixelScale: [pixelWidth, pixelHeight, 0],
      GeographicTypeGeoKey: 4326,
      Compression: 8,
      SamplesPerPixel: [3],
      BitsPerSample: [8, 8, 8],
      PhotometricInterpretation: 2,
    });

    const blob = new Blob([tiffBuffer], { type: "image/tiff" });
    download(blob, `${name}.${CONST.FORMAT.geotiff.ext}`);
  }

  /** Handle render failure. */
  onRenderError(err: Error, hideEls: NodeListOf<Element>) {
    hideEls.forEach(el => el.classList.remove(CONST.CLASSES.HIDDEN));
    ensureModes(this.map).setMode(CONF.name, null);
    ensureEvents(this.map).emit(EVENTS.AFTER_EXPORT, { component: CONF.name });
    this.removeExportOverlay();
    this.unlockMap();
    console.error(`[${CONF.name}] ${T("err_render")}:`, err);
    this.showGlobalHint(T("status_fail") + (err.message || ""), HINT_DURATION.LONG);
    this.isExporting = false;
  }

  /** Remove the physical export overlay to restore mouse interaction. */
  removeExportOverlay() {
    if (this.exportOverlay) {
      this.exportOverlay.remove();
      this.exportOverlay = null;
    }
  }

  /** Disable map interactions while an export is in progress to prevent
   *  pan/zoom from shifting layer positions mid-render (which caused
   *  offset or clipped exports). */
  lockMap() {
    if (!this.map) return;
    this.map.dragging.disable();
    this.map.scrollWheelZoom.disable();
    this.map.doubleClickZoom.disable();
    this.map.boxZoom.disable();
    this.map.keyboard.disable();
    this.map.touchZoom.disable();
  }

  /** Restore map interactions after export. */
  unlockMap() {
    if (!this.map) return;
    this.map.dragging.enable();
    this.map.scrollWheelZoom.enable();
    this.map.doubleClickZoom.enable();
    this.map.boxZoom.enable();
    this.map.keyboard.enable();
    this.map.touchZoom.enable();
  }
}

export { ExportManager };
