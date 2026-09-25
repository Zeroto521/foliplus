// ExportControl export session pipeline — doExport through cleanup.
// Functions are bound onto ExportManager.prototype (this === manager) so
// instance spies stay interceptable and bodies stay a pure move.
import { COMPONENTS } from "#core/component.js";
import { EVENTS } from "#core/event/index.js";
import { HINT_DURATION } from "#core/hint.js";
import { guardBlocked } from "#core/mode.js";
import { dom } from "#common/dom.js";
import { download } from "#common/download.js";
import { createScopedTranslator } from "#common/locale.js";
import { createLogger } from "#common/log.js";
import { nextFrame } from "#common/throttle.js";
import * as CONST from "./const.js";
import type { CropRect, GeoBounds } from "./crop.js";
import type { ExportManager } from "./manager.js";
import { ExportRenderer, isCorsBlocked } from "./renderer/index.js";
import { resolveExportBackground } from "./util.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const T = createScopedTranslator(CONF);
const log = createLogger(CONF.name);

/** Format a progress percentage with the locale text, for the persistent hint. */
const formatProgress = (percent: number) => {
  const pct = String(percent);
  return T("status_progress").replace(/\{pct\}/g, pct);
};

/**
 * Encode a rendered canvas to a Blob, resolving to `null` when encoding fails.
 * `toBlob` already encodes the raster exactly once, so this is deliberately
 * thin — the cost being removed was the `toDataURL` base64 round-trip that
 * used to encode the same pixels again for the transient preview.
 */
