// ExportControl mixed-mode renderer — orchestrates independent rendering passes.
// render() stays here (the class method that calls the other passes via `this`);
// each pass's implementation lives in its own module and is delegated to by
// the class method of the same name.
import { type LayerInfo, findLayer } from "#core/layer/index.js";
import { layerUrl } from "#core/leafletAdapter.js";
import { createScopedTranslator } from "#common/locale.js";
import { createLogger } from "#common/log.js";
import * as CONST from "../const.js";
import type { RenderCtx, TileDesc, TileLoadStats } from "../type.js";
import { renderCanvasElement, renderPaneCanvas } from "./canvas.js";
import {
  collectLayerShadows,
  collectPaneRoots,
  renderFontAwesome,
  renderMarkers,
  renderRemaining,
  renderTextLabels,
} from "./marker.js";
import { renderPaneSVG } from "./svg.js";
import { calcTiles, renderTileLayer, tilePositions } from "./tile.js";
import { isCorsBlocked, pooledEach } from "./util.js";

// CONFIG is a free variable from the IIFE template wrapper (see BaseControl._template).
const T = createScopedTranslator(CONFIG);
const log = createLogger(CONFIG.name);

/** Panes a layer's content walk must visit: what the layer API reports, minus
 *  every pane the export's shadow channel owns.
 *
 *  `shadowPanes` is collected across the whole export before the first pane is
 *  resolved (see `render()`), not per layer: a custom shadow pane can be
 *  shared by several layers, and layer A's content walk must not paint the pane
 *  that carries layer B's shadows either.  The subtraction also keeps the
 *  channel single-source — a pane named as a shadow is drawn once, by the
 *  shadow pass, from the owning leaves, never as a content root. */
const resolveExportPanes = (
  layer: L.Layer,
  shadowPanes: ReadonlySet<string>,
): string[] => {
  const raw = map.foliplus?.LayerAPI?.getLayerPanes(layer) ?? [];
  return raw.filter(name => !shadowPanes.has(name));
};

/** Report a shadow image the canvas could not read back.  A cross-origin
 *  `shadowUrl` without CORS headers is the usual cause; the shadow is left out
 *  of the picture, so say so instead of producing a silently shadowless
 *  export. */
const warnShadowLoadFailure = (src: string, error: unknown): void => {
  log.warn(
    `marker shadow left out of the export: "` +
      src +
      `" could not be loaded (cross-origin images need CORS headers)`,
    error,
  );
};

/** Report a shadow element that cannot be drawn because it declares no image
 *  source.  An AwesomeMarkers-style `folium.Icon` leaves an `<img src="">`
 *  shadow on the leaf; without this line the export is silently shadowless
 *  with nothing to grep for. */
const warnShadowWithoutSource = (): void => {
  log.warn(
    "marker shadow left out of the export: the shadow <img> has no src " +
      "(an icon whose shadowUrl is empty cannot be rasterised)",
  );
};

/** Wait one animation frame so the browser commits layout the caller just
 *  forced.  `session.doRender` hides the export chrome and reads
 *  `offsetHeight` in the same task that calls `render()`; a rect read before
 *  that layout is committed is a transient one (a shadow pane measured at
 *  (-128,-72) painted its shadow 256x144 canvas px away from the icon — the
 *  "icon drawn, shadow missing" export).  One frame before the first pass makes
 *  every measurement read the settled layout; the draw passes still re-measure
 *  right before drawing, which is the second half of the same guard. */
