(function () {
  // ==================== Constants ====================
  const CONST = {
    name: "MeasureControl",
    MARKER_RADIUS: 5,
    CLICK_COOLDOWN_MS: 300,
    FINALIZE_DELAY_MS: 50,
    DEL_ICON_RETRY_LIMIT: 10,
    DEL_ICON_RETRY_DELAY_MS: 50,
    SUPPRESS_HIDE_DELAY_MS: 100,
    Z_INDEX_OFFSET: 1000,
    CENTER_DOT_SIZE: [12, 12],
    CENTER_DOT_ANCHOR: [6, 6],
    LABEL_ANCHOR: [0, -10],
    LAT_LNG_PRECISION: 6,
    MEASURE_ID: "foliplus_measure",
    GRAPH_PANE: "measure_graph",
    LABEL_PANE: "measure_label",
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
  const SVGS = {
    RULER: `
      <svg viewBox="0 0 24 24" class="ruler-icon">
        <rect x="1" y="7" width="22" height="9" rx="1"/>
        <path d="M5 7v3M9 7v2M13 7v3M17 7v2"/>
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

  window.foliplus.registerHintIcon(CONST.name, SVGS.RULER);

  // ==================== Utility Classes ====================
  class MeasureUtils {
    static stopEvent(e) {
      const d = e.originalEvent || e;
      d?.stopPropagation?.();
      d?.preventDefault?.();
    }

    static formatDistance(meters) {
      return meters >= 1000
        ? (meters / 1000).toFixed(1) + " " + _(`${CONST.name}.unit_km`)
        : Math.round(meters) + " " + _(`${CONST.name}.unit_m`);
    }

    static distance(lat1, lng1, lat2, lng2) {
      return L.latLng(lat1, lng1).distanceTo(L.latLng(lat2, lng2));
    }

    static toggleVisibility(elements, visible) {
      elements.forEach((el) => {
        if (el) el.classList.toggle("measure-hidden", !visible);
      });
    }

    static suppressHide(manager) {
      manager.suppressHideDel = true;
      setTimeout(() => {
        manager.suppressHideDel = false;
      }, CONST.SUPPRESS_HIDE_DELAY_MS);
      this.hideAllDelIcons();
    }

    static hideAllDelIcons() {
      document
        .querySelectorAll(".measure-del-icon.visible")
        .forEach((el) => el.classList.remove("visible"));
    }

    static calcToggle(curX, curLabels, showX, toggleLbl) {
      const newX = showX !== undefined ? showX : !curX;
      let newL = curLabels;
      if (toggleLbl === true) newL = !curLabels;
      else if (toggleLbl === false) newL = false;
      else if (toggleLbl === "reset") newL = true;
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
          const lbl = el.querySelector(".measure-label");
          if (lbl) lbl.style.display = dsp;
        }
      });

      if (extraLbl) {
        const sEl = extraLbl.getElement();
        if (sEl) {
          const sL = sEl.querySelector(".measure-label");
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
        const icon = el.querySelector(".measure-del-icon");
        if (icon) icon.classList.toggle("visible", show);
      } else if (retries < CONST.DEL_ICON_RETRY_LIMIT) {
        setTimeout(
          () => MeasureUtils.toggleDelIcon(mkr, show, retries + 1),
          CONST.DEL_ICON_RETRY_DELAY_MS,
        );
      }
    }

    /** Attach a click handler to a delete icon marker with retry for DOM readiness. */
    static attachDelClick(delMkr, callback) {
      setTimeout(() => {
        const el = delMkr.getElement();
        if (el) {
          const btn = el.querySelector(".measure-del-icon");
          if (btn) {
            L.DomEvent.on(btn, "click", (ev) => {
              MeasureUtils.stopEvent(ev);
              callback();
            });
          }
        }
      }, CONST.DEL_ICON_RETRY_DELAY_MS);
    }

    /** Update a label marker's text content. Caches DOM reference on first call. */
    static setLabelText(marker, text) {
      if (!marker.labelEl) {
        const el = marker.getElement();
        if (el) marker.labelEl = el.querySelector(".measure-label");
      }
      if (marker.labelEl) marker.labelEl.textContent = text;
    }

    /** Remove multiple layers from a mainLayer in one call. */
    static removeLayers(mainLayer, ...layers) {
      layers.forEach((l) => {
        if (l != null) mainLayer.removeLayer(l);
      });
    }

    /** Build popup HTML for a marker location. */
    static buildPopup(lat, lng, addr) {
      return window.foliplus.buildPopupHtml(
        lat,
        lng,
        addr,
        `${CONST.name}.popup_title`,
        `${CONST.name}.popup_loading`,
        `${CONST.name}.popup_loc_label`,
        `${CONST.name}.popup_addr_label`,
      );
    }

    /** Create a divIcon for a label marker. */
    static makeLabelDivIcon(html) {
      return L.divIcon({
        className: "",
        html: `<div class="measure-label">${html}</div>`,
        iconSize: [0, 0],
        iconAnchor: CONST.LABEL_ANCHOR,
      });
    }

    /** Create a measure node circle marker. */
    static makeNode(latlng, className = "measure-node measure-node-final") {
      return L.circleMarker(latlng, {
        radius: CONST.MARKER_RADIUS,
        className,
      });
    }

    /** Create a delete icon marker. */
    static makeDelIcon(latlng, opts = {}) {
      return L.marker(latlng, {
        icon: L.divIcon({
          className: "del-icon-wrap",
          html: '<span class="measure-del-icon">✕</span>',
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
        interactive: true,
        ...opts,
      });
    }
  }

  // ==================== Core Manager ====================
  class MeasureManager {
    constructor(mapInstance) {
      this.map = mapInstance;
      this.layers = window.foliplus.LayerControlAPI.createLayers({
        id: CONST.MEASURE_ID,
        name: _(`${CONST.name}.tool_toggle`),
        graphPane: CONST.GRAPH_PANE,
        labelPane: CONST.LABEL_PANE,
        iconSvg: SVGS.RULER,
      });
      this.currentMode = null;
      this.cleanupFn = null;
      this.suppressHideDel = false;
      this.toolBtns = [];

      this.bindGlobalEvents();
    }

    bindGlobalEvents() {
      this.onMapClick = (e) => {
        if (this.suppressHideDel) return;
        const t = e.originalEvent?.target;
        if (t?.closest?.(".measure-del-icon")) return;
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

      this.cleanMapEvents();
      this.currentMode = mode;

      this.toolBtns.forEach((btn) =>
        btn.classList.toggle("active", btn.dataset.mode === mode),
      );

      this.map.getContainer().classList.add("is-measuring");

      if (mode === "marker") {
        window.foliplus.showHint(
          CONST.name,
          _(`${CONST.name}.hint_marker`),
          window.foliplus.HINT_DURATION.PERSIST,
        );
        this.bindMarkerMode();
      } else if (mode === "distance") {
        window.foliplus.showHint(
          CONST.name,
          _(`${CONST.name}.hint_dist_start`),
          window.foliplus.HINT_DURATION.PERSIST,
        );
        this.startDistanceMode();
      } else if (mode === "circle") {
        window.foliplus.showHint(
          CONST.name,
          _(`${CONST.name}.hint_circle_start`),
          window.foliplus.HINT_DURATION.PERSIST,
        );
        this.startCircleMode();
      }
    }

    clearActiveMode() {
      this.currentMode = null;
      this.toolBtns.forEach((btn) => btn.classList.remove("active"));
      window.foliplus.hideHint(CONST.name);
      this.map.getContainer().classList.remove("is-measuring");
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
    }

    cleanMapEvents() {
      if (this.onMarkerClickRef) {
        this.map.off("click", this.onMarkerClickRef);
        this.onMarkerClickRef = null;
      }
      if (this.cleanupFn) {
        this.cleanupFn();
        this.cleanupFn = null;
      }
      window.foliplus.hideHint(CONST.name);
    }

    // --- Marker (Locate) Mode ---
    bindMarkerMode() {
      this.onMarkerClickRef = this.handleMarkerClick.bind(this);
      this.map.on("click", this.onMarkerClickRef);
      this.cleanupFn = () => this.map.off("click", this.onMarkerClickRef);
    }

    async handleMarkerClick(e) {
      if (this.currentMode !== "marker") return;
      const lat = e.latlng.lat.toFixed(CONST.LAT_LNG_PRECISION);
      const lng = e.latlng.lng.toFixed(CONST.LAT_LNG_PRECISION);

      const marker = window.foliplus.createLocationMarker(
        this.map,
        parseFloat(lat),
        parseFloat(lng),
        null,
        `${CONST.name}.popup_title`,
        `${CONST.name}.popup_loading`,
        `${CONST.name}.popup_loc_label`,
        `${CONST.name}.popup_addr_label`,
        null,
        this.layers.mainLayer,
      );

      let cachedAddr = null;
      setTimeout(() => this.injectDelIcon(marker), CONST.DEL_ICON_RETRY_DELAY_MS);
      this.layers.register();

      const addr = await window.foliplus.reverseGeocode(
        this.map,
        parseFloat(lat),
        parseFloat(lng),
      );
      cachedAddr = addr;

      if (marker?.getPopup?.()?.isOpen()) {
        marker.setPopupContent(MeasureUtils.buildPopup(lat, lng, addr));
      }

      marker.on("popupopen", () => {
        MeasureUtils.hideAllDelIcons();
        if (cachedAddr !== null)
          marker.setPopupContent(MeasureUtils.buildPopup(lat, lng, cachedAddr));
        this.injectDelIcon(marker);
        const el = marker.getElement();
        if (el) {
          const icon = el.querySelector(".measure-del-icon");
          if (icon) icon.classList.add("visible");
        }
      });

      marker.on("popupclose", () => {
        const el = marker.getElement();
        if (el) {
          const icon = el.querySelector(".measure-del-icon");
          if (icon) icon.classList.remove("visible");
        }
      });
    }

    injectDelIcon(marker) {
      const el = marker.getElement();
      if (!el) return;
      if (el.querySelector(".measure-del-icon")) return;

      const iconDiv = el.querySelector("div");
      if (!iconDiv) return;

      const xIcon = foliplus.dom.el(
        "span",
        { class: "measure-del-icon marker-del-icon" },
        "✕",
      );
      iconDiv.appendChild(xIcon);

      L.DomEvent.on(xIcon, "click", (ev) => {
        MeasureUtils.stopEvent(ev);
        this.layers.mainLayer.removeLayer(marker);
        this.layers.unregister();
      });
    }

    // --- Distance Measurement Mode ---
    startDistanceMode() {
      const pts = [];
      let total = 0;
      const poly = L.polyline([], { className: "measure-line measure-line-dashed" });
      const nodeMarkers = [];
      const segLabels = [];
      let startLbl = null;

      const previewLine = L.polyline([], {
        className: "measure-line measure-line-preview",
      });

      // Empty placeholders go directly to graphLayer — bypasses mainLayer.addLayer
      // auto-register, so LayerControl won't show the layer until real content.
      if (this.layers.graphLayer) this.layers.graphLayer.addLayer(poly);
      if (this.layers.graphLayer) this.layers.graphLayer.addLayer(previewLine);

      this.cleanupFn = () => {
        this.map.off("click", onDistClick);
        this.map.off("dblclick", onDistDbl);
        this.map.off("contextmenu", onDistContext);
        this.map.off("mousemove", onDistMove);
        this.layers.mainLayer.removeLayer(previewLine);
        if (previewDistLabel) {
          this.layers.mainLayer.removeLayer(previewDistLabel);
          previewDistLabel = null;
        }
        this.layers.mainLayer.removeLayer(poly);
        nodeMarkers.forEach((m) => this.layers.mainLayer.removeLayer(m));
        segLabels.forEach((l) => this.layers.mainLayer.removeLayer(l));
        if (startLbl) this.layers.mainLayer.removeLayer(startLbl);
        this.layers.unregister();
      };

      let distFinished = false;
      let previewDistLabel = null;

      const finishDist = () => {
        if (distFinished) return;
        if (pts.length < 2) {
          this.cleanupFn();
          this.clearActiveMode();
          return;
        }
        distFinished = true;
        // Remove temporary poly before creating final one
        this.layers.mainLayer.removeLayer(poly);

        const finalPoly = L.polyline(pts, {
          className: "measure-line measure-line-solid",
          interactive: true,
        }).addTo(this.layers.mainLayer);

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
          MeasureUtils.suppressHide(this);
          toggleUI(undefined);
        };

        finalPoly.on("click", handleItemClick);
        nodeMarkers.forEach((m) => m.on("click", handleItemClick));
        segLabels.forEach((l) => l.on("click", handleItemClick));
        if (startLbl) startLbl.on("click", handleItemClick);

        toggleUI(false, "reset");

        const onDistMapClick = () => {
          if (this.suppressHideDel) return;
          if (xVisible) toggleUI(false, "reset");
        };
        this.map.on("click", onDistMapClick);
        this.cleanupFn = () => this.map.off("click", onDistMapClick);

        if (segLabels.length > 0) {
          const lastLbl = segLabels[segLabels.length - 1];
          lastLbl.setIcon(
            MeasureUtils.makeLabelDivIcon(MeasureUtils.formatDistance(total)),
          );
        }

        const deleteMeasurement = () => {
          MeasureUtils.removeLayers(
            this.layers.mainLayer,
            finalPoly,
            ...nodeMarkers,
            ...segLabels,
            startLbl,
            lastNodeDelMkr,
          );
          this.map.off("click", onDistMapClick);
          this.layers.unregister();
        };

        if (nodeMarkers.length > 0) {
          const lastNode = nodeMarkers[nodeMarkers.length - 1];
          lastNodeDelMkr = MeasureUtils.makeDelIcon(lastNode.getLatLng()).addTo(
            this.layers.mainLayer,
          );

          MeasureUtils.attachDelClick(lastNodeDelMkr, deleteMeasurement);

          lastNodeDelMkr.on("click", (e) => {
            const t = e.originalEvent?.target;
            if (t?.classList?.contains("measure-del-icon")) return;
            handleItemClick(e);
          });
        }

        // Re-sort layer ordering: finalPoly at bottom, then nodes, del icon, labels
        nodeMarkers.forEach((m) => this.layers.mainLayer.removeLayer(m));
        if (lastNodeDelMkr) this.layers.mainLayer.removeLayer(lastNodeDelMkr);
        segLabels.forEach((l) => this.layers.mainLayer.removeLayer(l));
        if (startLbl) this.layers.mainLayer.removeLayer(startLbl);

        nodeMarkers.forEach((m) => m.addTo(this.layers.mainLayer));
        if (lastNodeDelMkr) lastNodeDelMkr.addTo(this.layers.mainLayer);
        segLabels.forEach((l) => l.addTo(this.layers.mainLayer));
        if (startLbl) startLbl.addTo(this.layers.mainLayer);

        // Register after all final elements are placed
        this.layers.register();

        // Cleanup events and preview elements, keep final layers
        this.map.off("click", onDistClick);
        this.map.off("dblclick", onDistDbl);
        this.map.off("contextmenu", onDistContext);
        this.map.off("mousemove", onDistMove);
        this.layers.mainLayer.removeLayer(previewLine);
        if (previewDistLabel) {
          this.layers.mainLayer.removeLayer(previewDistLabel);
          previewDistLabel = null;
        }
        this.clearActiveMode();
      };

      const onDistMove = (e) => {
        if (pts.length === 0) return;
        previewLine.setLatLngs([pts[pts.length - 1], e.latlng]);
        const seg = MeasureUtils.distance(
          pts[pts.length - 1].lat,
          pts[pts.length - 1].lng,
          e.latlng.lat,
          e.latlng.lng,
        );
        const showDist = total + seg;
        if (!previewDistLabel) {
          previewDistLabel = L.marker(e.latlng, {
            icon: MeasureUtils.makeLabelDivIcon(MeasureUtils.formatDistance(showDist)),
            interactive: false,
          });
          previewDistLabel.isMeasureLabel = true;
          previewDistLabel.addTo(this.layers.mainLayer);
        } else {
          previewDistLabel.setLatLng(e.latlng);
          MeasureUtils.setLabelText(
            previewDistLabel,
            MeasureUtils.formatDistance(showDist),
          );
        }
      };

      const onDistClick = (e) => {
        if (this.currentMode !== "distance") return;
        pts.push(e.latlng);
        if (previewDistLabel) {
          this.layers.mainLayer.removeLayer(previewDistLabel);
          previewDistLabel = null;
        }
        poly.addLatLng(e.latlng);

        const mkr = MeasureUtils.makeNode(e.latlng).addTo(this.layers.mainLayer);
        mkr.bringToFront();
        nodeMarkers.push(mkr);

        if (pts.length === 1) {
          startLbl = L.marker(e.latlng, {
            icon: MeasureUtils.makeLabelDivIcon(_(`${CONST.name}.dist_origin`)),
          });
          startLbl.isMeasureLabel = true;
          startLbl.addTo(this.layers.mainLayer);
        }

        mkr.on("click", () => {
          if (pts.length < 2) return;
          if (mkr === nodeMarkers[nodeMarkers.length - 1]) finishDist();
        });

        if (pts.length > 1) {
          const seg = MeasureUtils.distance(
            pts[pts.length - 2].lat,
            pts[pts.length - 2].lng,
            pts[pts.length - 1].lat,
            pts[pts.length - 1].lng,
          );
          total += seg;

          if (segLabels.length > 0) {
            const prevLbl = segLabels[segLabels.length - 1];
            const prevSeg = MeasureUtils.distance(
              pts[pts.length - 3].lat,
              pts[pts.length - 3].lng,
              pts[pts.length - 2].lat,
              pts[pts.length - 2].lng,
            );
            prevLbl.setIcon(
              MeasureUtils.makeLabelDivIcon(MeasureUtils.formatDistance(prevSeg)),
            );
          }

          const lbl = L.marker(pts[pts.length - 1], {
            icon: MeasureUtils.makeLabelDivIcon(MeasureUtils.formatDistance(total)),
          });
          lbl.isMeasureLabel = true;
          lbl.addTo(this.layers.mainLayer);
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

    // --- Circle Drawing Mode ---
    startCircleMode() {
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
        if (previews.center) this.layers.mainLayer.removeLayer(previews.center);
        if (previews.circle) this.layers.mainLayer.removeLayer(previews.circle);
        if (previews.line) this.layers.mainLayer.removeLayer(previews.line);
        if (previews.node) this.layers.mainLayer.removeLayer(previews.node);
        if (previews.label) this.layers.mainLayer.removeLayer(previews.label);
        previews.center = null;
        previews.circle = null;
        previews.line = null;
        previews.node = null;
        previews.label = null;
      };

      const onMapClick = (e) => {
        if (
          isFinalizing ||
          this.currentMode !== "circle" ||
          (state !== 0 && state !== 1)
        )
          return;

        if (Date.now() - lastFinishTime < CONST.CLICK_COOLDOWN_MS) return;

        if (state === 0) {
          center = e.latlng;
          previews.center = L.marker(center, {
            icon: L.divIcon({
              className: "measure-center-dot",
              html: "",
              iconSize: CONST.CENTER_DOT_SIZE,
              iconAnchor: CONST.CENTER_DOT_ANCHOR,
            }),
            zIndexOffset: CONST.Z_INDEX_OFFSET,
            interactive: false,
          }).addTo(this.layers.mainLayer);
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
            center.lat,
            center.lng,
            e.latlng.lat,
            e.latlng.lng,
          );
          const savedCenter = center;
          const savedTarget = e.latlng;

          if (this.cleanupFn) this.cleanupFn();
          this.clearActiveMode();
          isFinalizing = true;
          setTimeout(() => {
            finalizeCircle(savedCenter, r, savedTarget);
            isFinalizing = false;
          }, CONST.FINALIZE_DELAY_MS);
        }
      };

      const onMouseMove = (e) => {
        if (state !== 1 || !center || this.currentMode !== "circle") return;
        const r = MeasureUtils.distance(
          center.lat,
          center.lng,
          e.latlng.lat,
          e.latlng.lng,
        );

        if (!previews.circle) {
          previews.circle = L.circle(center, {
            radius: r,
            className: "measure-circle measure-circle-preview",
            interactive: false,
          }).addTo(this.layers.mainLayer);
        } else previews.circle.setRadius(r);

        if (!previews.line) {
          previews.line = L.polyline([center, e.latlng], {
            className: "measure-line measure-line-preview",
            interactive: false,
          }).addTo(this.layers.mainLayer);
        } else previews.line.setLatLngs([center, e.latlng]);

        if (!previews.node) {
          previews.node = L.circleMarker(e.latlng, {
            radius: CONST.MARKER_RADIUS,
            className: "measure-node measure-node-preview",
            interactive: false,
          }).addTo(this.layers.mainLayer);
          previews.node.bringToFront();
        } else previews.node.setLatLng(e.latlng);

        const mid = L.latLng(
          (center.lat + e.latlng.lat) / 2,
          (center.lng + e.latlng.lng) / 2,
        );
        if (!previews.label) {
          previews.label = L.marker(mid, {
            interactive: false,
            icon: MeasureUtils.makeLabelDivIcon(MeasureUtils.formatDistance(r)),
          });
          previews.label.isMeasureLabel = true;
          previews.label.addTo(this.layers.mainLayer);
        } else {
          previews.label.setLatLng(mid);
          MeasureUtils.setLabelText(previews.label, MeasureUtils.formatDistance(r));
        }
      };

      const onContext = (e) => {
        MeasureUtils.stopEvent(e);
        this.clearActiveMode();
      };

      const finalizeCircle = (centerLatLng, r, targetLatLng) => {
        const finalTargetLatLng =
          targetLatLng || L.CRS.Earth.destination(centerLatLng, r, 90);

        const circle = L.circle(centerLatLng, {
          radius: r,
          className: "measure-circle measure-circle-final",
          interactive: true,
        }).addTo(this.layers.mainLayer);

        const radiusLine = L.polyline([centerLatLng, finalTargetLatLng], {
          className: "measure-line measure-line-dashed",
          interactive: true,
        }).addTo(this.layers.mainLayer);

        const midLat = (centerLatLng.lat + finalTargetLatLng.lat) / 2;
        const midLng = (centerLatLng.lng + finalTargetLatLng.lng) / 2;
        const radiusLabel = L.marker([midLat, midLng], {
          interactive: false,
          icon: MeasureUtils.makeLabelDivIcon(MeasureUtils.formatDistance(r)),
        });
        radiusLabel.isMeasureLabel = true;
        radiusLabel.addTo(this.layers.mainLayer);

        const radiusNode = MeasureUtils.makeNode(finalTargetLatLng).addTo(
          this.layers.mainLayer,
        );
        radiusNode.bringToFront();

        let labelsVisible = true;
        let xVisible = false;

        const centerFinal = L.marker(centerLatLng, {
          icon: L.divIcon({
            className: "measure-center-dot is-final",
            html: "",
            iconSize: CONST.CENTER_DOT_SIZE,
            iconAnchor: CONST.CENTER_DOT_ANCHOR,
          }),
          zIndexOffset: CONST.Z_INDEX_OFFSET,
          interactive: true,
        }).addTo(this.layers.mainLayer);

        const delMkr = MeasureUtils.makeDelIcon(centerLatLng, {
          zIndexOffset: CONST.Z_INDEX_OFFSET,
        }).addTo(this.layers.mainLayer);

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
                  xv ? CONST.Z_INDEX_OFFSET * 2 : CONST.Z_INDEX_OFFSET,
                );
              MeasureUtils.toggleVisibility(
                [radiusLine?.getElement(), radiusNode?.getElement()],
                labelsVisible,
              );
            },
          );
        };
        toggleUI(false, "reset");

        let deleted = false;
        const deleteCircle = () => {
          if (deleted) return;
          deleted = true;
          MeasureUtils.removeLayers(
            this.layers.mainLayer,
            delMkr,
            circle,
            centerFinal,
            radiusLine,
            radiusNode,
            radiusLabel,
          );
          this.map.off("click", onMapClickActive);
          this.layers.unregister();
        };

        MeasureUtils.attachDelClick(delMkr, deleteCircle);

        const toggleCircleToggle = () => {
          if (deleted) return;
          MeasureUtils.suppressHide(this);
          toggleUI(undefined);
        };

        const attachInteraction = (layer) => {
          layer.on("click", (e) => {
            const t = e.originalEvent?.target;
            if (t?.classList?.contains("measure-del-icon")) return;
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

        this.layers.register();

        const onMapClickActive = () => {
          if (this.suppressHideDel || deleted) return;
          if (xVisible) toggleUI(false, "reset");
        };
        this.map.on("click", onMapClickActive);
      };

      this.map.on("click", onMapClick);
      this.map.on("mousemove", onMouseMove);
      this.map.on("contextmenu", onContext);

      this.cleanupFn = () => {
        this.map.off("click", onMapClick);
        this.map.off("mousemove", onMouseMove);
        this.map.off("contextmenu", onContext);
        clearPreviews();
        window.foliplus.hideHint(CONST.name);
      };
    }
  }

  // ==================== Initialization & Control Construction ====================
  // Guard: LayerControl must be registered first to provide createLayers()/createCanvas()
  if (!window.foliplus.LayerControlAPI) {
    console.error(`[${CONST.name}] ${_(`${CONST.name}.no_layercontrol`)}`);
    window.foliplus.showHint(
      CONST.name,
      _(`${CONST.name}.no_layercontrol`),
      window.foliplus.HINT_DURATION.PERSIST,
    );
    return;
  }

  const measureManager = new MeasureManager(map);

  class MeasureControl extends L.Control {
    onAdd() {
      const { container, ctrl, toolBar, toggleBtn } = window.foliplus.createFoldControl(
        {
          cssClass: "measure-ctrl",
          toggleTitle: _(`${CONST.name}.tool_toggle`),
          toggleSvg: SVGS.RULER,
          isLeft: CONST.position.indexOf("left") >= 0,
        },
      );
      const btnConfigs = [
        {
          mode: "marker",
          title: _(`${CONST.name}.tool_marker`),
          svg: window.foliplus.SVGs.LOCATE,
        },
        { mode: "distance", title: _(`${CONST.name}.tool_distance`), svg: SVGS.RULER },
        { mode: "circle", title: _(`${CONST.name}.tool_circle`), svg: SVGS.CIRCLE },
        { mode: "clear", title: _(`${CONST.name}.tool_clear`), svg: SVGS.TRASH },
      ];
      btnConfigs.forEach(({ mode, title, svg }) => {
        toolBar.appendChild(
          foliplus.dom.el(
            "button",
            { class: "tool-btn", "data-mode": mode, title },
            { _html: svg },
          ),
        );
      });
      measureManager.toolBtns = toolBar.querySelectorAll(".tool-btn");

      toggleBtn.onclick = (e) => {
        e.stopPropagation();
        ctrl.classList.toggle("collapsed");
        ctrl.classList.toggle("expanded");
      };

      window.foliplus.bindOutsideCollapse({ container: ctrl });

      measureManager.toolBtns.forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          measureManager.setMode(btn.dataset.mode);
        };
      });

      return container;
    }

    onRemove() {
      measureManager.destroy();
    }
  }

  new MeasureControl({ position: CONST.position }).addTo(map);
})();
