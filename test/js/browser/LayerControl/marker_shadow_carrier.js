async () => {
  const ctrl = window.__layerCtrl;
  if (!ctrl) return null;
  const map = ctrl.mgr.map;
  const api = map.foliplus.LayerAPI;

  const baseZoom = map.getZoom();
  const paneZ = () => {
    const out = {};
    for (const [n, p] of Object.entries(map._panes)) {
      out[n] = getComputedStyle(p).zIndex;
    }
    return out;
  };

  const mkPoint = (lat, lng, name, zIndexOffset) =>
    L.marker([lat, lng], { name, zIndexOffset: zIndexOffset || 0 });

  const mkGroup = (name, markers) => {
    const layer = L.layerGroup(markers);
    api.registerLayer({ id: `__${name}__`, name, layer });
  };

  // Scenario 1: three markers, one with negative zIndexOffset (the regime
  // where the icon's inline z-index goes negative near the viewport top).
  // The shadow lives in the layer's own shadow pane, one step below the
  // icon's pane — the pane ladder carries icon-over-shadow regardless of
  // the icons' inline z, and pane writes (opacity/focus) reach the shadow.
  const m0 = mkPoint(26.08, 119.3, "m0");
  const m1 = mkPoint(26.09, 119.31, "m1");
  const m2 = mkPoint(26.1, 119.32, "m2_neg", -100);
  mkGroup("scen1", [m0, m1, m2]);
  ctrl.mgr.enforceOrder();

  // Scenario 2: after enforceOrder, re-append one icon to its pane's tail so
  // its DOM order flips. The pane ladder must carry the ordering — the hit
  // test at the pin center still returns the icon even though the icon is
  // now DOM-last.
  const m1Icon = m1.getElement();
  if (m1Icon && m1Icon.parentElement) m1Icon.parentElement.appendChild(m1Icon);

  // Scenario 3 (feed red): move one shadow out of its shadow pane into the
  // icon's own pane, without z on either element. The carrier assertions in
  // the Python test read the shadow's pane and its z — co-paned, the pane
  // boundary no longer separates the two, which is exactly the condition the
  // main test refuses. This proves the main assertions are sensitive to the
  // pane split rather than passing by coincidence.
  const m3 = mkPoint(26.11, 119.33, "m3_red");
  mkGroup("scen3", [m3]);
  ctrl.mgr.enforceOrder();
  const m3Icon = m3.getElement();
  const m3Pane = m3Icon?.parentElement;
  if (m3Pane && m3._shadow) {
    m3Pane.appendChild(m3._shadow);
  }
  // NOTE: the feed-red state is captured further down, immediately after the
  // `stateOf` helper is defined and BEFORE any further registration runs.
  // A later registration fires layeradd, re-pins surfaces, and the pin
  // restores the shadow to its own shadow pane — the system healing the
  // manual pollution — so the capture must precede it.

  // Scenario 4: polygon overlay above markers at two fillOpacity levels.
  // Reports the shadow center elementFromPoint (should be the polygon, not
  // the shadow) plus the polygon's computed fillOpacity, so the architect
  // can decide whether "shadow is fully hidden" or "shadow bleeds through".
  // NOTE: m4 is at a distinct lat/lng from scen1's markers — overlap would
  // let elementFromPoint at one marker's center return the OTHER marker's
  // icon, masking the pane-boundary check. Registered after the static
  // states are sampled (see above).
  const m4 = mkPoint(26.12, 119.34, "m4");

  const mkPolygon = fillOpacity =>
    L.polygon(
      [
        [26.115, 119.33],
        [26.125, 119.33],
        [26.125, 119.35],
        [26.115, 119.35],
      ],
      { fillOpacity, stroke: false, color: "#000", fillColor: "#000" },
    );

  const waitZoom = () =>
    new Promise(resolve => {
      map.once("zoomend", resolve);
      setTimeout(resolve, 900);
    });

  const hit = (el, r) => {
    if (!el || !r) return null;
    const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!h) return null;
    // Compare by class, not identity: Leaflet may re-create the icon element
    // during a zoom repaint, leaving a stale reference in `m._icon` while
    // elementFromPoint returns the freshly-created sibling. Class match is
    // the semantic check — "is the pin center on top of A marker icon?"
    const cls =
      typeof h.className === "string"
        ? h.className
        : String(h.className.baseVal || h.className);
    if (cls.includes("leaflet-marker-icon")) return "icon";
    if (cls.includes("leaflet-marker-shadow")) return "shadow";
    if (cls.includes("leaflet-interactive") || cls.includes("leaflet-overlay-pane"))
      return "overlay";
    return `other:${cls}.${h.tagName.toLowerCase()}`;
  };

  const polyHit = () => {
    // Return the polygon path element if any is currently visible on top at
    // the shadow's location, else null. Used to confirm the polygon is
    // actually in the hit-test stack above the shadow.
    const el = m4._shadow && m4._shadow.getBoundingClientRect();
    if (!el) return null;
    const cx = el.left + el.width / 2;
    const cy = el.top + el.height / 2;
    let h = document.elementFromPoint(cx, cy);
    while (
      h &&
      !(
        h.classList &&
        (h.classList.contains("leaflet-interactive") ||
          h.classList.contains("leaflet-overlay-pane"))
      )
    ) {
      h = h.parentElement;
    }
    return h
      ? { tag: h.tagName, cls: String(h.className.baseVal ?? h.className) }
      : null;
  };

  const stateOf = (label, scenarioId, markers) => {
    const mlist = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    for (const m of markers) {
      const icon = m.getElement();
      const shadow = m._shadow;
      if (!icon || !shadow) continue;
      const iconR = icon.getBoundingClientRect();
      const shadowR = shadow.getBoundingClientRect();
      // Skip markers whose icon is fully outside the viewport — elementFromPoint
      // returns null for off-screen coordinates, which would mask real failures.
      const inView =
        iconR.top < vh && iconR.bottom > 0 && iconR.left < vw && iconR.right > 0;
      mlist.push({
        name: m.options.name,
        zIndexOffset: m.options.zIndexOffset,
        inView,
        iconParent: icon.parentElement?.className || null,
        shadowParent: shadow.parentElement?.className || null,
        iconZ: getComputedStyle(icon).zIndex,
        shadowZ: getComputedStyle(shadow).zIndex,
        iconParentZ: icon.parentElement
          ? getComputedStyle(icon.parentElement).zIndex
          : null,
        shadowParentZ: shadow.parentElement
          ? getComputedStyle(shadow.parentElement).zIndex
          : null,
        pinCenterHit: inView ? hit(icon, iconR) : "offscreen",
        shadowCenterHit: inView ? hit(shadow, shadowR) : "offscreen",
        iconRect: { l: iconR.left, t: iconR.top, w: iconR.width, h: iconR.height },
        shadowRect: {
          l: shadowR.left,
          t: shadowR.top,
          w: shadowR.width,
          h: shadowR.height,
        },
      });
    }
    return {
      label,
      scenarioId,
      zoom: map.getZoom(),
      markers: mlist,
      topPoly: scenarioId.startsWith("poly") ? polyHit() : null,
    };
  };

  const out = { paneZ: paneZ(), states: [] };

  out.states.push(stateOf("initial", "scen1", [m0, m1, m2]));
  out.states.push(stateOf("icon-moved-last", "scen2", [m1]));
  // Synchronously after the helper definitions, still before any further
  // registration: the co-paned shadow must still be observable here.
  out.states.push(stateOf("feed-red", "scen3", [m3]));

  // scen4 joins the map only now (see the note at its declaration): from
  // here on, re-pins own scen3's shadow again and the carrier invariant
  // holds for the zoom and polygon scenarios below.
  mkGroup("scen4", [m4]);
  ctrl.mgr.enforceOrder();

  // Zoom ladder: user's reported repro is "min → max → min", so cover it.
  map.setZoom(map.getMinZoom());
  await waitZoom();
  out.states.push(stateOf("zoom-min", "scen1", [m0, m1, m2]));

  map.setZoom(baseZoom + 4);
  await waitZoom();
  out.states.push(stateOf("zoom-max-ish", "scen1", [m0, m1, m2]));

  map.setZoom(baseZoom);
  await waitZoom();

  // Polygon overlay scenarios.
  const polyOp08 = mkPolygon(0.8);
  api.registerLayer({ id: "__poly_op08__", name: "PolyOp08", layer: polyOp08 });
  ctrl.mgr.enforceOrder();
  await waitZoom();
  out.states.push(stateOf("poly-fillOpacity-0.8", "poly_op08", [m4]));
  polyOp08.remove();
  ctrl.mgr.enforceOrder();
  await waitZoom();

  const polyOp02 = mkPolygon(0.2);
  api.registerLayer({ id: "__poly_op02__", name: "PolyOp02", layer: polyOp02 });
  ctrl.mgr.enforceOrder();
  await waitZoom();
  out.states.push(stateOf("poly-fillOpacity-0.2", "poly_op02", [m4]));
  polyOp02.remove();
  ctrl.mgr.enforceOrder();
  await waitZoom();

  out.paneZ = paneZ();
  return out;
};
