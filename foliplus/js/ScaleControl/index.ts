import { defineControl } from "#core/defineControl.js";
import { primeControlMap } from "#core/leafletAdapter.js";
import { dom } from "#common/dom.js";

const ScaleControl = defineControl({
  conf: CONF,
  buildDOM(this: any) {
    const scaleCtrl = L.control.scale({ metric: true, imperial: false });
    this.scaleCtrl = scaleCtrl;
    primeControlMap(scaleCtrl, this._map);
    const ctrl = (scaleCtrl.onAdd as (map: L.Map) => HTMLElement)(this._map);
    ctrl.classList.add("foliplus-scale-wrap");

    if (this.conf.show_zoom) {
      const zoomLabel = dom.el("span", {
        class: "foliplus-scale-zoom-label",
        parent: ctrl,
      });
      const updateZoom = () => {
        zoomLabel.textContent = this.T("zoom_label").replace(
          "{zoom}",
          String(this._map.getZoom()),
        );
      };
      updateZoom();
      // Tracked via onMap — auto-unbound in onRemove.
      this.onMap("zoomend", updateZoom);
    }

    return ctrl;
  },
  destroy(this: any) {
    // scaleCtrl's onAdd bound a 'move' listener on the map directly; it is
    // invisible to BaseControl.mapListeners, so unbind it here, symmetric to
    // the manual onAdd in buildDOM.
    this.scaleCtrl?.onRemove?.(this._map);
    this.scaleCtrl = undefined;
  },
});

new ScaleControl({ position: CONF.position }).addTo(map);
