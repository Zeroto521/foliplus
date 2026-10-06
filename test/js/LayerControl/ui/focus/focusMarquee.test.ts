import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bindGeometryFocusMarquee } from "#foliplus/LayerControl/ui/focus/index.js";

const NS = "http://www.w3.org/2000/svg";

const makeSvgPath = (): SVGPathElement => {
  const svg = document.createElementNS(NS, "svg");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", "M0 0 L10 0 L10 10 Z");
  path.setAttribute("class", "leaflet-interactive");
  svg.appendChild(path);
  document.body.appendChild(svg);
  // jsdom has no getBBox — stub a stable box.
  (path as unknown as { getBBox: () => DOMRect }).getBBox = () =>
    ({ x: 0, y: 0, width: 10, height: 10 }) as DOMRect;
  return path;
};

describe("bindGeometryFocusMarquee", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
    document.body.innerHTML = "";
  });

  it("draws a rounded marquee path on focusin and removes it on focusout", () => {
    const path = makeSvgPath();
    root.appendChild(path.ownerSVGElement!);
    const unbind = bindGeometryFocusMarquee(root);

    path.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    const marquee = path.ownerSVGElement!.querySelector("path.foliplus-focus-rect");
    expect(marquee).not.toBeNull();
    // 4 corners × (2 tangents + 2 bezier mids) = 16 outline points.
    const d = marquee!.getAttribute("d")!;
    expect((d.match(/L/g) ?? []).length).toBe(15); // 15 L + 1 M, closed with Z

    path.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(path.ownerSVGElement!.querySelector("path.foliplus-focus-rect")).toBeNull();
    unbind();
  });

  it("ignores non-path targets and non-interactive paths", () => {
    const path = makeSvgPath();
    path.classList.remove("leaflet-interactive");
    root.appendChild(path.ownerSVGElement!);
    const unbind = bindGeometryFocusMarquee(root);

    path.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    root.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(path.ownerSVGElement!.querySelector("path.foliplus-focus-rect")).toBeNull();
    unbind();
  });

  it("replaces the marquee when focus moves to another path", () => {
    const a = makeSvgPath();
    const b = makeSvgPath();
    root.appendChild(a.ownerSVGElement!);
    root.appendChild(b.ownerSVGElement!);
    const unbind = bindGeometryFocusMarquee(root);

    a.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    b.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    // B's marquee is the only one left (A's was cleared on the new draw).
    const rects = document.querySelectorAll("path.foliplus-focus-rect");
    expect(rects.length).toBe(1);
    unbind();
  });

  it("focusout on a non-path target does not throw", () => {
    const unbind = bindGeometryFocusMarquee(root);
    root.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    unbind();
  });

  it("focusing a path without an owner SVG is a safe no-op", () => {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("class", "leaflet-interactive");
    (path as unknown as { getBBox: () => DOMRect }).getBBox = () =>
      ({ x: 0, y: 0, width: 10, height: 10 }) as DOMRect;
    // In the DOM under root, but not inside any <svg> → ownerSVGElement null.
    root.appendChild(path);
    const unbind = bindGeometryFocusMarquee(root);
    path.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(document.querySelectorAll("path.foliplus-focus-rect")).toHaveLength(0);
    unbind();
  });

  it("unbind removes listeners and any leftover marquee", () => {
    const path = makeSvgPath();
    root.appendChild(path.ownerSVGElement!);
    const unbind = bindGeometryFocusMarquee(root);

    path.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    unbind();
    expect(document.querySelectorAll("path.foliplus-focus-rect")).toHaveLength(0);

    // After unbind, focusin must not draw again.
    path.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(document.querySelectorAll("path.foliplus-focus-rect")).toHaveLength(0);
  });
});
