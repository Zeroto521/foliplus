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
      DEFAULT_ANCHOR: [0, 0],
      MARKER_ANCHOR: [0, 24],
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
      CLASS_FINAL: "foliplus-measure-center-dot final",
    },
    LABEL: {
      DEFAULT_ANCHOR: [0, -10],
      RADIUS_ANCHOR: [0, 0],
      MID_ANCHOR: [0, 0],
      CENTROID_ANCHOR: [0, -10],
      SIZE: [0, 0],
      CLASS: "foliplus-measure-label",
      CLASS_RADIUS: "foliplus-measure-label-radius",
      CLASS_MID: "foliplus-measure-label-mid",
    },
    FORMAT: {
      LAT_LNG_PRECISION: 6,
      KM_THRESHOLD: 1000,
      KM_DECIMALS: 1,
    },
    Z_INDEX: {
      OFFSET: 11000,
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
      POLYGON_FINAL: "foliplus-measure-line-solid foliplus-measure-polygon-final",
      NODE_FINAL: "foliplus-measure-node foliplus-measure-node-final",
      NODE_PREVIEW: "foliplus-measure-node foliplus-measure-node-preview",
      RIPPLE: "foliplus-measure-ripple",
      DASH_SWEEP: "foliplus-measure-dash-sweep",
      HIDDEN: "foliplus-measure-hidden",
      VISIBLE: "visible",
      ACTIVE: "active",
      MEASURING: "foliplus-measuring",
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
      KEY: "foliplus_measure",
    },
    MODE: {
      MARKER: "marker",
      DISTANCE: "distance",
      POLYGON: "polygon",
      CIRCLE: "circle",
      CLEAR: "clear",
    },
    position: "{{ this.position }}",
    show_bearing: {{ this.show_bearing | tojson }},
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
    POLYGON: `
      <svg viewBox="0 0 24 24">
        <polygon points="12,3 21,9 18,21 6,21 3,9"/>
        <circle cx="12" cy="3" r="1.5" class="solid"/>
        <circle cx="21" cy="9" r="1.5" class="solid"/>
        <circle cx="18" cy="21" r="1.5" class="solid"/>
        <circle cx="6" cy="21" r="1.5" class="solid"/>
        <circle cx="3" cy="9" r="1.5" class="solid"/>
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
    /** Stop event propagation and prevent default. */
    static stopEvent(e) {
      const d = e.originalEvent || e;
      d?.stopPropagation?.();
      d?.preventDefault?.();
    }

    /** Format meters to human-readable string (e.g. "1.2 km", "500 m").
     *  @param {number} meters - Distance in meters.
     *  @returns {string} Formatted distance string. */
    static formatDistance(meters) {
      return meters >= CONST.FORMAT.KM_THRESHOLD
        ? `${(meters / 1000).toFixed(CONST.FORMAT.KM_DECIMALS)} ` +
            _(`${CONST.name}.unit_km`)
        : `${Math.round(meters)} ` + _(`${CONST.name}.unit_m`);
    }

    /** Distance between two points in meters (turf.js geodesic).
     *  @param {Object} a - Point with lng/lat properties.
     *  @param {Object} b - Point with lng/lat properties. */
    static distance(a, b) {
      return turf.distance(turf.point([a.lng, a.lat]), turf.point([b.lng, b.lat]), {
        units: "meters",
      });
    }

    /** Initial bearing (azimuth) from point a to point b, 0°–360° clockwise from north.
     *  Uses turf.js bearing. */
    static bearing(a, b) {
      const bVal = turf.bearing(turf.point([a.lng, a.lat]), turf.point([b.lng, b.lat]));
      return (bVal + 360) % 360;
    }

    /** Format a segment label: "45° | 1.2 km", or just "1.2 km" when show_bearing is off.
     *  @param {Object} a - Start point with lng/lat properties.
     *  @param {Object} b - End point with lng/lat properties. */
    static formatSegmentLabel(a, b, meters) {
      const dist = MeasureUtils.formatDistance(meters);
      if (!CONST.show_bearing) return dist;
      const bearing = Math.round(MeasureUtils.bearing(a, b));
      return `${bearing}° | ${dist}`;
    }

    /** Geodesic midpoint between two points using turf.js.
     *  @param {Object} a - First point with lng/lat properties.
     *  @param {Object} b - Second point with lng/lat properties.
     *  @returns {L.LatLng} Midpoint LatLng. */
    static midpoint(a, b) {
      const mid = turf.midpoint(turf.point([a.lng, a.lat]), turf.point([b.lng, b.lat]));
      return L.latLng(mid.geometry.coordinates[1], mid.geometry.coordinates[0]);
    }

    /** Centroid (arithmetic mean of vertices) of a polygon.
     *  @param {Array<{lng:number,lat:number}>} points - Array of coordinate objects.
     *  @returns {L.LatLng} Centroid LatLng. */
    static centroid(points) {
      const cx = points.reduce((s, p) => s + p.lat, 0) / points.length;
      const cy = points.reduce((s, p) => s + p.lng, 0) / points.length;
      return L.latLng(cx, cy);
    }

    /** Geodesic area of a polygon using turf.js.
     *  @param {Array<{lng:number,lat:number}>} points - Array of coordinate objects.
     *  @returns {number} Area in square meters. */
    static area(points) {
      if (points.length < 3) return 0;
      const coords = points.map((p) => [p.lng, p.lat]);
      // Close the ring
      coords.push(coords[0]);
      return turf.area(turf.polygon([coords]));
    }

    /** Format area: "1,234 m²" or "1.23 km²". */
    static formatArea(sqMeters) {
      if (sqMeters >= 1_000_000) return `${(sqMeters / 1_000_000).toFixed(2)} km²`;
      return `${Math.round(sqMeters).toLocaleString()} m²`;
    }

    /** Toggle CSS hidden class on a list of DOM elements.
     *  @param {Element[]} elements - DOM elements to toggle.
     *  @param {boolean} visible - Whether elements should be visible. */
    static toggleVisibility(elements, visible) {
      elements.forEach((el) => {
        if (el) el.classList.toggle(CONST.CLASSES.HIDDEN, !visible);
      });
    }

    /** Temporarily suppress map click hide of delete icons.
     *  @param {Object} manager - MeasureManager instance. */
    static suppressHide(manager) {
      manager.isSuppressHideDel = true;
      setTimeout(() => {
        manager.isSuppressHideDel = false;
      }, CONST.TIMING.SUPPRESS_HIDE_DELAY);
      MeasureUtils.hideDelIcons();
    }

    /** Hide all visible delete icons on the page. */
    static hideDelIcons() {
      document
        .querySelectorAll(`${CONST.SEL.DEL_ICON}.${CONST.CLASSES.VISIBLE}`)
        .forEach((el) => el.classList.remove(CONST.CLASSES.VISIBLE));
    }

    /** Calculate next toggle state for X icons and labels.
     *  @param {boolean} curX - Current X visibility.
     *  @param {boolean} curLabels - Current label visibility.
     *  @param {boolean|undefined} showX - Requested X state.
     *  @param {boolean|string|undefined} toggleLbl - Requested label toggle.
     *  @returns {Object} `{isXVisible:boolean, isLabelsVisible:boolean}` */
    static calcToggle(curX, curLabels, showX, toggleLbl) {
      const newX = showX !== undefined ? showX : !curX;
      let newLabel = curLabels;
      if (toggleLbl === true) newLabel = !curLabels;
      else if (toggleLbl === false) newLabel = false;
      else if (toggleLbl === CONST.TOGGLE.RESET) newLabel = true;
      return { isXVisible: newX, isLabelsVisible: newLabel };
    }

    /** Apply toggle visibility state to del icon, labels, and optional extra label.
     *  @param {Object} delMarker - Delete icon marker.
     *  @param {boolean} isXVisible - Whether X icons are visible.
     *  @param {Array} labels - Label markers to toggle.
     *  @param {boolean} isLabelsVisible - Whether labels are visible.
     *  @param {Object} [extraLbl] - Extra label marker to toggle.
     *  @param {Function} [onToggle] - Callback after toggle. */
    static applyToggle(
      delMarker,
      isXVisible,
      labels,
      isLabelsVisible,
      extraLbl,
      onToggle,
    ) {
      const applyDelIcon = (marker, show, retries = 0) => {
        if (!marker) return;
        MeasureUtils.toggleDelIcon(marker, show, retries);
      };

      applyDelIcon(delMarker, isXVisible);
      labels.forEach((m) => {
        const el = m.getElement();
        if (el) {
          const label = el.querySelector(CONST.SEL.LABEL);
          if (label) label.classList.toggle(CONST.CLASSES.HIDDEN, !isLabelsVisible);
        }
      });

      if (extraLbl) {
        const sEl = extraLbl.getElement();
        if (sEl) {
          const sL = sEl.querySelector(CONST.SEL.LABEL);
          if (sL) sL.classList.toggle(CONST.CLASSES.HIDDEN, !isLabelsVisible);
        }
      }

      if (onToggle) onToggle(isXVisible, isLabelsVisible);
    }

    /** Toggle a delete icon's visibility with retry. */
    static toggleDelIcon(marker, show, retries = 0) {
      if (!marker) return;
      const el = marker.getElement();
      if (el) {
        const icon = el.querySelector(CONST.SEL.DEL_ICON);
        if (icon) icon.classList.toggle(CONST.CLASSES.VISIBLE, show);
      } else if (retries < CONST.DEL_ICON.RETRY_LIMIT) {
        setTimeout(
          () => MeasureUtils.toggleDelIcon(marker, show, retries + 1),
          CONST.TIMING.DEL_ICON_RETRY_DELAY,
        );
      }
    }

    /** Attach a click handler to a delete icon marker via Leaflet event (survives DOM rebuild). */
    static attachDelClick(delMarker, callback) {
      delMarker.on("click", (ev) => {
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
        iconAnchor: iconAnchor || CONST.LABEL.DEFAULT_ANCHOR,
      });
    }

    /** Create a divIcon for a segment label centered on the line midpoint.
     *  @param {string} html - Text content for the label. */
    static makeMidLabelDivIcon(html) {
      return MeasureUtils.makeLabelDivIcon(
        html,
        CONST.LABEL.MID_ANCHOR,
        CONST.LABEL.CLASS_MID,
      );
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
          iconAnchor: iconAnchor || CONST.DEL_ICON.DEFAULT_ANCHOR,
        }),
        interactive: true,
        ...markerOpts,
      });
    }

    /** Animate a dash-sweep effect on a finalized polyline/polygon. */
    static animateDashSweep(path) {
      if (!path) return;
      const len = path.getTotalLength?.() || 0;
      if (len <= 0) return;
      path.style.setProperty(CONST.STYLE.SWEEP_LENGTH, len);
      path.classList.add(CONST.CLASSES.DASH_SWEEP);
      const onEnd = () => {
        path.removeEventListener("animationend", onEnd);
        path.classList.remove(CONST.CLASSES.DASH_SWEEP);
        path.style.removeProperty(CONST.STYLE.SWEEP_LENGTH);
      };
      path.addEventListener("animationend", onEnd);
    }

    /** Recalculate segments and total distance from a points array.
     * @param {Array} points - Array of L.LatLng
     * @returns {Object} { segments: Array, totalDistance: number }
     */
    static recalculateSegments(points) {
      const segments = [];
      let totalDistance = 0;
      for (let i = 1; i < points.length; i++) {
        const d = MeasureUtils.distance(points[i - 1], points[i]);
        segments.push({ lng: points[i].lng, lat: points[i].lat, distance: d });
        totalDistance += d;
      }
      return { segments, totalDistance };
    }
  }

  // ==================== Mode Base Class ====================
  /** Base class for all measurement modes. Handles map reference, layer group, and cleanup lifecycle. */
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

  // ==================== Preview Mode Base Class ====================
  /** Base class for modes with preview layers (distance, polygon, circle). Tracks and cleans up preview artifacts. */
  class PreviewMode extends MeasureMode {
    constructor(manager) {
      super(manager);
      this.previewLayers = [];
      this.isFinished = false;
    }

    /** Track a preview layer (adds to layer group + tracks for cleanup). */
    addPreview(layer) {
      this.previewLayers.push(layer);
      this.layers.addLayer(layer);
      return layer;
    }

    /** Remove a specific preview layer. */
    removePreview(layer) {
      const idx = this.previewLayers.indexOf(layer);
      if (idx !== -1) this.previewLayers.splice(idx, 1);
      this.layers.removeLayer(layer);
    }

    /** Remove all tracked preview layers. */
    clearPreviews() {
      this.previewLayers.forEach((l) => this.layers.removeLayer(l));
      this.previewLayers = [];
    }
  }

  // ==================== Marker Mode ====================
  /** Marker placement mode. Places a geocoded marker on click. */
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

      // Save the measurement IMMEDIATELY (address resolved later) so the
      // marker survives a page reload even while geocoding is in flight.
      const markerId = this.nextMeasurementId();
      const measurement = {
        id: markerId,
        type: this.type,
        lng: parseFloat(lng),
        lat: parseFloat(lat),
        address: null,
      };
      this.m.measurements.push(measurement);
      this.m.saveMeasurements();

      // createLocationMarker resolves the address async (popup + onAddress
      // callback) — no separate geocode call here to avoid a duplicate request.
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
        (addr) => {
          measurement.address = addr;
          this.m.saveMeasurements();
        },
      );

      const delMarker = this.layers.addLayer(
        MeasureUtils.makeDelIcon(e.latlng, {
          zIndexOffset: CONST.Z_INDEX.OFFSET,
          iconAnchor: CONST.DEL_ICON.MARKER_ANCHOR,
          title: _(`${CONST.name}.del_tooltip`),
        }),
      );

      // Bind delete + popup events BEFORE async geocode so the X works even
      // while the address lookup is still in flight.
      const deleteMarker = () => {
        this.layers.removeLayer(marker);
        this.layers.removeLayer(delMarker);
        this.m.measurements = this.m.measurements.filter((x) => x.id !== markerId);
        this.m.saveMeasurements();
        this.layers.unregister();
      };
      MeasureUtils.attachDelClick(delMarker, deleteMarker);

      // Bind popup events BEFORE async geocode so X appears on first popup open
      marker.on("popupopen", () => {
        MeasureUtils.hideDelIcons();
        if (measurement.address !== null)
          marker.setPopupContent(
            MeasureUtils.buildPopup(lng, lat, measurement.address),
          );
        MeasureUtils.toggleDelIcon(delMarker, true);
      });

      marker.on("popupclose", () => {
        MeasureUtils.toggleDelIcon(delMarker, false);
      });
    }
  }

  // ==================== Distance Mode ====================
  /** Distance measurement mode. Click to place nodes, double-click/context to finish. */
  class DistanceMode extends PreviewMode {
    static TYPE = CONST.MODE.DISTANCE;

    start() {
      const points = [];
      let total = 0;
      const poly = this.addPreview(
        L.polyline([], { className: CONST.CLASSES.LINE_DASHED }),
      );
      const nodeMarkers = [];
      const segLabels = [];
      const previewLine = this.addPreview(
        L.polyline([], { className: CONST.CLASSES.LINE_PREVIEW }),
      );
      const finalPoly = this.layers.addLayer(
        L.polyline([], {
          className: CONST.CLASSES.LINE_SOLID,
          interactive: true,
        }),
      );
      let previewDistLabel = null;

      this._cleanup = () => {
        this.map.off("click", onDistClick);
        this.map.off("dblclick", onDistDbl);
        this.map.off("contextmenu", onDistContext);
        this.map.off("mousemove", onDistMove);
        this.layers.removeLayer(previewLine);
        if (previewDistLabel) {
          this.layers.removeLayer(previewDistLabel);
          previewDistLabel = null;
        }
        this.layers.removeLayer(poly);
        this.layers.removeLayer(finalPoly);
        nodeMarkers.forEach((m) => this.layers.removeLayer(m));
        segLabels.forEach((l) => this.layers.removeLayer(l));
      };

      const finishDist = () => {
        if (this.isFinished) return;
        if (points.length < 2) {
          this.cleanup();
          this.m.clearActiveMode();
          return;
        }
        this.isFinished = true;
        this.layers.removeLayer(poly);
        finalPoly.setLatLngs(points);

        // Dash-sweep animation
        MeasureUtils.animateDashSweep(finalPoly._path);

        // Save measurement data
        const distId = this.nextMeasurementId();
        const segments = points.slice(1).map((p, i) => ({
          lng: p.lng,
          lat: p.lat,
          distance: MeasureUtils.distance(points[i], points[i + 1]),
        }));
        this.m.measurements.push({
          id: distId,
          type: this.type,
          points: points.map((p) => ({ lng: p.lng, lat: p.lat })),
          segments,
          totalDistance: total,
        });
        this.m.saveMeasurements();

        // Format last label
        if (segLabels.length > 0) {
          const lastPt = points[points.length - 1];
          const prevPt = points[points.length - 2];
          const mid = MeasureUtils.midpoint(prevPt, lastPt);
          segLabels[segLabels.length - 1].setLatLng([mid.lat, mid.lng]);
          segLabels[segLabels.length - 1].setIcon(
            MeasureUtils.makeMidLabelDivIcon(
              MeasureUtils.formatSegmentLabel(prevPt, lastPt, total),
            ),
          );
        }

        // Attach toggle/delete UI (shared with restoreDistance)
        const onDistMapClick = this.m.attachDistanceUI({
          layers: this.layers,
          finalPoly,
          nodeMarkers,
          segLabels,
          points: points,
          onDelete: () => {
            this.m.measurements = this.m.measurements.filter((x) => x.id !== distId);
            this.m.saveMeasurements();
          },
          onUpdate: () => {
            const m = this.m.measurements.find((x) => x.id === distId);
            if (!m) return;
            const { segments, totalDistance } =
              MeasureUtils.recalculateSegments(points);
            m.points = points.map((p) => ({ lng: p.lng, lat: p.lat }));
            m.segments = segments;
            m.totalDistance = totalDistance;
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
        if (points.length === 0) return;
        previewLine.setLatLngs([points[points.length - 1], e.latlng]);
        const seg = MeasureUtils.distance(points[points.length - 1], e.latlng);
        const showDist = total + seg;
        const lastPt = points[points.length - 1];
        const mid = MeasureUtils.midpoint(lastPt, e.latlng);
        const labelText = MeasureUtils.formatSegmentLabel(lastPt, e.latlng, showDist);
        if (!previewDistLabel) {
          previewDistLabel = this.layers.addLayer(
            L.marker([mid.lat, mid.lng], {
              icon: MeasureUtils.makeMidLabelDivIcon(labelText),
              interactive: false,
            }),
            true,
          );
        } else {
          previewDistLabel.setLatLng([mid.lat, mid.lng]);
          MeasureUtils.setLabelText(previewDistLabel, labelText);
        }
      };

      const onDistClick = (e) => {
        if (this.m.currentMode !== this.type) return;
        points.push(e.latlng);
        if (previewDistLabel) {
          this.layers.removeLayer(previewDistLabel);
          previewDistLabel = null;
        }
        poly.addLatLng(e.latlng);

        const marker = this.layers.addLayer(MeasureUtils.makeNode(e.latlng));
        marker.bringToFront();
        nodeMarkers.push(marker);

        if (points.length === 1) {
          this.layers.addLayer(
            L.marker(e.latlng, {
              icon: MeasureUtils.makeLabelDivIcon(_(`${CONST.name}.dist_origin`)),
            }),
            true,
          );
        }

        marker.on("click", () => {
          if (points.length < 2) return;
          if (marker === nodeMarkers[nodeMarkers.length - 1]) finishDist();
        });

        if (points.length > 1) {
          const seg = MeasureUtils.distance(
            points[points.length - 2],
            points[points.length - 1],
          );
          total += seg;

          const mid = MeasureUtils.midpoint(
            points[points.length - 2],
            points[points.length - 1],
          );

          if (segLabels.length > 0 && points.length >= 3) {
            const prevLabel = segLabels[segLabels.length - 1];
            const prevSeg = MeasureUtils.distance(
              points[points.length - 3],
              points[points.length - 2],
            );
            prevLabel.setIcon(
              MeasureUtils.makeMidLabelDivIcon(
                MeasureUtils.formatSegmentLabel(
                  points[points.length - 3],
                  points[points.length - 2],
                  prevSeg,
                ),
              ),
            );
          }

          const label = this.layers.addLayer(
            L.marker([mid.lat, mid.lng], {
              icon: MeasureUtils.makeMidLabelDivIcon(
                MeasureUtils.formatSegmentLabel(
                  points[points.length - 2],
                  points[points.length - 1],
                  total,
                ),
              ),
            }),
            true,
          );
          segLabels.push(label);
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

  // ==================== Polygon Area Mode ====================
  /** Polygon area measurement mode. Click to place nodes, closes on first/last node click. */
  class PolygonMode extends PreviewMode {
    static TYPE = CONST.MODE.POLYGON;

    start() {
      const points = [];
      const poly = this.addPreview(
        L.polyline([], { className: CONST.CLASSES.LINE_DASHED }),
      );
      const previewPoly = this.addPreview(
        L.polygon([], { className: CONST.CLASSES.CIRCLE_PREVIEW }),
      );
      const nodeMarkers = [];
      const segLabels = [];
      const finalPoly = this.layers.addLayer(
        L.polygon([], {
          className: CONST.CLASSES.POLYGON_FINAL,
          interactive: true,
        }),
      );
      let previewDistLabel = null;
      let isFinished = false;

      this._cleanup = () => {
        this.map.off("click", onPolyClick);
        this.map.off("dblclick", onPolyDbl);
        this.map.off("contextmenu", onPolyContext);
        this.map.off("mousemove", onPolyMove);
        this.layers.removeLayer(previewPoly);
        this.layers.removeLayer(poly);
        this.layers.removeLayer(finalPoly);
        if (previewDistLabel) {
          this.layers.removeLayer(previewDistLabel);
          previewDistLabel = null;
        }
        nodeMarkers.forEach((m) => this.layers.removeLayer(m));
        segLabels.forEach((l) => this.layers.removeLayer(l));
      };

      const finishPoly = () => {
        if (isFinished) return;
        if (points.length < 3) {
          this.cleanup();
          this.m.clearActiveMode();
          return;
        }
        isFinished = true;
        this.layers.removeLayer(poly);
        this.layers.removeLayer(previewPoly);
        // Close the polygon by appending the first point
        const closedPts = [...points, points[0]];
        finalPoly.setLatLngs(closedPts);

        // Dash-sweep animation
        MeasureUtils.animateDashSweep(finalPoly._path);

        // Calculate area
        const area = MeasureUtils.area(points);

        // Save measurement data
        const polyId = this.nextMeasurementId();
        const segments = points.slice(1).map((p, i) => ({
          lng: p.lng,
          lat: p.lat,
          distance: MeasureUtils.distance(points[i], points[i + 1]),
        }));
        // Add closing segment
        const lastSeg = {
          lng: points[0].lng,
          lat: points[0].lat,
          distance: MeasureUtils.distance(points[points.length - 1], points[0]),
        };
        segments.push(lastSeg);
        this.m.measurements.push({
          id: polyId,
          type: this.type,
          points: points.map((p) => ({ lng: p.lng, lat: p.lat })),
          segments,
          area,
        });
        this.m.saveMeasurements();

        // Add closing segment label
        const lastPt = points[points.length - 1];
        const firstPt = points[0];
        const closeMid = MeasureUtils.midpoint(lastPt, firstPt);
        const closeLabel = this.layers.addLayer(
          L.marker([closeMid.lat, closeMid.lng], {
            icon: MeasureUtils.makeMidLabelDivIcon(
              MeasureUtils.formatDistance(lastSeg.distance),
            ),
          }),
          true,
        );
        segLabels.push(closeLabel);

        // Format last open segment label (if it exists)
        if (segLabels.length > 1) {
          segLabels[segLabels.length - 2].setIcon(
            MeasureUtils.makeMidLabelDivIcon(
              MeasureUtils.formatDistance(segments[segments.length - 2].distance),
            ),
          );
        }

        // Attach toggle/delete UI (shared with restorePolygon)
        const onPolyMapClick = this.m.attachPolygonUI({
          layers: this.layers,
          finalPoly,
          nodeMarkers,
          segLabels,
          points: points,
          area,
          onDelete: () => {
            this.m.measurements = this.m.measurements.filter((x) => x.id !== polyId);
            this.m.saveMeasurements();
          },
          onUpdate: () => {
            const m = this.m.measurements.find((x) => x.id === polyId);
            if (!m) return;
            const newArea = MeasureUtils.area(points);
            const { segments } = MeasureUtils.recalculateSegments(points);
            // Add closing segment
            const n = points.length;
            segments.push({
              lng: points[0].lng,
              lat: points[0].lat,
              distance: MeasureUtils.distance(points[n - 1], points[0]),
            });
            m.points = points.map((p) => ({ lng: p.lng, lat: p.lat }));
            m.segments = segments;
            m.area = newArea;
            this.m.saveMeasurements();
          },
        });
        this._cleanup = () => this.m.map.off("click", onPolyMapClick);
        this.m.finalizedClickHandlers.push(onPolyMapClick);

        // Cleanup drawing mode
        this.map.off("click", onPolyClick);
        this.map.off("dblclick", onPolyDbl);
        this.map.off("contextmenu", onPolyContext);
        this.map.off("mousemove", onPolyMove);
        this.layers.removeLayer(previewPoly);
        if (previewDistLabel) {
          this.layers.removeLayer(previewDistLabel);
          previewDistLabel = null;
        }
        this.m.clearActiveMode();
      };

      const onPolyMove = (e) => {
        if (points.length === 0) return;
        const allPts = [...points, e.latlng];
        previewPoly.setLatLngs(allPts);
        poly.setLatLngs([points[points.length - 1], e.latlng]);
        const seg = MeasureUtils.distance(points[points.length - 1], e.latlng);
        const lastPt = points[points.length - 1];
        const mid = MeasureUtils.midpoint(lastPt, e.latlng);
        const labelText = MeasureUtils.formatDistance(seg);
        if (!previewDistLabel) {
          previewDistLabel = this.layers.addLayer(
            L.marker([mid.lat, mid.lng], {
              icon: MeasureUtils.makeMidLabelDivIcon(labelText),
              interactive: false,
            }),
            true,
          );
        } else {
          previewDistLabel.setLatLng([mid.lat, mid.lng]);
          MeasureUtils.setLabelText(previewDistLabel, labelText);
        }
      };

      const onPolyClick = (e) => {
        if (this.m.currentMode !== this.type) return;
        points.push(e.latlng);
        if (previewDistLabel) {
          this.layers.removeLayer(previewDistLabel);
          previewDistLabel = null;
        }
        poly.addLatLng(e.latlng);
        previewPoly.setLatLngs(points);

        const marker = this.layers.addLayer(MeasureUtils.makeNode(e.latlng));
        marker.bringToFront();
        nodeMarkers.push(marker);

        marker.on("click", () => {
          if (points.length < 3) return;
          // Click first or last point → finish
          if (
            marker === nodeMarkers[0] ||
            marker === nodeMarkers[nodeMarkers.length - 1]
          ) {
            finishPoly();
          }
        });

        if (points.length > 1) {
          const seg = MeasureUtils.distance(
            points[points.length - 2],
            points[points.length - 1],
          );

          if (segLabels.length > 0 && points.length >= 3) {
            const prevLabel = segLabels[segLabels.length - 1];
            const prevSeg = MeasureUtils.distance(
              points[points.length - 3],
              points[points.length - 2],
            );
            prevLabel.setIcon(
              MeasureUtils.makeMidLabelDivIcon(MeasureUtils.formatDistance(prevSeg)),
            );
          }

          const mid = MeasureUtils.midpoint(
            points[points.length - 2],
            points[points.length - 1],
          );
          const label = this.layers.addLayer(
            L.marker([mid.lat, mid.lng], {
              icon: MeasureUtils.makeMidLabelDivIcon(MeasureUtils.formatDistance(seg)),
            }),
            true,
          );
          segLabels.push(label);
        }
      };

      const onPolyDbl = (e) => {
        MeasureUtils.stopEvent(e);
        finishPoly();
      };
      const onPolyContext = (e) => {
        MeasureUtils.stopEvent(e);
        finishPoly();
      };

      this.map.on("click", onPolyClick);
      this.map.on("dblclick", onPolyDbl);
      this.map.on("contextmenu", onPolyContext);
      this.map.on("mousemove", onPolyMove);
    }
  }

  // ==================== Circle Mode ====================
  /** Circle radius measurement mode. Click center, then click edge. */
  class CircleMode extends PreviewMode {
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

      const resetPreviews = () => {
        this.clearPreviews();
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
          previews.center = this.addPreview(
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
          const r = MeasureUtils.distance(center, e.latlng);
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
        const r = MeasureUtils.distance(center, e.latlng);

        if (!previews.circle) {
          previews.circle = this.addPreview(
            L.circle(center, {
              radius: r,
              className: CONST.CLASSES.CIRCLE_PREVIEW,
              interactive: false,
            }),
          );
        } else previews.circle.setRadius(r);

        if (!previews.line) {
          previews.line = this.addPreview(
            L.polyline([center, e.latlng], {
              className: CONST.CLASSES.LINE_PREVIEW,
              interactive: false,
            }),
          );
        } else previews.line.setLatLngs([center, e.latlng]);

        if (!previews.node) {
          previews.node = this.addPreview(
            L.circleMarker(e.latlng, {
              radius: CONST.MARKER.RADIUS,
              className: CONST.CLASSES.NODE_PREVIEW,
              interactive: false,
            }),
          );
          previews.node.bringToFront();
        } else previews.node.setLatLng(e.latlng);

        const mid = MeasureUtils.midpoint(center, e.latlng);
        if (!previews.label) {
          const previewLabel = L.marker(mid, {
            icon: MeasureUtils.makeLabelDivIcon(
              MeasureUtils.formatDistance(r),
              CONST.LABEL.RADIUS_ANCHOR,
              CONST.LABEL.CLASS_RADIUS,
            ),
            interactive: false,
          });
          previews.label = this.addPreview(previewLabel);
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

        const delMarker = this.layers.addLayer(
          MeasureUtils.makeDelIcon(centerLatLng, {
            zIndexOffset: CONST.Z_INDEX.OFFSET,
            title: _(`${CONST.name}.del_tooltip`),
          }),
        );

        const mid = MeasureUtils.midpoint(centerLatLng, finalTargetLatLng);
        const radiusLabel = this.layers.addLayer(
          L.marker([mid.lat, mid.lng], {
            icon: MeasureUtils.makeLabelDivIcon(
              MeasureUtils.formatDistance(r),
              CONST.LABEL.RADIUS_ANCHOR,
              CONST.LABEL.CLASS_RADIUS,
            ),
            interactive: false,
          }),
          true,
        );

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
          delMarker,
          radiusLabel,
          onDelete: () => {
            this.m.measurements = this.m.measurements.filter((x) => x.id !== circleId);
            this.m.saveMeasurements();
          },
        });
        this.m.finalizedClickHandlers.push(onMapClickActive);
      };

      this.map.on("click", onMapClick);
      this.map.on("mousemove", onMouseMove);
      this.map.on("contextmenu", onContext);

      this._cleanup = () => {
        this.map.off("click", onMapClick);
        this.map.off("mousemove", onMouseMove);
        this.map.off("contextmenu", onContext);
        resetPreviews();
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
  /** Central manager for all measurements. Handles persistence, layer management, mode switching, and UI toggle lifecycle. */
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
      this.finalizedClickHandlers = [];
      this.measurements = [];
      this.measurementIdCounter = 0;

      this.bindGlobalEvents();
      this.restoreMeasurements();
    }

    // ── Persistence ──

    /** Persist all measurements to localStorage. */
    saveMeasurements() {
      try {
        localStorage.setItem(CONST.STORAGE.KEY, JSON.stringify(this.measurements));
      } catch (e) {
        console.warn(`[${CONST.name}] ${_(`${CONST.name}.save_fail`)}`, e);
      }
    }

    /** Load measurements from localStorage.
     *  @returns {Array} Restored measurements array. */
    loadMeasurements() {
      try {
        const data = localStorage.getItem(CONST.STORAGE.KEY);
        return data ? JSON.parse(data) : [];
      } catch (e) {
        console.warn(`[${CONST.name}] ${_(`${CONST.name}.load_fail`)}`, e);
        return [];
      }
    }

    /** Generate a unique measurement ID.
     *  @param {string} type - Measurement type.
     *  @returns {string} Unique ID. */
    nextMeasurementId(type) {
      this.measurementIdCounter += 1;
      return `${CONST.ID}_${type}_${Date.now()}_${this.measurementIdCounter}`;
    }

    /** Restore all persisted measurements from localStorage and rebuild their UI. */
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
          case CONST.MODE.POLYGON:
            this.restorePolygon(m);
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
        (addr) => {
          // A marker restored with address:null (e.g. geocode was still in
          // flight when the page was reloaded) resolves its address here and
          // persists it so the next reload shows the address immediately.
          m.address = addr;
          this.saveMeasurements();
        },
        false, // do not auto-open popup on restore
      );
      const delMarker = this.layers.addLayer(
        MeasureUtils.makeDelIcon(L.latLng(m.lat, m.lng), {
          zIndexOffset: CONST.Z_INDEX.OFFSET,
          iconAnchor: CONST.DEL_ICON.MARKER_ANCHOR,
          title: _(`${CONST.name}.del_tooltip`),
        }),
      );

      marker.on("popupopen", () => {
        MeasureUtils.hideDelIcons();
        // Use the latest resolved address so a marker whose geocode finished
        // while the popup was closed still shows the real address on first open
        // (createLocationMarker only updates an open popup).
        if (m.address !== null)
          marker.setPopupContent(MeasureUtils.buildPopup(m.lng, m.lat, m.address));
        MeasureUtils.toggleDelIcon(delMarker, true);
      });
      marker.on("popupclose", () => {
        MeasureUtils.toggleDelIcon(delMarker, false);
      });

      const deleteMarker = () => {
        this.layers.removeLayer(marker);
        this.layers.removeLayer(delMarker);
        this.measurements = this.measurements.filter((x) => x.id !== m.id);
        this.saveMeasurements();
        this.layers.unregister();
      };
      MeasureUtils.attachDelClick(delMarker, deleteMarker);
    }

    restoreDistance(m) {
      const points = m.points.map((p) => L.latLng(p.lat, p.lng));
      const finalPoly = this.layers.addLayer(
        L.polyline(points, {
          className: CONST.CLASSES.LINE_SOLID,
          interactive: true,
        }),
      );

      const nodeMarkers = [];
      points.forEach((pt, i) => {
        const node = this.layers.addLayer(MeasureUtils.makeNode(pt));
        node.bringToFront();
        nodeMarkers.push(node);
      });

      // Restore start label
      this.layers.addLayer(
        L.marker(points[0], {
          icon: MeasureUtils.makeLabelDivIcon(_(`${CONST.name}.dist_origin`)),
        }),
        true,
      );

      const segLabels = [];
      if (m.segments) {
        let accTotal = 0;
        m.segments.forEach((seg, i) => {
          accTotal += seg.distance;
          const prev = points[i];
          const cur = points[i + 1] || { lat: seg.lat, lng: seg.lng };
          if (!prev || !cur) return;
          const mid = MeasureUtils.midpoint(prev, cur);
          const label = this.layers.addLayer(
            L.marker([mid.lat, mid.lng], {
              icon: MeasureUtils.makeMidLabelDivIcon(
                MeasureUtils.formatSegmentLabel(prev, cur, accTotal),
              ),
            }),
            true,
          );
          segLabels.push(label);
        });
      }

      // Attach toggle/delete UI (shared with finishDist)
      this.attachDistanceUI({
        layers: this.layers,
        finalPoly,
        nodeMarkers,
        segLabels,
        points: points,
        onDelete: () => {
          this.measurements = this.measurements.filter((x) => x.id !== m.id);
          this.saveMeasurements();
        },
        onUpdate: () => {
          const { segments, totalDistance } = MeasureUtils.recalculateSegments(points);
          m.points = points.map((p) => ({ lng: p.lng, lat: p.lat }));
          m.segments = segments;
          m.totalDistance = totalDistance;
          this.saveMeasurements();
        },
      });
    }

    restorePolygon(m) {
      const points = m.points.map((p) => L.latLng(p.lat, p.lng));
      const closedPts = [...points, points[0]];
      const finalPoly = this.layers.addLayer(
        L.polygon(closedPts, {
          className: CONST.CLASSES.POLYGON_FINAL,
          interactive: true,
        }),
      );

      const nodeMarkers = [];
      points.forEach((pt) => {
        const node = this.layers.addLayer(MeasureUtils.makeNode(pt));
        node.bringToFront();
        nodeMarkers.push(node);
      });

      const segLabels = [];
      if (m.segments) {
        m.segments.forEach((seg, i) => {
          const prev = points[i];
          const cur = points[i + 1] || { lat: seg.lat, lng: seg.lng };
          if (!prev || !cur) return;
          const mid = MeasureUtils.midpoint(prev, cur);
          const label = this.layers.addLayer(
            L.marker([mid.lat, mid.lng], {
              icon: MeasureUtils.makeMidLabelDivIcon(
                MeasureUtils.formatDistance(seg.distance),
              ),
            }),
            true,
          );
          segLabels.push(label);
        });
      }

      // Attach toggle/delete UI (shared with finishPoly)
      const { onMapClickActive } = this.attachPolygonUI({
        layers: this.layers,
        finalPoly,
        nodeMarkers,
        segLabels,
        points: points,
        area: m.area,
        onDelete: () => {
          this.measurements = this.measurements.filter((x) => x.id !== m.id);
          this.saveMeasurements();
        },
        onUpdate: () => {
          const newArea = MeasureUtils.area(points);
          const { segments } = MeasureUtils.recalculateSegments(points);
          // Add closing segment
          const n = points.length;
          segments.push({
            lng: points[0].lng,
            lat: points[0].lat,
            distance: MeasureUtils.distance(points[n - 1], points[0]),
          });
          m.points = points.map((p) => ({ lng: p.lng, lat: p.lat }));
          m.segments = segments;
          m.area = newArea;
          this.saveMeasurements();
        },
      });
      this.finalizedClickHandlers.push(onMapClickActive);
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

      const delMarker = this.layers.addLayer(
        MeasureUtils.makeDelIcon(centerLatLng, {
          zIndexOffset: CONST.Z_INDEX.OFFSET,
          title: _(`${CONST.name}.del_tooltip`),
        }),
      );

      const mid = MeasureUtils.midpoint(centerLatLng, targetLatLng);
      const radiusLabel = this.layers.addLayer(
        L.marker([mid.lat, mid.lng], {
          icon: MeasureUtils.makeLabelDivIcon(
            MeasureUtils.formatDistance(r),
            CONST.LABEL.RADIUS_ANCHOR,
            CONST.LABEL.CLASS_RADIUS,
          ),
          interactive: false,
        }),
        true,
      );

      // Attach toggle/delete UI (shared with finalizeCircle)
      const { onMapClickActive } = this.attachCircleUI({
        layers: this.layers,
        circle,
        radiusLine,
        radiusNode,
        centerFinal,
        delMarker,
        radiusLabel,
        onDelete: () => {
          this.measurements = this.measurements.filter((x) => x.id !== m.id);
          this.saveMeasurements();
        },
      });
      // Track the handler so clearAll()/destroy() can unbind it (same as
      // finalizeCircle does for freshly drawn circles).
      this.finalizedClickHandlers.push(onMapClickActive);
    }

    /** Bind global map click, keydown, and unload events. */
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

      // On map unload (page refresh/close), clear transient UI state but KEEP
      // persisted measurements. clearAll() would wipe localStorage, losing all
      // saved data on every reload.
      this.onUnload = () => {
        this.clearActiveMode();
        this.layers.clearLayers();
        this.finalizedClickHandlers.forEach((h) => this.map.off("click", h));
        this.finalizedClickHandlers = [];
      };
      this.map.on("unload", this.onUnload);
    }

    /**
     * Attach toggle/delete UI to a completed distance measurement.
     * Shared by finishDist (DistanceMode) and restoreDistance (MeasureManager).
     * @param {Object} opts
     * @param {Object} opts.layers     - createLayers API object
     * @param {Object} opts.finalPoly  - L.Polyline
     * @param {Array}  opts.nodeMarkers - L.CircleMarker[]
     * @param {Array}  opts.segLabels   - Label L.Marker[]
     * @param {Array}  opts.points     - LatLng array
     * @param {Function} opts.onDelete - Called when user deletes the measurement
     * @param {Function} opts.onUpdate - Called when points are modified (node deletion)
     * @returns {Function} cleanup(mapClickHandler) to remove map click listener
     */
    attachDistanceUI(opts) {
      const { layers, finalPoly, nodeMarkers, segLabels, onDelete, onUpdate, points } =
        opts;
      let isLabelsVisible = true;
      let isXVisible = false;
      const nodeDelIcons = [];

      const toggleUI = (showX, toggleLabels) => {
        const s = MeasureUtils.calcToggle(
          isXVisible,
          isLabelsVisible,
          showX,
          toggleLabels,
        );
        isXVisible = s.isXVisible;
        isLabelsVisible = s.isLabelsVisible;
        nodeDelIcons.forEach((m) => MeasureUtils.toggleDelIcon(m, isXVisible));
        MeasureUtils.applyToggle(null, isXVisible, segLabels, isLabelsVisible, null);
      };

      const handleItemClick = (e) => {
        MeasureUtils.stopEvent(e);
        MeasureUtils.suppressHide(this);
        toggleUI(undefined);
      };

      finalPoly.on("click", handleItemClick);
      nodeMarkers.forEach((m) => m.on("click", handleItemClick));
      segLabels.forEach((l) => l.on("click", handleItemClick));
      toggleUI(false, CONST.TOGGLE.RESET);

      const onMapClickActive = () => {
        if (this.isSuppressHideDel) return;
        if (isXVisible) toggleUI(false, CONST.TOGGLE.RESET);
      };
      this.map.on("click", onMapClickActive);

      const deleteMeas = () => {
        layers.removeLayer(finalPoly, ...nodeMarkers, ...segLabels, ...nodeDelIcons);
        this.map.off("click", onMapClickActive);
        onDelete();
        layers.unregister();
      };

      // Create a delete icon for each node
      nodeMarkers.forEach((node, idx) => {
        const isFirst = idx === 0;
        const isLastWhenTwo = points.length === 2 && idx === 1;
        const delMarker = layers.addLayer(
          MeasureUtils.makeDelIcon(node.getLatLng(), {
            zIndexOffset: CONST.Z_INDEX.OFFSET,
            title:
              isFirst || isLastWhenTwo
                ? _(`${CONST.name}.del_all`)
                : _(`${CONST.name}.del_node`),
          }),
        );
        nodeDelIcons.push(delMarker);

        if (isFirst || isLastWhenTwo)
          // First node or last node when only 2 points → delete entire measurement
          MeasureUtils.attachDelClick(delMarker, deleteMeas);
        else {
          // Other nodes X → delete this point only
          MeasureUtils.attachDelClick(delMarker, () => {
            // Find the current index in the (possibly-shifted) points array
            const latlng = node.getLatLng();
            const ptIdx = points.findIndex(
              (p) =>
                Math.abs(p.lat - latlng.lat) < 0.0001 &&
                Math.abs(p.lng - latlng.lng) < 0.0001,
            );
            if (ptIdx === -1) return;
            // segLabels[i] corresponds to points[i+1]
            const lblIdx = ptIdx - 1;
            // Remove the point and its associated DOM elements
            points.splice(ptIdx, 1);
            layers.removeLayer(node, delMarker);
            if (lblIdx >= 0 && lblIdx < segLabels.length) {
              layers.removeLayer(segLabels[lblIdx]);
              segLabels.splice(lblIdx, 1);
            }

            nodeMarkers.splice(ptIdx, 1);
            nodeDelIcons.splice(ptIdx, 1);

            if (points.length < 2) {
              deleteMeas();
              return;
            }

            // When only 2 points remain, update the last node's X to delete all
            if (points.length === 2 && nodeDelIcons.length === 2) {
              const lastDel = nodeDelIcons[1];
              if (lastDel) {
                lastDel.off("click");
                lastDel.on("click", (e) => {
                  const t = e.originalEvent?.target;
                  if (t?.classList?.contains(CONST.DEL_ICON.CLASS)) {
                    MeasureUtils.stopEvent(e);
                    deleteMeas();
                  }
                });
                // Update title on the icon element directly
                const iconEl = lastDel._icon || lastDel.getElement();
                if (iconEl) iconEl.title = _(`${CONST.name}.del_all`);
              }
            }

            // Recalculate the polyline
            finalPoly.setLatLngs(points);

            // Reposition and update ALL remaining segment labels
            segLabels.forEach((label, i) => {
              const mid = MeasureUtils.midpoint(points[i], points[i + 1]);
              label.setLatLng([mid.lat, mid.lng]);
              label.setIcon(
                MeasureUtils.makeMidLabelDivIcon(
                  MeasureUtils.formatSegmentLabel(
                    points[i],
                    points[i + 1],
                    MeasureUtils.distance(points[i], points[i + 1]),
                  ),
                ),
              );
            });

            if (onUpdate) onUpdate();
          });
        }

        delMarker.on("click", (e) => {
          const t = e.originalEvent?.target;
          if (t?.classList?.contains(CONST.DEL_ICON.CLASS)) return;
          handleItemClick(e);
        });
      });

      // Re-sort to ensure correct ordering
      nodeMarkers.forEach((m) => layers.removeLayer(m));
      nodeDelIcons.forEach((m) => layers.removeLayer(m));
      segLabels.forEach((l) => layers.removeLayer(l));
      nodeMarkers.forEach((m) => layers.addLayer(m));
      nodeDelIcons.forEach((m) => layers.addLayer(m));
      segLabels.forEach((l) => layers.addLayer(l));

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
     * @param {Object} opts.delMarker  - Delete icon L.Marker
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
        delMarker,
        radiusLabel,
        onDelete,
      } = opts;
      let isLabelsVisible = true;
      let isXVisible = false;
      let isDeleted = false;

      const toggleUI = (showX, toggleLabels) => {
        const s = MeasureUtils.calcToggle(
          isXVisible,
          isLabelsVisible,
          showX,
          toggleLabels,
        );
        isXVisible = s.isXVisible;
        isLabelsVisible = s.isLabelsVisible;
        MeasureUtils.applyToggle(
          delMarker,
          isXVisible,
          [radiusLabel],
          isLabelsVisible,
          null,
          (xv) => {
            if (delMarker.setZIndexOffset)
              delMarker.setZIndexOffset(
                xv ? CONST.Z_INDEX.OFFSET * 2 : CONST.Z_INDEX.OFFSET,
              );
            MeasureUtils.toggleVisibility(
              [radiusLine?.getElement(), radiusNode?.getElement()],
              isLabelsVisible,
            );
          },
        );
      };
      toggleUI(false, CONST.TOGGLE.RESET);

      const toggleCircleToggle = () => {
        if (isDeleted) return;
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

      attachInteraction(delMarker);
      attachInteraction(circle);
      attachInteraction(radiusLine);
      attachInteraction(radiusNode);
      attachInteraction(centerFinal);
      if (radiusLabel) attachInteraction(radiusLabel);

      const onMapClickActive = () => {
        if (this.isSuppressHideDel || isDeleted) return;
        if (isXVisible) toggleUI(false, CONST.TOGGLE.RESET);
      };
      this.map.on("click", onMapClickActive);

      const deleteCircle = () => {
        if (isDeleted) return;
        isDeleted = true;
        layers.removeLayer(
          delMarker,
          circle,
          centerFinal,
          radiusLine,
          radiusNode,
          radiusLabel,
        );
        this.map.off("click", onMapClickActive);
        const idx = this.finalizedClickHandlers.indexOf(onMapClickActive);
        if (idx !== -1) this.finalizedClickHandlers.splice(idx, 1);
        onDelete();
        layers.unregister();
      };
      MeasureUtils.attachDelClick(delMarker, deleteCircle);

      return { onMapClickActive, deleteCircle };
    }

    /**
     * Attach toggle/delete UI to a completed polygon measurement.
     * Shared by finishPoly (PolygonMode) and restorePolygon (MeasureManager).
     * @param {Object} opts
     * @param {Object} opts.layers     - createLayers API object
     * @param {Object} opts.finalPoly  - L.Polygon
     * @param {Array}  opts.nodeMarkers - L.CircleMarker[]
     * @param {Array}  opts.segLabels   - Label L.Marker[]
     * @param {Array}  opts.points     - LatLng array
     * @param {number} opts.area       - Area in square meters
     * @param {Function} opts.onDelete - Called when user deletes the measurement
     * @param {Function} opts.onUpdate - Called when points are modified
     */
    attachPolygonUI(opts) {
      const {
        layers,
        finalPoly,
        nodeMarkers,
        segLabels,
        onDelete,
        onUpdate,
        points,
        area,
      } = opts;
      let isLabelsVisible = true;
      let isXVisible = false;
      const nodeDelIcons = [];
      let centroidLabel = null;
      let centroidDot = null;
      let centroidDel = null;

      const rebuildCentroid = (showX, currentArea) => {
        // Remove old centroid elements
        if (centroidLabel) layers.removeLayer(centroidLabel);
        if (centroidDot) layers.removeLayer(centroidDot);
        if (centroidDel) layers.removeLayer(centroidDel);

        // Calculate centroid (arithmetic mean of vertices)
        const centroid = MeasureUtils.centroid(points);
        const a = currentArea !== undefined ? currentArea : area;

        centroidDot = layers.addLayer(
          L.marker(centroid, {
            icon: L.divIcon({
              className: CONST.CENTER_DOT.CLASS_FINAL,
              html: "",
              iconSize: CONST.CENTER_DOT.SIZE,
              iconAnchor: CONST.CENTER_DOT.ANCHOR,
            }),
            zIndexOffset: CONST.Z_INDEX.OFFSET,
            interactive: true,
          }),
          true,
        );

        centroidLabel = layers.addLayer(
          L.marker(centroid, {
            icon: MeasureUtils.makeLabelDivIcon(
              MeasureUtils.formatArea(a),
              CONST.LABEL.CENTROID_ANCHOR,
            ),
            interactive: false,
          }),
          true,
        );

        centroidDel = layers.addLayer(
          MeasureUtils.makeDelIcon(centroid, {
            zIndexOffset: CONST.Z_INDEX.OFFSET,
            title: _(`${CONST.name}.del_all`),
          }),
        );
        MeasureUtils.attachDelClick(centroidDel, deleteMeas);

        // Toggle visibility based on current state
        if (showX !== undefined) MeasureUtils.toggleDelIcon(centroidDel, showX);
      };

      const deleteMeas = () => {
        layers.removeLayer(finalPoly, ...nodeMarkers, ...segLabels, ...nodeDelIcons);
        if (centroidDot) layers.removeLayer(centroidDot);
        if (centroidLabel) layers.removeLayer(centroidLabel);
        if (centroidDel) layers.removeLayer(centroidDel);
        onDelete();
        layers.unregister();
      };

      const toggleUI = (showX, toggleLabels) => {
        const s = MeasureUtils.calcToggle(
          isXVisible,
          isLabelsVisible,
          showX,
          toggleLabels,
        );
        isXVisible = s.isXVisible;
        isLabelsVisible = s.isLabelsVisible;
        nodeDelIcons.forEach((m) => MeasureUtils.toggleDelIcon(m, isXVisible));
        MeasureUtils.toggleDelIcon(centroidDel, isXVisible);
        MeasureUtils.applyToggle(null, isXVisible, segLabels, isLabelsVisible, null);
        // Also toggle centroid label visibility
        if (centroidLabel) {
          const el = centroidLabel.getElement();
          if (el) {
            const label = el.querySelector(CONST.SEL.LABEL);
            if (label) label.classList.toggle(CONST.CLASSES.HIDDEN, !isLabelsVisible);
          }
        }
      };

      const handleItemClick = (e) => {
        MeasureUtils.stopEvent(e);
        MeasureUtils.suppressHide(this);
        toggleUI(undefined);
      };

      finalPoly.on("click", handleItemClick);
      nodeMarkers.forEach((m) => m.on("click", handleItemClick));
      segLabels.forEach((l) => l.on("click", handleItemClick));

      // Create centroid
      rebuildCentroid(false);
      if (centroidDot) centroidDot.on("click", handleItemClick);
      if (centroidDel) centroidDel.on("click", handleItemClick);

      toggleUI(false, CONST.TOGGLE.RESET);

      const onMapClickActive = () => {
        if (this.isSuppressHideDel) return;
        if (isXVisible) toggleUI(false, CONST.TOGGLE.RESET);
      };
      this.map.on("click", onMapClickActive);

      // Create delete icons for each node
      nodeMarkers.forEach((node) => {
        const is3pt = points.length === 3;
        const delMarker = layers.addLayer(
          MeasureUtils.makeDelIcon(node.getLatLng(), {
            zIndexOffset: CONST.Z_INDEX.OFFSET,
            title: is3pt ? _(`${CONST.name}.del_all`) : _(`${CONST.name}.del_node`),
          }),
        );
        nodeDelIcons.push(delMarker);

        if (is3pt) MeasureUtils.attachDelClick(delMarker, deleteMeas);
        else
          MeasureUtils.attachDelClick(delMarker, () => {
            const latlng = node.getLatLng();
            const ptIdx = points.findIndex(
              (p) =>
                Math.abs(p.lat - latlng.lat) < 0.0001 &&
                Math.abs(p.lng - latlng.lng) < 0.0001,
            );
            if (ptIdx === -1) return;
            points.splice(ptIdx, 1);
            layers.removeLayer(node, delMarker);
            nodeMarkers.splice(ptIdx, 1);
            nodeDelIcons.splice(ptIdx, 1);

            // Remove all old segLabels and rebuild from scratch
            segLabels.forEach((l) => layers.removeLayer(l));
            segLabels.length = 0;

            if (points.length < 3) {
              deleteMeas();
              return;
            }

            // When exactly 3 points remain, every node X should delete all
            if (points.length === 3) {
              nodeDelIcons.forEach((d) => {
                d.off("click");
                d.on("click", (ev) => {
                  const t = ev.originalEvent?.target;
                  if (t?.classList?.contains(CONST.DEL_ICON.CLASS)) {
                    MeasureUtils.stopEvent(ev);
                    deleteMeas();
                  } else handleItemClick(ev);
                });
                const iconEl = d._icon || d.getElement();
                if (iconEl) iconEl.title = _(`${CONST.name}.del_all`);
              });
            }

            // Recalculate polygon
            finalPoly.setLatLngs([...points, points[0]]);

            // Recalculate area
            const newArea = MeasureUtils.area(points);
            if (centroidLabel)
              MeasureUtils.setLabelText(
                centroidLabel,
                MeasureUtils.formatArea(newArea),
              );

            // Rebuild ALL segment labels from scratch
            const n = points.length;
            for (let i = 0; i < n; i++) {
              const next = (i + 1) % n;
              const mid = MeasureUtils.midpoint(points[i], points[next]);
              const label = layers.addLayer(
                L.marker([mid.lat, mid.lng], {
                  icon: MeasureUtils.makeMidLabelDivIcon(
                    MeasureUtils.formatDistance(
                      MeasureUtils.distance(points[i], points[next]),
                    ),
                  ),
                }),
                true,
              );
              segLabels.push(label);
              label.on("click", handleItemClick);
            }

            // Rebuild centroid position
            rebuildCentroid(isXVisible, newArea);

            if (onUpdate) {
              opts.area = newArea;
              onUpdate();
            }
          });

        delMarker.on("click", (e) => {
          const t = e.originalEvent?.target;
          if (t?.classList?.contains(CONST.DEL_ICON.CLASS)) return;
          handleItemClick(e);
        });
      });

      // Re-sort layers
      nodeMarkers.forEach((m) => layers.removeLayer(m));
      nodeDelIcons.forEach((m) => layers.removeLayer(m));
      segLabels.forEach((l) => layers.removeLayer(l));
      nodeMarkers.forEach((m) => layers.addLayer(m));
      nodeDelIcons.forEach((m) => layers.addLayer(m));
      segLabels.forEach((l) => layers.addLayer(l));

      return onMapClickActive;
    }

    /** Activate a measurement mode. Clears previous mode if active.
     *  @param {string} mode - Mode key from CONST.MODE. */
    setMode(mode) {
      if (mode === CONST.MODE.CLEAR) {
        this.clearAll();
        return;
      }
      if (this.currentMode === mode) {
        this.clearActiveMode();
        return;
      }

      // Re-register the measure layer so it's visible and on top when the user
      // activates a measurement tool, even if the layer was previously
      // hidden or re-ordered in the LayerControl panel.
      this.layers.register();

      this.cleanMapEvents();
      this.currentMode = mode;

      this.toolBtns.forEach((btn) =>
        btn.classList.toggle(CONST.CLASSES.ACTIVE, btn.dataset.mode === mode),
      );

      this.map.getContainer().classList.add(CONST.CLASSES.MEASURING);

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
      } else if (mode === CONST.MODE.POLYGON) {
        foliplus.showHint(
          CONST.name,
          _(`${CONST.name}.hint_polygon`),
          foliplus.HINT_DURATION.PERSIST,
        );
        this.modeInstance = new PolygonMode(this);
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

    /** Deactivate current mode, clean up events, and hide hints. */
    clearActiveMode() {
      this.currentMode = null;
      this.toolBtns.forEach((btn) => btn.classList.remove(CONST.CLASSES.ACTIVE));
      foliplus.hideHint(CONST.name);
      this.map.getContainer().classList.remove(CONST.CLASSES.MEASURING);
      this.cleanMapEvents();
    }

    /** Clear all measurements, layers, and persisted data. */
    clearAll() {
      this.layers.clearLayers();
      this.measurements = [];
      this.saveMeasurements();
      this.clearActiveMode();
      // Unbind all finalized-circle map click handlers; clearLayers removed
      // their targets so they would otherwise dangle until destroy().
      this.finalizedClickHandlers.forEach((h) => this.map.off("click", h));
      this.finalizedClickHandlers = [];
      // Collapse the panel after clearing all measurements
      if (this.ctrl) {
        this.ctrl.classList.remove(CONST.CLASSES.EXPANDED);
        this.ctrl.classList.add(CONST.CLASSES.COLLAPSED);
        foliplus.adjustPanelZIndex({ container: this.ctrl, expanded: false });
      }
    }

    /** Full cleanup including global events. Called on control removal. */
    destroy() {
      // Unbind onUnload first to prevent theoretical recursion if clearAll triggers unload
      if (this.onUnload) {
        this.map.off("unload", this.onUnload);
        this.onUnload = null;
      }
      this.clearAll();
      if (this.onMapClick) {
        this.map.off("click", this.onMapClick);
        this.onMapClick = null;
      }
      if (this.onKeyDown) {
        document.removeEventListener("keydown", this.onKeyDown);
        this.onKeyDown = null;
      }
      this.finalizedClickHandlers.forEach((h) => this.map.off("click", h));
      this.finalizedClickHandlers = [];
    }

    /** Clean up current mode instance and hide hints. */
    cleanMapEvents() {
      if (this.modeInstance) {
        this.modeInstance.cleanup();
        this.modeInstance = null;
      }
      foliplus.hideHint(CONST.name);
    }
  }

  const measureManager = new MeasureManager(map);

  /** Leaflet control wrapper for the MeasureManager. Handles DOM creation and tool button events. */
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
      this.ctrl = ctrl;
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
          mode: CONST.MODE.POLYGON,
          title: _(`${CONST.name}.tool_polygon`),
          svg: SVGs.POLYGON,
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
        foliplus.dom.el(
          "button",
          { class: "foliplus-tool-btn", "data-mode": mode, title, parent: toolBar },
          { html: svg },
        );
      });
      this.m.ctrl = ctrl;
      this.m.toolBtns = toolBar.querySelectorAll(CONST.SEL.TOOL_BTN);

      toggleBtn.onclick = (e) => {
        e.stopPropagation();
        const expanding = ctrl.classList.contains(CONST.CLASSES.COLLAPSED);
        ctrl.classList.toggle(CONST.CLASSES.COLLAPSED);
        ctrl.classList.toggle(CONST.CLASSES.EXPANDED);
        foliplus.adjustPanelZIndex({ container: ctrl, expanded: expanding });
      };

      // Collapse when clicking outside, but NOT when a tool is active
      foliplus.bindOutsideCollapse({
        container: ctrl,
        skipCheck: () => this.m.currentMode !== null,
      });

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
