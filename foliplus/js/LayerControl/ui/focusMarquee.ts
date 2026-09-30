// Marching-ants bbox on geometry focus (selection language B).
// A focused map path must not restyle its own stroke (lines would go dashed);
// instead draw a bounds marquee with the same look as the LayerControl focus
// rect: class `foliplus-focus-rect` on an SVG rect sized to the path's bbox.

const MARQUEE_PAD = 4;
const NS = "http://www.w3.org/2000/svg";

const marqueeFor = new WeakMap<Element, SVGElement>();

const clearMarquee = (path: Element): void => {
  const node = marqueeFor.get(path);
  if (node) {
    node.remove();
    marqueeFor.delete(path);
  }
};

const drawMarquee = (path: SVGGraphicsElement): void => {
  // Single-selection: drop any other marquee first.
  document.querySelectorAll("rect.foliplus-focus-rect").forEach(n => n.remove());
  marqueeFor.delete(path);
  const svg = path.ownerSVGElement;
  if (!svg) return;
  const box = path.getBBox();
  const rect = document.createElementNS(NS, "rect");
  rect.setAttribute("class", "foliplus-focus-rect");
  rect.setAttribute("x", String(box.x - MARQUEE_PAD));
  rect.setAttribute("y", String(box.y - MARQUEE_PAD));
  rect.setAttribute("width", String(box.width + MARQUEE_PAD * 2));
  rect.setAttribute("height", String(box.height + MARQUEE_PAD * 2));
  rect.setAttribute("rx", "4");
  rect.setAttribute("ry", "4");
  // Sit above the path so the marquee reads as a selection frame.
  svg.appendChild(rect);
  marqueeFor.set(path, rect);
};

const isMapPath = (el: EventTarget | null): el is SVGGraphicsElement =>
  el instanceof Element &&
  el.tagName === "path" &&
  el.classList.contains("leaflet-interactive");

/** Bind focusin/focusout marquee on every foliplus map pane under `root`. */
const bindGeometryFocusMarquee = (root: HTMLElement): (() => void) => {
  const onFocusIn = (ev: FocusEvent) => {
    const t = ev.target;
    if (!isMapPath(t)) return;
    drawMarquee(t);
  };
  const onFocusOut = (ev: FocusEvent) => {
    const t = ev.target;
    if (!isMapPath(t)) return;
    clearMarquee(t);
  };
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);
  return () => {
    root.removeEventListener("focusin", onFocusIn);
    root.removeEventListener("focusout", onFocusOut);
    root.querySelectorAll("rect.foliplus-focus-rect").forEach(n => n.remove());
  };
};

export { bindGeometryFocusMarquee };
