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
  SurfaceContentHandle,
  SurfaceHandle,
  SurfaceOpts,
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
    const handle = this.createSurface({
      id: opts.id,
      name: opts.name,
      iconSvg: opts.iconSvg,
      featureCountProvider: opts.featureCountProvider,
      styleProvider: opts.styleProvider,
      styleSetters: opts.styleSetters,
      styleDefaults: opts.styleDefaults,
      content: { kind: "layers", panes: opts.panes },
    });
    return {
      mainLayer: handle.content.mainLayer,
      addLayer: handle.content.addLayer,
      removeLayer: handle.content.removeLayer,
      clearLayers: handle.content.clearLayers,
      register: handle.register,
      unregister: handle.unregister,
      registered: handle.registered,
      bringToFront: handle.bringToFront,
    };
  }

  createCanvas(opts: CreateCanvasOpts): CreateCanvasAPI {
    const handle = this.createSurface({
      id: opts.id,
      name: opts.name,
      iconSvg: opts.iconSvg,
      featureCountProvider: opts.featureCountProvider,
      styleProvider: opts.styleProvider,
      styleSetters: opts.styleSetters,
      styleDefaults: opts.styleDefaults,
      content: {
        kind: "canvas",
        className: opts.className,
        onToggle: opts.onToggle,
        getBounds: opts.getBounds,
        source: opts.source,
        updatedAt: opts.updatedAt,
        meta: opts.meta,
      },
    });
    return {
      canvas: handle.content.canvas,
      ctx: handle.content.ctx,
      resize: handle.content.resize,
      getSize: handle.content.getSize,
      updatePosition: handle.content.updatePosition,
      register: handle.register,
      unregister: handle.unregister,
      registered: handle.registered,
      destroy: handle.destroy,
      bringToFront: handle.bringToFront,
      setVisible: handle.content.setVisible,
    };
  }

  createSurface(
    opts: SurfaceOpts & { content: { kind: "layers" } },
  ): Extract<SurfaceHandle, { content: { kind: "layers" } }>;
  createSurface(
    opts: SurfaceOpts & { content: { kind: "canvas" } },
  ): Extract<SurfaceHandle, { content: { kind: "canvas" } }>;
  createSurface(opts: SurfaceOpts): SurfaceHandle {
    // Unreachable for typed callers (SurfaceOpts.id is required); kept as a
    // guard for untyped JS callers that skip the overload.
    if (opts.content.kind === "canvas" && !opts.id) {
      throw new Error(log.msg("createCanvas requires an id"));
    }

    const { map, panes, registerLayer, unregisterLayer, bringLayerToFront } = this.deps;

    const commonLayerOpts = {
      id: opts.id,
      name: opts.name || opts.id,
      iconSvg: opts.iconSvg || null,
      featureCountProvider: opts.featureCountProvider ?? null,
      styleProvider: opts.styleProvider ?? null,
      styleSetters: opts.styleSetters ?? null,
      styleDefaults: opts.styleDefaults ?? null,
    };

    let registered = false;
    let layerOpts: RegisterLayerOpts;
    let registerIdempotent = false;
    let preRegister: () => void = () => {};
    let preUnregister: () => void = () => {};
    let shouldUnregister: () => boolean = () => true;
    let content: SurfaceContentHandle;

    const register = () => {
      // registerIdempotent: the layers branch sets it false (register always
      // fires), the canvas branch true (idempotent). The compiler can't narrow
      // a let across the if (content.kind) split, so the check is kept for
      // canvas; layers never takes the return path.
      if (registerIdempotent && registered) return;
      registered = true;
      preRegister();
      registerLayer(layerOpts);
    };

    const unregister = () => {
      if (!registered) return;
      // shouldUnregister: the canvas branch pins it to () => true (always
      // unregister), the layers branch evaluates remaining content. The check
      // is kept for layers; canvas never takes the return path.
      if (!shouldUnregister()) return;
      registered = false;
      preUnregister();
      unregisterLayer(opts.id);
    };

    const bringToFront = () => bringLayerToFront(opts.id);

    if (opts.content.kind === "layers") {
      const { invalidateType, onDataChange } = this.deps;

      const paneEntries = opts.content.panes ?? [];
      const paneSpecs: PaneSpec[] = paneEntries.map((p, i) => ({
        role: i === 0 ? "base" : "sub",
        order: i,
        name: p.name,
        isLabel: p.isLabel,
      }));
      const paneNames = paneSpecs.map(s => s.name);
      const basePaneName = paneNames[0] ?? null;
      const labelPanes = new Set(paneEntries.filter(p => p.isLabel).map(p => p.name));

      const onDataChangeSkip = Boolean(opts.featureCountProvider);
      const mainLayer = L.layerGroup();
      const subLayers = new Map<string, L.LayerGroup>();
      for (const name of paneNames) {
        const g = L.layerGroup([], { pane: name });
        subLayers.set(name, g);
        mainLayer.addLayer(g);
      }

      const proto = L.LayerGroup?.prototype;
      const origAddLayer = proto
        ? proto.addLayer.bind(mainLayer)
        : mainLayer.addLayer.bind(mainLayer);
      const origRemoveLayer = proto
        ? proto.removeLayer.bind(mainLayer)
        : mainLayer.removeLayer.bind(mainLayer);

      layerOpts = {
        ...commonLayerOpts,
        name: opts.name,
        isBase: false,
        layer: mainLayer,
        paneName: basePaneName,
        paneSpecs,
      };
      if (paneSpecs.length) panes.registerPaneSpecs(paneSpecs);

      const directCount = (): number => mainLayer.getLayers().length - subLayers.size;

      mainLayer.addLayer = (layer: LabelAwareLayer) => {
        const declared = layer.options.pane;
        const requested = layer.options.paneSet ? declared : basePaneName;
        if (requested && paneNames.includes(requested)) {
          if (!map.hasLayer(mainLayer)) register();
          panes.pinTree(layer, requested);
          const target = subLayers.get(requested)!;
          const result = target.addLayer(layer);
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
        const hadContent =
          directCount() > 0 ||
          Array.from(subLayers.values()).some(g => g.getLayers().length > 0);
        for (const g of subLayers.values()) g.clearLayers();
        if (hadContent && !onDataChangeSkip) onDataChange?.(opts.id);
        if (map.hasLayer(mainLayer)) map.removeLayer(mainLayer);
        unregister();
        return mainLayer;
      };

      const addLayer = (layer: L.Layer, paneName?: string): L.Layer => {
        const target = paneName ?? undefined;
        if (target && paneNames.includes(target)) {
          (layer as LabelAwareLayer).options.pane = target;
          (layer as LabelAwareLayer).options.paneSet = true;
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

      registerIdempotent = false;
      shouldUnregister = () =>
        !(
          directCount() > 0 ||
          Array.from(subLayers.values()).some(g => g.getLayers().length > 0)
        );
      content = { kind: "layers", mainLayer, addLayer, removeLayer, clearLayers };

      return {
        content,
        register,
        unregister,
        registered: () => registered,
        bringToFront,
      };
    }

    const {
      className,
      onToggle: onToggleOpt,
      getBounds,
      source,
      updatedAt,
      meta,
    } = opts.content;

    const paneName = `${CANVAS_PANE_PREFIX}${opts.id}`;
    const { pane } = panes.ensurePane(paneName, false);

    const canvas = dom.el("canvas", {
      class: "foliplus-canvas-layer",
      parent: pane,
    }) as HTMLCanvasElement;
    if (className) canvas.classList.add(className);

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(log.msg("createCanvas requires a 2d context"));

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

    const HIDDEN = "hidden";

    const onToggle =
      onToggleOpt ||
      ((visible: boolean) => {
        canvas.classList.toggle(HIDDEN, !visible);
      });

    layerOpts = {
      ...commonLayerOpts,
      canvas,
      paneName,
      onToggle,
      getBounds: getBounds ?? null,
      source: source ?? null,
      updatedAt: updatedAt ?? null,
      meta: meta ?? null,
    };

    const onMove = throttleRaf(() => updatePosition());
    map.on("move", onMove);

    const onResize = () => resize();
    map.on("resize", onResize);

    registerIdempotent = true;
    preRegister = () => {
      resize();
      updatePosition();
      canvas.classList.remove(HIDDEN);
    };
    preUnregister = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.classList.add(HIDDEN);
    };
    shouldUnregister = () => true;
    const destroyCanvas = () => {
      map.off("move", onMove);
      map.off("resize", onResize);
      onMove.cancel();
      unregister();
      canvas.remove();
      panes.removePane(paneName);
    };
    content = {
      kind: "canvas",
      canvas,
      ctx,
      resize,
      getSize,
      updatePosition,
      setVisible: (v: boolean) => {
        canvas.classList.toggle(HIDDEN, !v);
      },
    };

    return {
      content,
      register,
      unregister,
      registered: () => registered,
      bringToFront,
      destroy: destroyCanvas,
    };
  }
}

export { LayerFactory };
export type { CreateCanvasOpts, CreateLayersOpts } from "./type.js";
