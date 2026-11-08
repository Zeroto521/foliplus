// Generic-filter browser assertion: applying a committed filter to a real
// layer must hide every element the layer paints through - the path (Polygon /
// Polyline / CircleMarker), the marker icon AND its drop shadow, a DivIcon
// marker's element, and the leaves of a LayerGroup (the carrier's eachLayer
// recursion). This is the guardrail for the '.foliplus-feature-filtered {
// display: none; }' rule without !important: a rule that needs !important to
// win over a Leaflet inline style would leave one of these computed displays
// non-none. Each probe layer is filtered to a range that excludes every leaf's
// value (all leaves carry value 1, the committed range is [2, 5]).
async fixtures => {
  const ctrl = window.__layerCtrl;
  if (!ctrl) return null;
  const mgr = ctrl.mgr;
  const api = window.map && window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api || !mgr.ui || !mgr.ui.runtimeStore) return null;
  const layerCore =
    window.foliplus && window.foliplus.core && window.foliplus.core.layer;
  const visibleDomOf =
    layerCore && layerCore.visibleDomOf ? layerCore.visibleDomOf : null;

  const mk = (leaf, value) => {
    leaf.feature = { properties: { value } };
    return leaf;
  };
  const probes = [
    ["__flt_poly__", "Fl Poly", mk(L.polygon(fixtures.poly), 1)],
    ["__flt_line__", "Fl Line", mk(L.polyline(fixtures.line), 1)],
    [
      "__flt_circle__",
      "Fl Circle",
      mk(L.circleMarker([26.08, 119.3], { radius: 10 }), 1),
    ],
    ["__flt_marker__", "Fl Marker", mk(L.marker([26.08, 119.3]), 1)],
    [
      "__flt_div__",
      "Fl Div",
      mk(
        L.marker([26.1, 119.3], {
          icon: L.divIcon({ className: "my-div", html: "<b>x</b>" }),
        }),
        1,
      ),
    ],
    ["__flt_group__", "Fl Group", L.layerGroup([mk(L.polygon(fixtures.groupPoly), 1)])],
  ];

  const walk = (node, out) => {
    if (typeof node.eachLayer === "function") node.eachLayer(c => walk(c, out));
    else out.push(node);
  };
  const filter = { kind: "atom", field: "value", op: "between", range: [2, 5] };
  const out = [];

  for (const [id, name, layer] of probes) {
    api.registerLayer({ id, name, layer });
    // findLayer resolves a registered layer through the per-map window global
    // folium declares (Reflect.get(window, id)); declare it so the layeradd
    // replay (findLayer + L.stamp match) can resolve this probe.
    window[id] = layer;
    const leaves = [];
    walk(layer, leaves);
    const features = {
      features: leaves.map(l => ({ leaf: l, fields: { value: 1 } })),
      total: leaves.length,
      numericFields: ["value"],
      ranges: { value: [1, 1] },
      enumFields: [],
      enumValues: {},
    };
    mgr.ui.runtimeStore.setFilterFeatures(id, features);
    mgr.setLayerFilter(id, filter);
    const elements = [];
    for (const leaf of leaves) {
      const elems = visibleDomOf
        ? visibleDomOf(leaf)
        : leaf.getElement
          ? [leaf.getElement()]
          : [];
      elements.push({
        type: leaf.constructor ? leaf.constructor.name : null,
        displays: elems.map(e => (e ? getComputedStyle(e).display : null)),
        classed: elems.map(e =>
          e ? e.classList.contains("foliplus-feature-filtered") : null,
        ),
      });
    }
    // Late-binding replay: re-adding the layer fires layeradd, which the
    // controller answers by re-applying the committed filter (findLayer loop +
    // replayFilter). The class must survive the replay for the assertion.
    let replay = null;
    try {
      mgr.map.removeLayer(layer);
      mgr.map.addLayer(layer);
      replay = leaves.map(leaf => {
        const elems = visibleDomOf
          ? visibleDomOf(leaf)
          : leaf.getElement
            ? [leaf.getElement()]
            : [];
        return elems.map(e => (e ? getComputedStyle(e).display : null));
      });
    } catch (err) {
      replay = { error: String(err) };
    }
    out.push({ id, name, elements, replay });
    api.unregisterLayer(id);
    delete window[id];
  }
  return { out, hasVisibleDomOf: Boolean(visibleDomOf) };
};
