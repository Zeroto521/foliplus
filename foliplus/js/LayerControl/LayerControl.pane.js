import { createTranslator } from "#common/locale.js";
import * as CONST from "./LayerControl.const.js";
import * as Util from "./LayerControl.util.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const _ = createTranslator(CONF);

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
  constructor(map) {
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
  ensurePane(paneName, needRenderer = true) {
    let pane = this.map.getPane(paneName);
    if (!pane) {
      pane = this.map.createPane(paneName);
      pane.classList.add("foliplus-layer-pane");
      pane.style.zIndex = String(CONST.Z_INDEX.BASE);
    }
    let renderer = null;
    if (needRenderer) {
      const key = CONST.RENDERER_KEY + paneName;
      renderer = this.map[key];
      if (!renderer) {
        renderer = L.svg({ pane: paneName });
        renderer.addTo(this.map);
        this.map[key] = renderer;
      }
    }
    return { pane, renderer };
  }

  /** Find all custom panes used by a container's tree. */
  discoverChildPanes(layer, depth = 0) {
    if (depth > CONST.RECURSION.PANE_DEPTH) return [];
    const key = L.stamp(layer);
    if (this.paneCache.has(key)) return this.paneCache.get(key);
    const panes = new Set();
    Util.forEachLayer(
      layer,
      l => {
        const p = l.options?.pane;
        if (p && !this.isDefaultPane(p)) panes.add(p);
      },
      depth,
    );
    const result = Array.from(panes);
    this.paneCache.set(key, result);
    return result;
  }

  isDefaultPane(pane) {
    return this.defaultPanes.has(pane) || pane.startsWith(CONST.FALLBACK_PANE_PREFIX);
  }

  /** Find all panes a layer's content lives in, including fallback panes. */
  getLayerPanes(layer) {
    const panes = this.discoverChildPanes(layer);
    if (panes.length > 0) return panes;
    const fbName = this.fallbackPaneMap.get(L.stamp(layer));
    if (fbName) return [fbName];
    return ["overlayPane", "markerPane"];
  }

  /** Bump label panes for a layer so labels render above paths. */
  bumpLabelPanes(layer, z) {
    const childPanes = this.discoverChildPanes(layer);
    childPanes.forEach(cp => {
      if (this.labelPanes.has(cp)) {
        const lp = this.ensurePane(cp, false);
        lp.pane.style.zIndex = z + 1;
      }
    });
  }

  /**
   * Move layer DOM content into target panes, batched via DocumentFragment.
   */
  migrateLayers(layersToMove) {
    if (!layersToMove.length) return;
    const groups = new Map();
    const markerGroups = new Map();
    for (const { layer, paneName, renderer } of layersToMove) {
      if (!paneName) continue;
      const container = renderer?._container;
      if (!container) continue;
      const paneEl = this.map.getPane(paneName);
      if (!groups.has(container)) groups.set(container, []);
      const collect = l => {
        if (l.eachLayer) {
          l.eachLayer(collect);
          return;
        }
        l.options.pane = paneName;
        l.options.paneSet = true;
        if (l instanceof L.Path) l.options.renderer = renderer;
        if (l._path && l._path.parentNode !== container)
          groups.get(container).push(l._path);
        if (l instanceof L.Marker && paneEl) {
          if (l._shadow && l._shadow.parentNode !== paneEl) {
            if (!markerGroups.has(paneEl)) markerGroups.set(paneEl, []);
            markerGroups.get(paneEl).push(l._shadow);
          }
          if (l._icon && l._icon.parentNode !== paneEl) {
            if (!markerGroups.has(paneEl)) markerGroups.set(paneEl, []);
            markerGroups.get(paneEl).push(l._icon);
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
