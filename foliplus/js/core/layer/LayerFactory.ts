// core/layer/LayerFactory — standalone createLayers/createCanvas factories.
// Pure logic, no CONF / translator dependency. Takes map + PaneManager +
// register/unregister callbacks via dependency injection.
import { withCanvasLayerAlpha } from "#common/canvasAlpha.js";
import { cancelMapPaneTranslate, dom } from "#common/dom.js";
import { createLogger } from "#common/log.js";
import { throttleRaf } from "#common/throttle.js";
import { PaneManager } from "./PaneManager.js";
import {
  CANVAS_PANE_PREFIX,
  COLOR_PANE_PREFIX,
  GROUP,
  HIDDEN,
  KIND,
  PANE_NAME_PATTERN,
} from "./const.js";
import type {
  CreateCanvasAPI,
  CreateCanvasOpts,
  CreateColorAPI,
  CreateColorOpts,
  CreateLayersAPI,
  CreateLayersOpts,
  CreateSurfaceOpts,
  LabelAwareLayer,
  PaneSpec,
  RegisterLayerOpts,
  SurfaceContentHandle,
  SurfaceHandle,
} from "./type.js";
import { zFor } from "./z.js";

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
  /**
   * The slot a layer occupies once `registerLayer` has placed it — what `zFor`
   * prices. Canvas and color surfaces mount their pane inside `register()` and
   * need its final z before the first paint, so the slot is asked for here
   * rather than assumed. Null when the id never joined a registry (the
   * lightweight LayerAPI has no ordering pass either): no slot exists to price.
   */
  slotOf?: (
    id: string,
  ) => { index: number; count: number; group: "base" | "overlay" } | null;
}

// core/layer is not a component dir, so CONF is unavailable here — the module
// prefixes with its own class name.
const log = createLogger("LayerFactory");

/** The pane a canvas or color surface paints into. `opts.id` is caller input
 *  and this name reaches Leaflet's `createPane` as both an element id and a
 *  CSS class, so it has to satisfy `PANE_NAME_PATTERN` first — the same gate
 *  `PaneSpec.name` and the declared `paneName` pass through. Such a pane
 *  cannot be dropped the way an invalid spec is (the content has to live
 *  somewhere), so disallowed runs collapse to `-` instead: the pane stays
 *  recognisable and the caller's own `id` is left untouched. */
