() => {
  const ctrl = window.__layerCtrl;
  const map = ctrl.m.map;
  const api = map.foliplus.LayerAPI;
  const ui = ctrl.m.ui;

  const pointLayer = (id, name, lng) => {
    const geo = L.geoJson({
      type: "FeatureCollection",
      features: [0, 1].map(i => ({
        type: "Feature",
        properties: { name: "p" + i, value: i + 1 },
        geometry: { type: "Point", coordinates: [lng + i * 0.01, 26.08 + i * 0.01] },
      })),
    });
    api.registerLayer({ id, name, layer: geo });
    return geo;
  };

  // The pane a layer's content renders into, found from its own leaves.
  // Handles both LayerGroup (eachLayer) and single layers (_path/_icon).
  const paneOf = layer => {
    let pane = null;
    const leaves = [];
    if (layer.eachLayer) {
      layer.eachLayer(child => leaves.push(child));
    } else {
      leaves.push(layer);
    }
    for (const child of leaves) {
      let n = child._path || child._icon || null;
      while (n && !(n.classList && n.classList.contains("leaflet-pane"))) {
        n = n.parentElement;
      }
      if (n) pane = n;
    }
    return pane;
  };

  const leafOpacity = layer => {
    const vals = [];
    const each = layer.eachLayer
      ? (cb) => layer.eachLayer(cb)
      : (cb) => cb(layer);
    each(child => {
      if (child.options && typeof child.options.opacity === "number") {
        vals.push(child.options.opacity);
      }
    });
    return vals;
  };

  const sharedPane = el =>
    !!el &&
    /leaflet-(overlay|marker|tile|shadow|tooltip|popup)-pane/.test(el.className);

  const setOpacityViaSlider = id => {
    ui.openStylePanel(id);
    const range = document.querySelector(".foliplus-style-opacity-range");
    if (!range) {
      ui.closeStylePanel(false);
      return false;
    }
    range.value = "40";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    ui.closeStylePanel(false);
    return true;
  };

  // ── Case A: a plain folium layer, registered as-is ──────────────────
  const plain = pointLayer("op_plain", "Plain", 119.3);
  const plainNeighbour = pointLayer("op_plain_nb", "PlainNeighbour", 119.42);
  // Run the ordering pass now instead of waiting out its debounce: it is what
  // assigns each layer its own pane and migrates the content into it.
  ctrl.m.enforceOrder();
  const plainPane = paneOf(plain);
  const plainPaneBefore = plainPane ? plainPane.style.opacity : null;
  const plainOpened = setOpacityViaSlider("op_plain");
  const plainLi = api.layers.find(l => l.id === "op_plain");
  const plainNeighbourPane = paneOf(plainNeighbour);

  // ── Case B: a managed layer with its own panes (createLayers) ───────
  const managed = api.createLayers({
    id: "op_managed",
    name: "Managed",
    panes: [
      { name: "op-probe-graph" },
      { name: "op-probe-node" },
      { name: "op-probe-label", isLabel: true },
    ],
    styleSetters: { labelShow: () => {} },
    styleProvider: () => ({ labelShow: true }),
  });
  managed.register();
  managed.addLayer(
    L.polyline([
      [26.08, 119.5],
      [26.09, 119.51],
    ]),
    "op-probe-graph",
  );
  managed.addLayer(L.circleMarker([26.085, 119.505], { radius: 5 }), "op-probe-node");
  const managedOpened = setOpacityViaSlider("op_managed");
  const graphPaneEl = map.getPane("op-probe-graph");
  const nodePaneEl = map.getPane("op-probe-node");

  // ── Case C: a hollow polygon keeps its hole (multiplicative, not override) ──
  // Wrapped in GeoJSON with a property so the style panel opens (needs a
  // labelable field to render the label section, which hosts the opacity row).
  // style: { fillOpacity: 0 } makes it hollow — the pane CSS opacity must not
  // fill it back in (0 × 0.4 = 0, not 0.4).
  const hollowGeo = L.geoJson({
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { name: "hollow", value: 1 },
      geometry: {
        type: "Polygon",
        coordinates: [[[119.45, 26.07], [119.45, 26.08], [119.46, 26.08], [119.45, 26.07]]],
      },
    }],
  }, { style: { fillOpacity: 0, color: "#000", weight: 2 } });
  api.registerLayer({ id: "op_hollow", name: "Hollow", layer: hollowGeo });
  ctrl.m.enforceOrder();
  const hollowPane = paneOf(hollowGeo);
  setOpacityViaSlider("op_hollow");
  const hollowPaneAfter = hollowPane ? hollowPane.style.opacity : null;
  let hollowFillOpacity = null;
  hollowGeo.eachLayer(child => {
    if (child.options) hollowFillOpacity = child.options.fillOpacity;
  });

  // ── Case D: annotation pane follows the layer's opacity ─────────────
  // A data layer with labels on: the geometry pane and the annotation pane
  // must both carry the opacity. A neighbour layer's annotation pane is
  // unaffected (per-layer pane, not shared).
  const annotatedGeo = L.geoJson({
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { name: "annotated", value: 1 },
      geometry: {
        type: "Polygon",
        coordinates: [[[119.55, 26.10], [119.55, 26.11], [119.56, 26.11], [119.55, 26.10]]],
      },
    }],
  });
  api.registerLayer({ id: "op_annotated", name: "Annotated", layer: annotatedGeo });
  // A neighbour layer with its own annotation, so we can assert isolation.
  const neighbourGeo = L.geoJson({
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { name: "neighbour", value: 1 },
      geometry: {
        type: "Polygon",
        coordinates: [[[119.57, 26.10], [119.57, 26.11], [119.58, 26.11], [119.57, 26.10]]],
      },
    }],
  });
  api.registerLayer({ id: "op_annotated_nb", name: "AnnotatedNb", layer: neighbourGeo });
  ctrl.m.enforceOrder();

  // Enable labels on both layers.
  ctrl.m.annotation.setConfig("op_annotated", { ...ctrl.m.annotation.getConfig("op_annotated"), show: true });
  ctrl.m.annotation.renderLabels("op_annotated");
  ctrl.m.annotation.setConfig("op_annotated_nb", { ...ctrl.m.annotation.getConfig("op_annotated_nb"), show: true });
  ctrl.m.annotation.renderLabels("op_annotated_nb");

  const annotatedGeoPane = paneOf(annotatedGeo);
  const annotationPane = map.getPane("foliplus-annotation-op_annotated");
  const neighbourAnnotationPane = map.getPane("foliplus-annotation-op_annotated_nb");

  // Set opacity to 0.
  ui.openStylePanel("op_annotated");
  const rangeD = document.querySelector(".foliplus-style-opacity-range");
  if (rangeD) {
    rangeD.value = "0";
    rangeD.dispatchEvent(new Event("input", { bubbles: true }));
  }
  ui.closeStylePanel(false);

  return {
    error: null,
    // After the ordering pass a plain folium layer has its own pane too, so
    // the opacity is one write there — no per-feature sweep — and the
    // features keep the style they were created with.
    plainPaneShared: sharedPane(plainPane),
    plainPaneBefore,
    plainPaneAfter: plainPane ? plainPane.style.opacity : null,
    plainOpened,
    plainRegistryOpacity: plainLi ? plainLi.opacity : null,
    plainLeafOpacity: leafOpacity(plain),
    // Its neighbour is a different layer in a different pane, untouched.
    plainNeighbourSamePane: plainNeighbourPane === plainPane,
    plainNeighbourPaneOpacity: plainNeighbourPane
      ? plainNeighbourPane.style.opacity
      : null,
    plainNeighbourLeafOpacity: leafOpacity(plainNeighbour),
    // A managed layer owns its declared panes, so the opacity goes on the pane
    // element (one write per pane, no per-feature sweep).
    managedOpened,
    managedGraphPaneShared: sharedPane(graphPaneEl),
    managedGraphPaneOpacity: graphPaneEl ? graphPaneEl.style.opacity : null,
    managedNodePaneOpacity: nodePaneEl ? nodePaneEl.style.opacity : null,
    managedPolylineOpacity: (() => {
      let v = null;
      managed.mainLayer.eachLayer(g =>
        g.eachLayer(child => {
          if (child.options && child.options.pane === "op-probe-graph") {
            v = child.options.opacity;
          }
        }),
      );
      return v;
    })(),
    // A hollow polygon (fillOpacity: 0) keeps its hole: the pane's CSS opacity
    // is multiplicative at compositing time, not an override of the feature's
    // own style. 0 × 0.4 = 0, so the fill stays invisible.
    hollowPaneAfter,
    hollowFillOpacity,
    // Case D: annotation pane follows the layer's opacity. The geometry pane
    // and the annotation pane must both carry the opacity. A neighbour layer's
    // annotation pane is unaffected (per-layer pane, not shared).
    annotatedGeoPaneOpacity: annotatedGeoPane ? annotatedGeoPane.style.opacity : null,
    annotatedAnnotationPaneOpacity: annotationPane ? annotationPane.style.opacity : null,
    neighbourAnnotationPaneOpacity: neighbourAnnotationPane ? neighbourAnnotationPane.style.opacity : null,
    annotationPaneExists: !!annotationPane,
    neighbourAnnotationPaneExists: !!neighbourAnnotationPane,
  };
};
