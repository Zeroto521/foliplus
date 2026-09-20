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
  private s?: L.Control;

  buildDOM() {
    const s = L.control.scale({ metric: true, imperial: false });
    this.s = s;
    primeControlMap(s, this._map);
    const ctrl = (s.onAdd as (map: L.Map) => HTMLElement)(this._map);
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
    // s's onAdd bound a 'move' listener on the map directly; it is
    // invisible to BaseControl.mapListeners, so unbind it here, symmetric to
    // the manual onAdd in buildDOM.
    this.s?.onRemove?.(this._map);
    this.s = undefined;
  }
}

new ScaleControl({ position: CONF.position }).addTo(map);
