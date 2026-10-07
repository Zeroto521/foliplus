// Marching-ants bbox on geometry focus.
// A focused map path must not restyle its own stroke (lines would go dashed);
// draw a bounds marquee with the same look as the LayerControl focus rect
// instead: class `foliplus-focus-rect` on an SVG path sized to the path bbox.
// Corner rounding uses the shared roundedRectOutline (same math as focus.ts).
import { type RectCorners, roundedRectOutline } from "#common/marqueeShape.js";

const MARQUEE_PAD = 4;
const NS = "http://www.w3.org/2000/svg";
const MARQUEE_SEL = "path.foliplus-focus-rect";

const clearMarquees = (root: ParentNode = document): void => {
  root.querySelectorAll(MARQUEE_SEL).forEach(n => n.remove());
};

const outlineToPath = (pts: { u: number; v: number }[]): string =>
  pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.u.toFixed(1)} ${p.v.toFixed(1)}`)
    .join(" ") + " Z";

const drawMarquee = (path: SVGGraphicsElement): void => {
  clearMarquees();
  const svg = path.ownerSVGElement;
  if (!svg) return;
  const box = path.getBBox();
  const corners: RectCorners = [
    { u: box.x - MARQUEE_PAD, v: box.y - MARQUEE_PAD },
    { u: box.x + box.width + MARQUEE_PAD, v: box.y - MARQUEE_PAD },
    { u: box.x + box.width + MARQUEE_PAD, v: box.y + box.height + MARQUEE_PAD },
    { u: box.x - MARQUEE_PAD, v: box.y + box.height + MARQUEE_PAD },
  ];
  const el = document.createElementNS(NS, "path");
  el.setAttribute("class", "foliplus-focus-rect");
  el.setAttribute("d", outlineToPath(roundedRectOutline(corners)));
  // Sit above the path so the marquee reads as a selection frame.
  svg.appendChild(el);
};

const isMapPath = (el: EventTarget | null): el is SVGGraphicsElement =>
  el instanceof Element &&
  el.tagName === "path" &&
  el.classList.contains("leaflet-interactive");

/** Bind focusin/focusout marquee on map paths under `root`. Returns unbind. */
const bindGeometryFocusMarquee = (root: HTMLElement): (() => void) => {
  const onFocusIn = (ev: FocusEvent) => {
    const t = ev.target;
    if (isMapPath(t)) drawMarquee(t);
  };
  const onFocusOut = (ev: FocusEvent) => {
    const t = ev.target;
    if (isMapPath(t)) clearMarquees(root);
  };
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);
  return () => {
    root.removeEventListener("focusin", onFocusIn);
    root.removeEventListener("focusout", onFocusOut);
    clearMarquees(root);
  };
};

export { bindGeometryFocusMarquee };
