// core/PaneManager — physical pane hosting.
// Responsibility: "who orders and who owns which pane" is LayerSurface /
// LayerInfoRegistry; "make the pane div exist and hand back its renderer" is
// PaneManager. No CONFIG dependency.
//
// Method layering (tests follow the boundary):
//   ── Pure computation (JS unit tests, no Leaflet) ──
//     isDefaultPane / discoverChildPanes / getLayerPanes
//   ── Leaflet DOM integration (browser tests) ──
//     ensurePane / ensureVector / pinTree / pinLateContent / removePane /
//     invalidateDiscoveryCache / destroy
import { createLogger } from "#common/log.js";
import {
  destroyPane,
  getRendererContainer,
  getRendererFor,
  layerShadow,
} from "../leafletAdapter.js";
import * as CONST from "./const.js";
import type { PaneSpec, PinnableNode } from "./type.js";
import { isContainerNode, walkLeaf, walkTree } from "./walkLeaf.js";
import { zFor } from "./z.js";

const log = createLogger("PaneManager");

/** A Leaflet Path layer with the mutable option surface we set on. */
type PathWithPane = L.Path & { options: L.PathOptions & { pane?: string } };

/** One bookkeeping scope: panes and their specs live per map, so a manager
 *  built for one map never sees another map's names.
 *
 *  One invalidation primitive — a generation counter:
 *    Every state-changing call (`pinTree` / `invalidateDiscoveryCache` / `destroy`) bumps
 *    `generation` by one, which makes every previously memoised entry stale
 *    until it is rewalked. There is no per-node precise delete anywhere: the
 *    walk already pays for each node it touches, so the entries we would have
 *    kept cost nothing to drop, and the entries we did not touch are the ones
 *    a single-key policy would have kept wrong. Over-invalidation is always
 *    safe here — a stale entry costs one extra `walkTree` walk, never a
 *    wrong answer.
 *
 *  `removePane` deliberately touches neither: destroying a pane div does not
 *  change what any layer's `options.pane` names, which is the only thing the
 *  cache memoises.
 *
 *  Index lifecycle — every bookkeeping index, with where it is written, where
 *  it is deleted, and what bounds it. A missing delete point is a defect, not
 *  a policy: `L.stamp` values are never reused, so an index that only ever
 *  grows still describes retired layers when `destroy` finally runs.
 *
 *    `paneSpecs`      written by `registerPaneSpecs`; deleted by
 *                     `destroyOwnPane` (a pane foliplus created),
 *                     `sweepChildPanes` (a spec no registered layer uses) and
 *                     `destroy`. Bounded by the panes this map declared.
 *    `paneLeases`     written by `ensurePane`; deleted by `releasePane`,
 *                     `removePane` and `destroy`. Bounded by live surfaces'
 *                     bookings — a surface that never retires its panes leaves
 *                     a row here until `destroy`.
 *    `discoveryCache` written by `discoverChildPanes`; generation-gated on
 *                     read, capped at `CACHE.PANE_DISCOVERY_ENTRIES`, cleared
 *                     by `destroy`. Bounded by the cap, not by layer count.
 *    `childOwners`    written by `rememberChildOwnership` (the `addLayer`
 *                     override); deleted by `forgetChildOwnership`
 *                     (`removeLayer`), `forgetAllChildOwnership`
 *                     (`clearLayers`) and `destroy`. Bounded by the leaves
 *                     currently inside a declared-pane group.
 *
 *  TypeScript `private`, never an ES `#` field. Component bundles are inlined
 *  into a Jinja2 `Template` at render time (`BaseControl`
 *  `_build_component_template`), and minification drops the space in
 *  `class X { #f`, leaving `class e{#f` — the `{#` is Jinja2's comment start,
 *  so the render aborts with "Missing end of comment tag". This file only ever
 *  lands in the shared runtime bundle, which is built as a plain string, so the
 *  rule is convention rather than local necessity; keeping the whole codebase
 *  Jinja-inert means nobody has to know which bundle a module ends up in. */
