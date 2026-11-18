// Probes the MAIN LayerControl panel's corner (top-left .leaflet-top)
// against the real bottom-left ScaleControl, in a cross-corner overlap.
//
// Leaflet creates the four corner divs as equal z-index siblings (1000), so
// painting falls to DOM order: a later-created bottom corner covers a top
// corner's tall panel. The fix raises the corner hosting a foliplus fold
// control to --foliplus-z-index-control-corner (1001) via reset.css, which
// breaks that tie in our favour.
//
// The panel's expanded state also gets a JS inline raise (adjustPanelZIndex ->
// floating + 9), which would mask the CSS rule. So the probe clears the JS
// inline on the corner (the CSS-only path) before measuring: this proves the
// CSS token, not the JS raise, is what clears the scale's corner.
() => {
  const ctrl = document.querySelector(".foliplus-layer-ctrl");
  if (!ctrl) return { ok: false, reason: "ctrl-missing" };
  const corner = ctrl.closest(".leaflet-top, .leaflet-bottom");
  if (!corner) return { ok: false, reason: "corner-missing" };
  const scale = document.querySelector(".foliplus-scale-wrap");
  if (!scale) return { ok: false, reason: "scale-missing" };

  // Read the token and the Leaflet default before touching anything.
  const token = getComputedStyle(document.documentElement)
    .getPropertyValue("--foliplus-z-index-control-corner")
    .trim();

  // CSS-only path: drop the JS inline raise so the CSS corner rule is what
  // paints. Restore it afterwards so the test leaves no side effects.
  const jsInline = corner.style.zIndex;
  corner.style.zIndex = "";

  const pr = ctrl.getBoundingClientRect();
  const sr = scale.getBoundingClientRect();
  const overlap =
    pr.right > sr.left &&
    pr.left < sr.right &&
    pr.bottom > sr.top &&
    pr.top < sr.bottom;

  let hit, hitIsPanel, hitIsScale, cx, cy;
  if (overlap) {
    cx = Math.max(pr.left, sr.left) + 10;
    cy = Math.max(pr.top, sr.top) + 10;
    hit = document.elementFromPoint(cx, cy);
    hitIsPanel = hit ? !!hit.closest(".foliplus-layer-ctrl") : false;
    hitIsScale = hit ? !!hit.closest(".foliplus-scale-wrap") : false;
  }

  // Read the computed z-index while the JS inline is cleared: this is the
  // CSS-only paint order. Restore the inline afterwards.
  const cornerZ = getComputedStyle(corner).zIndex;
  corner.style.zIndex = jsInline;

  return {
    ok: true,
    token,
    cornerZ,
    cornerCls: corner.className,
    jsInlineCleared: jsInline === "" ? "none" : jsInline,
    overlap,
    cx,
    cy,
    hit: hit ? hit.className || hit.tagName : null,
    hitIsPanel,
    hitIsScale,
    panelRect: {
      l: Math.round(pr.left),
      t: Math.round(pr.top),
      r: Math.round(pr.right),
      b: Math.round(pr.bottom),
    },
    scaleRect: {
      l: Math.round(sr.left),
      t: Math.round(sr.top),
      r: Math.round(sr.right),
      b: Math.round(sr.bottom),
    },
  };
};
