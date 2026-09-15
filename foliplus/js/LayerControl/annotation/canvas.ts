// LayerControl annotation canvas — draws per-feature labels on one canvas.
//
// Replaces the per-feature L.marker + divIcon nodes: one element, no DOM per
// label, and — being a canvas — labels never intercept clicks, so features keep
// their own hit-testing and whatever popup/tooltip the author bound keeps
// working. Drawing is the shared canvas-label recipe (common/canvasLabel), the
// same one the heatmap's hex values use, so an annotation label and a hex value
// read as one language.
import { EVENTS, ensureEvents } from "#core/event/index.js";
import {
  type CanvasLabelStyle,
  drawCanvasLabel,
  prepareCanvasLabel,
  resolveCanvasLabelStyle,
} from "#common/canvasLabel.js";
import { throttleRaf } from "#common/throttle.js";
import { ANNOTATION_PANE } from "../const.js";
import {
  type LabelCandidate,
  type LabelSpec,
  type PlacedLabel,
  planLabelLayout,
} from "./layout.js";

/** One label to draw, described by its feature rather than by pixels — the
 *  canvas converts the latlng to container pixels on every draw, so a pan does
 *  not leave stale coordinates behind. */
interface LayerLabel {
  id: string;
  text: string;
  latlng: L.LatLng;
  atPoint: boolean;
  priority: number;
}

/** One canvas overlay per map, owned by the AnnotationManager. */
class AnnotationCanvas {
  private readonly map: L.Map;
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly labelsByLayer = new Map<string, LayerLabel[]>();
  private readonly scheduleDraw: (() => void) & { cancel: () => void };
  private readonly unsubscribe: Array<() => void> = [];
  /** Bound map handlers, kept so destroy() can unbind them. */
  private readonly onMapChange: () => void;
  private readonly onResize: () => void;
  private readonly onZoomStart: () => void;
  private readonly onZoomEnd: () => void;
  /** Whether a layer's labels should draw right now. The canvas is a passive
   *  overlay — labels are not children of their source layer — so a hidden
   *  layer (removed from the map) must drop out of the draw, exactly as the
   *  DOM labels did by riding the layer's detach/attach. */
  private readonly isLayerOnMap: (layerId: string) => boolean;
  /** Typography resolved from the --label-* tokens, cached like the heatmap's
   *  label style: re-reading six CSS variables per throttled frame is pure
   *  overhead, and the tokens only change with the theme. */
  private cachedSpec: LabelSpec | null = null;
  private cachedStyle: CanvasLabelStyle | null = null;

  constructor(map: L.Map, isLayerOnMap: (layerId: string) => boolean) {
    this.map = map;
    this.container = map.getContainer();
    this.isLayerOnMap = isLayerOnMap;

    this.canvas = document.createElement("canvas");
    this.canvas.className = "foliplus-annotation-canvas";
    this.canvas.style.position = "absolute";
    this.canvas.style.inset = "0";
    // The labels are not interactive: clicks land on the feature beneath.
    this.canvas.style.pointerEvents = "none";
    // The dedicated label pane (LayerManager.enforceOrder z-orders it above
    // every data pane, below markers/tooltips). Created here as a fallback so
    // the canvas has a home even if a label renders before the first enforce.
    const pane = map.getPane(ANNOTATION_PANE) ?? map.createPane(ANNOTATION_PANE);
    pane.classList.add("foliplus-annotation-pane");
    pane.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    this.resize();
    this.updatePosition();

    // Redraw throttled during pan/zoom, exactly once afterwards. Leaflet pans
    // by translating `mapPane`, and this canvas lives inside it — so the draw
    // must first cancel that translation (updatePosition), or the labels get
    // the pan twice: once from the inherited transform and once from the new
    // container coordinates, and drift off their features.
    this.scheduleDraw = throttleRaf(() => {
      this.updatePosition();
      this.draw();
    });
    // layeradd/layerremove is how LayerControl hides and shows a layer
    // (map.removeLayer/addLayer), so those redraw too — the draw re-reads
    // membership and a hidden layer's labels drop out.
    this.onMapChange = () => this.scheduleDraw();
    this.onResize = () => {
      this.resize();
      this.draw();
    };
    // Leaflet animates a zoom by CSS-transforming every zoom-animated layer;
    // this canvas is not one, so it would sit still through the transition and
    // then jump to the new positions. Hide it for the duration (the heatmap
    // does the same) and redraw on the far side.
    this.onZoomStart = () => {
      this.canvas.style.visibility = "hidden";
    };
    this.onZoomEnd = () => {
      this.canvas.style.visibility = "";
      this.scheduleDraw();
    };
    this.map.on("resize", this.onResize);
    this.map.on("zoomstart", this.onZoomStart);
    this.map.on("zoomend", this.onZoomEnd);
    this.map.on("move zoom moveend layeradd layerremove", this.onMapChange);

    // Export safety: the exporter renders this same container, so culling by
    // the live container box cannot lose labels — the *real* risk would be
    // culling by a stale view while the exporter changed it. The export events
    // exist so this canvas redraws with the new view before the capture.
    const events = ensureEvents(map);
    this.unsubscribe.push(
      events.on(EVENTS.BEFORE_EXPORT, () => this.scheduleDraw()),
      events.on(EVENTS.AFTER_EXPORT, () => this.scheduleDraw()),
    );
  }