class PaneManager {
  /** Read-only, and there is no accessor: no caller outside this class needs
   *  the map handle. */
  private readonly map: L.Map;
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
  private readonly paneSpecs = new Map<string, PaneSpec>();
  /** The generation at which entries in `discoveryCache` were computed. Bumped
   *  by `pinTree` / `invalidateDiscoveryCache` / `destroy`; an entry whose `gen` is behind this
   *  value is stale and is recomputed on its next read. */
  private generation = 0;
  /** Discovery results keyed by `L.stamp`, capped by
   *  `CACHE.PANE_DISCOVERY_ENTRIES`: stamps are never reused, so layer churn
   *  would otherwise accumulate until teardown. Each entry carries the
   *  generation it was written at, so a stale entry is dropped rather than
   *  served. */
  private readonly discoveryCache = new Map<number, { gen: number; panes: string[] }>();

  constructor(map: L.Map) {
    this.map = map;
    this.defaultPanes = new Set([
      "overlayPane",
      "markerPane",
      "tilePane",
      "shadowPane",
      "mapPane",
      "tooltipPane",
      "popupPane",
    ]);
  }

  /** The specs above, read-only. Specs are registered by `registerPaneSpecs`
   *  and dropped by `sweepChildPanes` / `removePane`; a caller has no way to
   *  put one in or take one out, which is what keeps this map the single
   *  source of truth for "is this pane ours". */
  get childPaneSpecs(): ReadonlyMap<string, PaneSpec> {
    return this.paneSpecs;
  }

  // ── Leaflet DOM integration ────────────────────────────────────

  /** Child-leaf stamps -> their owning registered group's stamp. Maintained
   *  at the write points (`LayerFactory`'s `mainLayer.addLayer` override):
   *  the next leaf of the same group attributes in O(1) instead of an
   *  O(registry) membership scan.
   *
   *  Bounded by the leaves currently in a group, not by every leaf it has
   *  ever held: the delete points are `forgetChildOwnership` (from
   *  `removeLayer`) and `forgetAllChildOwnership` (from `clearLayers`).
   *  Without them a 500-add / 500-remove session ended with all 500 entries
   *  still here, and a leaf re-added later would report the parent it once
   *  belonged to.
   *
   *  A leaf added through the override's fallback branch (a group with no
   *  declared panes) is never recorded; `childOwnerOf` answers `undefined`
   *  for it and the caller falls back to the registry scan, which is the
   *  same answer it already gets for any unrecorded child. */
  private readonly childOwners = new Map<number, number>();

  /** Record that `child` belongs to `parent` (both stamps). Callers that own
   *  the parent's tree — `createLayers`' `addLayer` — maintain this at the
   *  write point. */
  rememberChildOwnership(child: L.Layer, parent: L.Layer): void {
    this.childOwners.set(L.stamp(child), L.stamp(parent));
  }

  /** Forget that `child` belongs to its recorded parent — the `removeLayer`
   *  delete point. Deleting here instead of at teardown is what keeps the
   *  index bounded: a group that turns over its contents must not accumulate
   *  one row per leaf it has ever held. */
  forgetChildOwnership(child: L.Layer): void {
    this.childOwners.delete(L.stamp(child));
  }

  /** Forget every child recorded for `parent` — the `clearLayers` delete
   *  point, where the leaves leave in bulk and none of them passes through
   *  `removeLayer`. One pass over the index, paid only when a group empties.
   */
  forgetAllChildOwnership(parent: L.Layer): void {
    const parentStamp = L.stamp(parent);
    for (const [childStamp, owner] of this.childOwners) {
      if (owner === parentStamp) this.childOwners.delete(childStamp);
    }
  }

  /** The registered group's stamp that owns `child`, when recorded. */
  childOwnerOf(child: L.Layer): number | undefined {
    return this.childOwners.get(L.stamp(child));
  }