const canvasToBlob = (
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<Blob | null> =>
  new Promise(resolve => {
    canvas.toBlob(b => resolve(b), mimeType, quality);
  });

function doExport(this: ExportManager) {
  if (this.isExporting || !this.cropState) return;
  // Symmetric lock with the other interactive components (measure / focus).
  if (
    guardBlocked(this.map, CONF.name, T("blocked"), [
      { blockedBy: COMPONENTS.MeasureControl, text: T("blocked_measure") },
      { blockedBy: COMPONENTS.LayerControl, text: T("blocked_layer") },
      { blockedBy: COMPONENTS.SearchControl, text: T("blocked_search") },
      { blockedBy: COMPONENTS.LocateControl, text: T("blocked_locate") },
    ])
  ) {
    return;
  }
  this.isExporting = true;
  this.lastTileFailures = null;
  this.modes.setMode(CONF.name, "exporting");
  this.events.emit(EVENTS.BEFORE_EXPORT, { component: CONF.name });
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
  if (typeof scaleValue !== "number" || isNaN(scaleValue)) {
    scaleValue = window.devicePixelRatio || 1;
  }
  const bg = resolveExportBackground(this.mapContainer);

  // Abort if pixel limit is exceeded (warning already shown by showHintWithInfo).
  if (this.pixelOverLimit) {
    // Clear all of this component's hints first. The crop-box size/limit
    // hints are PERSIST (duration 0 sets no timer), so they would otherwise
    // outlive the export and sit on top of whatever status appears next.
    this.map.foliplus!.hideHint(CONF.name);
    this.unlockMap();
    this.endExport();
    return;
  }

  // Clear the crop-box hints before showing the exporting status, so the
  // status isn't announced on top of a stale "100 × 100 px" label. They are
  // PERSIST (duration 0 sets no timer), so nothing else removes them once
  // the box is gone — they'd outlive the export entirely, the same registry
  // leak as the object-URL one.
  this.map.foliplus!.hideHint(CONF.name, "size");
  this.map.foliplus!.hideHint(CONF.name, "limit");

  this.showGlobalHint(T("status_exporting"), HINT_DURATION.PERSIST, true);

  // Progress callback: format the percentage with locale text and refresh
  // the persistent hint.  render() reports 0..90 over the drawing passes;
  // this callback owns the final stretch, so 100 is reserved for the
  // download having started rather than the tiles having finished.
  const onProgress = (percent: number) => {
    this.showGlobalHint(formatProgress(percent), HINT_DURATION.PERSIST, true);
  };

  const vpW = this.mapContainer.clientWidth;
  const vpH = this.mapContainer.clientHeight;
  const needsBigger =
    r.width > vpW * 1.02 ||
    r.height > vpH * 1.02 ||
    r.left < -vpW * 0.02 ||
    r.top < -vpH * 0.02 ||
    r.left + r.width > vpW * 1.02 ||
    r.top + r.height > vpH * 1.02;

  if (needsBigger && geoBounds && geoBounds.nw) {
    this.enlargeAndRender(r, scaleValue, bg, geoBounds, vpW, vpH, onProgress);
  } else void this.doRender(r, scaleValue, bg, geoBounds, onProgress);
}

/** Render the crop area to a canvas and trigger download.  Returns the
 *  render promise so callers (e.g. enlargeAndRender) can chain work
 *  after the render completes. */
function doRender(
  this: ExportManager,
  r: CropRect,
  scaleValue: number,
  bg: string | undefined,
  geoBounds: GeoBounds | undefined,
  onProgress?: (percent: number) => void,
) {
  const hideEls = this.mapContainer.querySelectorAll(CONST.SEL.CONTROL);
  hideEls.forEach(el => el.classList.add(CONST.CLASSES.HIDDEN));
  // Force a synchronous layout so getBoundingClientRect() in the
  // render passes sees the final positions after hiding controls.
  void this.mapContainer.offsetHeight;

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

  const renderer = new ExportRenderer(this.map);
  return renderer
    .render(r, scaleValue, bg || undefined, geoBounds, onProgress)
    .then(canvas => {
      this.lastTileFailures = renderer.tileFailures;
      this.onRenderSuccess(canvas, hideEls);
    })
    .catch(err => {
      this.onRenderError(err, hideEls);
    });
}

/** Enlarge the container for over-size exports and render. */
function enlargeAndRender(
  this: ExportManager,
  r: CropRect,
  scaleValue: number,
  bg: string | undefined,
  geoBounds: GeoBounds,
  vpW: number,
  vpH: number,
  onProgress?: (percent: number) => void,
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
  nextFrame(() => {
    void this.mapContainer.offsetHeight; // Force synchronous reflow
    void this.doRender(r, scaleValue, bg, geoBounds, onProgress)
      .finally(restore)
      .catch(() => undefined);
  });
}

/** Handle successful render: show preview and trigger downloads. */
function onRenderSuccess(
  this: ExportManager,
  canvas: HTMLCanvasElement,
  hideEls: NodeListOf<Element>,
) {
  hideEls.forEach(el => el.classList.remove(CONST.CLASSES.HIDDEN));
  this.removeExportOverlay();
  this.unlockMap();
  // The persistent hint already reads "Exporting map... (N%)" from the
  // last render() report, and it never expires — so the encode phase
  // between here and the download is not label-less, and it does not read
  // as finished.  100 stays reserved for claimDownload, where the file
  // actually goes out.
  // Awaited inline so a rejection cannot escape as an unhandled promise
  // rejection — endExport() has to run on every path or the map stays
  // locked behind the blocker overlay.
  void this.finishExport(canvas);
}

async function finishExport(this: ExportManager, canvas: HTMLCanvasElement) {
  const name = CONF.filename || "map";
  try {
    // Encode once into a Blob shared by the preview and the download. The
    // old canvas.toDataURL() encoded the full raster into a base64 string
    // for the preview, and toBlob() then encoded the same pixels a second
    // time — on an HD export that base64 round-trip is a multi-tens-of-MB
    // string copy and was the dominant chunk of the click-to-download delay.
    const format = CONST.currentFormat();
    const blob = await canvasToBlob(canvas, format.mime, CONF.quality);
    if (!blob) {
      this.showGlobalHint(T("status_fail") + T("err_gen_fail"), HINT_DURATION.LONG);
      return;
    }
    this.showPreview(blob);
    // GeoTIFF needs embedded georeferencing, so it ships as its own
    // container file; every other format is the encoded blob itself.
    if (format.geotiff) await this.downloadGeoTiff(canvas, name);
    else this.claimDownload(blob, `${name}.${format.ext}`);
    // A layer whose tiles predominantly failed (e.g. a tile source that
    // rejects CORS requests) leaves a hole in the image — say so instead of
    // a bare success, then clear the stats so the next export starts clean.
    const blocked = (this.lastTileFailures ?? []).some(isCorsBlocked);
    this.lastTileFailures = null;
    this.showGlobalHint(
      blocked ? T("status_partial") : T("status_success"),
      HINT_DURATION.LONG,
    );
  } catch (err) {
    // Any step can throw (createObjectURL, encoding, download anchor). A
    // leaked rejection would otherwise skip endExport below and leave the
    // map locked with the blocker overlay on screen.
    this.showGlobalHint(T("status_fail") + T("err_gen_fail"), HINT_DURATION.LONG);
    log.warn("export failed:", err);
  } finally {
    this.endExport();
  }
}

/**
 * Start the download, claiming the 100 the user expects on the way in.
 * render() stops at 90 because the canvas still has to be encoded before
 * it can be saved — that encode is the delay the user sees with nothing
 * happening.  Claiming the 100 here means a full bar means the file is
 * actually going out, and the label shown in the meantime says what the
 * browser is doing.
 */
function claimDownload(this: ExportManager, blob: Blob, filename: string) {
  this.showGlobalHint(formatProgress(100), HINT_DURATION.PERSIST, true);
  download(blob, filename);
}

/** Show the transient preview overlay for an encoded export artifact.
 *  Click to dismiss early, otherwise auto-dismiss after SHORT. */
function showPreview(this: ExportManager, blob: Blob) {
  const prevImg = document.createElement("img");
  prevImg.src = URL.createObjectURL(blob);
  prevImg.className = CONST.CLASSES.PREVIEW;
  document.body.appendChild(prevImg);
  const dismissPreview = () => {
    prevImg.removeEventListener("click", dismissPreview);
    prevImg.remove();
    URL.revokeObjectURL(prevImg.src);
  };
  prevImg.addEventListener("click", dismissPreview);
  setTimeout(dismissPreview, HINT_DURATION.SHORT);
}

/** Release the export state: unlock interaction, emit AFTER_EXPORT, remove
 *  the blocker overlay. Runs on both the success and failure paths —
 *  forgetting it strands `isExporting === true` with map interaction
 *  disabled and the overlay still on screen. */
function endExport(this: ExportManager) {
  this.isExporting = false;
  this.modes.setMode(CONF.name, null);
  this.events.emit(EVENTS.AFTER_EXPORT, { component: CONF.name });
  this.removeExportOverlay();
}

/**
 * Export a GeoTIFF file with embedded georeferencing.
 * Canvas pixel data is written as an RGB GeoTIFF with ModelTiepoint
 * and ModelPixelScale tags for WGS84 (EPSG:4326).
 * Falls back to a plain image download if geo bounds are unavailable.
 */
function downloadGeoTiff(this: ExportManager, canvas: HTMLCanvasElement, name: string) {
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
  this.claimDownload(blob, `${name}.${CONST.FORMAT.geotiff.ext}`);
}

/** Handle render failure. */
function onRenderError(this: ExportManager, err: Error, hideEls: NodeListOf<Element>) {
  hideEls.forEach(el => el.classList.remove(CONST.CLASSES.HIDDEN));
  this.modes.setMode(CONF.name, null);
  this.events.emit(EVENTS.AFTER_EXPORT, { component: CONF.name });
  this.removeExportOverlay();
  this.unlockMap();
  log.error(`${T("err_render")}:`, err);
  this.showGlobalHint(T("status_fail") + (err.message || ""), HINT_DURATION.LONG);
  this.isExporting = false;
}

/** Remove the physical export overlay to restore mouse interaction. */
function removeExportOverlay(this: ExportManager) {
  if (this.exportOverlay) {
    this.exportOverlay.remove();
    this.exportOverlay = null;
  }
}

/** Method table installed on ExportManager.prototype. */
export const sessionMethods = {
  claimDownload,
  doExport,
  doRender,
  downloadGeoTiff,
  endExport,
  enlargeAndRender,
  finishExport,
  onRenderError,
  onRenderSuccess,
  removeExportOverlay,
  showPreview,
};

export { canvasToBlob };
