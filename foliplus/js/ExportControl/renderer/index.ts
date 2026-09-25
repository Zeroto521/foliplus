// ExportControl mixed-mode renderer — orchestrates independent rendering passes.
// render() stays here (the class method that calls the other passes via `this`);
// each pass's implementation lives in its own module and is delegated to by
// the class method of the same name.
import { layerUrl } from "#core/leafletAdapter.js";
import { createScopedTranslator } from "#common/locale.js";
import { createLogger } from "#common/log.js";
import * as CONST from "../const.js";
import {
  collectLayerMarkers,
  renderFontAwesome,
  renderMarkers,
  renderRemaining,
  renderTextLabels,
} from "./marker.js";
import { renderCanvasElement, renderPaneCanvas } from "./canvas.js";
import { renderPaneSVG } from "./svg.js";
import { calcTiles, renderTileLayer, tilePositions } from "./tile.js";
import {
  isCorsBlocked,
  pooledEach,
  type RenderCtx,
  type TileLoadStats,
  type TileDesc,
} from "./util.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const T = createScopedTranslator(CONF);
const log = createLogger(CONF.name);

// ==================== ExportRenderer ====================
// Mixed-mode renderer with independent rendering passes.
// render() orchestrates the passes in painter's-algorithm order:
//   1. tiles → 2. SVG → 3. canvas → 4. markers (sprites) → 5. FontAwesome →
//   6. text labels → 7. remaining (img, inline SVG, bg-color)

class ExportRenderer {
  map: L.Map;
  container: HTMLElement;
  /** Per-layer tile load stats, reset at the start of each render() and
   *  appended to by the tile passes.  The manager reads this after render()
   *  resolves to warn about CORS-blocked tile sources. */
  tileFailures: TileLoadStats[] = [];

  constructor(map: L.Map) {
    this.map = map;
    this.container = map.getContainer();
  }

  /** Calculate tile coordinates covering geo bounds at a given zoom. */
  calcTiles(
    tileLayer: L.TileLayer,
    bounds: { nw: { lat: number; lng: number }; se: { lat: number; lng: number } },
    zoom: number,
    scaleVal: number,
  ): TileDesc[] {
    return calcTiles(this.map, tileLayer, bounds, zoom, scaleVal);
  }

  /** Share of the progress range each phase of render() may occupy.
   *
   *  Tiles get the most, since they are the only phase that waits on the
   *  network and therefore dominates real export time; the vector/marker
   *  passes are fast but still happen before the canvas is done.  The top
   *  10 points are deliberately unused here — they belong to the manager,
   *  which owns the blob encoding.  That way 100 means the download has
   *  started, not that tiles have finished loading, which is when the
   *  download was previously reported as complete. */
  private static readonly PHASES = {
    tiles: [0, 70],
    layers: [71, 90],
  } as const;

  /** Map a [0,1] fraction to the given percent range, monotonically. */
  private static mapPhase(fraction: number, [lo, hi]: readonly [number, number]) {
    return Math.min(hi, lo + Math.round(fraction * (hi - lo)));
  }

