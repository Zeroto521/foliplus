// Probes the row panel's stacking against a sibling corner control.
//
// The panel must clear the Leaflet control band (z-index 800) whether it is
// pinned (fixed) or unpinned (absolute). A synthetic .leaflet-control sibling
// is placed over a point inside the panel, and elementFromPoint must hit the
// panel — not the synthetic control — in both states. Also reports the panel's
// computed z-index and the token it is supposed to read.
() => {
  const panel = document.querySelector(".foliplus-layer-style-panel");
  if (!panel) return { ok: false, reason: "panel-missing" };
  const section = panel.closest(".leaflet-top") || panel.closest(".leaflet-bottom");
  if (!section) return { ok: false, reason: "section-missing" };

  const token = getComputedStyle(document.documentElement)
    .getPropertyValue("--foliplus-z-index-floating")
    .trim();

  const probePoint = cy => {
    const pr = panel.getBoundingClientRect();
    // Keep the probe on-screen; the top-left region is inside the scroll clip.
    const cx = pr.left + 30;
    const y = Math.min(Math.max(cy, 2), window.innerHeight - 2);
    const sib = document.createElement("div");
    sib.className = "leaflet-control foliplus-scale-wrap";
    sib.style.cssText =
      "position:absolute;top:" +
      (y - 10) +
      "px;left:" +
      (cx - 10) +
      "px;width:100px;height:20px;z-index:800;";
    section.appendChild(sib);
    const hit = document.elementFromPoint(cx, y);
    const cs = getComputedStyle(panel);
    const r = {
      panelPos: cs.position,
      panelZ: cs.zIndex,
      topZ: getComputedStyle(section).zIndex,
      hit: hit ? hit.className || hit.tagName : null,
      hitIsPanel: hit ? !!hit.closest(".foliplus-layer-style-panel") : false,
      hitIsScale: hit ? !!hit.closest(".foliplus-scale-wrap") : false,
      cx,
      cy: y,
    };
    sib.remove();
    return r;
  };

  const pinned = probePoint(panel.getBoundingClientRect().top + 30);
  const wasPinned = panel.classList.contains("foliplus-is-pinned");
  panel.classList.remove("foliplus-is-pinned");
  const unpinned = probePoint(panel.getBoundingClientRect().top + 30);
  if (wasPinned) panel.classList.add("foliplus-is-pinned");

  return { ok: true, token, pinned, unpinned, wasPinned };
};
