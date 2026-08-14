import { createTranslator } from "#common/locale.js";
import * as CONST from "./LayerControl.const.js";
import * as Util from "./LayerControl.util.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const _ = createTranslator(CONF);

/** Marker with protected Leaflet internals (shadow element). */
type MarkerWithShadow = L.Marker & { _shadow?: HTMLElement };

/** Renderer storage on L.Map (keyed by CONST.RENDERER_KEY + pane name). */
interface PaneRendererMap {
  [key: string]: L.SVG | undefined;
}

// ==================== Pane Manager: PaneManager ====================
// Responsibility split — "who orders, who hosts":
//
//   Layer (LayerRegistry) decides ORDER + VISIBILITY:
//     - list order → computeZIndex() derives each layer's z-index number
//     - visibility → map.hasLayer(layer) / addLayer-removeLayer
//     - declares its main pane via layerInfo.paneName
//
//   Pane (PaneManager) HOSTS content and carries that number:
//     - a layer's content may span several panes (graphPane + labelPane),
//       discovered from the layer tree (discoverChildPanes, cached)
//     - enforceOrder writes the layer's z-index onto every pane the
//       layer's content lives in (applyLayerZIndex)
//     - intra-layer order: label panes are bumped above paths
//       (bumpLabelPanes → z + 1)
//
//   LayerManager ORCHESTRATES: reads layer order → computes z → hands
//   it to PaneManager to land on the panes.
//
// Purely map-scoped and independent of the layer registry/UI, so the
// z-order primitives are reusable across controls. The mechanism
// *selection* (applyLayerZIndex) stays on the Manager because it
// depends on the layer registry and z-index computation.
class PaneManager {
  map: L.Map;
  defaultPanes: Set<string>;
  labelPanes: Set<string>;
  paneCache: Map<number, string[]>;
  fallbackPaneMap: Map<number, string>;

  constructor(map: L.Map) {
    this.map = map;
    this.defaultPanes = new Set([
      "overlayPane",
      "markerPane",
      "tilePane",
      "shadowPane",
      "mapPane",
    ]);
    this.labelPanes = new Set();
    this.paneCache = new Map();
    this.fallbackPaneMap = new Map();
  }

  /**
   * Ensure a custom pane exists on the map.
   * @param {string} paneName - Pane name.
   * @param {boolean} [needRenderer=true] - Whether to create an SVG renderer.
   * @returns {Object} `{pane: HTMLElement, renderer: L.SVG|null}`
   */
  ensurePane(
    paneName: string,
    needRenderer = true,
  ): { pane: HTMLElement; renderer: L.SVG | null } {
    let pane = this.map.getPane(paneName);
    if (!pane) {
      pane = this.map.createPane(paneName);
      pane.classList.add("foliplus-layer-pane");
      pane.style.zIndex = String(CONST.Z_INDEX.BASE);
    }
    let renderer: L.SVG | null = null;
    if (needRenderer) {
      const key = CONST.RENDERER_KEY + paneName;
      renderer = (this.map as L.Map & PaneRendererMap)[key] ?? null;
      if (!renderer) {
        renderer = L.svg({ pane: paneName });
        renderer.addTo(this.map);
        (this.map as L.Map & PaneRendererMap)[key] = renderer;
      }
    }
    return { pane, renderer };
  }

  /** Find all custom panes used by a container's tree. */
  discoverChildPanes(layer: L.Layer, depth = 0): string[] {
    if (depth > CONST.RECURSION.PANE_DEPTH) return [];
    const key = L.stamp(layer);
    if (this.paneCache.has(key)) return this.paneCache.get(key) as string[];
    const panes = new Set<string>();
    Util.forEachLayer(
      layer,
      (l: L.Layer) => {
        const p = l.options.pane;
        if (p && !this.isDefaultPane(p)) panes.add(p);
      },
      depth,
    );
    const result = Array.from(panes);
    this.paneCache.set(key, result);
    return result;
  }

  isDefaultPane(pane: string): boolean {
    return this.defaultPanes.has(pane) || pane.startsWith(CONST.FALLBACK_PANE_PREFIX);
  }

  /** Find all panes a layer's content lives in, including fallback panes. */
  getLayerPanes(layer: L.Layer): string[] {
    const panes = this.discoverChildPanes(layer);
    if (panes.length > 0) return panes;
    const fbName = this.fallbackPaneMap.get(L.stamp(layer));
    if (fbName) return [fbName];
    return ["overlayPane", "markerPane"];
  }

  /** Bump label panes for a layer so labels render above paths. */
  bumpLabelPanes(layer: L.Layer, z: number): void {
    const childPanes = this.discoverChildPanes(layer);
    childPanes.forEach(cp => {
      if (this.labelPanes.has(cp)) {
        const lp = this.ensurePane(cp, false);
        if (lp.pane) lp.pane.style.zIndex = String(z + 1);
      }
    });
  }

  /**
   * Move layer DOM content into target panes, batched via DocumentFragment.
   */
  migrateLayers(
    layersToMove: Array<{
      layer: L.Layer;
      paneName: string | null;
      renderer: L.SVG | null;
    }>,
  ): void {
    if (!layersToMove.length) return;
    const groups = new Map<HTMLElement, HTMLElement[]>();
    const markerGroups = new Map<HTMLElement, HTMLElement[]>();
    for (const { layer, paneName, renderer } of layersToMove) {
      if (!paneName) continue;
      const container = (renderer as (L.SVG & { _container?: HTMLElement }) | null)
        ?._container;
      if (!container) continue;
      const paneEl = this.map.getPane(paneName);
      if (!groups.has(container)) groups.set(container, []);
      const collect = (l: L.Layer): void => {
        if (
          (l as L.Layer & { eachLayer?: (fn: (c: L.Layer) => void) => void }).eachLayer
        ) {
          (l as L.Layer & { eachLayer: (fn: (c: L.Layer) => void) => void }).eachLayer(
            collect,
          );
          return;
        }
        l.options.pane = paneName;
        l.options.paneSet = true;
        if (l instanceof L.Path) l.options.renderer = renderer ?? undefined;
        const pathEl = l instanceof L.Path ? (l.getElement() as HTMLElement) : null;
        if (pathEl && pathEl.parentNode !== container)
          groups.get(container)!.push(pathEl);
        if (l instanceof L.Marker && paneEl) {
          const marker = l as MarkerWithShadow;
          if (marker._shadow && marker._shadow.parentNode !== paneEl) {
            if (!markerGroups.has(paneEl)) markerGroups.set(paneEl, []);
            markerGroups.get(paneEl)!.push(marker._shadow);
          }
          const iconEl = l.getElement();
          if (iconEl && iconEl.parentNode !== paneEl) {
            if (!markerGroups.has(paneEl)) markerGroups.set(paneEl, []);
            markerGroups.get(paneEl)!.push(iconEl);
          }
        }
      };
      collect(layer);
    }
    for (const [container, paths] of groups) {
      if (!paths.length) continue;
      const frag = document.createDocumentFragment();
      for (const p of paths) frag.appendChild(p);
      container.appendChild(frag);
    }
    for (const [paneEl, markers] of markerGroups) {
      if (!markers.length) continue;
      const frag = document.createDocumentFragment();
      for (const m of markers) frag.appendChild(m);
      paneEl.appendChild(frag);
    }
  }

  /** Invalidate the child-pane discovery cache. */
  reset() {
    this.paneCache.clear();
  }

  /** Release all pane state. Called by LayerManager.destroy(). */
  destroy() {
    this.paneCache.clear();
    this.fallbackPaneMap.clear();
    this.labelPanes.clear();
  }
}

export { PaneManager };
