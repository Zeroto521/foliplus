// LayerControl annotation canvas — paints one layer's labels.
//
// One canvas per labelled layer, mounted in that layer's own annotation pane
// (created here, z-ordered by LayerManager.enforceOrder), so labels take their
// layer's place in the stack: a layer above covers them, and they cover the
// layers below. Placement stays per layer — the manager plans each layer's
// labels separately, so collision never crosses layers — and this class only
// paints the slice it is handed.
import {
  type CanvasLabelStyle,
  drawCanvasLabel,
  prepareCanvasLabel,
  resolveCanvasLabelStyle,
} from "#common/canvasLabel.js";
import { type PlacedLabel } from "./layout.js";

/** One layer's label canvas. Painting is driven by the AnnotationManager, so
 *  there is nothing to schedule or listen for here. */
class AnnotationCanvas {
  private readonly map: L.Map;
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private cachedStyle: CanvasLabelStyle | null = null;

  constructor(map: L.Map, pane: HTMLElement) {
    this.map = map;
    this.container = map.getContainer();

    this.canvas = document.createElement("canvas");
    this.canvas.className = "foliplus-annotation-canvas";
    this.canvas.style.position = "absolute";
    this.canvas.style.inset = "0";
    // The labels are not interactive: clicks land on the feature beneath.
    this.canvas.style.pointerEvents = "none";
    pane.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    this.resize();
    this.updatePosition();
  }

  /** Paint this layer's slice of the plan; replaces the previous frame. */
  paint(planned: readonly PlacedLabel[]): void {
    this.resize();
    this.updatePosition();

    const ctx = this.ctx;
    const { clientWidth: w, clientHeight: h } = this.container;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const style = (this.cachedStyle ??= resolveCanvasLabelStyle(this.container));
    prepareCanvasLabel(ctx, style);
    for (const label of planned) {
      drawCanvasLabel(
        ctx,
        label.text,
        label.box.x + label.box.w / 2,
        label.box.y + label.box.h / 2,
        style,
      );
    }
  }

  /** Hide the canvas while Leaflet's zoom animation runs — the pane's parent
   *  mapPane is CSS-transformed mid-zoom, which would smear the fixed-pixel
   *  labels. The manager redraws on zoomend. */
  setVisible(visible: boolean): void {
    this.canvas.style.visibility = visible ? "" : "hidden";
  }

  destroy(): void {
    this.canvas.remove();
  }

  /** Cancel the mapPane's pan translation so the canvas stays put in the
   *  container while its contents are drawn in container coordinates — the
   *  same trick HeatmapControl's canvas uses (see core/layer/LayerFactory). */
  private updatePosition(): void {
    const mapPane = this.map.getPanes().mapPane;
    if (!mapPane) return;
    const pos = L.DomUtil.getPosition(mapPane);
    this.canvas.style.left = `${-pos.x}px`;
    this.canvas.style.top = `${-pos.y}px`;
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const { clientWidth: w, clientHeight: h } = this.container;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }
}

export { AnnotationCanvas };
