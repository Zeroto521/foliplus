// R1 pane-surface probe harness (test-only, never shipped).
//
// Measures the four §10.3 facts for one layer after a forced enforceOrder:
//   1. where the content actually lives (pane names, shared or not)
//   2. whether CSS opacity written to that pane reaches the content
//   3. whether DOM created at runtime inherits the same pane
//   4. whether the layer's native setter is effective immediately
//
// Driver: window.__probe = {
//   id:        "<registry id>"     resolve via window.__layerCtrl.m.layers
//   layerVar:  "<global var name>" alternative when the layer is not registered
//   build:     "<tag>"             construct an unregistered layer in-page
//   add:       "<tag>"             runtime mutation to apply before fact 3
//   native:    "<tag>"             native setter to exercise for fact 4
// }
() => {
  const spec = window.__probe;
  delete window.__probe;
  const map = window.map;
  const ctrl = window.__layerCtrl;
  if (!map || !ctrl) return { error: "map or __layerCtrl missing" };
  const m = ctrl.m;

  const SHARED = new Set([
    "mapPane",
    "tilePane",
    "overlayPane",
    "shadowPane",
    "markerPane",
    "tooltipPane",
    "popupPane",
  ]);

  const paneNameOf = el => {
    let n = el;
    while (n && !(n.classList && n.classList.contains("leaflet-pane"))) {
      n = n.parentElement;
    }
    if (!n) return null;
    for (const [name, paneEl] of Object.entries(map._panes)) {
      if (paneEl === n) return name;
    }
    return null;
  };

  const effOpacity = el => {
    let v = 1;
    let n = el;
    while (n && n !== document.documentElement) {
      v *= parseFloat(getComputedStyle(n).opacity || "1");
      n = n.parentElement;
    }
    return v;
  };

  const leafElements = l => {
    const out = [];
    const walk = node => {
      if (typeof node.eachLayer === "function") {
        node.eachLayer(walk);
        return;
      }
      const el = typeof node.getElement === "function" ? node.getElement() : null;
      if (el) out.push({ el, node });
    };
    walk(l);
    return out;
  };

  // ── layer resolution ────────────────────────────────────────────
  let li = null;
  let layer = null;
  if (spec.id) {
    li = m.layers.find(l => l.id === spec.id) || null;
    if (li) layer = m.findLayer(li);
  } else if (spec.layerVar) {
    layer = window[spec.layerVar] || null;
  }
  if (spec.build === "featuregroup") {
    layer = L.featureGroup([
      L.polygon([
        [26.05, 119.25],
        [26.09, 119.25],
        [26.07, 119.3],
      ]),
      L.marker([26.08, 119.28]),
    ]);
    layer.addTo(map);
  }
  if (!layer) return { error: "layer not resolvable", spec };

  // Pitfall #1 from the design review: enforceOrder is debounced; the
  // fallback-pane assignment and content migration only land when it runs.
  m.enforceOrder();
  const settle = () => m.enforceOrder();

  // ── fact 1: pane homes ──────────────────────────────────────────
  const homes = leafElements(layer).map(({ el }) => {
    const name = paneNameOf(el);
    return {
      tag: el.tagName,
      pane: name,
      shared: name != null && SHARED.has(name),
    };
  });
  const homesUniq = [];
  for (const h of homes) {
    if (!homesUniq.some(x => x.pane === h.pane && x.tag === h.tag)) homesUniq.push(h);
  }

  // ── fact 2: CSS opacity on the content's pane ───────────────────
  let css = { tested: false };
  const rep = leafElements(layer)[0];
  if (rep && rep.el) {
    const paneName = paneNameOf(rep.el);
    const paneEl = paneName ? map.getPane(paneName) : null;
    if (paneEl) {
      const before = effOpacity(rep.el);
      paneEl.style.opacity = "0.4";
      const after = effOpacity(rep.el);
      paneEl.style.opacity = "";
      css = {
        tested: true,
        pane: paneName,
        shared: SHARED.has(paneName),
        effBefore: +before.toFixed(3),
        effAfter: +after.toFixed(3),
        reached: Math.abs(after - 0.4) < 0.02,
      };
    }
  }

  // ── fact 3: runtime-created DOM ─────────────────────────────────
  const ADD_OPS = {
    "geojson-addpoint": l => {
      const f = {
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [119.34, 26.11] },
      };
      l.addData(f);
      return l.getLayers().at(-1);
    },
    "cluster-addmarker": l => {
      const mk = L.marker([26.16, 119.2]);
      l.addLayer(mk);
      return mk;
    },
    "group-addmarker": l => {
      const mk = L.marker([26.15, 119.22]);
      l.addLayer(mk);
      return mk;
    },
    "tile-seturl": l => {
      l.setUrl("https://tile.openstreetmap.org/{z}/{x}/{y}.png", false);
      return l;
    },
    "heat-noop": l => l,
  };
  let runtime = { tested: false };
  if (spec.add && ADD_OPS[spec.add]) {
    const added = ADD_OPS[spec.add](layer);
    settle();
    const els = leafElements(added);
    if (els.length > 0) {
      const el = els[0].el;
      const paneName = paneNameOf(el);
      const paneEl = paneName ? map.getPane(paneName) : null;
      let reached = false;
      if (paneEl) {
        paneEl.style.opacity = "0.4";
        reached = Math.abs(effOpacity(el) - 0.4) < 0.02;
        paneEl.style.opacity = "";
      }
      runtime = {
        tested: true,
        pane: paneName,
        shared: paneName != null && SHARED.has(paneName),
        tag: el.tagName,
        reached,
      };
    }
  }

  // ── fact 4: native setter immediacy ─────────────────────────────
  const firstPathEl = l => {
    let el = null;
    const walk = n => {
      if (el) return;
      if (typeof n.eachLayer === "function") {
        n.eachLayer(walk);
        return;
      }
      if (n instanceof L.Path && typeof n.getElement === "function") {
        el = n.getElement();
      }
    };
    walk(l);
    return el;
  };
  const NATIVE_OPS = {
    "marker-setopacity": l => {
      const el = typeof l.getElement === "function" ? l.getElement() : null;
      if (!el) return { error: "no element" };
      l.setOpacity(0.4);
      return { eff: effOpacity(el) };
    },
    "path-setstyle": l => {
      l.setStyle({ opacity: 0.4, fillOpacity: 0.4 });
      const el = firstPathEl(l);
      return { el: !!el, attr: el ? el.getAttribute("stroke-opacity") : null };
    },
    "tile-setopacity": l => {
      l.setOpacity(0.4);
      return { eff: effOpacity(l._container) };
    },
    "img-setopacity": l => {
      l.setOpacity(0.4);
      return { eff: effOpacity(l._image) };
    },
    "tile-minzoom": l => {
      // Zoom is 12; raising minZoom above it must only apply after the
      // level bookkeeping is refreshed (GridLayer._updateLevels).
      const container = l._container || l;
      const levelUpdate = () => {
        if (typeof l._updateLevels === "function") l._updateLevels();
        else l.redraw();
      };
      const tilesBefore = container.querySelectorAll("img").length;
      l.options.minZoom = 13;
      const tilesAfterSet = container.querySelectorAll("img").length;
      levelUpdate();
      l.redraw();
      const tilesAfterLevel = container.querySelectorAll("img").length;
      l.options.minZoom = 0;
      levelUpdate();
      l.redraw();
      return { tilesBefore, tilesAfterSet, tilesAfterLevel };
    },
  };
  let native = { tested: false };
  if (spec.native && NATIVE_OPS[spec.native]) {
    native = { tested: true, ...NATIVE_OPS[spec.native](layer) };
  }

  return { homes: homesUniq, css, runtime, native };
};
