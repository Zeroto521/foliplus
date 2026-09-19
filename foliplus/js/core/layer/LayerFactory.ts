// core/layer/LayerFactory — standalone createLayers/createCanvas factories.
// Pure logic, no CONF / translator dependency. Takes map + PaneManager +
// register/unregister callbacks via dependency injection.
import { cancelMapPaneTranslate, dom } from "#common/dom.js";
import { createLogger } from "#common/log.js";
import { throttleRaf } from "#common/throttle.js";
import { PaneManager } from "./PaneManager.js";
import { CANVAS_PANE_PREFIX } from "./const.js";
import type {
  CreateCanvasAPI,
  CreateCanvasOpts,
  CreateLayersAPI,
  CreateLayersOpts,
  LabelAwareLayer,
  PaneSpec,
  RegisterLayerOpts,
} from "./type.js";

/** Dependency injection contract for LayerFactory. */
interface LayerFactoryDeps {
  map: L.Map;
  panes: PaneManager;
  registerLayer: (opts: RegisterLayerOpts) => HTMLElement | null;
  unregisterLayer: (id: string) => boolean;
  bringLayerToFront: (id: string) => void;
  /** Drop a registered layer's cached geometry type when its content changes. */
  invalidateType: (id: string) => void;
  /**
   * Optional: notify on runtime layer content changes (add/remove/clear).
   * Lets LayerControl refresh a layer's feature count column live when a
   * third party mutates the layer tree through the createLayers API.
   * NOTE: if a featureCountProvider is supplied, this is skipped — the
   * owning component manages its own counts via emit(LAYER_ITEM_COUNT_CHANGE).
   * For them, onDataChange would over-fire on every addLayer (preview layers
   * in MeasureControl alone call addLayer 6-7 times per measurement),
   * causing redundant UI refreshes of an unchanged count. Skip it.
   */
  onDataChange?: (id: string) => void;
}

// core/layer is not a component dir, so CONF is unavailable here — the module
// prefixes with its own class name.
const log = createLogger("LayerFactory");

class LayerFactory {
  private deps: LayerFactoryDeps;

  constructor(deps: LayerFactoryDeps) {
    this.deps = deps;
  }