  /** The pane leases some surface of this map currently holds — keyed by
   *  pane name, valued by the owning surface's id plus how the pane was
   *  acquired (`created` = foliplus made the element; adopted = a pre-built
   *  element this surface proved exclusive). The lease is the ownership
   *  proof: "the name is not one of Leaflet's shared panes" is NOT ownership,
   *  and neither is being the first caller of `ensurePane` on a pane that
   *  already carries foreign DOM. Admission therefore runs through
   *  `canAcquirePane` before any DOM or bookkeeping changes, a second
   *  claimant on a held name is refused, and `releasePane` retires the lease
   *  (deleting the element only when foliplus created it as the owner's own
   *  carrier). */
  private readonly paneLeases = new Map<string, { owner: string; created: boolean }>();

  /** Ensure a custom pane exists on the map.
   *  @param {string} paneName - Pane name.
   *  @param {boolean} [needRenderer=true] - Whether to build an SVG renderer
   *    for it. False for canvas panes and for sub-panes, whose renderer the
   *    content that routes into them creates (`ensureVector`). */
  ensurePane(
    paneName: string,
    needRenderer = true,
    /** The claiming surface's id. Recorded so `isPaneClaimed` can let a
     *  surface re-check its own pane without reading it as a collision. */
    owner?: string,
  ): { pane: HTMLElement | null; renderer: L.SVG | null } {
    const self = owner ?? paneName;
    const held = this.paneLeases.get(paneName);
    // Admission happens here, before any DOM or bookkeeping change: a pane
    // another surface holds, or a pre-built pane that already paints foreign
    // content, is not acquireable — the caller degrades instead of
    // co-writing (or restyling) someone else's carrier.
    if (held && held.owner !== self) {
      log.warn(
        `pane "${paneName}" is held by surface ${held.owner}; refusing ` +
          `acquire from ${self}`,
      );
      return { pane: null, renderer: null };
    }
    if (!held) {
      const existing = this.map.getPane(paneName);
      if (existing && this.isForeignPane(existing)) {
        // A pre-built pane that already paints content nobody here created:
        // adopting it would restyle (class/z/focus) and export foreign DOM.
        // (A pane foliplus stamped in an earlier cycle carries the class —
        // that is the unregister/re-register cycle re-adopting its OWN
        // declared pane, children included, not a foreign takeover.)
        log.warn(
          `pane "${paneName}" already carries foreign content; refusing ` +
            `adoption from ${self}`,
        );
        return { pane: null, renderer: null };
      }
    }
    let pane = this.map.getPane(paneName);
    if (!pane) {
      pane = this.map.createPane(paneName);
      pane.classList.add("foliplus-layer-pane");
      // Provisional z so panes of one layer already draw in the right relative
      // order before the ordering pass assigns their position-based base
      // (which may never come if LayerControl is absent).
      const spec = this.paneSpecs.get(paneName);
      if (spec) {
        pane.style.zIndex = String(zFor({ role: spec.role, order: spec.order }));
      }
      this.paneLeases.set(paneName, { owner: self, created: true });
    } else {
      if (!pane.classList.contains("foliplus-layer-pane")) {
        // An adopted pre-built pane must satisfy the same CSS contract as a
        // created one: the focus hide rule and the pointer-events rules key on
        // this class, and an adopted pane without it would stay visible (and
        // clickable) in focus mode.
        pane.classList.add("foliplus-layer-pane");
      }
      this.paneLeases.set(paneName, { owner: self, created: false });
    }
    return {
      pane,
      renderer: needRenderer ? getRendererFor(this.map, paneName) : null,
    };
  }

  /** Whether a pane name is acquireable by surface `selfId`: free (never
   *  created, never leased), leased by `selfId` itself (the matches()
   *  re-check flow), or an EMPTY pre-built pane (a caller preparing a pane
   *  for its layer — adoption is provably exclusive while nothing paints in
   *  it yet). A pane held by another surface, or a pre-built pane already
   *  painting foreign content, is refused — the caller degrades to its own
   *  synthesized pane instead of co-writing (or restyling) someone else's
   *  carrier. Callers use this at the declaration edge, where the degrade is
   *  still a constructor-time decision. */
  canAcquirePane(paneName: string, selfId?: string): boolean {
    if (this.defaultPanes.has(paneName)) return false;
    const self = selfId ?? paneName;
    const held = this.paneLeases.get(paneName);
    if (held) return held.owner === self;
    const existing = this.map.getPane(paneName);
    if (!existing) return true;
    // A pane foliplus already stamped is its own — the unregister/re-register
    // cycle re-adopts it, children included. A plain pane with content is
    // somebody else's; an empty one is a caller preparing for its layer.
    if (existing.classList.contains("foliplus-layer-pane")) return true;
    return existing.childElementCount === 0;
  }

