import { createControlEnv } from "#core/controlEnv.js";
import { requireLayerAPI } from "#core/layer/index.js";
import { BaseControl } from "#foliplus/BaseControl.js";
import { createScopedTranslator } from "#common/locale.js";
import { createFoldControl } from "#common/panel.js";
import * as SVGs from "./icon.js";
import { ExportManager } from "./manager.js";

createControlEnv(CONF, SVGs.CAMERA);
const T = createScopedTranslator(CONF);
requireLayerAPI(CONF.name, T, map);

// ==================== Leaflet Control ====================
const exportManager = new ExportManager(map);

class ExportControl extends BaseControl {
  declare manager: ExportManager;

  constructor(options?: L.ControlOptions) {
    super(options);
    this.manager = exportManager;
  }

  /** Shorthand for manager */
  get m() {
    return this.manager;
  }

  buildDOM() {
    const { container, ctrl, toolBar, toggleBtn } = createFoldControl({
      cssClass: `foliplus-export-ctrl`,
      toggleTitle: T("btn_title"),
      toggleSvg: SVGs.CAMERA,
      position: CONF.position,
    });
    this.m.attachUI(ctrl, toolBar);
    toggleBtn.onclick = () => {
      if (this.m.cropState) this.m.removeCropBox();
      else if (this.m.savedBounds) this.m.restoreFromSavedBounds();
      else this.m.showCropBox();
    };
    return container;
  }

  destroy() {
    if (this.m.cropState) this.m.removeCropBox();
    this.m.unregisterShortcuts();
  }
}

new ExportControl({ position: CONF.position }).addTo(map);
