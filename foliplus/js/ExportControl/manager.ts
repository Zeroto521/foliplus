// ExportControl manager — crop box state machine, export orchestration.
import { EVENTS, ensureEvents } from "#core/event/index.js";
import { HINT_DURATION } from "#core/hint.js";
import { ensureModes } from "#core/mode.js";
import { dom } from "#common/dom.js";
import { createTranslator } from "#common/locale.js";
import * as Storage from "#common/storage.js";
import * as CONST from "./const.js";
import { ExportRenderer } from "./renderer.js";
import { generateWorldFile } from "./util.js";
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
const _ = createTranslator(CONF);

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
  undoStack: Rect[];
  redoStack: Rect[];
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

  constructor(mapInstance: L.Map) {
    this.map = mapInstance;
    this.mapContainer = this.map.getContainer();

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

    /** Undo / redo history for crop box adjustments. */
    this.undoStack = [];
    this.redoStack = [];

    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
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
    const validLat = nw.lat >= -90 && nw.lat <= 90 && se.lat >= -90 && se.lat <= 90;
    const validLng = nw.lng >= -180 && nw.lng <= 180 && se.lng >= -180 && se.lng <= 180;
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
      map.foliplus!.showHint(
        CONF.name,
        _(`${CONF.name}.hint_restore`),
        HINT_DURATION.MEDIUM,
        true,
      );
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
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("mouseup", this.onMouseUp);
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
    if (type !== "move") this.showHintWithInfo(r, _(`${CONF.name}.hint_unlocked`));
  }

  pushUndoState() {
    if (!this.cropState) return;
    this.undoStack.push(Object.assign({}, this.cropState.rect));
    if (this.undoStack.length > CONST.CACHE.UNDO_MAX) this.undoStack.shift();
    // New drag invalidates the redo history
    this.redoStack = [];
  }

  undoCropBox() {
    if (!this.cropState || !this.undoStack.length) return;
    // Save current rect for possible redo
    this.redoStack.push(Object.assign({}, this.cropState.rect));
    if (this.redoStack.length > CONST.CACHE.UNDO_MAX) this.redoStack.shift();
    // If locked, unlock first so the user can see and continue adjusting
    if (this.cropState.locked) this.unlockCropBox();
    this.cropState.rect = this.undoStack.pop()!;
    this.updateBoxStyle(this.cropState.box, this.cropState.rect);
    this.showHintWithInfo(this.cropState.rect, _(`${CONF.name}.hint_unlocked`));
  }

  redoCropBox() {
    if (!this.cropState || !this.redoStack.length) return;
    this.undoStack.push(Object.assign({}, this.cropState.rect));
    if (this.undoStack.length > CONST.CACHE.UNDO_MAX) this.undoStack.shift();
    if (this.cropState.locked) this.unlockCropBox();
    this.cropState.rect = this.redoStack.pop()!;
    this.updateBoxStyle(this.cropState.box, this.cropState.rect);
    this.showHintWithInfo(this.cropState.rect, _(`${CONF.name}.hint_unlocked`));
  }

  onMouseUp() {
    this.dragState.dragging = false;
    this.dragState.dragType = null;
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("mouseup", this.onMouseUp);
    // Re-enable transition so the box animates smoothly to its final position
    // on the next non-drag style update (e.g. after unlock).
    if (this.cropState?.box)
      this.cropState.box.classList.remove(CONST.CLASSES.DRAGGING);
    this.pushUndoState();
  }

  onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      if (this.cropState?.locked) this.unlockCropBox();
      else this.removeCropBox();
    } else if (event.key === "Enter") {
      if (this.cropState && !this.cropState.locked) this.lockCropBox();
      else if (this.cropState?.locked) this.doExport();
    } else if (
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      event.key.toLowerCase() === "z"
    ) {
      event.preventDefault();
      this.redoCropBox();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      this.undoCropBox();
    }
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
    if (!skipHint) this.showHintWithInfo(newRect, _(`${CONF.name}.hint_locked`));
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

    this.showGlobalHint(
      _(`${CONF.name}.status_exporting`),
      HINT_DURATION.PERSIST,
      true,
    );

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
    const mimeType = CONST.MIME[CONF.format as "png"] || CONST.MIME.DEFAULT;
    const prevImg = document.createElement("img");
    prevImg.src = canvas.toDataURL(mimeType);
    prevImg.className = CONST.CLASSES.PREVIEW;
    document.body.appendChild(prevImg);
    // Click to dismiss the preview early; otherwise auto-dismiss after SHORT.
    const dismissPreview = () => prevImg.remove();
    prevImg.addEventListener("click", dismissPreview);
    setTimeout(() => {
      prevImg.removeEventListener("click", dismissPreview);
      prevImg.remove();
    }, HINT_DURATION.SHORT);
    // Trigger World File (`.pgw`) download immediately — it is pure
    // computation from the canvas pixel dimensions and the geo bounds
    // saved in cropState, so it does not depend on the toBlob() callback.
    this.downloadWorldFile(canvas);
    canvas.toBlob(
      blob => {
        if (!blob) {
          this.showGlobalHint(
            _(`${CONF.name}.status_fail`) + _(`${CONF.name}.err_gen_fail`),
            HINT_DURATION.LONG,
            false,
          );
          this.isExporting = false;
          ensureModes(this.map).setMode(CONF.name, null);
          ensureEvents(this.map).emit(EVENTS.AFTER_EXPORT, { component: CONF.name });
          this.removeExportOverlay();
          return;
        }
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        // Append the format extension to the base filename.
        link.download = `${CONF.filename}.${CONF.format}`;
        link.href = url;
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), CONST.TIMING.URL_REVOKE_DELAY);
        this.showGlobalHint(
          _(`${CONF.name}.status_success`),
          HINT_DURATION.LONG,
          false,
        );
        this.isExporting = false;
        ensureModes(this.map).setMode(CONF.name, null);
        ensureEvents(this.map).emit(EVENTS.AFTER_EXPORT, { component: CONF.name });
        this.removeExportOverlay();
      },
      mimeType,
      CONF.quality,
    );
  }

  /**
   * Build and trigger a download for the companion World File (`.pgw`)
   * that makes the exported raster georeferenced.  Uses the geo bounds
   * stored in cropState (captured when the crop box was locked) and the
   * actual bitmap dimensions of the rendered canvas.
   *
   * A zero-cost no-op when there is no geo bounds data.
   */
  downloadWorldFile(canvas: HTMLCanvasElement) {
    const geoBounds = this.cropState?.geoBounds;
    if (!geoBounds?.nw || !geoBounds?.se) return;
    if (canvas.width <= 0 || canvas.height <= 0) return;

    const content = generateWorldFile(
      geoBounds.nw,
      geoBounds.se,
      canvas.width,
      canvas.height,
    );
    if (!content) return;

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    // Use `.pgw` for PNG exports, `.tfw` for other formats — both are
    // understood by QGIS / ArcGIS; `.pgw` is the most universally
    // recognized name.
    link.download = `${CONF.filename}.pgw`;
    link.href = url;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), CONST.TIMING.URL_REVOKE_DELAY);
  }

  /** Handle render failure. */
  onRenderError(err: Error, hideEls: NodeListOf<Element>) {
    hideEls.forEach(el => el.classList.remove(CONST.CLASSES.HIDDEN));
    ensureModes(this.map).setMode(CONF.name, null);
    ensureEvents(this.map).emit(EVENTS.AFTER_EXPORT, { component: CONF.name });
    this.removeExportOverlay();
    this.unlockMap();
    console.error(`[${CONF.name}] ${_(`${CONF.name}.err_render`)}:`, err);
    this.showGlobalHint(
      _(`${CONF.name}.status_fail`) + (err.message || ""),
      HINT_DURATION.LONG,
      false,
    );
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
