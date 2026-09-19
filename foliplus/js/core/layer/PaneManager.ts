// core/PaneManager — physical pane hosting.
// Responsibility: "who orders and who owns which pane" is LayerSurface /
// LayerRegistry; "make the pane div exist and hand back its renderer" is
// PaneManager. No CONF dependency.
//
// Method layering (tests follow the boundary):
//   ── Pure computation (JS unit tests, no Leaflet) ──
//     isDefaultPane / discoverChildPanes / getLayerPanes
//   ── Leaflet DOM integration (browser tests) ──
//     ensurePane / ensureVector / pinTree / removePane / reset / destroy
import {
  destroyPane,
  getRendererContainer,
  getRendererFor,
  markerShadow,
} from "../leafletAdapter.js";
import * as CONST from "./const.js";
import type { PaneSpec } from "./type.js";
import { forEachLayer } from "./util.js";

/** A Leaflet Path layer with the mutable option surface we set on. */
type PathWithPane = L.Path & { options: L.PathOptions & { pane?: string } };

/** Anything we may be asked to pin into a pane: a leaf, or a container that
 *  enumerates its children. */
type PinnableNode = L.Layer & {
  options: L.LayerOptions & { renderer?: L.Renderer; pane?: string; paneSet?: boolean };
  eachLayer?: (fn: (layer: L.Layer) => void) => void;
};

class PaneManager {
  map: L.Map;
  defaultPanes: Set<string>;
  /**
   * The panes a `createLayers({ panes })` call declared on this map, by name.
   * The spec answers two questions: whether a discovered child pane is ours
   * (versus a foreign one another component put on the map under its own name,
   * which we leave alone), and where it draws relative to its layer's base z.
   *
   * Replaces the earlier `labelPanes` set — that concept was specific to one
   * consumer (MeasureControl's label pane) — and the name-only `childPanes`
   * set, which could not carry the draw offset.
   */
  childPaneSpecs: Map<string, PaneSpec>;
  paneCache: Map<number, string[]>;

  constructor(map: L.Map) {
    this.map = map;
    this.defaultPanes = new Set([
      "overlayPane",
      "markerPane",
      "tilePane",
      "shadowPane",
      "mapPane",
    ]);
    this.childPaneSpecs = new Map();
    this.paneCache = new Map();
  }

  /** The names above as a set — membership is what the caller usually wants. */
  get childPanes(): ReadonlySet<string> {
    return new Set(this.childPaneSpecs.keys());
  }

  // ── Leaflet DOM integration ────────────────────────────────────

  /** Ensure a custom pane exists on the map.
   *  @param {string} paneName - Pane name.
   *  @param {boolean} [needRenderer=true] - Whether to build an SVG renderer
   *    for it. False for canvas panes and for sub-panes, whose renderer the
   *    content that routes into them creates (`ensureVector`). */
  ensurePane(
    paneName: string,
    needRenderer = true,
  ): { pane: HTMLElement; renderer: L.SVG | null } {
    let pane = this.map.getPane(paneName);
    if (!pane) {
      pane = this.map.createPane(paneName);
      pane.classList.add("foliplus-layer-pane");
      // Provisional z so panes of one layer already draw in the right relative
      // order before the ordering pass assigns their position-based base
      // (which may never come if LayerControl is absent).
      const spec = this.childPaneSpecs.get(paneName);
      if (spec) pane.style.zIndex = String(CONST.Z_INDEX.BASE + spec.order);
    }
    return { pane, renderer: needRenderer ? getRendererFor(this.map, paneName) : null };
  }

  /** Remove a pane this tree owns from the DOM and Leaflet's registries.
   *  Used by LayerSurface.destroy (the layer's synthesized pane) and by
   *  createCanvas.destroy (its dedicated pane). */
  removePane(paneName: string) {
    destroyPane(this.map, paneName);
    this.childPaneSpecs.delete(paneName);
    this.paneCache.clear();
  }

  /** Clear all pane state. Called by LayerManager.destroy().
   *  The DOM is left alone: LayerManager.destroy() clears the registry without
   *  removing the registered layers from the map, so they are still live —
   *  deleting their panes would drop them off the map. */
  destroy() {
    this.paneCache.clear();
    this.childPaneSpecs.clear();
  }

