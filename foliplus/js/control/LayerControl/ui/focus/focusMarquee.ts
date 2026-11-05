// Marching-ants bbox on geometry focus.
// A focused map path must not restyle its own stroke (lines would go dashed);
// draw a bounds marquee with the same look as the LayerControl focus rect
// instead: class `foliplus-focus-marquee` on an SVG path sized to the path bbox.
//
// NOTE: the class name MUST be distinct from `foliplus-focus-rect` (used by
// focus.ts for the focus overlay rectangle). Sharing the name would let
// clearMarquees's document-wide querySelectorAll remove the focus overlay's
// rect on every marquee redraw — a moveend-triggered silent DOM theft.
//
// The marquee rides in the geometry's own parent. In foliplus's layer panes
// the polygon paths are direct children of the pane's <svg> (not inside a <g>),
// so the marquee shares that <svg>'s coordinate space and rides the same
// viewBox transform across the map during a pan.
//
// Leaflet re-projects every path on `moveend` — pan, zoom, flyTo — which
// rewrites the geometry's `d` synchronously before the event fires. But the
// browser's SVG layout engine caches getBBox() and only refreshes it on the
// next frame, so a synchronous drawMarquee(target) on `moveend` reads a stale
// bbox and the marquee freezes at the pre-zoom position. The binder defers
// the redraw with requestAnimationFrame and coalesces rapid moveends (wheel
// zoom fires many in a row) into one rAF redraw.
//
// Corner rounding uses the shared roundedRectOutline (same math as focus.ts).
import { type RectCorners, roundedRectOutline } from "#common/marqueeShape.js";

const MARQUEE_PAD = 4;
const NS = "http://www.w3.org/2000/svg";
const MARQUEE_SEL = "path.foliplus-focus-marquee";

const clearMarquees = (root: ParentNode = document): void => {
  root.querySelectorAll(MARQUEE_SEL).forEach(n => n.remove());
};

const outlineToPath = (pts: { u: number; v: number }[]): string =>
  `${pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.u.toFixed(1)} ${p.v.toFixed(1)}`)
    .join(" ")} Z`;

const drawMarquee = (geometry: SVGGraphicsElement | null): void => {
  clearMarquees();
  // The geometry's own parent is the coordinate space its bbox lives in. A path
  // removed from the map mid-focus has no SVG ancestor either, so the marquee
  // is dropped instead of orphaned in the root.
  if (!geometry?.ownerSVGElement) return;
  const host = geometry.parentNode;
  if (!host) return;
  const box = geometry.getBBox();
  const corners: RectCorners = [
    { u: box.x - MARQUEE_PAD, v: box.y - MARQUEE_PAD },
    { u: box.x + box.width + MARQUEE_PAD, v: box.y - MARQUEE_PAD },
    { u: box.x + box.width + MARQUEE_PAD, v: box.y + box.height + MARQUEE_PAD },
    { u: box.x - MARQUEE_PAD, v: box.y + box.height + MARQUEE_PAD },
  ];
  const el = document.createElementNS(NS, "path");
  el.setAttribute("class", "foliplus-focus-marquee");
  el.setAttribute("d", outlineToPath(roundedRectOutline(corners)));
  // Sit above the geometry so the marquee reads as a selection frame.
  host.appendChild(el);
};

const isMapPath = (el: EventTarget | null): el is SVGGraphicsElement =>
  el instanceof Element &&
  el.tagName === "path" &&
  el.classList.contains("leaflet-interactive");

/** Bind focusin/focusout marquee on map paths under `root`. Returns unbind. */
const bindGeometryFocusMarquee = (root: HTMLElement, map: L.Map): (() => void) => {
  let target: SVGGraphicsElement | null = null;
  let rafId: number | null = null;

  const cancelPending = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const scheduleDraw = (): void => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      drawMarquee(target);
    });
  };

  const onFocusIn = (ev: FocusEvent): void => {
    const t = ev.target;
    if (isMapPath(t)) {
      target = t;
      // Cancel any pending rAF redraw — focusin already drew with the
      // current bbox, and a stale rAF would re-draw over it.
      cancelPending();
      drawMarquee(t);
    }
  };
  const onFocusOut = (ev: FocusEvent): void => {
    if (isMapPath(ev.target)) {
      target = null;
      cancelPending();
      drawMarquee(null);
    }
  };
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);
  map.on("moveend", scheduleDraw);
  return () => {
    map.off("moveend", scheduleDraw);
    root.removeEventListener("focusin", onFocusIn);
    root.removeEventListener("focusout", onFocusOut);
    cancelPending();
    target = null;
    drawMarquee(null);
  };
};

export { bindGeometryFocusMarquee };
