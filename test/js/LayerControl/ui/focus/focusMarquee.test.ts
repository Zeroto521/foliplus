import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bindGeometryFocusMarquee } from "#foliplus/LayerControl/ui/focus/index.js";

const NS = "http://www.w3.org/2000/svg";

/** Stub the bbox jsdom does not implement, so the marquee math runs for real. */
const stubBBox = (
  path: SVGGraphicsElement,
  box: { x: number; y: number; width: number; height: number },
): void => {
  (path as unknown as { getBBox: () => DOMRect }).getBBox = () =>
    ({ ...box }) as DOMRect;
};

/**
 * A Leaflet-style geometry: the `<path>` lives inside the renderer's root
 * `<g>` — the group `bindGeometryFocusMarquee` must append the marquee to,
 * because the viewBox transform rides on that group, not on the path.
 */
const makeSvgPath = (): {
  path: SVGPathElement;
  svg: SVGSVGElement;
  group: SVGGElement;
} => {
  const svg = document.createElementNS(NS, "svg");
  const group = document.createElementNS(NS, "g");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", "M0 0 L10 0 L10 10 Z");
  path.setAttribute("class", "leaflet-interactive");
  stubBBox(path, { x: 0, y: 0, width: 10, height: 10 });
  group.appendChild(path);
  svg.appendChild(group);
  return { path, svg, group };
};