  /**
   * Move layer DOM content into target panes, batched via DocumentFragment.
   *
   * This is the one relocation primitive a `LayerSurface` reconciles with — it
   * is only ever assembled on demand (the surface is dirty), never queued
   * permanently. Idempotent: a node already where it belongs is left alone, so
   * the steady-state ordering pass never builds it.
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
      const container = getRendererContainer(renderer);
      if (!container) {
        // No renderer container (e.g. tile layers with a paneName get
        // needRenderer=false). DOM migration is impossible, but the layer must
        // still be marked handled — otherwise a dirty surface would re-queue it
        // on every reconcile.
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
          const shadow = markerShadow(l);
          if (shadow && shadow.parentNode !== paneEl) {
            if (!markerGroups.has(paneEl)) markerGroups.set(paneEl, []);
            markerGroups.get(paneEl)!.push(shadow);
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
   *  re-creating the pane would not re-parent it. */
  sweepChildPanes(layers: ReadonlyArray<{ paneSpecs?: readonly PaneSpec[] }>) {
    const used = new Set<string>();
    for (const li of layers) {
      for (const spec of li.paneSpecs ?? []) {
        used.add(spec.name);
      }
    }
    for (const name of this.childPaneSpecs.keys()) {
      if (!used.has(name)) this.childPaneSpecs.delete(name);
    }
  }

  /**
   * Register the panes a `createLayers({ panes })` call declared for this map.
   * Every subsequent `ensurePane` / `sweepChildPanes` knows these are ours and
   * won't touch any foreign pane a third-party component may have put on the
   * map under its own name.
   */
  registerPaneSpecs(specs: readonly PaneSpec[]): void {
    for (const spec of specs) this.childPaneSpecs.set(spec.name, spec);
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
   * @returns The renderer that was pinned, or null when none could be built.
   */
  ensureVector(layer: PathWithPane, paneName: string): L.Renderer | null {
    const target = getRendererFor(this.map, paneName);
    layer.options.renderer = target ?? undefined;
    layer.options.pane = paneName;
    return target;
  }

  /** Pin a node and its whole subtree to one pane.
   *
   * `options.pane` is read only at the moment a layer joins the map, and
   * Leaflet ignores a group's pane for its children — each child is added on
   * its own, with its own options. So a container handed in here has to carry
   * the pane down to every leaf itself, or those leaves render into the map's
   * default renderer and never land in the declared pane. The renderer is
   * written too: without it a later re-attach recreates the `<path>` in the
   * default SVG.
   *
   * `paneName` always names a **declared** pane, so the pane already exists by
   * the time this runs. `LayerFactory.addLayer` is the only caller and it
   * gates on `paneNames.includes(requested)`: a name outside `opts.panes`
   * never reaches here — the leaf falls through to `origAddLayer` and lands in
   * the base pane, with no pin. Both sides of that gate are pinned by
   * `LayerFactory.test.ts` ("addLayer with an unknown paneName …" and
   * "mainLayer.addLayer falls through to origAddLayer …").
   */
  pinTree(node: L.Layer, paneName: string): void {
    const walk = (n: PinnableNode): void => {
      n.options.pane = paneName;
      n.options.paneSet = true;
      // Every node we touch invalidates its own discovery entry, so a later
      // `discoverChildPanes` sees the pin rather than the pre-pin name.
      this.reset(L.stamp(n));
      if (!n.eachLayer) {
        // A Path needs its renderer pinned; every other leaf just carries the
        // pane name written above.
        if (n instanceof L.Path) this.ensureVector(n as PathWithPane, paneName);
        return;
      }
      n.eachLayer(c => walk(c as PinnableNode));
    };
    walk(node as PinnableNode);
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

  /** Find all panes a layer's content lives in, including the synthesized pane
   *  a LayerSurface gave it (which the caller resolves — this only knows the
   *  panes the layer's own tree names). */
  getLayerPanes(layer: L.Layer): string[] {
    const panes = this.discoverChildPanes(layer);
    if (panes.length > 0) return panes;
    return ["overlayPane", "markerPane"];
  }
}

export { PaneManager };
