// core/PaneManager — physical pane hosting + z-index landing.
// Responsibility: "who orders" is LayerRegistry; "where content lands and
// carries the z-number" is PaneManager. No CONF dependency.
//
// Method layering (tests follow the boundary):
//   ── Pure computation (JS unit tests, no Leaflet) ──
//     isDefaultPane / discoverChildPanes / getLayerPanes
//   ── Leaflet DOM integration (browser tests) ──
//     ensurePane / ensureVector / bumpPanes / migrateLayers / reset / destroy
//     releaseFallbackPane
import * as CONST from "./const.js";
import { forEachLayer } from "./util.js";

/** Marker with protected Leaflet internals (shadow element). */
type MarkerWithShadow = L.Marker & { _shadow?: HTMLElement };

/** A Leaflet Path layer with the mutable option surface we set on. */
type PathWithPane = L.Path & { options: L.PathOptions & { pane?: string } };

/** Renderer storage on L.Map (keyed by CONST.RENDERER_KEY + pane name). */
interface PaneRendererMap {
  [key: string]: L.SVG | undefined;
}

class PaneManager {
  map: L.Map;
  defaultPanes: Set<string>;
  /**
   * Sub-panes registered by `createLayers({ panes: [...] })` — the child
   * `layerGroup`s that carry one sub-pane's worth of content. Used to decide
   * whether a discovered child pane is ours (bumpPanes, sweep) or a foreign
   * pane belonging to some other component (leave alone).
   *
   * Replaces the earlier `labelPanes` set: the concept was specific to one
   * consumer (MeasureControl's label pane). Generalizing to any child pane
   * keeps `bumpPanes` and `registerSubPanes` component-agnostic.
   */
  childPanes: Set<string>;
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
    this.childPanes = new Set();
    this.paneCache = new Map();
    this.fallbackPaneMap = new Map();
  }

  // ── Leaflet DOM integration ────────────────────────────────────

  /** Ensure a custom pane exists on the map.
   *  @param {string} paneName - Pane name.
   *  @param {boolean} [needRenderer=true] - Whether to create an SVG renderer. */
  ensurePane(
    paneName: string,
    needRenderer = true,
  ): { pane: HTMLElement; renderer: L.SVG | null } {
    let pane = this.map.getPane(paneName);
    if (!pane) {
      pane = this.map.createPane(paneName);
      pane.classList.add("foliplus-layer-pane");
      pane.style.zIndex = String(CONST.Z_INDEX.BASE);
    } else {
      // `bumpPanes` only assigns a child pane its `+k` offset during
      // LayerControl's `enforceOrder`, which fires on registration and
      // layer-change events — not when a layer first lands in a sub-pane
      // after init (MeasureControl's preview labels arrive on mousemove).
      // Two panes left at the same z-index fall back to DOM insertion
      // order, so the sub-pane would only outrank the base pane by luck of
      // construction. Pin it here, keyed to the same registration the base
      // pane came from, so sub-pane ordering is a contract rather than an
      // accident of div append order.
      const k = Array.from(this.childPanes).indexOf(paneName);
      if (k > 0)
        pane.style.zIndex = String(CONST.Z_INDEX.BASE + k * CONST.CHILD_PANE_STEP);
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

  /** Reclaim the fallback pane that `unregisterLayer` just released.
   *  Must run after the layer is off the map, so nothing still renders into
   *  the pane. The caller supplies the stamp, since `fallbackPaneMap` is
   *  keyed by stamp and the layer is already gone from the registry.
   *  Clears the two renderer registries plus the pane record. */
  releaseFallbackPane(stamp: number | null) {
    if (stamp == null) return;
    const paneName = this.fallbackPaneMap.get(stamp);
    if (!paneName) return;
    const key = CONST.RENDERER_KEY + paneName;
    const renderer = (this.map as L.Map & PaneRendererMap)[key];
    if (renderer) {
      // map.removeLayer unbinds the renderer's map event listeners (zoom,
      // moveend, viewreset, …) — that listener set is what grew per
      // add/remove cycle; the DOM teardown below is the cheap half.
      // Renderer.onRemove detaches the SVG root.
      if (this.map.hasLayer(renderer)) this.map.removeLayer(renderer);
      delete (this.map as L.Map & PaneRendererMap)[key];
    }
    // Leaflet's own per-pane registry is separate: getRenderer() fills it
    // lazily, so it can exist without our key. Clearing it keeps getRenderer()
    // from re-adding a dead renderer to the removed pane.
    delete this.map._paneRenderers[paneName];
    this.map.getPane(paneName)?.remove();
    // getPane() must not keep returning a detached node.
    delete this.map._panes[paneName];
    this.fallbackPaneMap.delete(stamp);
  }

  /** Clear all pane state. Called by LayerManager.destroy().
   *  The DOM is left alone: LayerManager.destroy() clears the registry without
   *  removing the registered layers from the map, so they are still live —
   *  deleting their panes would drop them off the map. */
  destroy() {
    this.paneCache.clear();
    this.fallbackPaneMap.clear();
    this.childPanes.clear();
  }

  /**
   * Bump every child pane of a layer so it paints above the base pane. Each
   * child pane gets `base + k * CHILD_PANE_STEP`, where `k` is the position
   * of the pane name in the registry entry's `subPanes` array.
   *
   * Generalizes the earlier `bumpLabelPanes`: that method only knew about
   * label panes (hard-coded `+1` offset) because MeasureControl was the only
   * consumer. With N registered sub-panes per layer, we bump each by its
   * index into the same ordered list `registerSubPanes` was called with,
   * so the number of sub-panes is unbounded.
   *
   * @param layer - The container layer whose subtree's child panes to bump.
   * @param z - Base z-index for the layer's root pane.
   * @param subPanes - The ordered pane names registered for this layer's
   *   `createLayers` call. Only names in this list that also appear as child
   *   panes of `layer` get bumped, and in this list's order.
   */
  bumpPanes(layer: L.Layer, z: number, subPanes: string[]): void {
    const found = this.discoverChildPanes(layer);
    found.forEach(cp => {
      if (!this.childPanes.has(cp)) return;
      const k = subPanes.indexOf(cp);
      if (k < 0) return;
      const lp = this.ensurePane(cp, false);
      if (lp.pane) lp.pane.style.zIndex = String(z + k * CONST.CHILD_PANE_STEP);
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
      if (!container) {
        // No renderer container (e.g. tile layers with a paneName get
        // needRenderer=false). DOM migration is impossible, but the layer must
        // still be marked handled — otherwise applyLayerZIndex re-queues it on
        // every enforceOrder pass (options.pane never matches paneName).
        layer.options.pane = paneName;
        layer.options.paneSet = true;
        continue;
      }
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
        if (pathEl && pathEl.parentNode !== container) {
          groups.get(container)!.push(pathEl);
        }
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

  /** Invalidate the child-pane discovery cache.
   *  @param {number} [id] - Layer stamp to invalidate (single entry).
   *    Omit to clear the whole cache (structure-wide change). */
  reset(id?: number) {
    if (id != null) {
      this.paneCache.delete(id);
      return;
    }
    this.paneCache.clear();
  }

  /** Drop child-pane entries no longer referenced by any registered layer.
   *  Only the bookkeeping is dropped — the pane div is left in place. Unlike a
   *  fallback pane it is not keyed to a single layer: its name is user-defined
   *  and can be reused, and its renderer is still live, its SVG container being
   *  a child of the pane div. Removing the div would orphan that container, and
   *  re-creating the pane would not re-parent it.
   *
   * `subPanes` is the ordered list from `registerSubPanes`; `bumpPanes` uses
   * the same index to pick the offset, so passing the entry's `subPanes`
   * array here keeps the two APIs in lockstep. */
  sweepChildPanes(layers: ReadonlyArray<{ subPanes?: string[] }>) {
    const used = new Set<string>();
    for (const li of layers) for (const pane of li.subPanes ?? []) used.add(pane);
    for (const pane of this.childPanes)
      if (!used.has(pane)) this.childPanes.delete(pane);
  }

  /**
   * Register the sub-panes `createLayers({ panes: [...] })` declared for this
   * map. Every subsequent `bumpPanes` / `sweepChildPanes` knows these are
   * ours and won't touch any foreign pane a third-party component may have
   * put on the map under its own name.
   */
  registerSubPanes(names: string[]): void {
    for (const n of names) this.childPanes.add(n);
  }

  /**
   * Pin a layer to a pane's renderer. Both `options.renderer` and
   * `options.pane` are set on the layer, so a later `setPane()` call cannot
   * move it back to the default renderer.
   *
   * Why both: Leaflet's `Path._update` re-creates the `<path>` element from
   * the layer's options and appends it to the renderer's root group. If the
   * renderer's parent pane doesn't match `options.pane`, the element lands in
   * the wrong pane even though the SVG group is correct. Setting both keeps
   * the DOM and the options consistent through repeated attach / re-attach
   * cycles (which `LayerFactory.addLayer` triggers through
   * `mainLayer.addLayer`).
   *
   * @param layer - The Path to pin.
   * @param paneName - The pane this layer's renderer should live in.
   * @returns The renderer that was pinned.
   */
  ensureVector(layer: PathWithPane, paneName: string): L.Renderer {
    const key = CONST.RENDERER_KEY + paneName;
    const cached = ((this.map as L.Map & PaneRendererMap)[key] ??
      null) as L.Renderer | null;
    const target = cached || this.ensurePane(paneName, true).renderer!;
    layer.options.renderer = target;
    layer.options.pane = paneName;
    return target;
  }

  // ── Pure computation (JS unit-testable, no Leaflet) ────────────

  /** Find all custom panes used by a container's tree. */
  discoverChildPanes(layer: L.Layer, depth = 0): string[] {
    if (depth > CONST.RECURSION.PANE_DEPTH) return [];
    const key = L.stamp(layer);
    if (this.paneCache.has(key)) return this.paneCache.get(key) as string[];
    const panes = new Set<string>();
    forEachLayer(
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
}

export { PaneManager };