  /** Give the canvas a layer's labels; replaces the previous set. */
  setLayerLabels(layerId: string, labels: LayerLabel[]): void {
    this.labelsByLayer.set(layerId, labels);
    this.scheduleDraw();
  }

  removeLayerLabels(layerId: string): void {
    if (this.labelsByLayer.delete(layerId)) this.scheduleDraw();
  }

  destroy(): void {
    this.scheduleDraw.cancel();
    this.map.off("resize", this.onResize);
    this.map.off("zoomstart", this.onZoomStart);
    this.map.off("zoomend", this.onZoomEnd);
    this.map.off("move zoom moveend layeradd layerremove", this.onMapChange);
    this.unsubscribe.forEach(off => off());
    this.unsubscribe.length = 0;
    this.canvas.remove();
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const { clientWidth: w, clientHeight: h } = this.container;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  /** Cancel the mapPane's pan translation so the canvas stays put in the
   *  container while its contents are redrawn in container coordinates — the
   *  same trick HeatmapControl's canvas uses (see core/layer/LayerFactory). */
  private updatePosition(): void {
    const mapPane = this.map.getPanes().mapPane;
    if (!mapPane) return;
    const pos = L.DomUtil.getPosition(mapPane);
    this.canvas.style.left = `${-pos.x}px`;
    this.canvas.style.top = `${-pos.y}px`;
  }

  private spec(): LabelSpec {
    if (this.cachedSpec) return this.cachedSpec;
    // Derived from the same style the draw uses, so the box that layout plans
    // and the text that gets painted can never disagree on the font.
    const s = this.style();
    this.cachedSpec = {
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      haloWidth: s.haloWidth,
      pointOffsetY: 10,
      shapeOffsetY: 0,
    };
    return this.cachedSpec;
  }

  private style(): CanvasLabelStyle {
    return (this.cachedStyle ??= resolveCanvasLabelStyle(this.container));
  }

  private draw(): void {
    const ctx = this.ctx;
    const { clientWidth: w, clientHeight: h } = this.container;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const all: Array<LabelCandidate> = [...this.labelsByLayer.entries()]
      .filter(([layerId]) => this.isLayerOnMap(layerId))
      .flatMap(([, labels]) => labels)
      .map(label => ({
        id: label.id,
        text: label.text,
        atPoint: label.atPoint,
        priority: label.priority,
        anchor: this.map.latLngToContainerPoint(label.latlng),
      }));
    if (all.length === 0) return;

    const spec = this.spec();
    // The viewport is the live container box: "on screen" for this container,
    // which is also the extent any render of it captures. Culling and collision
    // are one plan (see core/labelCollision).
    const planned = planLabelLayout(all, spec, { x: 0, y: 0, w, h });

    this.drawPlanned(planned);
  }

  private drawPlanned(planned: PlacedLabel[]): void {
    const ctx = this.ctx;
    // The same resolver and drawer the heatmap's hex labels use — an annotation
    // label and a hex value over the same feature are one recipe (common/
    // canvasLabel reads the shared --label-* tokens for both).
    const style = this.style();
    prepareCanvasLabel(ctx, style);

    for (const label of planned) {
      const cx = label.box.x + label.box.w / 2;
      const cy = label.box.y + label.box.h / 2;
      drawCanvasLabel(ctx, label.text, cx, cy, style);
    }
  }
}

export { AnnotationCanvas, type LayerLabel };
