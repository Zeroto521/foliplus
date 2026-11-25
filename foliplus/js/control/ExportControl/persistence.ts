// ExportControl bounds persistence + map lock — storage restore/save and pan/zoom freeze.
// Function expressions are installed on ExportManager.prototype so `this` is
// the manager and instance spies stay interceptable.
import * as CONST from "./const.js";
import type { ExportManager } from "./manager.js";
import type { SavedBounds } from "./type.js";
import { COORD_BOUNDS, type GeoBounds, boundsToRect } from "#core/geo/index.js";
import { HINT_DURATION } from "#core/overlay/index.js";
import { createScopedTranslator } from "#platform/locale.js";
import * as Storage from "#platform/storage.js";
import { nextFrame } from "#platform/throttle.js";

// CONFIG is a free variable from the IIFE template wrapper (see BaseControl._template).
const T = createScopedTranslator(CONFIG);

const loadSavedBounds = function (this: ExportManager) {
  // Pre-envelope records wrote the bounds flat; the migrator accepts that shape
  // and the versioned reader returns the same object either way.
  const data = Storage.loadVersionedObject<SavedBounds | null>(CONST.STORAGE.KEY, {
    version: CONST.STORAGE.VERSION,
    migrate: raw => {
      const o = raw as Partial<SavedBounds> | null;
      return o?.nw && o?.se ? (o as SavedBounds) : null;
    },
    name: CONFIG.name,
  });
  if (!data?.nw || !data.se) return;
  const nw = data.nw;
  const se = data.se;
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
};

const saveBounds = function (this: ExportManager, bounds: GeoBounds) {
  Storage.saveVersionedObject(CONST.STORAGE.KEY, {
    version: CONST.STORAGE.VERSION,
    data: {
      nw: { lat: bounds.nw.lat, lng: bounds.nw.lng },
      se: { lat: bounds.se.lat, lng: bounds.se.lng },
    },
    name: CONFIG.name,
  });
};

/** Restore and lock crop box from saved geo bounds. */
const restoreFromSavedBounds = function (this: ExportManager) {
  this.showCropBox();
  nextFrame(() => {
    if (!this.cropState || this.cropState.locked) return;
    if (!this.savedBounds) return;
    this.cropState.savedGeoBounds = {
      nw: { lat: this.savedBounds.nw.lat, lng: this.savedBounds.nw.lng },
      se: { lat: this.savedBounds.se.lat, lng: this.savedBounds.se.lng },
    };
    this.lockCropBox(true);
    map.foliplus!.hint.set(CONFIG.name, "restore", T("hint_restore"), {
      duration: HINT_DURATION.MEDIUM,
    });
  });
};

const onMapChange = function (this: ExportManager, skipHint?: boolean) {
  if (!this.cropState?.locked) return;
  const newRect = boundsToRect(this.map, this.cropState.geoBounds!);
  this.cropState.rect = newRect;
  this.updateBoxStyle(this.cropState.box, newRect);
  // Always check pixel limit regardless of hint visibility.
  this.checkPixelLimit(newRect);
  // Update hint text on zoom (rect changes), skip on pan (rect unchanged).
  if (!skipHint) this.showHintWithInfo(newRect, T("hint_locked"));
};

/** Disable map interactions while an export is in progress to prevent
 *  pan/zoom from shifting layer positions mid-render (which caused
 *  offset or clipped exports). */
const lockMap = function (this: ExportManager) {
  if (!this.map) return;
  this.map.dragging.disable();
  this.map.scrollWheelZoom.disable();
  this.map.doubleClickZoom.disable();
  this.map.boxZoom.disable();
  this.map.keyboard.disable();
  this.map.touchZoom.disable();
};

/** Restore map interactions after export. */
const unlockMap = function (this: ExportManager) {
  if (!this.map) return;
  this.map.dragging.enable();
  this.map.scrollWheelZoom.enable();
  this.map.doubleClickZoom.enable();
  this.map.boxZoom.enable();
  this.map.keyboard.enable();
  this.map.touchZoom.enable();
};

/** Method table installed on ExportManager.prototype. */
const persistenceMethods = {
  loadSavedBounds,
  lockMap,
  onMapChange,
  restoreFromSavedBounds,
  saveBounds,
  unlockMap,
};

export { persistenceMethods };