const nextFrame = (): Promise<void> =>
  new Promise(resolve => requestAnimationFrame(() => resolve()));

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

  /** Resolve a layer from a LayerInfo: use the pre-captured reference when
   *  available, otherwise look it up live. This is the late-binding fallback
   *  for basemaps whose TileLayer `var` was emitted after the LayerControl
   *  IIFE in the folium script stream — the registry captured `layer: null`
   *  at construction, and without this the render passes silently skip the
   *  basemap and the export is missing its base layer. Mirrors the same
   *  pattern at LayerControl/controller.ts#210. */
  private resolveLayer(layerInfo: LayerInfo): L.Layer | null {
    // Late-binding fallback for basemaps whose TileLayer `var` was emitted
    // after the LayerControl IIFE — mirrors manager.findLayer. Explicit
    // no-carrier entries (canvas/solid/custom) return null here by design.
    return layerInfo.layer ?? findLayer(this.map, layerInfo.id);
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
   *  LayerInfoRegistry's ordered array) bottom-to-top so cross-technology
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
    const rc: import("../type.js").RenderCtx = {
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
    // Uses api.layers (read-only view of LayerInfoRegistry's ordered array).
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
      if (geoBounds?.nw) {
        // Size every tile layer up front: the sum is the progress denominator
        // and the surviving entries are the layers that get drawn, so the
        // numerator and denominator describe the same set of tiles. The
        // solid-color basemap, when visible, is a separate canvas entry in
        // `layerInfo.canvas` — it paints over the tile layer above it in row order
        // exactly like any other pane.
        const zoom = this.map.getZoom();
        const sizedTiles: Array<{
          tiles: import("../type.js").TileDesc[];
          count: number;
          layer: L.TileLayer;
        }> = [];
        for (const layerInfo of layers) {
          const layer = this.resolveLayer(layerInfo);
          if (
            !(api.intentVisible?.(layerInfo.id) ?? true) ||
            !(layer instanceof L.TileLayer) ||
            !layerUrl(layer)
          ) {
            continue;
          }
          const tiles = this.tilePositions(
            rc,
            this.calcTiles(layer, geoBounds, zoom, scale),
          );
          if (tiles.length > 0) {
            sizedTiles.push({ tiles, count: tiles.length, layer });
          }
        }
        const grandTotal = sizedTiles.reduce((sum, bucket) => sum + bucket.count, 0);

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
      const passable = layers.filter(layerInfo => {
        const layer = this.resolveLayer(layerInfo);
        return (
          (api.intentVisible?.(layerInfo.id) ?? true) &&
          (layerInfo.canvas ??
            (layer && !(layer instanceof L.TileLayer && layerUrl(layer))))
        );
      });
      // The shadow channel is resolved before anything is drawn, over every
      // registered layer:
      //   - each layer's shadow roots come from its own leaves
      //     (`collectLayerShadows`), so a shadow is found wherever it is
      //     mounted — the layer's own pane, Leaflet's shared `shadowPane`, or a
      //     custom pane several layers share;
      //   - the REAL parent pane of each admitted shadow is accumulated
      //     export-wide (never the declared `options.shadowPane` name, which can
      //     collide with a content pane) and subtracted from EVERY layer's
      //     content panes: a shared shadow pane must not be walked as content
      //     by any of its layers, or the same shadows would be painted twice
      //     (once below the icon, once as marker roots above it).
      // A shadow element is drawn once per export (the Set is keyed by the
      // element, not the pane): two layers pointing at one shared pane each
      // contribute only their own leaves' shadows.
      // The caller hid the chrome and forced a reflow in this same task; one
      // frame makes the browser commit that layout before any pass reads a
      // rect (see nextFrame).  Without it the first shadow pass measures a
      // transient box and paints the shadow off its icon.
      await nextFrame();

      let warnedMissingShadowSrc = false;
      const reportMissingShadowSrc = (): void => {
        if (warnedMissingShadowSrc) return;
        warnedMissingShadowSrc = true;
        warnShadowWithoutSource();
      };
      const shadowPaneNames = new Set<string>();
      const shadowRootsByLayer = new Map<LayerInfo, HTMLElement[]>();
      for (const layerInfo of layers) {
        const layer = this.resolveLayer(layerInfo);
        if (!layer) continue;
        shadowRootsByLayer.set(
          layerInfo,
          this.collectLayerShadows(layer, shadowPaneNames, reportMissingShadowSrc),
        );
      }
      const drawnShadowRoots = new Set<HTMLElement>();

      let done = 0;
      for (let i = passable.length - 1; i >= 0; i--) {
        const layerInfo = passable[i];
        const layer = this.resolveLayer(layerInfo);

        // Callback-only layers (e.g. HeatmapControl canvas) — render via stored canvas
        if (layerInfo.canvas) {
          await this.renderCanvasElement(rc, layerInfo.canvas);
          done++;
        } else if (layer) {
          // The layer's own shadows go down first: a shadow sits one z-step
          // BELOW the icon it belongs to (its pane is under the base pane), so
          // it has to be on the canvas before the content and the icons.  Roots
          // are claimed only after the list is built, so a layer whose shadows
          // are all already drawn cannot block anything.
          const shadowRoots = (shadowRootsByLayer.get(layerInfo) ?? []).filter(
            root => !drawnShadowRoots.has(root),
          );
          for (const root of shadowRoots) drawnShadowRoots.add(root);
          if (shadowRoots.length) {
            await this.renderRemaining(rc, shadowRoots, warnShadowLoadFailure);
          }

          // SVG paths, Canvas elements, and Markers in this layer's panes.
          // The annotation pane is NOT part of the generic walk — its labels
          // are drawn by the dedicated pass right below, and the generic
          // canvas sweep would draw them a second time (double-painted
          // labels, deepened alpha).
          const contentPanes = this.resolveExportPanes(layer, shadowPaneNames).filter(
            paneName => !paneName.startsWith(CONST.ANNOTATION_PANE_PREFIX),
          );
          for (const paneName of contentPanes) {
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
          const labelPane = this.map.getPane(
            CONST.ANNOTATION_PANE_PREFIX + layerInfo.id,
          );
          if (labelPane) {
            await this.renderPaneCanvas(rc, labelPane, CONST.SEL.ANNOTATION_CANVAS);
          }

          // Markers and divIcons in this layer.  The sweep takes the resolved
          // content panes, not the raw `getLayerPanes` answer: the resolver
          // has already removed every shadow pane, and a shadow must never be
          // admitted as a marker root — it would paint on top of its icon.
          const markerRoots = this.collectPaneRoots(contentPanes);
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
  async renderCanvasElement(rc: RenderCtx, ce: HTMLCanvasElement) {
    return renderCanvasElement(this.container, rc, ce);
  }

  /** Viewport-clip a tile list to the crop rect. Pure geometry — the class
   *  entry point is a thin delegate of `renderer/tile.js:tilePositions`. */
  tilePositions(rc: RenderCtx, tiles: import("../type.js").TileDesc[]): TileDesc[] {
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
    visibleTiles: import("../type.js").TileDesc[],
    layer: L.TileLayer,
    onProgress?: (tilesDrawn: number) => void,
  ) {
    return renderTileLayer(this.tileFailures, rc, visibleTiles, layer, onProgress);
  }

  /** Render SVG content from a single pane. */
  async renderPaneSVG(rc: import("../type.js").RenderCtx, pane: HTMLElement) {
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

  /** Panes this layer's content walk must visit, with every shadow pane in
   *  `shadowPanes` removed. */
  resolveExportPanes(layer: L.Layer, shadowPanes: ReadonlySet<string>): string[] {
    return resolveExportPanes(layer, shadowPanes);
  }

  /** Collect this layer's marker-shadow roots and record the pane names they
   *  actually ride in (the export-wide exclusion set).  `onMissingSource`
   *  reports a shadow element that declares no image source instead of
   *  collecting a root the draw pass would skip silently. */
  collectLayerShadows(
    layer: L.Layer,
    paneNames: Set<string>,
    onMissingSource?: (el: HTMLImageElement) => void,
  ): HTMLElement[] {
    return collectLayerShadows(layer, paneNames, onMissingSource);
  }

  /** Collect exportable roots from a set of panes — the marker-pass
   *  admission filter, shared by the content and shadow walks. */
  collectPaneRoots(paneNames: readonly string[]): HTMLElement[] {
    return collectPaneRoots(paneNames);
  }

  /** Render markers with background-image sprites. */
  async renderMarkers(rc: RenderCtx, markerRoots: HTMLElement[]) {
    return renderMarkers(this.container, rc, markerRoots);
  }

  /** Render FontAwesome icons from ::before pseudo-element content. */
  async renderFontAwesome(rc: RenderCtx, markerRoots: HTMLElement[]) {
    return renderFontAwesome(this.container, rc, markerRoots);
  }

  /** Render plain text labels (e.g. MeasureControl distance labels) with background. */
  async renderTextLabels(rc: RenderCtx, markerRoots: HTMLElement[]) {
    return renderTextLabels(this.container, rc, markerRoots);
  }

  /** Render remaining icon types not handled by other passes:
   *  <img> → fallback sprite → inline SVG → background-color fill.  The shadow
   *  channel passes `onLoadError` so a shadow the canvas cannot read back is
   *  reported instead of silently missing. */
  async renderRemaining(
    rc: RenderCtx,
    markerRoots: HTMLElement[],
    onLoadError?: (src: string, error: unknown) => void,
  ) {
    return renderRemaining(this.container, rc, markerRoots, onLoadError);
  }
}

export { ExportRenderer, isCorsBlocked, pooledEach };
