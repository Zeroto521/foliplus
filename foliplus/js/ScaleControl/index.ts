import { createControlEnv } from "#core/controlEnv.js";
import { primeControlMap } from "#core/leafletAdapter.js";
import { BaseControl } from "#foliplus/BaseControl.js";
import { dom } from "#common/dom.js";
import { createScopedTranslator } from "#common/locale.js";

// ==================== Runtime Guard ====================
createControlEnv(CONF);
const T = createScopedTranslator(CONF);

// ==================== Control Definition ====================
class ScaleControl extends BaseControl {
  private scaleCtrl?: L.Control;

  buildDOM() {
    const scaleCtrl = L.control.scale({ metric: true, imperial: false });
    this.scaleCtrl = scaleCtrl;
    primeControlMap(scaleCtrl, this._map);
    const ctrl = (scaleCtrl.onAdd as (map: L.Map) => HTMLElement)(this._map);
    ctrl.classList.add("foliplus-scale-wrap");

    // ==================== Zoom Label ====================
    if (CONF.show_zoom) {
      const zoomLabel = dom.el("span", {
        class: "foliplus-scale-zoom-label",
        parent: ctrl,
      });
      const updateZoom = () => {
        zoomLabel.textContent = T("zoom_label").replace(
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

  destroy() {
    // scaleCtrl is a separate L.Control instance that onAdd registered a
    // 'move' listener directly on the map. BaseControl.mapListeners only
    // tracks what we listenMap()'d, so this.inner must be cleaned here
    // symmetrically — the same way we called onAdd manually in buildDOM.
    this.scaleCtrl?.onRemove?.(this._map);
    this.scaleCtrl = undefined;
  }
}

new ScaleControl({ position: CONF.position }).addTo(map);