  /** Whether `owner` holds the live lease on `paneName` — the write-side twin
   *  of `canAcquirePane`. The shadow-pane pinning calls consult this before
   *  writing `options.shadowPane`: a name on `layer.options` is not ownership,
   *  and a shadow name another surface holds would move every marker shadow
   *  of ours into its pane. The caller only ever passes a name it booked
   *  (`LayerSurface` sets `shadowPaneName` on acquisition success and clears it
   *  in `destroy`), so this is a second line, not the first gate. */
  private leasedBy(paneName: string, owner: string): boolean {
    return this.paneLeases.get(paneName)?.owner === owner;
  }

  /** Whether a pane element paints content foliplus never created: no
   *  foliplus class stamp AND children on it. The class is what makes the
   *  unregister/re-register cycle of a declared pane re-adoptable. */
  private isForeignPane(existing: HTMLElement): boolean {
    return (
      !existing.classList.contains("foliplus-layer-pane") &&
      existing.childElementCount > 0
    );
  }

  /** Retire a surface's lease on one pane. The lease always goes; the
   *  element goes only when foliplus created it as the owner's own carrier
   *  (a synthesized base pane, a marker-shadow pane, a canvas face pane) — an
   *  adopted or caller-declared pane outlives its surface so the same id can
   *  be registered again without rebuilding panes.
   *
   *  This is the retirement entry the surface teardowns go through: it owns
   *  the lease check and decides whether the DOM goes at all, so a caller
   *  never has to know whether its booking was created or adopted. */
  releasePane(paneName: string, owner: string, removeDom: boolean): void {
    const held = this.paneLeases.get(paneName);
    if (!held || held.owner !== owner) return;
    this.paneLeases.delete(paneName);
    if (removeDom && held.created) this.destroyOwnPane(paneName);
  }

  /** Remove a pane this tree owns from the DOM and Leaflet's registries.
   *  Used by LayerSurface.destroy (the layer's synthesized pane) and by
   *  createCanvas.destroy (its dedicated pane).
   *
   *  Owner-checked. A canvas face whose booking was refused still names a
   *  pane, and an unchecked teardown deleted that pane — which was the other
   *  surface's carrier — while its lease kept pointing at the detached
   *  element. Every later `writeZ`, focus and export then wrote into DOM that
   *  is no longer on the map. Refused here, loudly, instead.
   *
   *  An adopted pane is retired without its DOM too: deleting an element
   *  foliplus never created would drop another component's carrier off the
   *  map.
   *
   *  No cache invalidation here: the cache memoises what each layer's
   *  `options.pane` names, and destroying a pane div changes no layer's
   *  options. Clearing on every teardown used to be the one place this policy
   *  over-invalidated structure-wide for a single pane. */
  removePane(paneName: string, owner: string): void {
    const held = this.paneLeases.get(paneName);
    if (!held || held.owner !== owner) {
      log.warn(
        `refusing to destroy pane "${paneName}": not leased by ${owner} — ` +
          `removing it would delete another surface's carrier and leave its ` +
          `lease dangling`,
      );
      return;
    }
    this.paneLeases.delete(paneName);
    if (held.created) this.destroyOwnPane(paneName);
  }

  /** Delete a pane element this tree created, and drop its spec record. Not
   *  owner-checked: `releasePane` and `removePane` both hold the lease check
   *  first, so "how a pane goes away" has one answer. */
  private destroyOwnPane(paneName: string): void {
    destroyPane(this.map, paneName);
    this.paneSpecs.delete(paneName);
  }

