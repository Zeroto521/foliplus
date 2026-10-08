// ExportControl bounds persistence + map lock — storage restore/save and pan/zoom freeze.
// Function expressions are installed on ExportManager.prototype so `this` is
// the manager and instance spies stay interceptable.
import { COORD_BOUNDS, type GeoBounds, boundsToRect } from "#core/geo/index.js";
import { HINT_DURATION } from "#core/hint.js";
import { createScopedTranslator } from "#common/locale.js";
import * as Storage from "#common/storage.js";
import { nextFrame } from "#common/throttle.js";
import * as CONST from "./const.js";
import type { ExportManager } from "./manager.js";
import type { SavedBounds } from "./type.js";

// CONFIG is a free variable from the IIFE template wrapper (see BaseControl._template).
const T = createScopedTranslator(CONFIG);

const loadSavedBounds = function (this: ExportManager) {
  const data = Storage.loadRecord<SavedBounds | null>(CONST.STORAGE.KEY, CONFIG.name);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- data may be null, nw/se may be absent from legacy records
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
  Storage.saveRecord(
    CONST.STORAGE.KEY,
    {
      nw: { lat: bounds.nw.lat, lng: bounds.nw.lng },
      se: { lat: bounds.se.lat, lng: bounds.se.lng },
    },
    CONFIG.name,
  );
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
    map.foliplus!.showHint(CONFIG.name, T("hint_restore"), HINT_DURATION.MEDIUM, true);
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
  this.map.dragging.disable();
  this.map.scrollWheelZoom.disable();
  this.map.doubleClickZoom.disable();
  this.map.boxZoom.disable();
  this.map.keyboard.disable();
  this.map.touchZoom.disable();
};

/** Restore map interactions after export. */
const unlockMap = function (this: ExportManager) {
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
