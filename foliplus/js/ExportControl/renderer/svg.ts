// SVG pane rendering: serialise, inline computed props, load as an image,
// and draw under the pane's effective opacity.
// Moved from renderer.ts — renderPaneSVG.
import * as CONST from "../const.js";
import { loadImage } from "../util.js";
import { type RenderCtx, effectiveOpacity, withAlpha } from "./util.js";

/** Render SVG content from a single pane. */
const renderPaneSVG = async (
  container: HTMLElement,
  rc: RenderCtx,
  pane: HTMLElement,
): Promise<void> => {
  const { ctx, rect, scale, contRect, sw, sh } = rc;
  const props = [
    "fill",
    "stroke",
    "stroke-width",
    "stroke-dasharray",
    "stroke-linecap",
    "stroke-linejoin",
    "opacity",
    "fill-opacity",
    "stroke-opacity",
    "visibility",
    "display",
  ];
  for (const svgEl of pane.querySelectorAll("svg")) {
    const svgG = svgEl.querySelector("g");
    const hasContent =
      (svgG && svgG.children.length > 0) ||
      svgEl.querySelector("path, polygon, polyline, circle, rect, ellipse, line, text");
    if (!hasContent) continue;

    const svgRect = svgEl.getBoundingClientRect();
    const svgL = svgRect.left - contRect.left;
    const svgT = svgRect.top - contRect.top;
    if (svgRect.width < 1 || svgRect.height < 1) continue;

    // A pane's own `visibility` is a transient view state — focus hides every
    // non-focused pane with one CSS rule — and the export has to ignore it, or
    // a focused export silently drops every vector.  A child's own
    // `visibility` is content and must be honoured.  The trouble is that
    // `visibility` inherits, so a computed read returns the ancestor
    // contribution dressed up as the child's own.  Flipping the pane's inline
    // value neutralises just that: inline style beats focus.css's author
    // rule, while a child's own value lives on the child and survives.
    // `visibility` does not affect layout, so this is no reflow.
    //
    // The flip has to close before the first `await`.  Everything above is
    // synchronous — getComputedStyle, cloneNode, the prop write, XMLSerializer
    // — and the loads below are network-bound, so restoring here gives the
    // browser no paint opportunity in between.  Saving the flip for the end
    // of render() would leave every layer un-hidden for the whole tile
    // download.
    const savedVisibility = pane.style.visibility;
    pane.style.visibility = "visible";
    let src = "";
    try {
      const clone = svgEl.cloneNode(true) as SVGElement;
      clone.removeAttribute("style");
      clone.setAttribute("width", String(svgRect.width));
      clone.setAttribute("height", String(svgRect.height));

      const allEls = clone.querySelectorAll("*");
      const originals = svgEl.querySelectorAll("*");

      // Three exclusion mechanisms operate at different stages:
      // 1. data-foliplus-export="exclude" / .foliplus-no-export — declarative,
      //    checked below via SKIP_EXPORT after all props are set (clone prune).
      // 2. computed display:"none" — derived from the live DOM's computed
      //    style, checked per-element in this loop. The <img>
      //    pipeline ignores inline display, so removal is the only reliable
      //    exclusion. Kept separate from SKIP_EXPORT: different data source
      //    (getComputedStyle vs querySelectorAll) and different semantics
      //    (layout-driven hiding vs explicit opt-out).
      for (let i = 0; i < allEls.length && i < originals.length; i++) {
        const cs = window.getComputedStyle(originals[i]);
        // An element whose own computed display is "none" must not appear in
        // the export — the pipeline serialises to an <img>, which ignores
        // inline display, so the only reliable exclusion is removal.
        if (cs.getPropertyValue("display") === "none") {
          (allEls[i] as Element).remove();
          continue;
        }
        const inline = allEls[i] as HTMLElement;
        for (const p of props) {
          const v = cs.getPropertyValue(p);
          if (!v) continue;
          // fill: none and stroke: none mean "unpainted", and the standalone
          // clone carries no stylesheet to express that — skipping them
          // leaves the default black fill, so those skips stay.
          if (v === "none") continue;
          if (p === "fill" && v === "rgb(0, 0, 0)") continue;
          inline.style.setProperty(p, v);
        }
      }

      // Content a component opted out of — prune the clone, never the live
      // DOM, since the map still needs the preview while drawing continues.
      clone.querySelectorAll(CONST.SEL.SKIP_EXPORT).forEach(n => n.remove());

      src = new XMLSerializer().serializeToString(clone);
    } finally {
      pane.style.visibility = savedVisibility;
    }

    if (!src.includes(`xmlns="${CONST.SVG_NS}"`)) {
      src = src.replace("<svg", `<svg xmlns="${CONST.SVG_NS}"`);
    }
    if (src.length < 100) continue;

    const blob = new Blob([src], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      const svgImg = await loadImage(url);
      withAlpha(ctx, effectiveOpacity(container, pane), () => {
        ctx.drawImage(
          svgImg as HTMLImageElement,
          rect.left - svgL,
          rect.top - svgT,
          rect.width,
          rect.height,
          0,
          0,
          sw,
          sh,
        );
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
};

export { renderPaneSVG };
