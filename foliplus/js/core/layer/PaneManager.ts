// core/PaneManager — physical pane hosting.
// Responsibility: "who orders and who owns which pane" is LayerSurface /
// LayerRegistry; "make the pane div exist and hand back its renderer" is
// PaneManager. No CONF dependency.
//
// Method layering (tests follow the boundary):
//   ── Pure computation (JS unit tests, no Leaflet) ──
//     isDefaultPane / discoverChildPanes / getLayerPanes
//   ── Leaflet DOM integration (browser tests) ──
//     ensurePane / ensureVector / pinTree / pinLateContent / removePane /
//     reset / destroy
import { createLogger } from "#common/log.js";
import {
  destroyPane,
  getRendererContainer,
  getRendererFor,
  markerShadow,
} from "../leafletAdapter.js";
import * as CONST from "./const.js";
import type { PaneRole, PaneSpec } from "./type.js";
import { forEachLayer } from "./util.js";
import { zFor } from "./z.js";

const log = createLogger("PaneManager");

/** The four legal `PaneSpec.role` values — anything else gets dropped at
 *  `registerPaneSpecs` rather than flowing into z arithmetic (where an
 *  unknown value silently prices like "base" and desynchronises a stack).
 *  `as const satisfies` catches a new `PaneRole` value that was added to
 *  the union type but not to this runtime mirror. */
const PANE_ROLES = [
  "base",
  "sub",
  "annotation",
  "preview",
] as const satisfies readonly PaneRole[];

/** A Leaflet Path layer with the mutable option surface we set on. */
type PathWithPane = L.Path & { options: L.PathOptions & { pane?: string } };

/** Anything we may be asked to pin into a pane: a leaf, or a container that
 *  enumerates its children. */
type PinnableNode = L.Layer & {
  options: L.LayerOptions & { renderer?: L.Renderer; pane?: string; paneSet?: boolean };
  eachLayer?: (fn: (layer: L.Layer) => void) => void;
};

/** One bookkeeping scope: panes and their specs live per map, so a manager
 *  built for one map never sees another map's names.
 *
 *  Two invalidators, one policy — never a third:
 *    - precise: `pinTree` deletes the entry for the one node it just repinned.
 *      It has the node in hand, so the delete is exact and costs one hash.
 *    - structure-wide: `reset` clears the whole cache. It is the fallback for a
 *      caller that only holds a stamp (or nothing), and over-invalidation is
 *      always safe here — a stale entry costs one extra `forEachLayer` walk,
 *      never a wrong answer.
 *
 *  `removePane` deliberately touches neither: destroying a pane div does not
 *  change what any layer's `options.pane` names, which is the only thing the
 *  cache memoises. */
class PaneManager {
  /** Read-only, and there is no accessor: no caller outside this class needs
   *  the map handle. */
  readonly #map: L.Map;
  /** Leaflet's own panes, plus the auto-generated fallback family
   *  (`FALLBACK_PANE_PREFIX`). Kept public on purpose: `LayerControl/ui/focus`
   *  tests membership to skip the panes it must not touch. */
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
  readonly #childPaneSpecs = new Map<string, PaneSpec>();
  /** Discovery results keyed by `L.stamp`, capped by
   *  `CACHE.PANE_DISCOVERY_ENTRIES`: stamps are never reused, so layer churn
   *  would otherwise accumulate until teardown. */
  #paneCache = new Map<number, string[]>();

  constructor(map: L.Map) {
    this.#map = map;
    this.defaultPanes = new Set([
      "overlayPane",
      "markerPane",
      "tilePane",
      "shadowPane",
      "mapPane",
    ]);
  }

  /** The specs above, read-only. Specs are registered by `registerPaneSpecs`
   *  and dropped by `sweepChildPanes` / `removePane`; a caller has no way to
   *  put one in or take one out, which is what keeps this map the single
   *  source of truth for "is this pane ours". */
  get childPaneSpecs(): ReadonlyMap<string, PaneSpec> {
    return this.#childPaneSpecs;
  }

  /** The discovery cache, read-only, for assertions on what was memoised. */
  get paneCache(): ReadonlyMap<number, string[]> {
    return this.#paneCache;
  }

