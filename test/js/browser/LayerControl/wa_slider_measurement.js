async () => {
  const ctrl = window.__layerCtrl;
  const map = ctrl.mgr.map;
  const ui = ctrl.mgr.ui;
  const api = map.foliplus.LayerAPI;

  const geo = L.geoJson({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "p1" },
        geometry: { type: "Point", coordinates: [119.3, 26.08] },
      },
    ],
  });
  api.registerLayer({ id: "wa_measure", name: "WaMeasure", layer: geo });
  ctrl.mgr.enforceOrder();

  ui.openStylePanel("wa_measure");
  const panel = document.querySelector(".foliplus-layer-style-panel");
  if (!panel) {
    ui.closeStylePanel(false);
    return { error: "style panel not rendered" };
  }

  const results = {};

  // ── Opacity row ──
  const opacityRow = panel.querySelector(".foliplus-style-opacity-track");
  if (opacityRow) {
    const slider = opacityRow.querySelector("wa-slider");
    if (slider) {
      await slider.updateComplete;
      const shadow = slider.shadowRoot;
      if (shadow) {
        const cs = el => {
          const s = window.getComputedStyle(el);
          const pick = p => s.getPropertyValue(p).trim();
          return pick;
        };

        // 1. Track: does ::part(track) override the shadow's border?
        const track = shadow.querySelector('[part="track"]');
        if (track) {
          const trackCs = cs(track);
          results.opacityTrack = {
            height: trackCs("height"),
            border: trackCs("border"),
            "border-width": trackCs("border-width"),
            "border-style": trackCs("border-style"),
            "border-color": trackCs("border-color"),
            background: trackCs("background-color"),
            "border-radius": trackCs("border-radius"),
            boxSizing: trackCs("box-sizing"),
          };
        }

        // 2. Thumb: hover state
        const thumb = shadow.querySelector('[part="thumb"]');
        if (thumb) {
          const thumbCs = cs(thumb);
          results.opacityThumb = {
            width: thumbCs("width"),
            height: thumbCs("height"),
            "border-radius": thumbCs("border-radius"),
            background: thumbCs("background-image"),
            "background-clip": thumbCs("background-clip"),
            "box-sizing": thumbCs("box-sizing"),
            padding: thumbCs("padding"),
            transform: thumbCs("transform"),
            boxShadow: thumbCs("box-shadow"),
            cursor: thumbCs("cursor"),
          };
        }

        // 3. Indicator
        const indicator = shadow.querySelector('[part="indicator"]');
        if (indicator) {
          const indCs = cs(indicator);
          results.opacityIndicator = {
            background: indCs("background-color"),
            "border-radius": indCs("border-radius"),
          };
        }

        // 4. Tooltip
        const tooltip = shadow.querySelector('[part="tooltip__tooltip"]');
        if (tooltip) {
          const tipCs = cs(tooltip);
          results.opacityTooltip = {
            background: tipCs("background-color"),
            color: tipCs("color"),
            "border-radius": tipCs("border-radius"),
            "font-size": tipCs("font-size"),
          };
        }

        // 5. Markers (end dots) — library hides first/last by default
        const markers = shadow.querySelectorAll('[part="marker"]');
        results.opacityMarkers = [];
        for (const m of markers) {
          const mCs = cs(m);
          results.opacityMarkers.push({
            display: mCs("display"),
            background: mCs("background-color"),
            width: mCs("width"),
            height: mCs("height"),
          });
        }

        // 6. Host CSS vars
        const hostCs = window.getComputedStyle(slider);
        results.opacityHostVars = {
          "--track-size": hostCs.getPropertyValue("--track-size").trim(),
          "--thumb-width": hostCs.getPropertyValue("--thumb-width").trim(),
          "--thumb-height": hostCs.getPropertyValue("--thumb-height").trim(),
          "--marker-width": hostCs.getPropertyValue("--marker-width").trim(),
          "--marker-height": hostCs.getPropertyValue("--marker-height").trim(),
        };
      }
    }
  }

  // ── Zoom-range row ──
  const zoomRow = panel.querySelector(".foliplus-style-zoom-range-row");
  if (zoomRow) {
    const slider = zoomRow.querySelector("wa-slider");
    if (slider) {
      await slider.updateComplete;
      const shadow = slider.shadowRoot;
      if (shadow) {
        const cs = el => {
          const s = window.getComputedStyle(el);
          const pick = p => s.getPropertyValue(p).trim();
          return pick;
        };

        // 1. Track
        const track = shadow.querySelector('[part="track"]');
        if (track) {
          const trackCs = cs(track);
          results.zoomTrack = {
            height: trackCs("height"),
            border: trackCs("border"),
            "border-width": trackCs("border-width"),
            "border-color": trackCs("border-color"),
            background: trackCs("background-color"),
            "border-radius": trackCs("border-radius"),
          };
        }

        // 2. Thumb (first one = min thumb)
        const thumbs = shadow.querySelectorAll('[part="thumb"]');
        results.zoomThumbs = [];
        for (const t of thumbs) {
          const tCs = cs(t);
          results.zoomThumbs.push({
            width: tCs("width"),
            height: tCs("height"),
            "border-radius": tCs("border-radius"),
            background: tCs("background-image"),
            "background-clip": tCs("background-clip"),
            "box-sizing": tCs("box-sizing"),
            padding: tCs("padding"),
          });
        }

        // 3. Markers
        const markers = shadow.querySelectorAll('[part="marker"]');
        results.zoomMarkers = [];
        for (const m of markers) {
          const mCs = cs(m);
          results.zoomMarkers.push({
            display: mCs("display"),
            background: mCs("background-color"),
            width: mCs("width"),
            height: mCs("height"),
            opacity: mCs("opacity"),
          });
        }

        // 4. Tooltip
        const tooltip = shadow.querySelector('[part="tooltip__tooltip"]');
        if (tooltip) {
          const tipCs = cs(tooltip);
          results.zoomTooltip = {
            background: tipCs("background-color"),
            color: tipCs("color"),
            "border-radius": tipCs("border-radius"),
          };
        }
      }
    }
  }

  ui.closeStylePanel(false);
  return results;
};
