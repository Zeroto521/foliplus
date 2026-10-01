// Marching-ants bbox on geometry focus.
// A focused map path must not restyle its own stroke (lines would go dashed);
// draw a bounds marquee with the same look as the LayerControl focus rect
// instead: class `foliplus-focus-rect` on an SVG rect sized to the path bbox.

const MARQUEE_PAD = 4;
const MARQUEE_RX = 8;
const NS = "http://www.w3.org/2000/svg";
const SEL = "rect.foliplus-focus-rect";

const clearMarquees = (root: ParentNode = document): void => {
  root.querySelectorAll(SEL).forEach(n => n.remove());
};

const drawMarquee = (path: SVGGraphicsElement): void => {
  clearMarquees();
  const svg = path.ownerSVGElement;
  if (!svg) return;
  const box = path.getBBox();
  const rect = document.createElementNS(NS, "rect");
  rect.setAttribute("class", "foliplus-focus-rect");
  rect.setAttribute("x", String(box.x - MARQUEE_PAD));
  rect.setAttribute("y", String(box.y - MARQUEE_PAD));
  rect.setAttribute("width", String(box.width + MARQUEE_PAD * 2));
  rect.setAttribute("height", String(box.height + MARQUEE_PAD * 2));
  rect.setAttribute("rx", String(MARQUEE_RX));
  rect.setAttribute("ry", String(MARQUEE_RX));
  // Sit above the path so the marquee reads as a selection frame.
  svg.appendChild(rect);
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
