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
      WRAP_CLASS: "foliplus-del-icon",
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
    STORAGE: {
      KEY: "foliplus_measurement",
    },
    MODE: {
      MARKER: "marker",
      DISTANCE: "distance",
      CIRCLE: "circle",
      CLEAR: "clear",
    },
    position: "{{ this.position }}",
  };

  // ==================== Runtime Guard ====================
  const foliplus = window.foliplus || {};
  if (!foliplus || !foliplus.SVGs) {
    console.error(`[${CONST.name}] foliplus runtime not found, plugin disabled.`);
    return;
  }

  // ==================== Globals & Shared Dependencies ====================
  const map = {{ this._parent.get_name() }};
  const _ = (k) => (foliplus.gt ? foliplus.gt(k) : k);

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
        <circle cx="12" cy="12" r="1.5" class="solid"/>
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

  foliplus.registerHintIcon(CONST.name, SVGs.RULER);

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
      this.hideDelIcons();
    }

    static hideDelIcons() {
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
      labels.forEach((m) => {
        const el = m.getElement();
        if (el) {
          const lbl = el.querySelector(CONST.SEL.LABEL);
          if (lbl) lbl.classList.toggle(CONST.CLASSES.HIDDEN, !labelsVisible);
        }
      });

      if (extraLbl) {
        const sEl = extraLbl.getElement();
        if (sEl) {
          const sL = sEl.querySelector(CONST.SEL.LABEL);
          if (sL) sL.classList.toggle(CONST.CLASSES.HIDDEN, !labelsVisible);
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

    /** Build popup HTML for a marker location. */
    static buildPopup(lng, lat, addr) {
      return foliplus.buildPopupHtml(
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
      return L.circleMarker(latlng, { radius: CONST.MARKER.RADIUS, className });
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

    /** Shorthand for mode type */
    get type() {
      return this.constructor.TYPE;
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

    /** Generate a unique measurement ID with type prefix. */
    nextMeasurementId() {
      return this.m.nextMeasurementId(this.type);
    }
  }

  // ==================== Marker Mode ====================
  class MarkerMode extends MeasureMode {
    static TYPE = CONST.MODE.MARKER;

    start() {
      this.onMarkerClickRef = this.handleMarkerClick.bind(this);
      this.map.on("click", this.onMarkerClickRef);
      this._cleanup = () => this.map.off("click", this.onMarkerClickRef);
    }

    async handleMarkerClick(e) {
      if (this.m.currentMode !== this.type) return;
      const lng = e.latlng.lng.toFixed(CONST.FORMAT.LAT_LNG_PRECISION);
      const lat = e.latlng.lat.toFixed(CONST.FORMAT.LAT_LNG_PRECISION);

      const marker = foliplus.createLocationMarker(
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

      const delMkr = this.layers.addLayer(
        MeasureUtils.makeDelIcon(e.latlng, {
          zIndexOffset: CONST.Z_INDEX.OFFSET,
          iconAnchor: CONST.DEL_ICON.MARKER_ANCHOR,
        }),
      );

      let cachedAddr = null;
      const addr = await foliplus.reverseGeocode(
        this.map,
        parseFloat(lng),
        parseFloat(lat),
      );
      cachedAddr = addr;

      if (marker?.getPopup?.()?.isOpen())
        marker.setPopupContent(MeasureUtils.buildPopup(lng, lat, addr));

      marker.on("popupopen", () => {
        MeasureUtils.hideDelIcons();
        if (cachedAddr !== null)
          marker.setPopupContent(MeasureUtils.buildPopup(lng, lat, cachedAddr));
        MeasureUtils.toggleDelIcon(delMkr, true);
      });

      marker.on("popupclose", () => {
        MeasureUtils.toggleDelIcon(delMkr, false);
      });

      const markerId = this.nextMeasurementId();
      this.m.measurements.push({
        id: markerId,
        type: this.type,
        lng: parseFloat(lng),
        lat: parseFloat(lat),
        address: cachedAddr,
      });
      this.m.saveMeasurements();

      const deleteMarker = () => {
        this.layers.removeLayer(marker);
        this.layers.removeLayer(delMkr);
        this.m.measurements = this.m.measurements.filter((x) => x.id !== markerId);
        this.m.saveMeasurements();
        this.layers.unregister();
      };
      MeasureUtils.attachDelClick(delMkr, deleteMarker);
    }
  }

  // ==================== Distance Mode ====================
  class DistanceMode extends MeasureMode {
    static TYPE = CONST.MODE.DISTANCE;

    start() {
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
        this.layers.addLayer(poly);
        this.layers.addLayer(previewLine);
        this.layers.addLayer(finalPoly);
      };

      this._cleanup = () => {
        this.map.off("click", onDistClick);
        this.map.off("dblclick", onDistDbl);
        this.map.off("contextmenu", onDistContext);
        this.map.off("mousemove", onDistMove);
        if (isLayersRegistered) {
          this.layers.removeLayer(previewLine);
          if (previewDistLabel) {
            this.layers.removeLayer(previewDistLabel);
            previewDistLabel = null;
          }
          this.layers.removeLayer(poly);
          this.layers.removeLayer(finalPoly);
          nodeMarkers.forEach((m) => this.layers.removeLayer(m));
          segLabels.forEach((l) => this.layers.removeLayer(l));
          if (startLbl) this.layers.removeLayer(startLbl);
          this.layers.unregister();
        }
      };

      const finishDist = () => {
        if (isDistFinished) return;
        if (pts.length < 2) {
          this.cleanup();
          this.m.clearActiveMode();
          return;
        }
        isDistFinished = true;
        this.layers.removeLayer(poly);
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

        // Save measurement data
        const distId = this.nextMeasurementId();
        const segments = pts.slice(1).map((p, i) => ({
          lng: p.lng,
          lat: p.lat,
          distance: MeasureUtils.distance(
            pts[i].lng,
            pts[i].lat,
            pts[i + 1].lng,
            pts[i + 1].lat,
          ),
        }));
        this.m.measurements.push({
          id: distId,
          type: this.type,
          points: pts.map((p) => ({ lng: p.lng, lat: p.lat })),
          segments,
          totalDistance: total,
        });
        this.m.saveMeasurements();

        // Format last label
        if (segLabels.length > 0) {
          segLabels[segLabels.length - 1].setIcon(
            MeasureUtils.makeLabelDivIcon(MeasureUtils.formatDistance(total)),
          );
        }

        // Attach toggle/delete UI (shared with restoreDistance)
        const onDistMapClick = this.m.attachDistanceUI({
          layers: this.layers,
          finalPoly,
          nodeMarkers,
          segLabels,
          startLbl,
          onDelete: () => {
            this.m.measurements = this.m.measurements.filter((x) => x.id !== distId);
            this.m.saveMeasurements();
          },
        });
        this._cleanup = () => this.m.map.off("click", onDistMapClick);

        // Cleanup drawing mode
        this.map.off("click", onDistClick);
        this.map.off("dblclick", onDistDbl);
        this.map.off("contextmenu", onDistContext);
        this.map.off("mousemove", onDistMove);
        this.layers.removeLayer(previewLine);
        if (previewDistLabel) {
          this.layers.removeLayer(previewDistLabel);
          previewDistLabel = null;
        }
        this.m.clearActiveMode();
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
          this.layers.addLayer(previewDistLabel, true);
        } else {
          previewDistLabel.setLatLng(e.latlng);
          MeasureUtils.setLabelText(
            previewDistLabel,
            MeasureUtils.formatDistance(showDist),
          );
        }
      };

      const onDistClick = (e) => {
        if (this.m.currentMode !== this.type) return;
        ensureLayersAdded();
        pts.push(e.latlng);
        if (previewDistLabel) {
          this.layers.removeLayer(previewDistLabel);
          previewDistLabel = null;
        }
        poly.addLatLng(e.latlng);

        const mkr = this.layers.addLayer(MeasureUtils.makeNode(e.latlng));
        mkr.bringToFront();
        nodeMarkers.push(mkr);

        if (pts.length === 1) {
          startLbl = L.marker(e.latlng, {
            icon: MeasureUtils.makeLabelDivIcon(_(`${CONST.name}.dist_origin`)),
          });
          this.layers.addLayer(startLbl, true);
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
          this.layers.addLayer(lbl, true);
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

      this.map.on("click", onDistClick);
      this.map.on("dblclick", onDistDbl);
      this.map.on("contextmenu", onDistContext);
      this.map.on("mousemove", onDistMove);
    }
  }

  // ==================== Circle Mode ====================
  class CircleMode extends MeasureMode {
    static TYPE = CONST.MODE.CIRCLE;

    start() {
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
        if (previews.center) this.layers.removeLayer(previews.center);
        if (previews.circle) this.layers.removeLayer(previews.circle);
        if (previews.line) this.layers.removeLayer(previews.line);
        if (previews.node) this.layers.removeLayer(previews.node);
        if (previews.label) this.layers.removeLayer(previews.label);
        previews.center = null;
        previews.circle = null;
        previews.line = null;
        previews.node = null;
        previews.label = null;
      };

      const onMapClick = (e) => {
        if (
          isFinalizing ||
          this.m.currentMode !== this.type ||
          (state !== 0 && state !== 1)
        )
          return;

        if (Date.now() - lastFinishTime < CONST.TIMING.CLICK_COOLDOWN) return;

        if (state === 0) {
          center = e.latlng;
          previews.center = this.layers.addLayer(
            L.marker(center, {
              icon: L.divIcon({
                className: CONST.CENTER_DOT.CLASS,
                html: "",
                iconSize: CONST.CENTER_DOT.SIZE,
                iconAnchor: CONST.CENTER_DOT.ANCHOR,
              }),
              zIndexOffset: CONST.Z_INDEX.OFFSET,
              interactive: false,
            }),
          );
          state = 1;
          foliplus.showHint(
            CONST.name,
            _(`${CONST.name}.hint_circle_radius`),
            foliplus.HINT_DURATION.PERSIST,
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
          this.m.clearActiveMode();
          isFinalizing = true;
          setTimeout(() => {
            finalizeCircle(savedCenter, r, e.latlng);
            isFinalizing = false;
          }, CONST.TIMING.FINALIZE_DELAY);
        }
      };

      const onMouseMove = (e) => {
        if (state !== 1 || !center || this.m.currentMode !== this.type) return;
        const r = MeasureUtils.distance(
          center.lng,
          center.lat,
          e.latlng.lng,
          e.latlng.lat,
        );

        if (!previews.circle) {
          previews.circle = this.layers.addLayer(
            L.circle(center, {
              radius: r,
              className: CONST.CLASSES.CIRCLE_PREVIEW,
              interactive: false,
            }),
          );
        } else previews.circle.setRadius(r);

        if (!previews.line) {
          previews.line = this.layers.addLayer(
            L.polyline([center, e.latlng], {
              className: CONST.CLASSES.LINE_PREVIEW,
              interactive: false,
            }),
          );
        } else previews.line.setLatLngs([center, e.latlng]);

        if (!previews.node) {
          previews.node = this.layers.addLayer(
            L.circleMarker(e.latlng, {
              radius: CONST.MARKER.RADIUS,
              className: CONST.CLASSES.NODE_PREVIEW,
              interactive: false,
            }),
          );
          previews.node.bringToFront();
        } else previews.node.setLatLng(e.latlng);

        const mid = L.latLng(
          (center.lat + e.latlng.lat) / 2,
          (center.lng + e.latlng.lng) / 2,
        );
        if (!previews.label) {
          previews.label = this.layers.addLayer(
            L.marker(mid, {
              icon: MeasureUtils.makeLabelDivIcon(
                MeasureUtils.formatDistance(r),
                CONST.DEL_ICON.ANCHOR,
                CONST.LABEL.CLASS_RADIUS,
              ),
              interactive: false,
            }),
          );
          this.layers.addLayer(previews.label, true);
        } else {
          previews.label.setLatLng(mid);
          MeasureUtils.setLabelText(previews.label, MeasureUtils.formatDistance(r));
        }
      };

      const onContext = (e) => {
        MeasureUtils.stopEvent(e);
        this.m.clearActiveMode();
      };

      const finalizeCircle = (centerLatLng, r, targetLatLng) => {
        const finalTargetLatLng =
          targetLatLng || L.CRS.Earth.destination(centerLatLng, r, 90);

        const circle = this.layers.addLayer(
          L.circle(centerLatLng, {
            radius: r,
            className: CONST.CLASSES.CIRCLE_FINAL,
            interactive: true,
          }),
        );

        const ripple = this.layers.addLayer(
          L.circle(centerLatLng, {
            radius: r,
            className: CONST.CLASSES.RIPPLE,
            interactive: false,
          }),
        );
        const rippleEl = ripple._path;
        if (rippleEl) {
          const onEnd = () => {
            rippleEl.removeEventListener("animationend", onEnd);
            this.layers.removeLayer(ripple);
          };
          rippleEl.addEventListener("animationend", onEnd);
        }

        const radiusLine = this.layers.addLayer(
          L.polyline([centerLatLng, finalTargetLatLng], {
            className: CONST.CLASSES.LINE_DASHED,
            interactive: true,
          }),
        );
        const radiusNode = this.layers.addLayer(
          MeasureUtils.makeNode(finalTargetLatLng),
        );

        let labelsVisible = true;
        let xVisible = false;

        const centerFinal = this.layers.addLayer(
          L.marker(centerLatLng, {
            icon: L.divIcon({
              className: CONST.CENTER_DOT.CLASS_FINAL,
              html: "",
              iconSize: CONST.CENTER_DOT.SIZE,
              iconAnchor: CONST.CENTER_DOT.ANCHOR,
            }),
            zIndexOffset: CONST.Z_INDEX.OFFSET,
            interactive: true,
          }),
        );

        const delMkr = this.layers.addLayer(
          MeasureUtils.makeDelIcon(centerLatLng, {
            zIndexOffset: CONST.Z_INDEX.OFFSET,
          }),
        );

        const midLng = (centerLatLng.lng + finalTargetLatLng.lng) / 2;
        const midLat = (centerLatLng.lat + finalTargetLatLng.lat) / 2;
        const radiusLabel = L.marker([midLat, midLng], {
          icon: MeasureUtils.makeLabelDivIcon(
            MeasureUtils.formatDistance(r),
            CONST.DEL_ICON.ANCHOR,
            CONST.LABEL.CLASS_RADIUS,
          ),
          interactive: false,
        });
        this.layers.addLayer(radiusLabel, true);

        // Save measurement data
        const circleId = this.nextMeasurementId();
        this.m.measurements.push({
          id: circleId,
          type: this.type,
          center: { lng: centerLatLng.lng, lat: centerLatLng.lat },
          target: { lng: finalTargetLatLng.lng, lat: finalTargetLatLng.lat },
          radius: r,
        });
        this.m.saveMeasurements();

        // Attach toggle/delete UI (shared with restoreCircle)
        const { onMapClickActive } = this.m.attachCircleUI({
          layers: this.layers,
          circle,
          radiusLine,
          radiusNode,
          centerFinal,
          delMkr,
          radiusLabel,
          onDelete: () => {
            this.m.measurements = this.m.measurements.filter((x) => x.id !== circleId);
            this.m.saveMeasurements();
          },
        });
        this.m.finalizedClickHandler = onMapClickActive;
      };

      this.map.on("click", onMapClick);
      this.map.on("mousemove", onMouseMove);
      this.map.on("contextmenu", onContext);

      this._cleanup = () => {
        this.map.off("click", onMapClick);
        this.map.off("mousemove", onMouseMove);
        this.map.off("contextmenu", onContext);
        clearPreviews();
        foliplus.hideHint(CONST.name);
      };
    }
  }

  // ==================== Guard: LayerControl required ====================
  if (!foliplus.LayerAPI) {
    console.error(`[${CONST.name}] ${_(`${CONST.name}.no_layercontrol`)}`);
    foliplus.showHint(
      CONST.name,
      _(`${CONST.name}.no_layercontrol`),
      foliplus.HINT_DURATION.PERSIST,
    );
    return;
  }

  // ==================== Core Manager ====================
  class MeasureManager {
    constructor(mapInstance) {
      this.map = mapInstance;
      this.layers = foliplus.LayerAPI.createLayers({
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
      this.finalizedClickHandler = null;
      this.measurements = [];
      this.measurementIdCounter = 0;

      this.bindGlobalEvents();
      this.restoreMeasurements();
    }

    // ── Persistence ──

    saveMeasurements() {
      try {
        localStorage.setItem(CONST.STORAGE.KEY, JSON.stringify(this.measurements));
      } catch (e) {
        console.warn(`[${CONST.name}] ${_(`${CONST.name}.save_fail`)}`, e);
      }
    }

    loadMeasurements() {
      try {
        const data = localStorage.getItem(CONST.STORAGE.KEY);
        return data ? JSON.parse(data) : [];
      } catch (e) {
        console.warn(`[${CONST.name}] ${_(`${CONST.name}.load_fail`)}`, e);
        return [];
      }
    }

    nextMeasurementId(type) {
      this.measurementIdCounter += 1;
      return `${CONST.ID}_${type}_${Date.now()}_${this.measurementIdCounter}`;
    }

    restoreMeasurements() {
      this.measurements = this.loadMeasurements();
      this.measurements.forEach((m) => {
        switch (m.type) {
          case CONST.MODE.MARKER:
            this.restoreMarker(m);
            break;
          case CONST.MODE.DISTANCE:
            this.restoreDistance(m);
            break;
          case CONST.MODE.CIRCLE:
            this.restoreCircle(m);
            break;
        }
      });
    }

    restoreMarker(m) {
      const marker = foliplus.createLocationMarker(
        this.map,
        m.lng,
        m.lat,
        m.address,
        `${CONST.name}.popup_title`,
        `${CONST.name}.popup_loading`,
        `${CONST.name}.popup_loc_label`,
        `${CONST.name}.popup_addr_label`,
        null,
        this.layers.mainLayer,
      );
      const delMkr = this.layers.addLayer(
        MeasureUtils.makeDelIcon(L.latLng(m.lat, m.lng), {
          zIndexOffset: CONST.Z_INDEX.OFFSET,
          iconAnchor: CONST.DEL_ICON.MARKER_ANCHOR,
        }),
      );

      marker.on("popupopen", () => {
        MeasureUtils.hideDelIcons();
        MeasureUtils.toggleDelIcon(delMkr, true);
      });
      marker.on("popupclose", () => {
        MeasureUtils.toggleDelIcon(delMkr, false);
      });

      const deleteMarker = () => {
        this.layers.removeLayer(marker);
        this.layers.removeLayer(delMkr);
        this.measurements = this.measurements.filter((x) => x.id !== m.id);
        this.saveMeasurements();
        this.layers.unregister();
      };
      MeasureUtils.attachDelClick(delMkr, deleteMarker);
    }

    restoreDistance(m) {
      const pts = m.points.map((p) => L.latLng(p.lat, p.lng));
      const finalPoly = this.layers.addLayer(
        L.polyline(pts, {
          className: CONST.CLASSES.LINE_SOLID,
          interactive: true,
        }),
      );

      const nodeMarkers = [];
      pts.forEach((pt, i) => {
        const node = this.layers.addLayer(MeasureUtils.makeNode(pt));
        node.bringToFront();
        nodeMarkers.push(node);
      });

      const segLabels = [];
      if (m.segments) {
        m.segments.forEach((seg, i) => {
          const total = m.segments.slice(0, i + 1).reduce((s, x) => s + x.distance, 0);
          const lbl = L.marker(L.latLng(seg.lat, seg.lng), {
            icon: MeasureUtils.makeLabelDivIcon(MeasureUtils.formatDistance(total)),
          });
          this.layers.addLayer(lbl, true);
          segLabels.push(lbl);
        });
      }

      const startLbl = L.marker(pts[0], {
        icon: MeasureUtils.makeLabelDivIcon(_(`${CONST.name}.dist_origin`)),
      });
      this.layers.addLayer(startLbl, true);

      // Attach toggle/delete UI (shared with finishDist)
      this.attachDistanceUI({
        layers: this.layers,
        finalPoly,
        nodeMarkers,
        segLabels,
        startLbl,
        onDelete: () => {
          this.measurements = this.measurements.filter((x) => x.id !== m.id);
          this.saveMeasurements();
        },
      });
    }

    restoreCircle(m) {
      const centerLatLng = L.latLng(m.center.lat, m.center.lng);
      const targetLatLng = L.latLng(m.target.lat, m.target.lng);
      const r = m.radius;

      const circle = this.layers.addLayer(
        L.circle(centerLatLng, {
          radius: r,
          className: CONST.CLASSES.CIRCLE_FINAL,
          interactive: true,
        }),
      );

      const radiusLine = this.layers.addLayer(
        L.polyline([centerLatLng, targetLatLng], {
          className: CONST.CLASSES.LINE_DASHED,
          interactive: true,
        }),
      );
      const radiusNode = this.layers.addLayer(MeasureUtils.makeNode(targetLatLng));

      let labelsVisible = true;
      let xVisible = false;

      const centerFinal = this.layers.addLayer(
        L.marker(centerLatLng, {
          icon: L.divIcon({
            className: CONST.CENTER_DOT.CLASS_FINAL,
            html: "",
            iconSize: CONST.CENTER_DOT.SIZE,
            iconAnchor: CONST.CENTER_DOT.ANCHOR,
          }),
          zIndexOffset: CONST.Z_INDEX.OFFSET,
          interactive: true,
        }),
      );

      const delMkr = this.layers.addLayer(
        MeasureUtils.makeDelIcon(centerLatLng, {
          zIndexOffset: CONST.Z_INDEX.OFFSET,
        }),
      );

      const midLng = (centerLatLng.lng + targetLatLng.lng) / 2;
      const midLat = (centerLatLng.lat + targetLatLng.lat) / 2;
      const radiusLabel = this.layers.addLayer(
        L.marker([midLat, midLng], {
          icon: MeasureUtils.makeLabelDivIcon(
            MeasureUtils.formatDistance(r),
            CONST.LABEL.ANCHOR,
            CONST.LABEL.CLASS_RADIUS,
          ),
          interactive: false,
        }),
      );
      this.layers.addLayer(radiusLabel, true);

      // Attach toggle/delete UI (shared with finalizeCircle)
      this.attachCircleUI({
        layers: this.layers,
        circle,
        radiusLine,
        radiusNode,
        centerFinal,
        delMkr,
        radiusLabel,
        onDelete: () => {
          this.measurements = this.measurements.filter((x) => x.id !== m.id);
          this.saveMeasurements();
        },
      });
    }

    bindGlobalEvents() {
      this.onMapClick = (e) => {
        if (this.isSuppressHideDel) return;
        const t = e.originalEvent?.target;
        if (t?.closest?.(CONST.SEL.DEL_ICON)) return;
        MeasureUtils.hideDelIcons();
      };
      this.map.on("click", this.onMapClick);

      this.onKeyDown = (e) => {
        if (e.key === "Escape" && this.currentMode) this.clearActiveMode();
      };
      document.addEventListener("keydown", this.onKeyDown);

      this.onUnload = () => this.clearAll();
      this.map.on("unload", this.onUnload);
    }

    /**
     * Attach toggle/delete UI to a completed distance measurement.
     * Shared by finishDist (DistanceMode) and restoreDistance (MeasureManager).
     * @param {Object} opts
     * @param {Object} opts.layers    - createLayers API object
     * @param {Object} opts.finalPoly - L.Polyline
     * @param {Array}  opts.nodeMarkers - L.CircleMarker[]
     * @param {Array}  opts.segLabels   - Label L.Marker[]
     * @param {Object} opts.startLbl    - Origin label marker
     * @param {Function} opts.onDelete  - Called when user deletes the measurement
     * @returns {Function} cleanup(mapClickHandler) to remove map click listener
     */
    attachDistanceUI(opts) {
      const { layers, finalPoly, nodeMarkers, segLabels, startLbl, onDelete } = opts;
      let labelsVisible = true;
      let xVisible = false;
      let lastNodeDelMkr = null;

      const toggleUI = (showX, toggleLabels) => {
        const s = MeasureUtils.calcToggle(xVisible, labelsVisible, showX, toggleLabels);
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
        MeasureUtils.suppressHide(this);
        toggleUI(undefined);
      };

      finalPoly.on("click", handleItemClick);
      nodeMarkers.forEach((m) => m.on("click", handleItemClick));
      segLabels.forEach((l) => l.on("click", handleItemClick));
      if (startLbl) startLbl.on("click", handleItemClick);

      toggleUI(false, CONST.TOGGLE.RESET);

      const onMapClickActive = () => {
        if (this.isSuppressHideDel) return;
        if (xVisible) toggleUI(false, CONST.TOGGLE.RESET);
      };
      this.map.on("click", onMapClickActive);

      const deleteMeas = () => {
        layers.removeLayer(
          finalPoly,
          ...nodeMarkers,
          ...segLabels,
          startLbl,
          lastNodeDelMkr,
        );
        this.map.off("click", onMapClickActive);
        onDelete();
        layers.unregister();
      };

      const lastNode = nodeMarkers[nodeMarkers.length - 1];
      lastNodeDelMkr = layers.addLayer(MeasureUtils.makeDelIcon(lastNode.getLatLng()));
      MeasureUtils.attachDelClick(lastNodeDelMkr, deleteMeas);
      lastNodeDelMkr.on("click", (e) => {
        const t = e.originalEvent?.target;
        if (t?.classList?.contains(CONST.DEL_ICON.CLASS)) return;
        handleItemClick(e);
      });

      // Re-sort to ensure correct ordering
      nodeMarkers.forEach((m) => layers.removeLayer(m));
      if (lastNodeDelMkr) layers.removeLayer(lastNodeDelMkr);
      segLabels.forEach((l) => layers.removeLayer(l));
      if (startLbl) layers.removeLayer(startLbl);
      nodeMarkers.forEach((m) => layers.addLayer(m));
      if (lastNodeDelMkr) layers.addLayer(lastNodeDelMkr);
      segLabels.forEach((l) => layers.addLayer(l));
      if (startLbl) layers.addLayer(startLbl);

      return onMapClickActive;
    }

    /**
     * Attach toggle/delete UI to a completed circle measurement.
     * Shared by finalizeCircle (CircleMode) and restoreCircle (MeasureManager).
     * @param {Object} opts
     * @param {Object} opts.layers     - createLayers API object
     * @param {Object} opts.circle     - L.Circle
     * @param {Object} opts.radiusLine - L.Polyline
     * @param {Object} opts.radiusNode - L.CircleMarker
     * @param {Object} opts.centerFinal - L.Marker (center dot)
     * @param {Object} opts.delMkr     - Delete icon L.Marker
     * @param {Object} opts.radiusLabel - Label L.Marker
     * @param {Function} opts.onDelete - Called when user deletes the measurement
     * @returns {Function} cleanup(mapClickHandler) to remove map click listener
     */
    attachCircleUI(opts) {
      const {
        layers,
        circle,
        radiusLine,
        radiusNode,
        centerFinal,
        delMkr,
        radiusLabel,
        onDelete,
      } = opts;
      let labelsVisible = true;
      let xVisible = false;
      let deleted = false;

      const toggleUI = (showX, toggleLabels) => {
        const s = MeasureUtils.calcToggle(xVisible, labelsVisible, showX, toggleLabels);
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

      const toggleCircleToggle = () => {
        if (deleted) return;
        MeasureUtils.suppressHide(this);
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
        if (this.isSuppressHideDel || deleted) return;
        if (xVisible) toggleUI(false, CONST.TOGGLE.RESET);
      };
      this.map.on("click", onMapClickActive);

      const deleteCircle = () => {
        if (deleted) return;
        deleted = true;
        layers.removeLayer(
          delMkr,
          circle,
          centerFinal,
          radiusLine,
          radiusNode,
          radiusLabel,
        );
        this.map.off("click", onMapClickActive);
        onDelete();
        layers.unregister();
      };
      MeasureUtils.attachDelClick(delMkr, deleteCircle);

      return { onMapClickActive, deleteCircle };
    }

    setMode(mode) {
      if (mode === CONST.MODE.CLEAR) {
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

      if (mode === CONST.MODE.MARKER) {
        foliplus.showHint(
          CONST.name,
          _(`${CONST.name}.hint_marker`),
          foliplus.HINT_DURATION.PERSIST,
        );
        this.modeInstance = new MarkerMode(this);
        this.modeInstance.start();
      } else if (mode === CONST.MODE.DISTANCE) {
        foliplus.showHint(
          CONST.name,
          _(`${CONST.name}.hint_dist_start`),
          foliplus.HINT_DURATION.PERSIST,
        );
        this.modeInstance = new DistanceMode(this);
        this.modeInstance.start();
      } else if (mode === CONST.MODE.CIRCLE) {
        foliplus.showHint(
          CONST.name,
          _(`${CONST.name}.hint_circle_start`),
          foliplus.HINT_DURATION.PERSIST,
        );
        this.modeInstance = new CircleMode(this);
        this.modeInstance.start();
      }
    }

    clearActiveMode() {
      this.currentMode = null;
      this.toolBtns.forEach((btn) => btn.classList.remove(CONST.CLASSES.ACTIVE));
      foliplus.hideHint(CONST.name);
      this.map.getContainer().classList.remove(CONST.CLASSES.IS_MEASURING);
      this.cleanMapEvents();
    }

    clearAll() {
      this.layers.destroy();
      this.measurements = [];
      this.saveMeasurements();
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
      foliplus.hideHint(CONST.name);
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
      const { container, ctrl, toolBar, toggleBtn } = foliplus.createFoldControl({
        cssClass: "foliplus-measure-ctrl",
        toggleTitle: _(`${CONST.name}.tool_toggle`),
        toggleSvg: SVGs.RULER,
        isLeft: CONST.position.indexOf("left") >= 0,
      });
      const btnConfigs = [
        {
          mode: CONST.MODE.MARKER,
          title: _(`${CONST.name}.tool_marker`),
          svg: foliplus.SVGs.LOCATE,
        },
        {
          mode: CONST.MODE.DISTANCE,
          title: _(`${CONST.name}.tool_distance`),
          svg: SVGs.RULER,
        },
        {
          mode: CONST.MODE.CIRCLE,
          title: _(`${CONST.name}.tool_circle`),
          svg: SVGs.CIRCLE,
        },
        {
          mode: CONST.MODE.CLEAR,
          title: _(`${CONST.name}.tool_clear`),
          svg: SVGs.TRASH,
        },
      ];
      btnConfigs.forEach(({ mode, title, svg }) => {
        toolBar.appendChild(
          foliplus.dom.el(
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

      foliplus.bindOutsideCollapse({ container: ctrl });

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
