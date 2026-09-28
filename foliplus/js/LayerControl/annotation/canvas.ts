// LayerControl annotation canvas — paints one layer's labels.
//
// One canvas per labeled layer, mounted in that layer's own annotation pane
// (created here, z-ordered by LayerManager.enforceOrder), so labels take their
// layer's place in the stack: a layer above covers them, and they cover the
// layers below. Placement stays per layer — the manager plans each layer's
// labels separately, so collision never crosses layers — and this class only
// paints the slice it is handed.
import { setLayerAlpha, withCanvasLayerAlpha } from "#common/canvasAlpha.js";
import {
  type CanvasLabelStyle,
  drawCanvasLabel,
  prepareCanvasLabel,
  resolveCanvasLabelStyle,
} from "#common/canvasLabel.js";
import { cancelMapPaneTranslate } from "#common/dom.js";
import { type PlacedLabel } from "./layout.js";

/** One layer's label canvas. Painting is driven by the AnnotationManager, so
 *  there is nothing to schedule or listen for here. */
class AnnotationCanvas {
  private readonly map: L.Map;
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private cachedStyle: CanvasLabelStyle | null = null;
  /** Last plan handed to `paint`, so an opacity commit can repaint without
   *  going back through the layout. Empty until the first paint. */
  private lastPlanned: readonly PlacedLabel[] = [];

  constructor(map: L.Map, pane: HTMLElement) {
    this.map = map;
    this.container = map.getContainer();

    this.canvas = document.createElement("canvas");
    // `.foliplus-canvas-layer` declares this a decoration canvas — the pointer
    // events are handed down by the base `.foliplus-layer-pane` rule, no inline
    // style needed. Without it the pane's hit-test rule would turn this canvas
    // `auto`, swallowing every click over the map.
    this.canvas.className = "foliplus-annotation-canvas foliplus-canvas-layer";
    this.canvas.style.position = "absolute";
    this.canvas.style.inset = "0";
    pane.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    this.resize();
    this.updatePosition();
  }

  /** Paint this layer's slice of the plan; replaces the previous frame.
   *  `style` overlays runtime color/size on the shared --foliplus-label-* tokens. */
  paint(planned: readonly PlacedLabel[], style?: CanvasLabelStyle): void {
    this.lastPlanned = planned;
    this.resize();
    this.updatePosition();

    const ctx = this.ctx;
    const { clientWidth: w, clientHeight: h } = this.container;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const paint =
      style ?? (this.cachedStyle ??= resolveCanvasLabelStyle(this.container));
    // Layer alpha is baked into the labels (R11), not applied as pane CSS —
    // the vector data panes still take the CSS path, so both sides of a mixed
    // layer must end up at the same visual opacity.
    withCanvasLayerAlpha(ctx, () => {
      prepareCanvasLabel(ctx, paint);
      for (const label of planned) {
        drawCanvasLabel(
          ctx,
          label.text,
          label.box.x + label.box.w / 2,
          label.box.y + label.box.h / 2,
          paint,
        );
      }
    });
  }

  /** Hide the canvas while Leaflet's zoom animation runs — the pane's parent
   *  mapPane is CSS-transformed mid-zoom, which would smear the fixed-pixel
   *  labels. The manager redraws on zoomend. */
  setVisible(visible: boolean): void {
    this.canvas.style.visibility = visible ? "" : "hidden";
  }

  /** Store the layer opacity this canvas bakes into `paint`, and repaint the
   *  last plan so the change is visible without waiting for the next map
   *  event. R11: labels take the bake path, the pane CSS stays at 1. */
  setLayerAlpha(alpha: number): void {
    setLayerAlpha(this.canvas, alpha);
    // Re-paint the current plan: the manager re-sends `planned` on the next
    // map event anyway, but an opacity commit must land immediately.
    this.paint(this.lastPlanned, this.cachedStyle ?? undefined);
  }

  destroy(): void {
    this.canvas.remove();
  }

  /** Cancel the mapPane's pan translation so the canvas stays put in the
   *  container while its contents are drawn in container coordinates. */
  private updatePosition(): void {
    cancelMapPaneTranslate(this.canvas, this.map);
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
