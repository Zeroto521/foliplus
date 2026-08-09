import { requireRuntime } from "../common/guard.js";
import { createTranslator } from "../common/locale.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const CLASSES = {
  WRAP: "foliplus-scale-wrap",
  ZOOM_LABEL: "foliplus-scale-zoom-label",
};

// ==================== Runtime Guard ====================
requireRuntime(CONF.name);

// ==================== Dependencies ====================
const foliplus = window.foliplus;
const _ = createTranslator(CONF);

// ==================== Control Definition ====================
class ScaleControl extends L.Control {
  onAdd() {
    const scaleCtrl = L.control.scale({
      metric: CONF.isMetric,
      imperial: !CONF.isMetric,
    });
    scaleCtrl._map = this._map;
    const wrap = scaleCtrl.onAdd(this._map);
    wrap.classList.add(CLASSES.WRAP);

    // ==================== Zoom Label ====================
    if (CONF.show_zoom) {
      const zoomLabel = foliplus.dom.el("span", {
        class: CLASSES.ZOOM_LABEL,
        parent: wrap,
      });
      const updateZoom = () => {
        zoomLabel.textContent = _(`${CONF.name}.zoom_label`).replace(
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