  /** Clear all pane state. Called by LayerController.destroy().
   *  The DOM is left alone: LayerController.destroy() clears the registry without
   *  removing the registered layers from the map, so they are still live —
   *  deleting their panes would drop them off the map. */
  destroy() {
    this.discoveryCache.clear();
    this.paneSpecs.clear();
    this.paneLeases.clear();
    this.childOwners.clear();
    this.generation++;
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
   * `LabelAwareLayer`: `pane`, `renderer` (a Path only), and `shadowPane`
   * (a Marker only) — all three Leaflet's own.
   */
  pinLateContent(
    layersToMove: Array<{
      layer: L.Layer;
      paneName: string | null;
      renderer: L.SVG | null;
      /** The layer's own marker-shadow pane, when the surface synthesized one.
       *  Absent leaves shadows wherever Leaflet put them — but a surface that
       *  promises pane coverage must always pass one now (see
       *  `LayerSurface.ensureShadowPane`). */
      shadowPaneName?: string | null;
      /** The surface that booked `shadowPaneName` — `options.shadowPane` is
       *  only written when `leasedBy` confirms the lease is still its. */
      owner: string;
    }>,
  ): void {
    if (!layersToMove.length) return;
    const groups = new Map<HTMLElement, HTMLElement[]>();
    const markerGroups = new Map<HTMLElement, HTMLElement[]>();
    for (const { layer, paneName, renderer, shadowPaneName, owner } of layersToMove) {
      if (!paneName) continue;
      const container = getRendererContainer(renderer);
      if (!container) {
        // No renderer container (e.g. tile layers with a paneName get
        // needRenderer=false). DOM migration is impossible, but the layer must
        // still be marked handled — otherwise a dirty surface would re-queue it
        // on every reconcile.
        layer.options.pane = paneName;
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
        if (l instanceof L.Path) l.options.renderer = renderer ?? undefined;
        const pathEl = l instanceof L.Path ? (l.getElement() as HTMLElement) : null;
        if (pathEl && pathEl.parentNode !== container) {
          groups.get(container)!.push(pathEl);
        }
        if (l instanceof L.Marker) {
          const iconEl = l.getElement();
          if (paneEl && iconEl && iconEl.parentNode !== paneEl) {
            if (!markerGroups.has(paneEl)) markerGroups.set(paneEl, []);
            markerGroups.get(paneEl)!.push(iconEl);
          }
          // The shadow follows the icon off the shared `shadowPane`, into the
          // surface's own shadow pane — the write that makes pane opacity /
          // visibility / focus cover the marker's full visible DOM. Leaflet
          // re-reads `options.shadowPane` at every `_initIcon`, so the write
          // also keeps a later `setIcon` re-creation inside the layer's pane.
          // The lease check stays on the write itself: a name alone is not
          // ownership, so a refused or already-leased shadow pane can never be
          // pointed at here.
          if (paneEl && shadowPaneName && this.leasedBy(shadowPaneName, owner)) {
            l.options.shadowPane = shadowPaneName;
            // Back to the L.Layer view: the instanceof above narrows to
            // Marker, whose @types declaration holds `_shadow` protected —
            // the probe reads it structurally, like every other internals
            // reach.
            const shadowEl = layerShadow(l as L.Layer);
            const shadowPaneEl = this.map.getPane(shadowPaneName);
            if (shadowEl && shadowPaneEl && shadowEl.parentNode !== shadowPaneEl) {
              if (!markerGroups.has(shadowPaneEl)) markerGroups.set(shadowPaneEl, []);
              markerGroups.get(shadowPaneEl)!.push(shadowEl);
            }
          }
        }
        // A GridLayer (TileLayer included) paints through its own container
        // div, which Leaflet appends to `options.pane` once at addLayer.
        // `options.pane` is read at that single moment, so rewriting it here
        // (two lines above) does nothing visible; the container has to be
        // physically moved into the target pane for the layer to take its
        // place in the z ladder. Paths and markers get moved above; this is
        // the GridLayer analogue. The `getContainer` guard keeps a stripped
        // Leaflet mock (no GridLayer implementation) from blowing up the pin.
        if (
          l instanceof L.GridLayer &&
          paneEl &&
          typeof (l as { getContainer?: () => HTMLElement }).getContainer === "function"
        ) {
          const tileContainer = l.getContainer();
          if (tileContainer && tileContainer.parentNode !== paneEl) {
            if (!markerGroups.has(paneEl)) markerGroups.set(paneEl, []);
            markerGroups.get(paneEl)!.push(tileContainer);
          }
        }
        // ImageOverlay (VideoOverlay included) paints through its own <img>,
        // which Leaflet appends to `options.pane` once at addLayer — the same
        // read-once contract as the GridLayer branch, with the same
        // consequence: an image that joined the map before the pin stays in
        // the shared `overlayPane`, invisible to the surface's z ladder
        // (LayerSurface.setZ writes the panes, not the layer) and to every
        // pane-scoped focus rule. Same fix, symmetric branch. The typeof
        // guard keeps a stripped Leaflet mock (no ImageOverlay) from throwing
        // on `instanceof undefined`, like the GridLayer check above.
        if (
          typeof L.ImageOverlay !== "undefined" &&
          l instanceof L.ImageOverlay &&
          paneEl
        ) {
          const image = (l as L.ImageOverlay & { _image?: HTMLElement | null })._image;
          if (image && image.parentNode !== paneEl) {
            if (!markerGroups.has(paneEl)) markerGroups.set(paneEl, []);
            markerGroups.get(paneEl)!.push(image);
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

  /** Relocate only the marker shadows of a tree into the layer's shadow pane
   *  and write `options.shadowPane` — the declared-container counterpart of
   *  `pinLateContent`'s marker branch.
   *
   *  A declared-pane surface does NOT repin its container's children: the
   *  leaves' pane assignment belongs to whoever declared them (`createLayers`),
   *  and a full re-pin would collapse every leaf onto the base pane. Shadows
   *  are the one exception — they carry no pane assignment of their own and
   *  must ride the layer's shadow carrier for the pane-write invariant to
   *  hold, so this walk moves them without touching icon / path placement.
   *  A leaf already inside the shadow pane is left alone (idempotent, like
   *  every pin), and `options.shadowPane` keeps a later `setIcon` inside.
   *
   *  @param shadowPaneName - The surface's shadow pane; must exist (the
   *    surface materialized it) and still be leased by `owner` — a null,
   *    missing, or no-longer-ours pane skips the move rather than guessing a
   *    destination.
   *  @param owner - The surface that booked `shadowPaneName`. `options.shadowPane`
   *    is a write, so it is gated on the lease the same way `pinLateContent`'s
   *    marker branch gates it. */
  pinLateShadows(layer: L.Layer, shadowPaneName: string | null, owner: string): void {
    if (!shadowPaneName || !this.leasedBy(shadowPaneName, owner)) return;
    const shadowPaneEl = this.map.getPane(shadowPaneName);
    if (!shadowPaneEl) return;
    // Collect, then move once: a group with N un-shadowed markers used to
    // append N times into the pane div, and this runs from `materialize` — on
    // the register path. One fragment is one append instead of N.
    const toMove: HTMLElement[] = [];
    walkLeaf(layer, leaf => {
      if (!(leaf instanceof L.Marker)) return;
      leaf.options.shadowPane = shadowPaneName;
      const shadowEl = layerShadow(leaf as L.Layer);
      if (shadowEl && shadowEl.parentNode !== shadowPaneEl) toMove.push(shadowEl);
    });
    if (!toMove.length) return;
    const frag = document.createDocumentFragment();
    for (const el of toMove) frag.appendChild(el);
    shadowPaneEl.appendChild(frag);
  }

  /** Invalidate the child-pane discovery cache — structure-wide, either way.
   *  @param {number} [id] - Retained for the stamp-only callers. It is
   *    ignored: a repinned subtree can invalidate entries for layers the
   *    caller holds no reference to, so a single-key policy can leave a wrong
   *    answer in the cache. Over-invalidating is always safe here — a stale
   *    entry costs one extra `walkTree` walk, never a wrong result.
   *    `pinTree` uses the same primitive. */
  invalidateDiscoveryCache(id?: number): void {
    void id;
    this.generation++;
  }

  /** Drop child-pane entries no longer referenced by any registered layer.
   *  Only the bookkeeping is dropped — the pane div is left in place. Unlike a
   *  fallback pane it is not keyed to a single layer: its name is user-defined
   *  and can be reused, and its renderer is still live, its SVG container being
   *  a child of the pane div. Removing the div would orphan that container, and
   *  re-creating the pane would not re-parent it. */
  sweepChildPanes(layers: ReadonlyArray<{ paneSpecs?: readonly PaneSpec[] }>) {
    const used = new Set<string>();
    for (const layerInfo of layers) {
      for (const spec of layerInfo.paneSpecs ?? []) {
        used.add(spec.name);
      }
    }
    for (const name of this.paneSpecs.keys()) {
      if (!used.has(name)) this.paneSpecs.delete(name);
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
      if (this.defaultPanes.has(spec.name)) {
        // Same degradation as the injection gate: a spec naming one of
        // Leaflet's shared panes would let `ensurePane` adopt that pane and
        // every layer-carrier write on it (z, opacity, focus classes) style
        // the whole map. Skip the spec — the surface's own synthesis gives
        // the layer a pane that is provably its own.
        log.warn(
          `PaneSpec.name rejected ("${spec.name}" is one of Leaflet's shared ` +
            `panes); the layer gets its own synthesized pane instead`,
        );
        continue;
      }
      if (!Object.values(CONST.PANE_ROLE).includes(spec.role)) {
        log.warn(
          `PaneSpec.role rejected (unknown value "${String(spec.role)}"); ` +
            `keeping the spec but falling back to "base"`,
        );
        this.paneSpecs.set(spec.name, {
          ...spec,
          role: CONST.PANE_ROLE.BASE,
        });
        continue;
      }
      this.paneSpecs.set(spec.name, spec);
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
   * The write contract is the one declared on `LabelAwareLayer`: `pane` and
   * `renderer` (a Path only). Nothing else on a third-party
   * layer's `options` is written here.
   *
   * `paneName` always names a **declared** pane that already exists, by two
   * independent guarantees:
   *   - existence — the pane is built before anything can be routed into it.
   *     `LayerFactory.addLayer` calls `register()` before it pins (and only
   *     when the group is not on the map yet, so every later call already has
   *     the surface); `register()` reaches `LayerController.registerLayer` →
   *     `surfaceFor` → `new LayerSurface(...)`, whose constructor runs
   *     `addPane` → `PaneManager.ensurePane` and creates the DOM pane.
   *   - name — `LayerFactory.addLayer` gates on
   *     `paneNames.includes(requested)`, so a name outside `opts.panes` never
   *     reaches this method at all. Both sides of that gate are pinned by
   *     `LayerFactory.test.ts` ("addLayer with an unknown paneName …" and
   *     "mainLayer.addLayer falls through to origAddLayer …").
   */
  pinTree(node: L.Layer, paneName: string): void {
    walkTree(node as PinnableNode, n => {
      n.options.pane = paneName;
      // A Path needs its renderer pinned; every other leaf just carries the
      // pane name written above. Containers never reach here — the walk
      // descends past them.
      if (!isContainerNode(n) && n instanceof L.Path) {
        this.ensureVector(n as PathWithPane, paneName);
      }
    });
    // Bumping the generation marks every previously memoised entry stale, so
    // any later `discoverChildPanes` sees the pin rather than the pre-pin name.
    // Precise per-node delete would only have served the ones we touched;
    // structure-wide covers them plus every entry a subtree re-pin invalidates
    // from underneath.
    this.generation++;
  }

  // ── Pure computation (JS unit-testable, no Leaflet) ────────────

  /** Find all custom panes used by a container's tree.
   *  Memoised per layer stamp and capped by `CACHE.PANE_DISCOVERY_ENTRIES`.
   *  Entries carry the generation they were written at; an entry from a
   *  different generation is recomputed, so `pinTree` / `invalidateDiscoveryCache` /
   *  `destroy` all invalidate uniformly without a per-node delete. */
  discoverChildPanes(layer: L.Layer, depth = 0): string[] {
    if (depth > CONST.RECURSION.PANE_DEPTH) return [];
    const key = L.stamp(layer);
    const hit = this.discoveryCache.get(key);
    if (hit?.gen === this.generation) return hit.panes;
    const panes = new Set<string>();
    walkTree(
      layer,
      (l: L.Layer) => {
        const p = l.options.pane;
        if (p && !this.isDefaultPane(p)) panes.add(p);
      },
      depth,
    );
    const result = Array.from(panes);
    // Map insertion order is FIFO here, so the first key is the oldest. Dropping
    // it costs one extra `walkTree` walk the next time that layer is asked
    // about — never a wrong answer. The `size` guard already guarantees the
    // iterator has a value, so the `!` is for the type system only.
    if (this.discoveryCache.size >= CONST.CACHE.PANE_DISCOVERY_ENTRIES) {
      this.discoveryCache.delete(this.discoveryCache.keys().next().value!);
    }
    this.discoveryCache.set(key, { gen: this.generation, panes: result });
    return result;
  }

  isDefaultPane(pane: string): boolean {
    return this.defaultPanes.has(pane) || pane.startsWith(CONST.FALLBACK_PANE_PREFIX);
  }

  /** Write-side gate for Leaflet's shared panes — every pane-style write
   *  (opacity, z-index, focus classes) must land on a pane the layer stack
   *  owns.
   *
   *  A write that reaches `shadowPane` / `markerPane` / `overlayPane` /
   *  `tilePane` styles every other layer on the map at once: fading the
   *  shared shadowPane drops the shadows of all marker layers together, and
   *  lifting or classing a shared pane rewrites the whole map's stacking.
   *  That is the exact failure class the marker-shadow carrier fix exists to
   *  close, so the resolve-by-name write sites call this before touching
   *  `style` / `classList`, and a shared name throws rather than corrupting
   *  the map — a shared-pane write is always a bug in the caller's carrier
   *  model, never a value to clamp.
   *
   *  Deliberately `defaultPanes.has`, NOT `isDefaultPane`: the fallback family
   *  (`foliplus-pane-*`) is the surface's own synthesized carrier — one pane
   *  per layer, safe to write — while `isDefaultPane` also answers for it
   *  (discovery uses that to exclude our own panes). Only Leaflet's shared
   *  panes are refused here.
   *
   *  Leaflet's own UI panes are not wholly off-limits: the focus ladder lifts
   *  `markerPane` / `tooltipPane` / `popupPane` deliberately (focus/pane.ts
   *  `liftZ`, a temporary z write with restore), and the ordering pass prices
   *  the same three panes. Those are native-pane *ladder* writes, not
   *  layer-carrier writes — they intentionally bypass this gate. */
  assertOwnedPane(paneName: string): void {
    if (this.defaultPanes.has(paneName)) {
      throw new Error(this.sharedPaneRejection(paneName));
    }
    if (!this.paneLeases.has(paneName)) {
      // A name outside the shared list but with no claim on file is exactly
      // the co-writing case: two surfaces adopting the same custom-named pane
      // would both pass a name-only check and style each other's content.
      throw new Error(
        log.msg(
          `refusing a layer-style write on unclaimed pane "${paneName}": no ` +
            `surface on this map claimed it as its exclusive carrier`,
        ),
      );
    }
  }

  /** The shared-pane rejection message, shared by the write gate and the
   *  declaration gate so both sides warn identically. */
  private sharedPaneRejection(paneName: string): string {
    return log.msg(
      `refusing a layer-style write on shared pane "${paneName}": the pane ` +
        `does not belong to one layer. Resolve the layer's own pane ` +
        `(LayerSurface.panes) instead — a write here would style every ` +
        `layer on the map.`,
    );
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
