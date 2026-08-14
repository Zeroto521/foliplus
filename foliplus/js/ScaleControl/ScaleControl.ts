import { BaseControl } from "#common/BaseControl.js";
import { dom } from "#common/dom.js";
import { createControlEnv } from "#common/guard.js";

const CLASSES = {
  WRAP: "foliplus-scale-wrap",
  ZOOM_LABEL: "foliplus-scale-zoom-label",
};

// ==================== Runtime Guard ====================
const { _ } = createControlEnv(CONF);

// ==================== Control Definition ====================
class ScaleControl extends BaseControl {
  buildDOM() {
    const scaleCtrl = L.control.scale({
      metric: CONF.isMetric,
      imperial: !CONF.isMetric,
    });
    Reflect.set(scaleCtrl, "_map", this._map);
    const ctrl = (scaleCtrl.onAdd as (map: L.Map) => HTMLElement)(this._map);
    ctrl.classList.add(CLASSES.WRAP);

    // ==================== Zoom Label ====================
    if (CONF.show_zoom) {
      const zoomLabel = dom.el("span", { class: CLASSES.ZOOM_LABEL, parent: ctrl });
      const updateZoom = () => {
        zoomLabel.textContent = _(`${CONF.name}.zoom_label`).replace(
          "{zoom}",
          String(this._map.getZoom()),
        );
      };
      updateZoom();
      // Tracked via listenMap — auto-unbound in onRemove.
      this.listenMap("zoomend", updateZoom);
    }

    return ctrl;
  }
}

new ScaleControl({ position: CONF.position }).addTo(map);