  createLayers(opts: CreateLayersOpts): CreateLayersAPI {
    const {
      map,
      panes,
      registerLayer,
      unregisterLayer,
      bringLayerToFront,
      invalidateType,
      onDataChange,
    } = this.deps;
    const factoryPanes = panes;

    // The first entry in `opts.panes` is the layer's base pane (recorded as
    // `paneName` on the registry entry); each later entry is a `sub`, drawn one
    // offset above the previous. That offset is the entry's position in the
    // list, written down once as PaneSpec.order and read back at every z write.
    // An empty or absent list means the layer is flat — one `mainLayer` with no
    // sub-panes.
    const paneEntries = opts.panes ?? [];
    const paneSpecs: PaneSpec[] = paneEntries.map((p, i) => ({
      role: i === 0 ? "base" : "sub",
      order: i,
      name: p.name,
      isLabel: p.isLabel,
    }));
    const paneNames = paneSpecs.map(s => s.name);
    const basePaneName = paneNames[0] ?? null;
    const labelPanes = new Set(paneEntries.filter(p => p.isLabel).map(p => p.name));

    // Components that supply featureCountProvider (MeasureControl, Heatmap)
    // manage their own counts via emit(LAYER_ITEM_COUNT_CHANGE). For them,
    // onDataChange would over-fire on every addLayer (preview layers in
    // MeasureControl alone call addLayer 6-7 times per measurement), causing
    // redundant UI refreshes of an unchanged count. Skip it.
    const onDataChangeSkip = Boolean(opts.featureCountProvider);
    const mainLayer = L.layerGroup();
    // Build one sub-layer per declared sub-pane. The base sub-layer exists
    // even when there is exactly one pane — mainLayer always routes through
    // it so `paneName` on `RegisterLayerOpts` is well-defined.
    const subLayers = new Map<string, L.LayerGroup>();
    for (const name of paneNames) {
      const g = L.layerGroup([], { pane: name });
      subLayers.set(name, g);
      mainLayer.addLayer(g);
    }

    let registered = false;

    // Capture the original LayerGroup.prototype methods before we shadow them
    // on the instance a few lines below. `mainLayer.addLayer = fn` on the
    // instance hides the prototype method, but if we bound the (then-current)
    // `mainLayer.addLayer` first the wrapper would end up calling itself —
    // infinite self-recursion until the stack returns to the caller with the
    // default Leaflet pane. Pull from `L.LayerGroup.prototype` directly to
    // sidestep the shadow. The null-guard fallback is for the JS unit test,
    // which mocks `L.layerGroup` as a plain factory without a `prototype`.
    const proto = L.LayerGroup?.prototype;
    const origAddLayer = proto
      ? proto.addLayer.bind(mainLayer)
      : mainLayer.addLayer.bind(mainLayer);
    const origRemoveLayer = proto
      ? proto.removeLayer.bind(mainLayer)
      : mainLayer.removeLayer.bind(mainLayer);

    const layerOpts: RegisterLayerOpts = {
      name: opts.name,
      id: opts.id,
      isBase: false,
      layer: mainLayer,
      paneName: basePaneName,
      paneSpecs,
      iconSvg: opts.iconSvg || null,
      featureCountProvider: opts.featureCountProvider ?? null,
      styleProvider: opts.styleProvider ?? null,
      styleSetters: opts.styleSetters ?? null,
      styleDefaults: opts.styleDefaults ?? null,
    };
    // Register the pane specs eagerly so ensurePane can assign a provisional
    // z on first creation. register() only fires when the first layer is added,
    // but ensurePane may run earlier via ensureVector — at that point
    // childPaneSpecs must already be populated.
    if (paneSpecs.length) factoryPanes.registerPaneSpecs(paneSpecs);

    const register = () => {
      registered = true;
      registerLayer(layerOpts);
    };

    const unregister = () => {
      if (!registered) return;
      const hasContent =
        directCount() > 0 ||
        Array.from(subLayers.values()).some(g => g.getLayers().length > 0);
      if (!hasContent) {
        registered = false;
        unregisterLayer(opts.id);
      }
    };

    /** Count content outside the sub-layer containers (which always exist
     *  once `opts.panes` is non-empty). */
    const directCount = (): number => mainLayer.getLayers().length - subLayers.size;

    /** Route a layer to its target sub-layer by `options.pane`. If the
     *  caller did not preset `options.pane` — or left it at Leaflet's
     *  class-default (`'overlayPane'` for paths, `'markerPane'` for
     *  markers, etc.) — default to `paneNames[0]`, the base pane where
     *  graph geometry normally lives. This mirrors the pre-refactor
     *  `mainLayer.addLayer(layer)` contract (which auto-routed unflagged
     *  leaves to graphPane) so existing callers that rely on
     *  `mainLayer.addLayer(poly)` without setting `options.pane` keep
     *  working. Explicit `options.pane` values in `paneNames` are honoured;
     *  values outside `paneNames` (or empty `paneNames`) fall through to
     *  `origAddLayer` unchanged.
     *
     *  Distinguishing "explicit" from "class-default" uses `options.paneSet`
     *  — the flag `ensureVector` / `LayerSurface`'s pin / this method set when
     *  they actually write `options.pane`. Without it, every `L.polyline()`
     *  carries `options.pane === 'overlayPane'` and the auto-default below
     *  would never fire.
     *
     *  The pin recurses into containers: a GeoJSON group or FeatureGroup
     *  handed in here has each child path pinned too, because Leaflet ignores
     *  a group's pane for its children and each child is added on its own.
     *  Pinning writes `options.renderer` as well, so a later `setPane()` call
     *  cannot fall through to Leaflet's default SVG and cause the
     *  "already-owned element" `appendChild` crash. */
    mainLayer.addLayer = (layer: LabelAwareLayer) => {
      const declared = layer.options.pane;
      const requested = layer.options.paneSet ? declared : basePaneName;
      if (requested && paneNames.includes(requested)) {
        if (!map.hasLayer(mainLayer)) register();
        // The whole subtree, not just the top node: a container handed in here
        // would otherwise leave its child paths on the map's default renderer —
        // Leaflet ignores a group's pane for its children, so each child has to
        // carry the pane itself. pinTree also pins the top node, so downstream
        // code (discoverChildPanes, getLayerPanes, ensureVector) sees the
        // requested name even when the caller left `options.pane` empty.
        factoryPanes.pinTree(layer, requested);
        const target = subLayers.get(requested)!;
        const result = target.addLayer(layer);
        // The mainLayer subtree changed — invalidate its discovery entry.
        // pinTree already reset the nodes it pinned.
        panes.reset(L.stamp(mainLayer));
        invalidateType(opts.id);
        if (!onDataChangeSkip) onDataChange?.(opts.id);
        return result;
      }
      return origAddLayer(layer);
    };

    mainLayer.removeLayer = (layer: LabelAwareLayer) => {
      for (const g of subLayers.values()) {
        if (g.hasLayer(layer)) {
          const result = g.removeLayer(layer);
          panes.reset(L.stamp(mainLayer));
          panes.reset(L.stamp(layer));
          invalidateType(opts.id);
          if (!onDataChangeSkip) onDataChange?.(opts.id);
          return result;
        }
      }
      return origRemoveLayer(layer);
    };

    mainLayer.clearLayers = () => {
      // mainLayer always holds the (possibly empty) sub-layers as children;
      // content may also be added directly (no sub-pane). Count only actual
      // content, not the sub-layer containers themselves.
      const hadContent =
        directCount() > 0 ||
        Array.from(subLayers.values()).some(g => g.getLayers().length > 0);
      for (const g of subLayers.values()) g.clearLayers();
      if (hadContent && !onDataChangeSkip) onDataChange?.(opts.id);
      if (map.hasLayer(mainLayer)) map.removeLayer(mainLayer);
      unregister();
      return mainLayer;
    };

    /**
     * Add a layer into this tree, pinned to the given sub-pane. The pane
     * name must have been declared via `opts.panes` — the values are
     * component-owned (MeasureControl/const.ts:PANES supplies them, so
     * callers never write pane-name string literals).
     *
     * Passing no name defaults to `paneNames[0]` — the base pane, where
     * graph geometry normally lives. Passing a name not in the list
     * falls through to the base layerGroup with no pin: that is the
     * same shape as a flat layer. Kept silent rather than throwing
     * because a mis-routed layer is a caller bug that would still
     * render; a thrown error would kill a live measurement.
     *
     * `paneName` is written directly onto `layer.options.pane` —
     * `mainLayer.addLayer` routes by that field, so callers reading
     * `layer.options.pane` (e.g. `discoverChildPanes`, `getLayerPanes`)
     * see the same truth. `isLabel` is also set on the leaf when the
     * pane is declared with `isLabel: true` in `panes`: `util.getGeometryType`
     * and `countFeatureGeometry` still use it to exclude label leaves from
     * feature-geometry counts, so the flag is kept for that contract.
     */
    const addLayer = (layer: L.Layer, paneName?: string): L.Layer => {
      // Only write options.pane when the caller explicitly names one.
      // When paneName is omitted, mainLayer.addLayer's own default
      // (basePaneName for unset pane, existing pane when paneSet is true)
      // handles routing — overwriting here would collapse NODE/LABEL
      // layers back to GRAPH on resort/re-add.
      const target = paneName ?? undefined;
      if (target && paneNames.includes(target)) {
        (layer as LabelAwareLayer).options.pane = target;
        (layer as LabelAwareLayer).options.paneSet = true;
        // Set or clear the flag so a layer that moves from a label pane
        // to a non-label pane (or vice versa) stays consistent.
        (layer as LabelAwareLayer).isLabel = labelPanes.has(target);
      }
      mainLayer.addLayer(layer as LabelAwareLayer);
      return layer;
    };
    const removeLayer = (...items: Array<L.Layer | null | undefined>) => {
      items.forEach(l => {
        if (l != null) mainLayer.removeLayer(l as LabelAwareLayer);
      });
    };
    const clearLayers = () => {
      mainLayer.clearLayers();
    };

    return {
      mainLayer,
      addLayer,
      removeLayer,
      clearLayers,
      register,
      unregister,
      registered: () => registered,
      bringToFront: () => bringLayerToFront(opts.id),
    };
  }

