// ExportControl bounds persistence + map lock — storage restore/save and pan/zoom freeze.
// Functions are bound onto ExportManager.prototype (this === manager) so
// instance spies stay interceptable and bodies stay a pure move.
import { COORD_BOUNDS } from "#core/geo/index.js";
import { HINT_DURATION } from "#core/hint.js";
import { createScopedTranslator } from "#common/locale.js";
import * as Storage from "#common/storage.js";
import { nextFrame } from "#common/throttle.js";
import * as CONST from "./const.js";
import type { CropRect, GeoBounds, LatLngPoint } from "./crop.js";
import type { ExportManager } from "./manager.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const T = createScopedTranslator(CONF);

/** Loaded saved bounds from storage. */
export interface SavedBounds {
  nw: LatLngPoint;
  se: LatLngPoint;
}

function loadSavedBounds(this: ExportManager) {
  const data = Storage.loadRecord<SavedBounds | null>(CONST.STORAGE.KEY, CONF.name);
  if (!data || !data.nw || !data.se) return;
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
}

function saveBounds(this: ExportManager, bounds: GeoBounds) {
  Storage.saveRecord(
    CONST.STORAGE.KEY,
    {
      nw: { lat: bounds.nw.lat, lng: bounds.nw.lng },
      se: { lat: bounds.se.lat, lng: bounds.se.lng },
    },
    CONF.name,
  );
}

/** Restore and lock crop box from saved geo bounds. */
function restoreFromSavedBounds(this: ExportManager) {
  this.showCropBox();
  nextFrame(() => {
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

function onMapChange(this: ExportManager, skipHint?: boolean) {
  if (!this.cropState || !this.cropState.locked) return;
  const nw = this.cropState.geoBounds!.nw;
  const se = this.cropState.geoBounds!.se;
  const tl = this.map.latLngToContainerPoint(L.latLng(nw.lat, nw.lng));
  const br = this.map.latLngToContainerPoint(L.latLng(se.lat, se.lng));
  const newRect: CropRect = {
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

/** Disable map interactions while an export is in progress to prevent
 *  pan/zoom from shifting layer positions mid-render (which caused
 *  offset or clipped exports). */
function lockMap(this: ExportManager) {
  if (!this.map) return;
  this.map.dragging.disable();
  this.map.scrollWheelZoom.disable();
  this.map.doubleClickZoom.disable();
  this.map.boxZoom.disable();
  this.map.keyboard.disable();
  this.map.touchZoom.disable();
}

/** Restore map interactions after export. */
function unlockMap(this: ExportManager) {
  if (!this.map) return;
  this.map.dragging.enable();
  this.map.scrollWheelZoom.enable();
  this.map.doubleClickZoom.enable();
  this.map.boxZoom.enable();
  this.map.keyboard.enable();
  this.map.touchZoom.enable();
}

/** Method table installed on ExportManager.prototype. */
export const persistenceMethods = {
  loadSavedBounds,
  lockMap,
  onMapChange,
  restoreFromSavedBounds,
  saveBounds,
  unlockMap,
};
