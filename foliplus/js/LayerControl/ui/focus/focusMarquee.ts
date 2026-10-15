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
// The marquee rides in the geometry's own group (the renderer's root group,
// not the SVG root) so Leaflet's viewBox transform carries it across the map
// during a pan. Leaflet re-projects every path on `moveend` — pan, zoom,
// flyTo — which rewrites the geometry's `d` and orphans a frozen bbox, so the
// binder re-derives the marquee from the live bbox on that event.
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
  pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.u.toFixed(1)} ${p.v.toFixed(1)}`)
    .join(" ") + " Z";

const drawMarquee = (geometry: SVGGraphicsElement | null): void => {
  clearMarquees();
  // The geometry's own group is the coordinate space its bbox lives in. A path
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

  const onFocusIn = (ev: FocusEvent): void => {
    const t = ev.target;
    if (isMapPath(t)) {
      target = t;
      drawMarquee(t);
    }
  };
  const onFocusOut = (ev: FocusEvent): void => {
    if (isMapPath(ev.target)) {
      target = null;
      drawMarquee(null);
    }
  };
  // Rederive after every view change; a no-op while no geometry is focused.
  const onMoveEnd = (): void => {
    drawMarquee(target);
  };
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);
  map.on("moveend", onMoveEnd);
  return () => {
    map.off("moveend", onMoveEnd);
    root.removeEventListener("focusin", onFocusIn);
    root.removeEventListener("focusout", onFocusOut);
    target = null;
    drawMarquee(null);
  };
};

export { bindGeometryFocusMarquee };