  /** The names above as a set — membership is what the caller usually wants. */
  get childPanes(): ReadonlySet<string> {
    return new Set(this.#childPaneSpecs.keys());
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
    let pane = this.#map.getPane(paneName);
    if (!pane) {
      pane = this.#map.createPane(paneName);
      pane.classList.add("foliplus-layer-pane");
      // Provisional z so panes of one layer already draw in the right relative
      // order before the ordering pass assigns their position-based base
      // (which may never come if LayerControl is absent).
      const spec = this.#childPaneSpecs.get(paneName);
      if (spec) {
        pane.style.zIndex = String(zFor({ role: spec.role, order: spec.order }));
      }
    }
    return {
      pane,
      renderer: needRenderer ? getRendererFor(this.#map, paneName) : null,
    };
  }

  /** Remove a pane this tree owns from the DOM and Leaflet's registries.
   *  Used by LayerSurface.destroy (the layer's synthesized pane) and by
   *  createCanvas.destroy (its dedicated pane).
   *
   *  No cache invalidation here: the cache memoises what each layer's
   *  `options.pane` names, and destroying a pane div changes no layer's
   *  options. Clearing on every teardown used to be the one place this policy
   *  over-invalidated structure-wide for a single pane. */
  removePane(paneName: string) {
    destroyPane(this.#map, paneName);
    this.#childPaneSpecs.delete(paneName);
  }

  /** Clear all pane state. Called by LayerManager.destroy().
   *  The DOM is left alone: LayerManager.destroy() clears the registry without
   *  removing the registered layers from the map, so they are still live —
   *  deleting their panes would drop them off the map. */
  destroy() {
    this.#paneCache.clear();
    this.#childPaneSpecs.clear();
  }

  /**
   * Move layer DOM content into target panes, batched via DocumentFragment.
   *
   * This is the one relocation primitive a `LayerSurface` reconciles with — it
   * is only ever assembled on demand (the surface is dirty), never queued
   * permanently. Idempotent: a node already where it belongs is left alone, so
   * the steady-state ordering pass never builds it.
   *
   * The write contract on a third-party node's `options` is the one declared on
   * `LabelAwareLayer`: `pane`, `renderer` (a Path only), and `paneSet` — the
   * last being foliplus's own marker, not a Leaflet key.
   */
  pinLateContent(
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
      const paneEl = this.#map.getPane(paneName);
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

  /** Invalidate the child-pane discovery cache — structure-wide, either way.
   *  @param {number} [_id] - Retained for the stamp-only callers. It is ignored:
   *    a repinned subtree can invalidate entries for layers the caller holds no
   *    reference to, so single-key invalidation is the one that can leave a
   *    wrong answer in the cache. Over-invalidating is always safe here — a
   *    stale entry costs one extra `forEachLayer` walk, never a wrong result.
   *    `pinTree` keeps the precise per-node delete, because it has the node in
   *    hand. */
  reset(_id?: number): void {
    this.#paneCache.clear();
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
    for (const name of this.#childPaneSpecs.keys()) {
      if (!used.has(name)) this.#childPaneSpecs.delete(name);
    }
  }

  /**
   * Register the panes a `createLayers({ panes })` call declared for this map.
   * Every subsequent `ensurePane` / `sweepChildPanes` knows these are ours and
   * won't touch any foreign pane a third-party component may have put on the
   * map under its own name.
   *
   * Injection gate: `PaneSpec.name` lands on the DOM as a pane element id
   * and CSS class (Leaflet's `createPane` does both), so a third party
   * passing a name outside `PANE_NAME_PATTERN` would plant an id collision,
   * a compound-selector escape, or a script tag into the map container.
   * Same story for `role` — anything outside the enum would silently price
   * as "base" in z arithmetic and desynchronise the stack. Bad specs are
   * skipped (with a warn) rather than throwing, matching the project's
   * "don't take the whole layer tree down over a typo" convention.
   */
  registerPaneSpecs(specs: readonly PaneSpec[]): void {
    for (const spec of specs) {
      if (typeof spec.name !== "string" || !CONST.PANE_NAME_PATTERN.test(spec.name)) {
        log.warn(`PaneSpec.name rejected for injection safety: ${String(spec.name)}`);
        continue;
      }
      if (!PANE_ROLES.includes(spec.role)) {
        log.warn(
          `PaneSpec.role rejected (unknown value "${String(spec.role)}"); ` +
            `keeping the spec but falling back to "base"`,
        );
        this.#childPaneSpecs.set(spec.name, {
          ...spec,
          role: "base" as const,
        });
        continue;
      }
      this.#childPaneSpecs.set(spec.name, spec);
    }
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
    const target = getRendererFor(this.#map, paneName);
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
   * The write contract is the one declared on `LabelAwareLayer`: `pane`,
   * `renderer` (a Path only), and `paneSet`. `paneSet` is foliplus's own
   * "we decided this layer's pane" marker rather than a legacy flag —
   * `LayerFactory.addLayer` reads it back to tell a caller-declared pane apart
   * from one foliplus routed the layer into. Nothing else on a third-party
   * layer's `options` is written here.
   *
   * `paneName` always names a **declared** pane that already exists, by two
   * independent guarantees:
   *   - existence — the pane is built before anything can be routed into it.
   *     `LayerFactory.addLayer` calls `register()` before it pins (and only
   *     when the group is not on the map yet, so every later call already has
   *     the surface); `register()` reaches `LayerManager.registerLayer` →
   *     `surfaceFor` → `new LayerSurface(...)`, whose constructor runs
   *     `addPane` → `PaneManager.ensurePane` and creates the DOM pane.
   *   - name — `LayerFactory.addLayer` gates on
   *     `paneNames.includes(requested)`, so a name outside `opts.panes` never
   *     reaches this method at all. Both sides of that gate are pinned by
   *     `LayerFactory.test.ts` ("addLayer with an unknown paneName …" and
   *     "mainLayer.addLayer falls through to origAddLayer …").
   */
  pinTree(node: L.Layer, paneName: string): void {
    const walk = (n: PinnableNode): void => {
      n.options.pane = paneName;
      n.options.paneSet = true;
      // Every node we touch invalidates its own discovery entry, so a later
      // `discoverChildPanes` sees the pin rather than the pre-pin name. Precise
      // here rather than structure-wide: the walk already pays for each node,
      // so there is nothing to gain from discarding entries we did not touch.
      this.#paneCache.delete(L.stamp(n));
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

  /** Find all custom panes used by a container's tree.
   *  Memoised per layer stamp and capped by `CACHE.PANE_DISCOVERY_ENTRIES`
   *  (`reset` is the only way to invalidate what is already cached, and it does
   *  so structure-wide). */
  discoverChildPanes(layer: L.Layer, depth = 0): string[] {
    if (depth > CONST.RECURSION.PANE_DEPTH) return [];
    const key = L.stamp(layer);
    const hit = this.#paneCache.get(key);
    if (hit !== undefined) return hit;
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
    // Map insertion order is FIFO here, so the first key is the oldest. Dropping
    // it costs one extra `forEachLayer` walk the next time that layer is asked
    // about — never a wrong answer.
    if (this.#paneCache.size >= CONST.CACHE.PANE_DISCOVERY_ENTRIES) {
      const oldest = this.#paneCache.keys().next().value;
      if (oldest !== undefined) this.#paneCache.delete(oldest);
    }
    this.#paneCache.set(key, result);
    return result;
  }

  isDefaultPane(pane: string): boolean {
    return this.defaultPanes.has(pane) || pane.startsWith(CONST.FALLBACK_PANE_PREFIX);
  }

  /** Find the panes a layer's content names in its own tree — the panes this
   *  tree can prove the layer paints into. Never guesses: a layer whose tree
   *  names no custom pane answers `[]`, not Leaflet's shared `overlayPane` /
   *  `markerPane`.
   *
   *  The old fallback returned those two shared panes "conservatively", which
   *  made the answer indistinguishable from "the layer really paints there".
   *  A Marker names `markerPane`; a GridLayer names `tilePane`. Handing either
   *  to a caller that reads the list as "this layer's panes" means the caller
   *  now owns every other layer's pixels too — focus would lift every marker
   *  on the map, and an exporter would render every tile. The honest answer
   *  is "none that are ours". A caller that needs infrastructure panes (tiles
   *  for export) reaches for them by name, not through this list.
   *
   *  The synthesized pane a LayerSurface gave the layer is resolved from the
   *  surface, not from here. Default panes are already excluded by
   *  `discoverChildPanes` (`isDefaultPane`), so the returned list can never
   *  contain one. */
  getLayerPanes(layer: L.Layer): string[] {
    return this.discoverChildPanes(layer);
  }
}

export { PaneManager };
