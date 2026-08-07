(function () {
  const CONF = window.foliplus.CONFIG.ScaleControl;
  const CONST = {
    name: "ScaleControl",
    isMetric: CONF.isMetric,
    CLASSES: {
      SCALE_WRAP: "foliplus-scale-wrap",
      SCALE_ZOOM_LABEL: "foliplus-scale-zoom-label",
    },
  };

  // ==================== Runtime Guard ====================
  const foliplus = window.foliplus || {};
  if (!foliplus || !foliplus.SVGs) {
    console.error(`[${CONST.name}] foliplus runtime not found, plugin disabled.`);
    return;
  }

  // ==================== Dependencies ====================
  const _ = (k) => (foliplus.gt ? foliplus.gt(k) : k);

  // ==================== Control Definition ====================
  class ScaleControl extends L.Control {
    onAdd() {
      const scaleCtrl = L.control.scale({
        metric: CONST.isMetric,
        imperial: !CONST.isMetric,
      });
      scaleCtrl._map = this._map;
      const wrap = scaleCtrl.onAdd(this._map);
      wrap.classList.add(CONST.CLASSES.SCALE_WRAP);

      // ==================== Zoom Label ====================
      if (CONF.show_zoom) {
        const zoomLabel = foliplus.dom.el("span", {
          class: CONST.CLASSES.SCALE_ZOOM_LABEL,
          parent: wrap,
        });
        const updateZoom = () => {
          zoomLabel.textContent = _(`${CONST.name}.zoom_label`).replace(
            "{zoom}",
            this._map.getZoom(),
          );
        };
        updateZoom();
        this._map.on("zoomend", updateZoom);
        this._map.on("unload", () => this._map.off("zoomend", updateZoom));
      }

      return wrap;
    }
  }

  new ScaleControl({ position: CONF.position }).addTo(map);
})();