  /** Orchestrate all rendering passes in painter's-algorithm order.
   *  Passes: tiles → SVG → canvas → markers → FA → text → remaining.
   *  Overlay layers iterate via `api.layers` (read-only view of
   *  LayerRegistry's ordered array) bottom-to-top so cross-technology
   *  z-ordering is preserved per layer.
   *
   *  onProgress reports 0..90 over those passes, monotonically.  It never
   *  reports 100: the canvas still has to be encoded before it can be
   *  saved, and that belongs to the caller.  ExportRenderer does not
   *  interpret the value — it forwards it so the caller can format it
   *  (e.g. with locale text) however it likes. */
  async render(
    rect: { left: number; top: number; width: number; height: number },
    scale: number,
    bg: string | undefined,
    geoBounds:
      | { nw: { lat: number; lng: number }; se: { lat: number; lng: number } }
      | undefined,
    onProgress?: (percent: number) => void,
  ): Promise<HTMLCanvasElement> {
    const sw = Math.round(rect.width * scale);
    const sh = Math.round(rect.height * scale);
    if (sw < 1 || sh < 1) throw new Error(log.msg(T("err_crop_too_small")));
    // Stats are per-render: a repeated render (e.g. the enlarged path calling
    // doRender again) must not carry the previous attempt's failures forward.
    this.tileFailures = [];

    // Progress must be reportable from the moment the canvas is created, so it
    // lives here rather than on the render context: the background fill below
    // is the first step that costs anything, and no layers can be sized yet.
    let lastPercent = 0;
    const reportProgress = (percent: number) => {
      // Only ever move forward: reporting a lower value than one already
      // shown would make the bar look stuck and regress.
      if (percent <= lastPercent) return;
      lastPercent = percent;
      onProgress?.(percent);
    };

    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d")!;

    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, sw, sh);
    }

    // Shared render context threaded through all passes.
    const rc: import("./util.js").RenderCtx = {
      ctx,
      rect,
      scale,
      contRect: this.container.getBoundingClientRect(),
      // Derived values used by every pass.
      cw: rect.width * scale,
      ch: rect.height * scale,
      sw,
      sh,
      onProgress: reportProgress,
    };

    // 2. All layers — iterate in LayerControl API order bottom-to-top.
    // Each layer may contain Tile, SVG, Canvas, and/or Marker elements, so we
    // render all passes per-layer to preserve cross-technology z-order.
    // Uses api.layers (read-only view of LayerRegistry's ordered array).
    const api = map.foliplus!.LayerAPI;
    const layers = api?.layers;
    if (layers) {
      // Progress is reported as a share of every tile across all visible tile
      // layers, not per layer: with several visible TileLayers each of a
      // different tile count, per-layer percentages would restart at 0 and the
      // indicator would jump backwards.
      //
      // The denominator is the tiles renderTileLayer is actually going to
      // draw — its pre-filtered, viewport-clip list — not the raw calcTiles
      // extent.  Using the extent would make the numerator and denominator
      // disagree: a clipped layer draws fewer tiles than it enumerated, so the
      // running total could never reach tilesTotal and the last batch would
      // report 80-95% instead of 100.  Each layer is therefore sized (which
      // does the same filtering as the draw pass) and counted, and its own
      // total is reported against the running cross-layer sum.
      if (geoBounds && geoBounds.nw) {
        // A solid-color basemap hides tilePane by class instead of unchecking
        // the tile layers, so every `li.visible` is still true and the tile
        // URLs would still be fetched — the tiles repaint over the colour the
        // user just picked.  Read the pane's computed state rather than the
        // class: it is what the screen actually shows, and it does not bind to
        // whichever rule produced the hiding.  Skipping here leaves sizedTiles
        // empty, so the progress denominator correctly reports no tiles.
        const tilePane = this.map.getPane("tilePane");
        const tilePaneVisible =
          !tilePane || window.getComputedStyle(tilePane).visibility !== "hidden";

        // Size every tile layer up front: the sum is the progress denominator
        // and the surviving entries are the layers that get drawn, so the
        // numerator and denominator describe the same set of tiles.
        const zoom = this.map.getZoom();
        const sizedTiles: Array<{
          tiles: import("./util.js").TileDesc[];
          count: number;
          layer: L.TileLayer;
        }> = [];
        for (const li of layers) {
          if (
            !tilePaneVisible ||
            !li.visible ||
            !(li.layer instanceof L.TileLayer) ||
            !layerUrl(li.layer)
          ) {
            continue;
          }
          const tiles = this.tilePositions(
            rc,
            this.calcTiles(li.layer, geoBounds, zoom, scale),
          );
          if (tiles.length > 0) {
            sizedTiles.push({ tiles, count: tiles.length, layer: li.layer });
          }
        }
        const grandTotal = sizedTiles.reduce((sum, li) => sum + li.count, 0);

        if (grandTotal > 0) {
          let tilesDone = 0;
          for (const { tiles, layer } of sizedTiles) {
            await this.renderTileLayer(rc, tiles, layer, handled => {
              tilesDone += handled;
              rc.onProgress?.(
                ExportRenderer.mapPhase(
                  tilesDone / grandTotal,
                  ExportRenderer.PHASES.tiles,
                ),
              );
            });
          }
        } else {
          // No tiles to download, so the remaining phases start from the top
          // of their range instead of from 0.
          rc.onProgress?.(ExportRenderer.PHASES.layers[0]);
        }
      }

      // Only layers that can actually paint are in the denominator: an entry
      // with no layer and no canvas contributes nothing, and counting it would
      // leave the layer range permanently short of its top.  The filter must
      // stay in step with what the loop body consumes, since every surviving
      // entry is counted as one unit of progress.
      const passable = layers.filter(
        li =>
          li.visible &&
          (li.canvas ||
            (li.layer && !(li.layer instanceof L.TileLayer && layerUrl(li.layer)))),
      );
      let done = 0;
      for (let i = passable.length - 1; i >= 0; i--) {
        const li = passable[i];

        // Callback-only layers (e.g. HeatmapControl canvas) — render via stored canvas
        if (li.canvas) {
          await this.renderCanvasElement(rc, li.canvas);
          done++;
        } else if (li.layer) {
          // SVG paths, Canvas elements, and Markers in this layer's panes
          const panes = api.getLayerPanes(li.layer);
          for (const paneName of panes) {
            const pane = this.map.getPane(paneName);
            if (!pane) continue;
            await this.renderPaneSVG(rc, pane);
            await this.renderPaneCanvas(rc, pane);
          }

          // The layer's annotation labels sit one z-step above its content, in
          // a pane the content walk never visits (created with map.createPane).
          // Drawing them here — right after this layer, before the next layer
          // up — keeps the export's stack order identical to the map's: a layer
          // above covers this layer's labels.
          const labelPane = this.map.getPane(CONST.ANNOTATION_PANE_PREFIX + li.id);
          if (labelPane) {
            await this.renderPaneCanvas(rc, labelPane, CONST.SEL.ANNOTATION_CANVAS);
          }

          // Markers and divIcons in this layer
          const markerRoots = this.collectLayerMarkers(li.layer);
          if (markerRoots.length) {
            await this.renderMarkers(rc, markerRoots);
            await this.renderFontAwesome(rc, markerRoots);
            await this.renderTextLabels(rc, markerRoots);
            await this.renderRemaining(rc, markerRoots);
          }
        }
        done++;
        rc.onProgress?.(
          ExportRenderer.mapPhase(done / passable.length, ExportRenderer.PHASES.layers),
        );
      }
    }

    return canvas;
  }

  /** Render a standalone canvas element (e.g. HeatmapControl). */
  async renderCanvasElement(
    rc: RenderCtx,
    ce: HTMLCanvasElement,
  ) {
    return renderCanvasElement(this.container, rc, ce);
  }

  private tilePositions(
    rc: RenderCtx,
    tiles: import("./util.js").TileDesc[],
  ): TileDesc[] {
    return tilePositions(this.map, rc, tiles);
  }

  /** Render a single tile layer from geo bounds with concurrent tile loading.
   *  onProgress reports the cumulative tiles actually drawn for this layer
   *  (not a percentage, and not tiles merely fetched), so the caller can
   *  accumulate a share of the whole export instead of re-basing the bar at
   *  the start of every layer.  Failing tiles do not advance it: they are
   *  still missing from the picture, which is what the bar is for. */
  async renderTileLayer(
    rc: RenderCtx,
    visibleTiles: import("./util.js").TileDesc[],
    layer: L.TileLayer,
    onProgress?: (tilesDrawn: number) => void,
  ) {
    return renderTileLayer(
      this.tileFailures,
      rc,
      visibleTiles,
      layer,
      onProgress,
    );
  }

  /** Render SVG content from a single pane. */
  async renderPaneSVG(rc: import("./util.js").RenderCtx, pane: HTMLElement) {
    return renderPaneSVG(this.container, rc, pane);
  }

  /** Render canvas elements from a pane — or the container, for canvases that
   *  live in a pane the per-layer walk never visits (annotation labels). */
  async renderPaneCanvas(
    rc: RenderCtx,
    pane: HTMLElement,
    selector: string = CONST.SEL.CANVAS,
  ) {
    return renderPaneCanvas(this.container, rc, pane, selector);
  }

  /** Collect markers belonging to a specific layer's panes. */
  collectLayerMarkers(layer: L.Layer): HTMLElement[] {
    return collectLayerMarkers(layer);
  }

  /** Render markers with background-image sprites. */
  async renderMarkers(
    rc: RenderCtx,
    markerRoots: HTMLElement[],
  ) {
    return renderMarkers(this.container, rc, markerRoots);
  }

  /** Render FontAwesome icons from ::before pseudo-element content. */
  async renderFontAwesome(
    rc: RenderCtx,
    markerRoots: HTMLElement[],
  ) {
    return renderFontAwesome(this.container, rc, markerRoots);
  }

  /** Render plain text labels (e.g. MeasureControl distance labels) with background. */
  async renderTextLabels(
    rc: RenderCtx,
    markerRoots: HTMLElement[],
  ) {
    return renderTextLabels(this.container, rc, markerRoots);
  }

  /** Render remaining icon types not handled by other passes:
   *  <img> → fallback sprite → inline SVG → background-color fill. */
  async renderRemaining(
    rc: RenderCtx,
    markerRoots: HTMLElement[],
  ) {
    return renderRemaining(this.container, rc, markerRoots);
  }
}

export { ExportRenderer, isCorsBlocked, pooledEach };
export type { TileLoadStats };