const makeMap = (): { map: L.Map; fire: (type: string) => void } => {
  const handlers = new Map<string, Array<() => void>>();
  return {
    map: {
      on: (type: string, fn: () => void) => {
        if (!handlers.has(type)) handlers.set(type, []);
        handlers.get(type)!.push(fn);
      },
      off: (type: string, fn: () => void) => {
        const list = handlers.get(type);
        if (!list) return;
        const idx = list.indexOf(fn);
        if (idx >= 0) list.splice(idx, 1);
      },
    } as L.Map,
    fire: (type: string) =>
      handlers
        .get(type)
        ?.slice()
        .forEach(fn => fn()),
  };
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
    const { path, group } = makeSvgPath();
    root.appendChild(group.ownerSVGElement!);
    const { map } = makeMap();
    const unbind = bindGeometryFocusMarquee(root, map);

    path.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    const marquee = group.querySelector("path.foliplus-focus-rect");
    expect(marquee).not.toBeNull();
    // 4 corners × (2 tangents + 2 bezier mids) = 16 outline points.
    const d = marquee!.getAttribute("d")!;
    expect((d.match(/L/g) ?? []).length).toBe(15); // 15 L + 1 M, closed with Z

    path.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(group.querySelector("path.foliplus-focus-rect")).toBeNull();
    unbind();
  });

  it("appends the marquee to the geometry's own group, not the SVG root", () => {
    const { path, svg, group } = makeSvgPath();
    root.appendChild(svg);
    const { map } = makeMap();
    const unbind = bindGeometryFocusMarquee(root, map);

    path.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(group.contains(document.querySelector("path.foliplus-focus-rect"))).toBe(
      true,
    );
    // A direct child of the SVG root would sit outside the projection group.
    expect(
      [...svg.children].some(
        n => (n as Element).getAttribute("class") === "foliplus-focus-rect",
      ),
    ).toBe(false);
    unbind();
  });

  it("ignores non-path targets and non-interactive paths", () => {
    const { path, group } = makeSvgPath();
    path.classList.remove("leaflet-interactive");
    root.appendChild(group.ownerSVGElement!);
    const { map } = makeMap();
    const unbind = bindGeometryFocusMarquee(root, map);

    path.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    root.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(group.querySelector("path.foliplus-focus-rect")).toBeNull();
    unbind();
  });

  it("replaces the marquee when focus moves to another path", () => {
    const a = makeSvgPath();
    const b = makeSvgPath();
    root.appendChild(a.svg);
    root.appendChild(b.svg);
    const { map } = makeMap();
    const unbind = bindGeometryFocusMarquee(root, map);

    a.path.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    b.path.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    // B's marquee is the only one left (A's was cleared on the new draw).
    const rects = document.querySelectorAll("path.foliplus-focus-rect");
    expect(rects.length).toBe(1);
    expect(b.group.contains(rects[0])).toBe(true);
    unbind();
  });

  it("redraws the marquee from the live bbox on map moveend", async () => {
    const { path, group } = makeSvgPath();
    root.appendChild(group.ownerSVGElement!);
    const { map, fire } = makeMap();
    const unbind = bindGeometryFocusMarquee(root, map);

    path.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    const stale = group.querySelector("path.foliplus-focus-rect")!.getAttribute("d")!;

    // Leaflet re-projects every path on moveend (pan, zoom, flyTo), rewriting
    // the geometry's bbox in pixel space. The binder defers the redraw with
    // requestAnimationFrame because the browser's SVG bbox cache only refreshes
    // on the next frame — a synchronous drawMarquee reads a stale bbox.
    stubBBox(path, { x: 20, y: 20, width: 40, height: 40 });
    fire("moveend");

    // Wait for the rAF-deferred redraw to run.
    await new Promise(r => requestAnimationFrame(r));

    const live = group.querySelector("path.foliplus-focus-rect")!.getAttribute("d")!;
    expect(live).not.toBe(stale);
    // New bbox left edge is 20 - MARQUEE_PAD = 16; the stale one was -4.
    expect(live).toContain("16.0");
    expect(stale).not.toContain("16.0");
    expect(document.querySelectorAll("path.foliplus-focus-rect").length).toBe(1);
    unbind();
  });

  it("drops the marquee when the focused path leaves the map", async () => {
    const { path, svg } = makeSvgPath();
    root.appendChild(svg);
    const { map, fire } = makeMap();
    const unbind = bindGeometryFocusMarquee(root, map);

    path.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(document.querySelectorAll("path.foliplus-focus-rect").length).toBe(1);

    svg.remove(); // layer removed from the map
    fire("moveend");
    // The redraw is deferred to rAF (see the moveend test above); wait for
    // it to clear the orphaned marquee.
    await new Promise(r => requestAnimationFrame(r));
    expect(document.querySelectorAll("path.foliplus-focus-rect").length).toBe(0);
    unbind();
  });

  it("focusout cancels a pending rAF redraw", async () => {
    const { path, svg } = makeSvgPath();
    root.appendChild(svg);
    const { map, fire } = makeMap();
    const unbind = bindGeometryFocusMarquee(root, map);

    path.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(document.querySelectorAll("path.foliplus-focus-rect").length).toBe(1);

    fire("moveend"); // schedules rAF, rafId set
    // Focusout cancels the pending rAF (cancelPending → cancelAnimationFrame)
    path.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(document.querySelectorAll("path.foliplus-focus-rect").length).toBe(0);

    // Await rAF to confirm the cancelled rAF did not redraw the marquee.
    await new Promise(r => requestAnimationFrame(r));
    expect(document.querySelectorAll("path.foliplus-focus-rect").length).toBe(0);
    unbind();
  });

  it("coalesces rapid moveends into one rAF redraw", async () => {
    const { path, group } = makeSvgPath();
    root.appendChild(group.ownerSVGElement!);
    const { map, fire } = makeMap();
    const unbind = bindGeometryFocusMarquee(root, map);

    path.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    const first = group.querySelector("path.foliplus-focus-rect")!.getAttribute("d")!;

    // First moveend schedules rAF (rafId set).
    stubBBox(path, { x: 10, y: 10, width: 20, height: 20 });
    fire("moveend");
    // Second moveend must be coalesced (rafId already set → early return).
    stubBBox(path, { x: 30, y: 30, width: 40, height: 40 });
    fire("moveend");

    await new Promise(r => requestAnimationFrame(r));

    // Marquee reflects the SECOND bbox (the latest), not the first.
    const live = group.querySelector("path.foliplus-focus-rect")!.getAttribute("d")!;
    expect(live).toContain("26.0"); // 30 - MARQUEE_PAD = 26
    expect(live).not.toBe(first);
    unbind();
  });

  it("focusout on a non-path target does not throw", () => {
    const { map } = makeMap();
    const unbind = bindGeometryFocusMarquee(root, map);
    root.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    unbind();
  });

  it("focusing a path without an owner SVG is a safe no-op", () => {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("class", "leaflet-interactive");
    stubBBox(path, { x: 0, y: 0, width: 10, height: 10 });
    // In the DOM under root, but not inside any <svg> → ownerSVGElement null.
    root.appendChild(path);
    const { map } = makeMap();
    const unbind = bindGeometryFocusMarquee(root, map);
    path.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(document.querySelectorAll("path.foliplus-focus-rect")).toHaveLength(0);
    unbind();
  });

  it("unbind removes listeners and any leftover marquee", () => {
    const { path, svg } = makeSvgPath();
    root.appendChild(svg);
    const { map, fire } = makeMap();
    const unbind = bindGeometryFocusMarquee(root, map);

    path.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    unbind();
    expect(document.querySelectorAll("path.foliplus-focus-rect")).toHaveLength(0);

    // After unbind, focusin must not draw again.
    path.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(document.querySelectorAll("path.foliplus-focus-rect")).toHaveLength(0);
    // And the map listener must be gone with it.
    fire("moveend");
    expect(document.querySelectorAll("path.foliplus-focus-rect")).toHaveLength(0);
  });
});
