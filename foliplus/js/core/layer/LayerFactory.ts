// core/layer/LayerFactory — standalone createLayers/createCanvas factories.
// Pure logic, no CONF / translator dependency. Takes map + PaneManager +
// register/unregister callbacks via dependency injection.
import { dom } from "#common/dom.js";
import { throttleRaf } from "#common/throttle.js";
import { PaneManager } from "./PaneManager.js";
import type { RegisterLayerOpts } from "./LayerRegistry.js";

/** Options for createLayers. */
interface CreateLayersOpts {
  id: string;
  name?: string;
  graphPane?: string;
  labelPane?: string;
  iconSvg?: string;
}

/** Options for createCanvas. */
interface CreateCanvasOpts {
  id: string;
  name?: string;
  className?: string;
  iconSvg?: string;
  onToggle?: ((visible: boolean) => void) | null;
  onZIndex?: ((z: number) => void) | null;
}

/** Leaflet layer with a custom `isLabel` flag (foliplus adds it). */
interface LabelAwareLayer extends L.Layer {
  isLabel?: boolean;
  options: L.LayerOptions & { renderer?: L.Renderer; pane?: string; paneSet?: boolean };
}

/** Dependency injection contract for LayerFactory. */
interface LayerFactoryDeps {
  map: L.Map;
  panes: PaneManager;
  registerLayer: (opts: RegisterLayerOpts) => HTMLElement | null;
  unregisterLayer: (id: string) => boolean;
  bringLayerToFront: (id: string) => void;
}

class LayerFactory {
  private deps: LayerFactoryDeps;

  constructor(deps: LayerFactoryDeps) {
    this.deps = deps;
  }

  createLayers(opts: CreateLayersOpts): CreateLayersAPI {
    const { map, panes, registerLayer, unregisterLayer, bringLayerToFront } =
      this.deps;
    const mainLayer = L.layerGroup();
    const graphLayer = opts.graphPane
      ? L.layerGroup([], { pane: opts.graphPane })
      : null;
    const labelLayer = opts.labelPane
      ? L.layerGroup([], { pane: opts.labelPane })
      : null;
    if (graphLayer) mainLayer.addLayer(graphLayer);
    if (labelLayer) mainLayer.addLayer(labelLayer);

    let registered = false;

    const layerOpts: RegisterLayerOpts = {
      name: opts.name,
      id: opts.id,
      isBase: false,
      layer: mainLayer,
      paneName: opts.graphPane || null,
      iconSvg: opts.iconSvg || null,
    };
    const register = () => {
      if (!registered) {
        registered = true;
        if (opts.labelPane) panes.labelPanes.add(opts.labelPane);
      }
      registerLayer(layerOpts);
    };

    const unregister = () => {
      if (!registered) return;
      const hasContent =
        (graphLayer && graphLayer.getLayers().length > 0) ||
        (labelLayer && labelLayer.getLayers().length > 0);
      if (!hasContent) {
        registered = false;
        unregisterLayer(opts.id);
      }
    };

    const origAddLayer = mainLayer.addLayer.bind(mainLayer);
    const origRemoveLayer = mainLayer.removeLayer.bind(mainLayer);

    mainLayer.addLayer = (layer: LabelAwareLayer) => {
      const isLabel = layer.isLabel;
      const target = isLabel ? labelLayer : graphLayer;
      if (target) {
        if (!map.hasLayer(mainLayer)) register();
        const paneName = isLabel ? opts.labelPane : opts.graphPane;
        layer.options.pane = paneName;
        if (layer instanceof L.Path) {
          const { renderer } = panes.ensurePane(opts.graphPane!);
          layer.options.renderer = renderer ?? undefined;
        } else if (paneName) panes.ensurePane(paneName, false);
        const result = target.addLayer(layer);
        panes.reset();
        return result;
      }
      return origAddLayer(layer);
    };

    mainLayer.removeLayer = (layer: LabelAwareLayer) => {
      if (graphLayer && graphLayer.hasLayer(layer)) {
        const result = graphLayer.removeLayer(layer);
        panes.reset();
        return result;
      }
      if (labelLayer && labelLayer.hasLayer(layer)) {
        const result = labelLayer.removeLayer(layer);
        panes.reset();
        return result;
      }
      return origRemoveLayer(layer);
    };

    mainLayer.clearLayers = () => {
      if (graphLayer) graphLayer.clearLayers();
      if (labelLayer) labelLayer.clearLayers();
      if (map.hasLayer(mainLayer)) map.removeLayer(mainLayer);
      unregister();
      return mainLayer;
    };

    const addLayer = (layer: LabelAwareLayer, isLabel?: boolean) => {
      if (isLabel) layer.isLabel = true;
      mainLayer.addLayer(layer);
      return layer;
    };
    const removeLayer = (...items: Array<L.Layer | null | undefined>) => {
      items.forEach(l => {
        if (l != null) mainLayer.removeLayer(l);
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
    const { map, panes, registerLayer, unregisterLayer, bringLayerToFront } =
      this.deps;
    if (!opts?.id)
      throw new Error(
        "[foliplus] LayerFactory: createCanvas requires an id",
      );

    const mapPane = map.getPanes().mapPane as HTMLElement;
    if (!mapPane)
      throw new Error(
        "[foliplus] LayerFactory: mapPane not available",
      );

    const canvas = dom.el("canvas", {
      class: "foliplus-heatmap-canvas",
      parent: mapPane,
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
      const pos = L.DomUtil.getPosition(mapPane);
      canvas.style.left = `${-pos.x}px`;
      canvas.style.top = `${-pos.y}px`;
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

    const onZIndex =
      opts.onZIndex ||
      ((z: number) => {
        canvas.style.zIndex = String(z);
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
      onToggle,
      onZIndex,
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

    const hooks = {
      before: [] as Array<() => void>,
      after: [] as Array<() => void>,
    };
    (canvas as CanvasWithHooks).hooks = hooks;

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
      },
      bringToFront: () => bringLayerToFront(opts.id),
      setZIndex: (z: number) => {
        canvas.style.zIndex = String(z);
      },
      setVisible: (v: boolean) => {
        canvas.classList.toggle(HIDDEN, !v);
      },
      hooks,
    };
  }
}

export { LayerFactory, type CreateLayersOpts, type CreateCanvasOpts };
