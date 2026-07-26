(function () {
  // ==================== Constants ====================
  const CONST = {
    name: "MeasureControl",
    TIMING: {
      CLICK_COOLDOWN: 300,
      FINALIZE_DELAY: 50,
      DEL_ICON_RETRY_DELAY: 50,
      SUPPRESS_HIDE_DELAY: 100,
    },
    DEL_ICON: {
      RETRY_LIMIT: 10,
      ANCHOR: [0, 0],
      MARKER_ANCHOR: [-4, 28],
      SIZE: [0, 0],
      CHAR: "✕",
      CLASS: "foliplus-measure-del-icon",
      WRAP_CLASS: "foliplus-del-icon-wrap",
    },
    MARKER: {
      RADIUS: 5,
    },
    CENTER_DOT: {
      SIZE: [12, 12],
      ANCHOR: [6, 6],
      CLASS: "foliplus-measure-center-dot",
      CLASS_FINAL: "foliplus-measure-center-dot foliplus-final",
    },
    LABEL: {
      ANCHOR: [0, -10],
      SIZE: [0, 0],
      CLASS: "foliplus-measure-label",
      CLASS_RADIUS: "foliplus-measure-label-radius",
    },
    FORMAT: {
      LAT_LNG_PRECISION: 6,
      KM_THRESHOLD: 1000,
      KM_DECIMALS: 1,
    },
    Z_INDEX: {
      OFFSET: 1000,
    },
    ID: "foliplus_measure",
    PANES: {
      GRAPH: "measure_graph",
      LABEL: "measure_label",
    },
    CLASSES: {
      LINE_DASHED: "foliplus-measure-line foliplus-measure-line-dashed",
      LINE_PREVIEW: "foliplus-measure-line foliplus-measure-line-preview",
      LINE_SOLID: "foliplus-measure-line foliplus-measure-line-solid",
      CIRCLE_PREVIEW: "foliplus-measure-circle foliplus-measure-circle-preview",
      CIRCLE_FINAL: "foliplus-measure-circle foliplus-measure-circle-final",
      NODE_FINAL: "foliplus-measure-node foliplus-measure-node-final",
      NODE_PREVIEW: "foliplus-measure-node foliplus-measure-node-preview",
      RIPPLE: "foliplus-measure-ripple",
      DASH_SWEEP: "foliplus-measure-dash-sweep",
      HIDDEN: "foliplus-measure-hidden",
      VISIBLE: "visible",
      ACTIVE: "active",
      IS_MEASURING: "foliplus-measuring",
      COLLAPSED: "collapsed",
      EXPANDED: "expanded",
    },
    TOGGLE: {
      RESET: "reset",
    },
    STYLE: {
      SWEEP_LENGTH: "--sweep-length",
    },
    SEL: {
      LABEL: ".foliplus-measure-label",
      DEL_ICON: ".foliplus-measure-del-icon",
      TOOL_BTN: ".foliplus-tool-btn",
    },
    position: "{{ this.position }}",
  };

  // ==================== Runtime Guard ====================
  if (!window.foliplus || !window.foliplus.SVGs) {
    console.error(`[${CONST.name}] foliplus runtime not found, plugin disabled.`);
    return;
  }

  // ==================== Globals & Shared Dependencies ====================
  const map = {{ this._parent.get_name() }};
  const _ = (k) => (window.foliplus && window.foliplus.gt ? window.foliplus.gt(k) : k);

  // ==================== SVG Icons ====================
  const SVGs = {
    RULER: `
      <svg viewBox="0 0 24 24">
        <g transform="rotate(-45 12 12)">
          <rect x="1" y="7" width="22" height="9" rx="1"/>
          <path d="M5 7v3M9 7v2M13 7v3M17 7v2"/>
        </g>
      </svg>`,
    CIRCLE: `
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9"/>
        <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>
      </svg>`,
    TRASH: `
      <svg viewBox="0 0 24 24">
        <path d="M3 6h18"/>
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
        <line x1="10" y1="11" x2="10" y2="17"/>
        <line x1="14" y1="11" x2="14" y2="17"/>
      </svg>`,
  };

  window.foliplus.registerHintIcon(CONST.name, SVGs.RULER);

  // ==================== Utility Classes ====================
  class MeasureUtils {
    static stopEvent(e) {
      const d = e.originalEvent || e;
      d?.stopPropagation?.();
      d?.preventDefault?.();
    }

    static formatDistance(meters) {
      return meters >= CONST.FORMAT.KM_THRESHOLD
        ? `${(meters / 1000).toFixed(CONST.FORMAT.KM_DECIMALS)} ` +
            _(`${CONST.name}.unit_km`)
        : `${Math.round(meters)} ` + _(`${CONST.name}.unit_m`);
    }

    static distance(lng1, lat1, lng2, lat2) {
      return L.latLng(lat1, lng1).distanceTo(L.latLng(lat2, lng2));
    }

    static toggleVisibility(elements, visible) {
      elements.forEach((el) => {
        if (el) el.classList.toggle(CONST.CLASSES.HIDDEN, !visible);
      });
    }

    static suppressHide(manager) {
      manager.isSuppressHideDel = true;
      setTimeout(() => {
        manager.isSuppressHideDel = false;
      }, CONST.TIMING.SUPPRESS_HIDE_DELAY);
      this.hideAllDelIcons();
    }

    static hideAllDelIcons() {
      document
        .querySelectorAll(`${CONST.SEL.DEL_ICON}.${CONST.CLASSES.VISIBLE}`)
        .forEach((el) => el.classList.remove(CONST.CLASSES.VISIBLE));
    }

    static calcToggle(curX, curLabels, showX, toggleLbl) {
      const newX = showX !== undefined ? showX : !curX;
      let newL = curLabels;
      if (toggleLbl === true) newL = !curLabels;
      else if (toggleLbl === false) newL = false;
      else if (toggleLbl === CONST.TOGGLE.RESET) newL = true;
      return { xVisible: newX, labelsVisible: newL };
    }

    static applyToggle(delMarker, xVisible, labels, labelsVisible, extraLbl, onToggle) {
      const applyDelIcon = (mkr, show, retries = 0) => {
        if (!mkr) return;
        MeasureUtils.toggleDelIcon(mkr, show, retries);
      };

      applyDelIcon(delMarker, xVisible);
      const dsp = labelsVisible ? "" : "none";

      labels.forEach((m) => {
        const el = m.getElement();
        if (el) {
          const lbl = el.querySelector(CONST.SEL.LABEL);
          if (lbl) lbl.style.display = dsp;
        }
      });

      if (extraLbl) {
        const sEl = extraLbl.getElement();
        if (sEl) {
          const sL = sEl.querySelector(CONST.SEL.LABEL);
          if (sL) sL.style.display = dsp;
        }
      }

      if (onToggle) onToggle(xVisible, labelsVisible);
    }

    /** Toggle a delete icon's visibility with retry. */
    static toggleDelIcon(mkr, show, retries = 0) {
      if (!mkr) return;
      const el = mkr.getElement();
      if (el) {
        const icon = el.querySelector(CONST.SEL.DEL_ICON);
        if (icon) icon.classList.toggle(CONST.CLASSES.VISIBLE, show);
      } else if (retries < CONST.DEL_ICON.RETRY_LIMIT) {
        setTimeout(
          () => MeasureUtils.toggleDelIcon(mkr, show, retries + 1),
          CONST.TIMING.DEL_ICON_RETRY_DELAY,
        );
      }
    }

    /** Attach a click handler to a delete icon marker via Leaflet event (survives DOM rebuild). */
    static attachDelClick(delMkr, callback) {
      delMkr.on("click", (ev) => {
        const t = ev.originalEvent?.target;
        if (t?.classList?.contains(CONST.DEL_ICON.CLASS)) {
          MeasureUtils.stopEvent(ev);
          callback();
        }
      });
    }

    /** Update a label marker's text content. Always gets fresh DOM reference. */
    static setLabelText(marker, text) {
      const el = marker.getElement();
      if (!el) return;
      const labelEl = el.querySelector(CONST.SEL.LABEL);
      if (labelEl) labelEl.textContent = text;
    }

    /** Remove multiple layers from a mainLayer in one call. */
    static removeLayers(mainLayer, ...layers) {
      layers.forEach((l) => {
        if (l != null) mainLayer.removeLayer(l);
      });
    }

    /** Build popup HTML for a marker location. */
    static buildPopup(lng, lat, addr) {
      return window.foliplus.buildPopupHtml(
        lng,
        lat,
        addr,
        `${CONST.name}.popup_title`,
        `${CONST.name}.popup_loading`,
        `${CONST.name}.popup_loc_label`,
        `${CONST.name}.popup_addr_label`,
      );
    }

    /** Create a divIcon for a label marker.
     * @param {string} html - Text content for the label.
     * @param {number[]} [iconAnchor] - Override default LABEL_ANCHOR.
     * @param {string} [className] - Extra CSS class for the label div. */
    static makeLabelDivIcon(html, iconAnchor, className) {
      return L.divIcon({
        className: "",
        html: `<div class="${CONST.LABEL.CLASS}${className ? " " + className : ""}">${html}</div>`,
        iconSize: CONST.LABEL.SIZE,
        iconAnchor: iconAnchor || CONST.LABEL.ANCHOR,
      });
    }

    /** Create a measure node circle marker. */
    static makeNode(latlng, className = CONST.CLASSES.NODE_FINAL) {
      return L.circleMarker(latlng, {
        radius: CONST.MARKER.RADIUS,
        className,
      });
    }

    /** Create a delete icon marker.
     * @param {Object} [opts] - Extra options. className appended to del-icon-wrap
     *   for CSS targeting; iconAnchor overrides the default [0, 0];
     *   remaining opts passed to L.marker (e.g. zIndexOffset).
     */
    static makeDelIcon(latlng, opts = {}) {
      const { className, iconAnchor, ...markerOpts } = opts;
      return L.marker(latlng, {
        icon: L.divIcon({
          className: CONST.DEL_ICON.WRAP_CLASS + (className ? " " + className : ""),
          html: `<span class="${CONST.DEL_ICON.CLASS}">${CONST.DEL_ICON.CHAR}</span>`,
          iconSize: CONST.DEL_ICON.SIZE,
          iconAnchor: iconAnchor || CONST.DEL_ICON.ANCHOR,
        }),
        interactive: true,
        ...markerOpts,
      });
    }
  }

  // ==================== Mode Base Class ====================
  class MeasureMode {
    constructor(manager) {
      this.manager = manager;
      this.map = manager.map;
      this.layers = manager.layers;
      this._cleanup = null;
    }

    /** Shorthand for manager */
    get m() {
      return this.manager;
    }

    /** Start the mode — bind events, create UI. */
    start() {}

    /** Cleanup — unbind events, remove temporary elements. */
    cleanup() {
      if (this._cleanup) {
        this._cleanup();
        this._cleanup = null;
      }
    }

    /** Hide all delete icons (shared across modes). */
    hideDelIcons() {
      MeasureUtils.hideAllDelIcons();
    }
  }

  // ==================== Marker Mode ====================
  class MarkerMode extends MeasureMode {
    start() {
      this.onMarkerClickRef = this.handleMarkerClick.bind(this);
      this.map.on("click", this.onMarkerClickRef);
      this._cleanup = () => this.map.off("click", this.onMarkerClickRef);
    }

    async handleMarkerClick(e) {
      if (this.m.currentMode !== "marker") return;
      const lat = e.latlng.lat.toFixed(CONST.FORMAT.LAT_LNG_PRECISION);
      const lng = e.latlng.lng.toFixed(CONST.FORMAT.LAT_LNG_PRECISION);

      const marker = window.foliplus.createLocationMarker(
        this.map,
        parseFloat(lng),
        parseFloat(lat),
        null,
        `${CONST.name}.popup_title`,
        `${CONST.name}.popup_loading`,
        `${CONST.name}.popup_loc_label`,
        `${CONST.name}.popup_addr_label`,
        null,
        this.layers.mainLayer,
      );

      const delMkr = MeasureUtils.makeDelIcon(e.latlng, {
        zIndexOffset: CONST.Z_INDEX.OFFSET,
        iconAnchor: CONST.DEL_ICON.MARKER_ANCHOR,
      }).addTo(this.layers.mainLayer);

      let cachedAddr = null;
      const addr = await window.foliplus.reverseGeocode(
        this.map,
        parseFloat(lng),
        parseFloat(lat),
      );
      cachedAddr = addr;

      if (marker?.getPopup?.()?.isOpen())
        marker.setPopupContent(MeasureUtils.buildPopup(lng, lat, addr));

      marker.on("popupopen", () => {
        this.hideDelIcons();
        if (cachedAddr !== null)
          marker.setPopupContent(MeasureUtils.buildPopup(lng, lat, cachedAddr));
        MeasureUtils.toggleDelIcon(delMkr, true);
      });

      marker.on("popupclose", () => {
        MeasureUtils.toggleDelIcon(delMkr, false);
      });

      const deleteMarker = () => {
        this.layers.mainLayer.removeLayer(marker);
        this.layers.mainLayer.removeLayer(delMkr);
        this.layers.unregister();
      };
      MeasureUtils.attachDelClick(delMkr, deleteMarker);
    }
  }

  // ==================== Distance Mode ====================
  class DistanceMode extends MeasureMode {
    start() {
      const manager = this.m;
      const map = this.map;
      const layers = this.layers;

      const pts = [];
      let total = 0;
      const poly = L.polyline([], { className: CONST.CLASSES.LINE_DASHED });
      const nodeMarkers = [];
      const segLabels = [];
      let startLbl = null;
      const previewLine = L.polyline([], { className: CONST.CLASSES.LINE_PREVIEW });
      const finalPoly = L.polyline([], {
        className: CONST.CLASSES.LINE_SOLID,
        interactive: true,
      });
      let isLayersRegistered = false;
      let isDistFinished = false;
      let previewDistLabel = null;

      const ensureLayersAdded = () => {
        if (isLayersRegistered) return;
        isLayersRegistered = true;
        layers.mainLayer.addLayer(poly);
        layers.mainLayer.addLayer(previewLine);
        layers.mainLayer.addLayer(finalPoly);
      };

      this._cleanup = () => {
        map.off("click", onDistClick);
        map.off("dblclick", onDistDbl);
        map.off("contextmenu", onDistContext);
        map.off("mousemove", onDistMove);
        if (isLayersRegistered) {
          layers.mainLayer.removeLayer(previewLine);
          if (previewDistLabel) {
            layers.mainLayer.removeLayer(previewDistLabel);
            previewDistLabel = null;
          }
          layers.mainLayer.removeLayer(poly);
          layers.mainLayer.removeLayer(finalPoly);
          nodeMarkers.forEach((m) => layers.mainLayer.removeLayer(m));
          segLabels.forEach((l) => layers.mainLayer.removeLayer(l));
          if (startLbl) layers.mainLayer.removeLayer(startLbl);
          layers.unregister();
        }
      };

      const finishDist = () => {
        if (isDistFinished) return;
        if (pts.length < 2) {
          this.cleanup();
          manager.clearActiveMode();
          return;
        }
        isDistFinished = true;
        layers.mainLayer.removeLayer(poly);
        finalPoly.setLatLngs(pts);

        // Dash-sweep animation
        if (finalPoly._path) {
          const len = finalPoly._path.getTotalLength?.() || 0;
          if (len > 0) {
            finalPoly._path.style.setProperty(CONST.STYLE.SWEEP_LENGTH, len);
            finalPoly._path.classList.add(CONST.CLASSES.DASH_SWEEP);
            const onEnd = () => {
              finalPoly._path.removeEventListener("animationend", onEnd);
              finalPoly._path.classList.remove(CONST.CLASSES.DASH_SWEEP);
              finalPoly._path.style.removeProperty(CONST.STYLE.SWEEP_LENGTH);
            };
            finalPoly._path.addEventListener("animationend", onEnd);
          }
        }

        let labelsVisible = true;
        let xVisible = false;
        let lastNodeDelMkr = null;

        const toggleUI = (showX, toggleLabels) => {
          const s = MeasureUtils.calcToggle(
            xVisible,
            labelsVisible,
            showX,
            toggleLabels,
          );
          xVisible = s.xVisible;
          labelsVisible = s.labelsVisible;
          MeasureUtils.applyToggle(
            lastNodeDelMkr,
            xVisible,
            segLabels,
            labelsVisible,
            startLbl,
          );
        };

        const handleItemClick = (e) => {
          MeasureUtils.stopEvent(e);
          MeasureUtils.suppressHide(manager);
          toggleUI(undefined);
        };

        finalPoly.on("click", handleItemClick);
        nodeMarkers.forEach((m) => m.on("click", handleItemClick));
        segLabels.forEach((l) => l.on("click", handleItemClick));
        if (startLbl) startLbl.on("click", handleItemClick);

        toggleUI(false, CONST.TOGGLE.RESET);

        const onDistMapClick = () => {
          if (manager.isSuppressHideDel) return;
          if (xVisible) toggleUI(false, CONST.TOGGLE.RESET);
        };
        map.on("click", onDistMapClick);
        // After finalization, mode cleanup should only remove the map click listener,
        // not the completed polyline/nodes/labels (they stay on the map).
        this._cleanup = () => map.off("click", onDistMapClick);

        if (segLabels.length > 0) {
          const lastLbl = segLabels[segLabels.length - 1];
          lastLbl.setIcon(
            MeasureUtils.makeLabelDivIcon(MeasureUtils.formatDistance(total)),
          );
        }

        const deleteMeasurement = () => {
          MeasureUtils.removeLayers(
            layers.mainLayer,
            finalPoly,
            ...nodeMarkers,
            ...segLabels,
            startLbl,
            lastNodeDelMkr,
          );
          map.off("click", onDistMapClick);
          layers.unregister();
        };

        if (nodeMarkers.length > 0) {
          const lastNode = nodeMarkers[nodeMarkers.length - 1];
          lastNodeDelMkr = MeasureUtils.makeDelIcon(lastNode.getLatLng()).addTo(
            layers.mainLayer,
          );
          MeasureUtils.attachDelClick(lastNodeDelMkr, deleteMeasurement);
          lastNodeDelMkr.on("click", (e) => {
            const t = e.originalEvent?.target;
            if (t?.classList?.contains(CONST.DEL_ICON.CLASS)) return;
            handleItemClick(e);
          });
        }

        // Re-sort layer ordering
        nodeMarkers.forEach((m) => layers.mainLayer.removeLayer(m));
        if (lastNodeDelMkr) layers.mainLayer.removeLayer(lastNodeDelMkr);
        segLabels.forEach((l) => layers.mainLayer.removeLayer(l));
        if (startLbl) layers.mainLayer.removeLayer(startLbl);
        nodeMarkers.forEach((m) => m.addTo(layers.mainLayer));
        if (lastNodeDelMkr) lastNodeDelMkr.addTo(layers.mainLayer);
        segLabels.forEach((l) => l.addTo(layers.mainLayer));
        if (startLbl) startLbl.addTo(layers.mainLayer);

        map.off("click", onDistClick);
        map.off("dblclick", onDistDbl);
        map.off("contextmenu", onDistContext);
        map.off("mousemove", onDistMove);
        layers.mainLayer.removeLayer(previewLine);
        if (previewDistLabel) {
          layers.mainLayer.removeLayer(previewDistLabel);
          previewDistLabel = null;
        }
        manager.clearActiveMode();
      };

      const onDistMove = (e) => {
        if (pts.length === 0) return;
        previewLine.setLatLngs([pts[pts.length - 1], e.latlng]);
        const seg = MeasureUtils.distance(
          pts[pts.length - 1].lng,
          pts[pts.length - 1].lat,
          e.latlng.lng,
          e.latlng.lat,
        );
        const showDist = total + seg;
        if (!previewDistLabel) {
          previewDistLabel = L.marker(e.latlng, {
            icon: MeasureUtils.makeLabelDivIcon(MeasureUtils.formatDistance(showDist)),
            interactive: false,
          });
          previewDistLabel.isMeasureLabel = true;
          previewDistLabel.addTo(layers.mainLayer);
        } else {
          previewDistLabel.setLatLng(e.latlng);
          MeasureUtils.setLabelText(
            previewDistLabel,
            MeasureUtils.formatDistance(showDist),
          );
        }
      };

      const onDistClick = (e) => {
        if (manager.currentMode !== "distance") return;
        ensureLayersAdded();
        pts.push(e.latlng);
        if (previewDistLabel) {
          layers.mainLayer.removeLayer(previewDistLabel);
          previewDistLabel = null;
        }
        poly.addLatLng(e.latlng);

        const mkr = MeasureUtils.makeNode(e.latlng).addTo(layers.mainLayer);
        mkr.bringToFront();
        nodeMarkers.push(mkr);

        if (pts.length === 1) {
          startLbl = L.marker(e.latlng, {
            icon: MeasureUtils.makeLabelDivIcon(_(`${CONST.name}.dist_origin`)),
          });
          startLbl.isMeasureLabel = true;
          startLbl.addTo(layers.mainLayer);
        }

        mkr.on("click", () => {
          if (pts.length < 2) return;
          if (mkr === nodeMarkers[nodeMarkers.length - 1]) finishDist();
        });

        if (pts.length > 1) {
          const seg = MeasureUtils.distance(
            pts[pts.length - 2].lng,
            pts[pts.length - 2].lat,
            pts[pts.length - 1].lng,
            pts[pts.length - 1].lat,
          );
          total += seg;

          if (segLabels.length > 0 && pts.length >= 3) {
            const prevLbl = segLabels[segLabels.length - 1];
            const prevSeg = MeasureUtils.distance(
              pts[pts.length - 3].lng,
              pts[pts.length - 3].lat,
              pts[pts.length - 2].lng,
              pts[pts.length - 2].lat,
            );
            prevLbl.setIcon(
              MeasureUtils.makeLabelDivIcon(MeasureUtils.formatDistance(prevSeg)),
            );
          }

          const lbl = L.marker(pts[pts.length - 1], {
            icon: MeasureUtils.makeLabelDivIcon(MeasureUtils.formatDistance(total)),
          });
          lbl.isMeasureLabel = true;
          lbl.addTo(layers.mainLayer);
          segLabels.push(lbl);
        }
      };

      const onDistDbl = (e) => {
        MeasureUtils.stopEvent(e);
        finishDist();
      };
      const onDistContext = (e) => {
        MeasureUtils.stopEvent(e);
        finishDist();
      };

      map.on("click", onDistClick);
      map.on("dblclick", onDistDbl);
      map.on("contextmenu", onDistContext);
      map.on("mousemove", onDistMove);
    }
  }

  // ==================== Circle Mode ====================
  class CircleMode extends MeasureMode {
    start() {
      const manager = this.m;
      const map = this.map;
      const layers = this.layers;

      let center = null;
      let state = 0;
      let lastFinishTime = 0;
      let isFinalizing = false;
      const previews = {
        center: null,
        circle: null,
        line: null,
        node: null,
        label: null,
      };

      const clearPreviews = () => {
        if (previews.center) layers.mainLayer.removeLayer(previews.center);
        if (previews.circle) layers.mainLayer.removeLayer(previews.circle);
        if (previews.line) layers.mainLayer.removeLayer(previews.line);
        if (previews.node) layers.mainLayer.removeLayer(previews.node);
        if (previews.label) layers.mainLayer.removeLayer(previews.label);
        previews.center = null;
        previews.circle = null;
        previews.line = null;
        previews.node = null;
        previews.label = null;
      };

      const onMapClick = (e) => {
        if (
          isFinalizing ||
          manager.currentMode !== "circle" ||
          (state !== 0 && state !== 1)
        )
          return;

        if (Date.now() - lastFinishTime < CONST.TIMING.CLICK_COOLDOWN) return;

        if (state === 0) {
          center = e.latlng;
          previews.center = L.marker(center, {
            icon: L.divIcon({
              className: CONST.CENTER_DOT.CLASS,
              html: "",
              iconSize: CONST.CENTER_DOT.SIZE,
              iconAnchor: CONST.CENTER_DOT.ANCHOR,
            }),
            zIndexOffset: CONST.Z_INDEX.OFFSET,
            interactive: false,
          }).addTo(layers.mainLayer);
          state = 1;
          window.foliplus.showHint(
            CONST.name,
            _(`${CONST.name}.hint_circle_radius`),
            window.foliplus.HINT_DURATION.PERSIST,
          );
        } else if (state === 1) {
          state = 2;
          lastFinishTime = Date.now();
          const r = MeasureUtils.distance(
            center.lng,
            center.lat,
            e.latlng.lng,
            e.latlng.lat,
          );
          const savedCenter = center;
          this.cleanup();
          manager.clearActiveMode();
          isFinalizing = true;
          setTimeout(() => {
            finalizeCircle(savedCenter, r, e.latlng);
            isFinalizing = false;
          }, CONST.TIMING.FINALIZE_DELAY);
        }
      };

      const onMouseMove = (e) => {
        if (state !== 1 || !center || manager.currentMode !== "circle") return;
        const r = MeasureUtils.distance(
          center.lng,
          center.lat,
          e.latlng.lng,
          e.latlng.lat,
        );

        if (!previews.circle) {
          previews.circle = L.circle(center, {
            radius: r,
            className: CONST.CLASSES.CIRCLE_PREVIEW,
            interactive: false,
          }).addTo(layers.mainLayer);
        } else previews.circle.setRadius(r);

        if (!previews.line) {
          previews.line = L.polyline([center, e.latlng], {
            className: CONST.CLASSES.LINE_PREVIEW,
            interactive: false,
          }).addTo(layers.mainLayer);
        } else previews.line.setLatLngs([center, e.latlng]);

        if (!previews.node) {
          previews.node = L.circleMarker(e.latlng, {
            radius: CONST.MARKER.RADIUS,
            className: CONST.CLASSES.NODE_PREVIEW,
            interactive: false,
          }).addTo(layers.mainLayer);
          previews.node.bringToFront();
        } else previews.node.setLatLng(e.latlng);

        const mid = L.latLng(
          (center.lat + e.latlng.lat) / 2,
          (center.lng + e.latlng.lng) / 2,
        );
        if (!previews.label) {
          previews.label = L.marker(mid, {
            icon: MeasureUtils.makeLabelDivIcon(
              MeasureUtils.formatDistance(r),
              [0, 0],
              CONST.LABEL.CLASS_RADIUS,
            ),
            interactive: false,
          });
          previews.label.isMeasureLabel = true;
          previews.label.addTo(layers.mainLayer);
        } else {
          previews.label.setLatLng(mid);
          MeasureUtils.setLabelText(previews.label, MeasureUtils.formatDistance(r));
        }
      };

      const onContext = (e) => {
        MeasureUtils.stopEvent(e);
        manager.clearActiveMode();
      };

      const finalizeCircle = (centerLatLng, r, targetLatLng) => {
        const finalTargetLatLng =
          targetLatLng || L.CRS.Earth.destination(centerLatLng, r, 90);

        const circle = L.circle(centerLatLng, {
          radius: r,
          className: CONST.CLASSES.CIRCLE_FINAL,
          interactive: true,
        }).addTo(layers.mainLayer);

        const ripple = L.circle(centerLatLng, {
          radius: r,
          className: CONST.CLASSES.RIPPLE,
          interactive: false,
        }).addTo(layers.mainLayer);
        const rippleEl = ripple._path;
        if (rippleEl) {
          const onEnd = () => {
            rippleEl.removeEventListener("animationend", onEnd);
            layers.mainLayer.removeLayer(ripple);
          };
          rippleEl.addEventListener("animationend", onEnd);
        }

        const radiusLine = L.polyline([centerLatLng, finalTargetLatLng], {
          className: CONST.CLASSES.LINE_DASHED,
          interactive: true,
        }).addTo(layers.mainLayer);
        const radiusNode = MeasureUtils.makeNode(finalTargetLatLng).addTo(
          layers.mainLayer,
        );

        let labelsVisible = true;
        let xVisible = false;

        const centerFinal = L.marker(centerLatLng, {
          icon: L.divIcon({
            className: CONST.CENTER_DOT.CLASS_FINAL,
            html: "",
            iconSize: CONST.CENTER_DOT.SIZE,
            iconAnchor: CONST.CENTER_DOT.ANCHOR,
          }),
          zIndexOffset: CONST.Z_INDEX.OFFSET,
          interactive: true,
        }).addTo(layers.mainLayer);

        const delMkr = MeasureUtils.makeDelIcon(centerLatLng, {
          zIndexOffset: CONST.Z_INDEX.OFFSET,
        }).addTo(layers.mainLayer);

        const midLat = (centerLatLng.lat + finalTargetLatLng.lat) / 2;
        const midLng = (centerLatLng.lng + finalTargetLatLng.lng) / 2;
        const radiusLabel = L.marker([midLat, midLng], {
          icon: MeasureUtils.makeLabelDivIcon(
            MeasureUtils.formatDistance(r),
            [0, 0],
            CONST.LABEL.CLASS_RADIUS,
          ),
          interactive: false,
        });
        radiusLabel.isMeasureLabel = true;
        radiusLabel.addTo(layers.mainLayer);

        const toggleUI = (showX, toggleLabels) => {
          const s = MeasureUtils.calcToggle(
            xVisible,
            labelsVisible,
            showX,
            toggleLabels,
          );
          xVisible = s.xVisible;
          labelsVisible = s.labelsVisible;
          MeasureUtils.applyToggle(
            delMkr,
            xVisible,
            [radiusLabel],
            labelsVisible,
            null,
            (xv) => {
              if (delMkr.setZIndexOffset)
                delMkr.setZIndexOffset(
                  xv ? CONST.Z_INDEX.OFFSET * 2 : CONST.Z_INDEX.OFFSET,
                );
              MeasureUtils.toggleVisibility(
                [radiusLine?.getElement(), radiusNode?.getElement()],
                labelsVisible,
              );
            },
          );
        };
        toggleUI(false, CONST.TOGGLE.RESET);

        let deleted = false;
        const deleteCircle = () => {
          if (deleted) return;
          deleted = true;
          MeasureUtils.removeLayers(
            layers.mainLayer,
            delMkr,
            circle,
            centerFinal,
            radiusLine,
            radiusNode,
            radiusLabel,
          );
          map.off("click", onMapClickActive);
          layers.unregister();
        };

        MeasureUtils.attachDelClick(delMkr, deleteCircle);

        const toggleCircleToggle = () => {
          if (deleted) return;
          MeasureUtils.suppressHide(manager);
          toggleUI(undefined);
        };

        const attachInteraction = (layer) => {
          layer.on("click", (e) => {
            const t = e.originalEvent?.target;
            if (t?.classList?.contains(CONST.DEL_ICON.CLASS)) return;
            MeasureUtils.stopEvent(e);
            toggleCircleToggle();
          });
        };

        attachInteraction(delMkr);
        attachInteraction(circle);
        attachInteraction(radiusLine);
        attachInteraction(radiusNode);
        attachInteraction(centerFinal);
        if (radiusLabel) attachInteraction(radiusLabel);

        const onMapClickActive = () => {
          if (manager.isSuppressHideDel || deleted) return;
          if (xVisible) toggleUI(false, CONST.TOGGLE.RESET);
        };
        map.on("click", onMapClickActive);
        manager.finalizedClickHandler = onMapClickActive;
      };

      map.on("click", onMapClick);
      map.on("mousemove", onMouseMove);
      map.on("contextmenu", onContext);

      this._cleanup = () => {
        map.off("click", onMapClick);
        map.off("mousemove", onMouseMove);
        map.off("contextmenu", onContext);
        clearPreviews();
        window.foliplus.hideHint(CONST.name);
      };
    }
  }

  // ==================== Guard: LayerControl required ====================
  if (!window.foliplus.LayerAPI) {
    console.error(`[${CONST.name}] ${_(`${CONST.name}.no_layercontrol`)}`);
    window.foliplus.showHint(
      CONST.name,
      _(`${CONST.name}.no_layercontrol`),
      window.foliplus.HINT_DURATION.PERSIST,
    );
    return;
  }

  // ==================== Core Manager ====================
  class MeasureManager {
    constructor(mapInstance) {
      this.map = mapInstance;
      this.layers = window.foliplus.LayerAPI.createLayers({
        id: CONST.ID,
        name: _(`${CONST.name}.tool_toggle`),
        graphPane: CONST.PANES.GRAPH,
        labelPane: CONST.PANES.LABEL,
        iconSvg: SVGs.RULER,
      });
      this.currentMode = null;
      this.modeInstance = null;
      this.isSuppressHideDel = false;
      this.toolBtns = [];
      this.finalizedClickHandler = null; // Track circle finalized click listener for cleanup

      this.bindGlobalEvents();
    }

    bindGlobalEvents() {
      this.onMapClick = (e) => {
        if (this.isSuppressHideDel) return;
        const t = e.originalEvent?.target;
        if (t?.closest?.(CONST.SEL.DEL_ICON)) return;
        MeasureUtils.hideAllDelIcons();
      };
      this.map.on("click", this.onMapClick);

      this.onKeyDown = (e) => {
        if (e.key === "Escape" && this.currentMode) this.clearActiveMode();
      };
      document.addEventListener("keydown", this.onKeyDown);

      this.onUnload = () => this.clearAll();
      this.map.on("unload", this.onUnload);
    }

    setMode(mode) {
      if (mode === "clear") {
        this.clearAll();
        return;
      }
      if (this.currentMode === mode) {
        this.clearActiveMode();
        return;
      }

      // Bring the measure layer to the front so it's always on top
      // when the user activates a measurement tool, even if the layer
      // was previously hidden and re-shown at a lower z-order.
      this.layers.bringToFront();

      this.cleanMapEvents();
      this.currentMode = mode;

      this.toolBtns.forEach((btn) =>
        btn.classList.toggle(CONST.CLASSES.ACTIVE, btn.dataset.mode === mode),
      );

      this.map.getContainer().classList.add(CONST.CLASSES.IS_MEASURING);

      if (mode === "marker") {
        window.foliplus.showHint(
          CONST.name,
          _(`${CONST.name}.hint_marker`),
          window.foliplus.HINT_DURATION.PERSIST,
        );
        this.modeInstance = new MarkerMode(this);
        this.modeInstance.start();
      } else if (mode === "distance") {
        window.foliplus.showHint(
          CONST.name,
          _(`${CONST.name}.hint_dist_start`),
          window.foliplus.HINT_DURATION.PERSIST,
        );
        this.modeInstance = new DistanceMode(this);
        this.modeInstance.start();
      } else if (mode === "circle") {
        window.foliplus.showHint(
          CONST.name,
          _(`${CONST.name}.hint_circle_start`),
          window.foliplus.HINT_DURATION.PERSIST,
        );
        this.modeInstance = new CircleMode(this);
        this.modeInstance.start();
      }
    }

    clearActiveMode() {
      this.currentMode = null;
      this.toolBtns.forEach((btn) => btn.classList.remove(CONST.CLASSES.ACTIVE));
      window.foliplus.hideHint(CONST.name);
      this.map.getContainer().classList.remove(CONST.CLASSES.IS_MEASURING);
      this.cleanMapEvents();
    }

    clearAll() {
      this.layers.clearAll();
      this.clearActiveMode();
    }

    /** Full cleanup including global events. Called on control removal. */
    destroy() {
      this.clearAll();
      this.layers.unregister();
      if (this.onMapClick) {
        this.map.off("click", this.onMapClick);
        this.onMapClick = null;
      }
      if (this.onKeyDown) {
        document.removeEventListener("keydown", this.onKeyDown);
        this.onKeyDown = null;
      }
      if (this.onUnload) {
        this.map.off("unload", this.onUnload);
        this.onUnload = null;
      }
      if (this.finalizedClickHandler) {
        this.map.off("click", this.finalizedClickHandler);
        this.finalizedClickHandler = null;
      }
    }

    cleanMapEvents() {
      if (this.modeInstance) {
        this.modeInstance.cleanup();
        this.modeInstance = null;
      }
      window.foliplus.hideHint(CONST.name);
    }
  }

  const measureManager = new MeasureManager(map);

  class MeasureControl extends L.Control {
    constructor(options) {
      super(options);
      this.manager = measureManager;
    }

    /** Shorthand for manager */
    get m() {
      return this.manager;
    }

    onAdd() {
      const { container, ctrl, toolBar, toggleBtn } = window.foliplus.createFoldControl(
        {
          cssClass: "foliplus-measure-ctrl",
          toggleTitle: _(`${CONST.name}.tool_toggle`),
          toggleSvg: SVGs.RULER,
          isLeft: CONST.position.indexOf("left") >= 0,
        },
      );
      const btnConfigs = [
        {
          mode: "marker",
          title: _(`${CONST.name}.tool_marker`),
          svg: window.foliplus.SVGs.LOCATE,
        },
        { mode: "distance", title: _(`${CONST.name}.tool_distance`), svg: SVGs.RULER },
        { mode: "circle", title: _(`${CONST.name}.tool_circle`), svg: SVGs.CIRCLE },
        { mode: "clear", title: _(`${CONST.name}.tool_clear`), svg: SVGs.TRASH },
      ];
      btnConfigs.forEach(({ mode, title, svg }) => {
        toolBar.appendChild(
          window.foliplus.dom.el(
            "button",
            { class: "foliplus-tool-btn", "data-mode": mode, title },
            { html: svg },
          ),
        );
      });
      this.m.toolBtns = toolBar.querySelectorAll(CONST.SEL.TOOL_BTN);

      toggleBtn.onclick = (e) => {
        e.stopPropagation();
        ctrl.classList.toggle(CONST.CLASSES.COLLAPSED);
        ctrl.classList.toggle(CONST.CLASSES.EXPANDED);
      };

      window.foliplus.bindOutsideCollapse({ container: ctrl });

      this.m.toolBtns.forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          this.m.setMode(btn.dataset.mode);
        };
      });

      return container;
    }

    onRemove() {
      this.m.destroy();
    }
  }

  new MeasureControl({ position: CONST.position }).addTo(map);
})();