const namedPaneNameFor = (id: string, prefix: string, label: string): string => {
  const raw = String(id);
  const safe = raw.replace(/[^a-zA-Z0-9_-]+/g, "-");
  if (safe !== raw) {
    log.warn(`${label} id normalized for injection safety: "${raw}" -> "${safe}"`);
  }
  return `${prefix}${safe}`;
};

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
      styleDefaultsProvider: opts.styleDefaultsProvider,
      metaProvider: opts.metaProvider,
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
      styleDefaultsProvider: opts.styleDefaultsProvider,
      onOpacity: opts.onOpacity,
      opacityBake: opts.opacityBake,
      content: {
        kind: "canvas",
        className: opts.className,
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

  createColor(opts: CreateColorOpts): CreateColorAPI {
    const handle = this.createSurface({
      id: opts.id,
      name: opts.name,
      onOpacity: opts.onOpacity,
      opacityBake: opts.opacityBake,
      content: { kind: "color", color: opts.color },
    });
    // register() is called by the caller (LayerControl UI) after setting
    // ui.colorSurface, to avoid a recursive call through applyProjection.
    return {
      element: handle.content.element,
      setColor: handle.content.setColor,
      setVisible: handle.content.setVisible,
      register: handle.register,
      unregister: handle.unregister,
      registered: handle.registered,
      bringToFront: handle.bringToFront,
      destroy: handle.destroy,
    };
  }

  createSurface(
    opts: CreateSurfaceOpts & { content: { kind: "layers" } },
  ): Extract<SurfaceHandle, { content: { kind: "layers" } }>;
  createSurface(
    opts: CreateSurfaceOpts & { content: { kind: "canvas" } },
  ): Extract<SurfaceHandle, { content: { kind: "canvas" } }>;
  createSurface(
    opts: CreateSurfaceOpts & { content: { kind: "color"; color: string } },
  ): Extract<SurfaceHandle, { content: { kind: "color" } }>;
  createSurface(
    opts: CreateSurfaceOpts & { content: { kind: "custom" } },
  ): Extract<SurfaceHandle, { content: { kind: "custom" } }>;
  createSurface(opts: CreateSurfaceOpts): SurfaceHandle {
    // Unreachable for typed callers (CreateSurfaceOpts.id is required); kept as a
    // guard for untyped JS callers that skip the overload.
    if (opts.content.kind === "canvas" && !opts.id) {
      throw new Error(log.msg("createCanvas requires an id"));
    }
    if (opts.content.kind === "color" && !opts.id) {
      throw new Error(log.msg("color surface requires an id"));
    }

    const { map, panes, registerLayer, unregisterLayer, bringLayerToFront } = this.deps;

    const commonLayerOpts = {
      id: opts.id,
      name: opts.name || opts.id,
      iconSvg: opts.iconSvg || null,
      featureCountProvider: opts.featureCountProvider ?? null,
      styleProvider: opts.styleProvider ?? null,
      styleSetters: opts.styleSetters ?? null,
      styleDefaultsProvider: opts.styleDefaultsProvider ?? null,
      metaProvider: opts.metaProvider ?? null,
      onOpacity: opts.onOpacity ?? null,
      opacityBake: opts.opacityBake,
    };

    let registered = false;
    let layerOpts: RegisterLayerOpts;
    let registerIdempotent = false;
    let preRegister: () => void = () => {};
    let postRegister: () => void = () => {};
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
      postRegister();
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

    // A canvas or color face paints into its own pane, which is born at register
    // time rather than at createSurface: only once registerLayer has placed the
    // layer does it have a slot, and the pane must carry that slot's z from the
    // moment it exists. Created earlier it would hold Leaflet's default z of
    // 400 — above every basemap — until the ordering pass caught up.
    let facePane: HTMLElement | null = null;
    const mountFace = (paneName: string, face: HTMLCanvasElement) => {
      facePane = panes.ensurePane(paneName, false).pane;
      facePane.appendChild(face);
    };
    const stampBirthZ = (id: string) => {
      const slot = this.deps.slotOf?.(id);
      if (slot && facePane) facePane.style.zIndex = String(zFor(slot));
    };

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
        kind: KIND.VECTOR,
        group: GROUP.OVERLAY,
        layer: mainLayer,
        paneName: basePaneName,
        paneSpecs,
      };
      if (paneSpecs.length) panes.registerPaneSpecs(paneSpecs);

      const directCount = (): number => mainLayer.getLayers().length - subLayers.size;

      mainLayer.addLayer = (layer: LabelAwareLayer) => {
        const declared = layer.options.pane;
        const requested =
          declared && paneNames.includes(declared) ? declared : basePaneName;
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

    if (opts.content.kind === "color") {
      const { color } = opts.content;
      const paneName = namedPaneNameFor(opts.id, COLOR_PANE_PREFIX, "color surface");

      // The face is built detached and mounted into its pane at register time
      // (`preRegister` below): a detached canvas takes sizing and paint exactly
      // like an attached one, so `resize()` runs here and the first mount is
      // already at container size.
      // A canvas face, reused rather than invented: a Leaflet pane has no size
      // of its own, so the fill must live on a child element that is sized to
      // the container and counter-translated against the map's pan, exactly the
      // plumbing `createCanvas` already owns (and `.foliplus-canvas-layer`
      // already styles). Drawing one pixel of it is not "canvas drawing" — it
      // keeps the fourth variant of viewport geometry from being born here.
      const face = dom.el("canvas", {
        class: "foliplus-canvas-layer",
      }) as HTMLCanvasElement;
      const ctx = face.getContext("2d");
      if (!ctx) throw new Error(log.msg("color surface requires a 2d context"));

      let fill = color;
      // R11: bake the layer opacity into the single fillRect. CSS opacity on
      // a full-viewport canvas forces a GPU composite buffer; the redraw is
      // one rect, so baking is free and keeps pixels honest. Callers that
      // want a redraw-on-commit pass `onOpacity`; when they do not, the
      // factory supplies `paint` itself so the bake still lands.
      const paint = () => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, face.width, face.height);
        withCanvasLayerAlpha(ctx, () => {
          ctx.fillStyle = fill;
          ctx.fillRect(0, 0, face.width, face.height);
        });
      };
      const setColor = (next: string) => {
        fill = next;
        paint();
      };

      const resize = () => {
        const container = map.getContainer();
        const dpr = window.devicePixelRatio || 1;
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (face.width !== w * dpr) face.width = w * dpr;
        if (face.height !== h * dpr) face.height = h * dpr;
        face.style.width = `${w}px`;
        face.style.height = `${h}px`;
        paint();
      };
      const updatePosition = () => cancelMapPaneTranslate(face, map);
      resize();
      updatePosition();
      setColor(color);

      const setVisible = (v: boolean) => {
        face.classList.toggle(HIDDEN, !v);
      };

      layerOpts = {
        ...commonLayerOpts,
        kind: KIND.SOLID,
        // Default the opacity redraw hook to the face's own paint so a
        // caller that only wants the fill still gets the bake live. Color
        // is a single fillRect — `"commit"` (bake + repaint on the slider
        // itself) is cheaper than keeping a CSS composite layer around.
        onOpacity: commonLayerOpts.onOpacity ?? paint,
        opacityBake: opts.opacityBake ?? "commit",
        group: GROUP.BASE,
        baseInsert: "bottom",
        canvas: face,
        color,
        paneName,
      };

      const onMove = throttleRaf(() => updatePosition());
      map.on("move", onMove);

      const onResize = () => resize();
      map.on("resize", onResize);

      registerIdempotent = true;
      preRegister = () => {
        mountFace(paneName, face);
        resize();
        updatePosition();
        setVisible(true);
      };
      postRegister = () => stampBirthZ(opts.id);
      preUnregister = () => setVisible(false);
      shouldUnregister = () => true;
      content = {
        kind: "color",
        element: face,
        get color() {
          return fill;
        },
        setColor,
        setVisible,
      };

      return {
        content,
        register,
        unregister,
        registered: () => registered,
        bringToFront,
        destroy: () => {
          map.off("move", onMove);
          map.off("resize", onResize);
          onMove.cancel();
          // Unconditional, not left to `preUnregister`: a caller that called
          // `setVisible(true)` without registering still left the shared tile
          // panes hidden, and unlike a `hidden` class on this face (which
          // detaches with it) that side effect lives on a pane that outlives
          // this surface.
          setVisible(false);
          unregister();
          face.remove();
          panes.removePane(paneName);
        },
      };
    }

    // Third-party carrier: shape first, door later. No synthesized pane;
    // register the opaque payload and an optional layer. Capability defaults
    // are the honest `none` (see deriveLayerKind / detectCapabilities).
    if (opts.content.kind === "custom") {
      const custom = opts.content.custom;
      const customLayer = opts.content.layer ?? null;
      layerOpts = {
        ...commonLayerOpts,
        kind: KIND.CUSTOM,
        custom,
        layer: customLayer,
      };
      registerIdempotent = true;
      content = { kind: "custom", custom, layer: customLayer };
      return {
        content,
        register,
        unregister,
        registered: () => registered,
        bringToFront,
      };
    }

    if (opts.content.kind !== "canvas") {
      throw new Error(
        log.msg(
          `unhandled surface kind: ${String((opts.content as { kind: string }).kind)}`,
        ),
      );
    }
    const { className, getBounds, source, updatedAt, meta } = opts.content;

    const paneName = namedPaneNameFor(opts.id, CANVAS_PANE_PREFIX, "createCanvas");

    // Detached until `preRegister` mounts it: the pane is created at register
    // time so it can be priced at its slot from birth (see `mountFace`).
    const canvas = dom.el("canvas", {
      class: "foliplus-canvas-layer",
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

    layerOpts = {
      ...commonLayerOpts,
      kind: KIND.CANVAS,
      canvas,
      paneName,
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
      mountFace(paneName, canvas);
      resize();
      updatePosition();
      canvas.classList.remove(HIDDEN);
    };
    postRegister = () => stampBirthZ(opts.id);
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