  createCanvas(opts: CreateCanvasOpts): CreateCanvasAPI {
    const { map, panes, registerLayer, unregisterLayer, bringLayerToFront } = this.deps;
    if (!opts?.id) throw new Error(log.msg("createCanvas requires an id"));

    // Dedicated Leaflet pane: z-order, focus hide, and export all treat the
    // canvas like any other layer pane. No SVG renderer — the canvas paints.
    const paneName = `${CANVAS_PANE_PREFIX}${opts.id}`;
    const { pane } = panes.ensurePane(paneName, false);

    // Generic class so every createCanvas consumer shares the overlay CSS.
    const canvas = dom.el("canvas", {
      class: "foliplus-canvas-layer",
      parent: pane,
    }) as HTMLCanvasElement;
    if (opts.className) canvas.classList.add(opts.className);

    const ctx = canvas.getContext("2d");

    const resize = () => {
      const container = map.getContainer();
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (canvas.width !== w * dpr) canvas.width = w * dpr;
      if (canvas.height !== h * dpr) canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };

    const updatePosition = () => {
      cancelMapPaneTranslate(canvas, map);
    };

    const getSize = () => {
      const container = map.getContainer();
      return { width: container.clientWidth, height: container.clientHeight };
    };

    resize();
    updatePosition();

    let registered = false;
    const HIDDEN = "hidden";

    const onToggle =
      opts.onToggle ||
      ((visible: boolean) => {
        canvas.classList.toggle(HIDDEN, !visible);
      });

    const unregister = () => {
      if (!registered) return;
      registered = false;
      ctx!.setTransform(1, 0, 0, 1, 0, 0);
      ctx!.clearRect(0, 0, canvas.width, canvas.height);
      canvas.classList.add(HIDDEN);
      unregisterLayer(opts.id);
    };

    const layerOpts: RegisterLayerOpts = {
      id: opts.id,
      name: opts.name || opts.id,
      iconSvg: opts.iconSvg || null,
      canvas,
      paneName,
      onToggle,
      featureCountProvider: opts.featureCountProvider ?? null,
      styleProvider: opts.styleProvider ?? null,
      styleSetters: opts.styleSetters ?? null,
      styleDefaults: opts.styleDefaults ?? null,
      getBounds: opts.getBounds ?? null,
      source: opts.source ?? null,
      updatedAt: opts.updatedAt ?? null,
      meta: opts.meta ?? null,
    };
    const register = () => {
      if (registered) return;
      registered = true;
      resize();
      updatePosition();
      canvas.classList.remove(HIDDEN);
      registerLayer(layerOpts);
    };

    const onMove = throttleRaf(() => updatePosition());
    map.on("move", onMove);

    const onResize = () => resize();
    map.on("resize", onResize);

    return {
      canvas,
      ctx,
      resize,
      getSize,
      updatePosition,
      register,
      unregister,
      registered: () => registered,
      destroy: () => {
        map.off("move", onMove);
        map.off("resize", onResize);
        onMove.cancel();
        unregister();
        canvas.remove();
        panes.removePane(paneName);
      },
      bringToFront: () => bringLayerToFront(opts.id),
      setZIndex: (z: number) => {
        pane.style.zIndex = String(z);
      },
      setVisible: (v: boolean) => {
        canvas.classList.toggle(HIDDEN, !v);
      },
    };
  }
}

export { LayerFactory };
export type { CreateCanvasOpts, CreateLayersOpts } from "./type.js";
