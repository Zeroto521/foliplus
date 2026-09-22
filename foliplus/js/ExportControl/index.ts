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
// Manager creation is lazy so destroy() + re-add re-creates a fresh manager.
// Browser tests inject a synchronous rafLoop scheduler on window before
// instantiation to make rafLoop deterministic (see
// TestExportControlBrowser._make_page) — typed locally, not as a runtime
// global, because this hook is test-only.
type ExportScheduler = (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
const createExportManager = (): ExportManager =>
  new ExportManager(
    map,
    (window as unknown as { __foliplusExportScheduler?: ExportScheduler })
      .__foliplusExportScheduler ?? setTimeout,
  );

class ExportControl extends BaseControl {
  manager: ExportManager | null = null;

  constructor(options?: L.ControlOptions) {
    super(options);
  }

  /** Shorthand for manager (creates it on first access). */
  get m(): ExportManager {
    return (this.manager ??= createExportManager());
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

  /** Never touch `this.m` here: destroy() must not re-create the manager. */
  destroy() {
    if (this.manager?.cropState) this.manager.removeCropBox();
    this.manager?.unregisterShortcuts();
    this.manager = null;
  }
}

new ExportControl({ position: CONF.position }).addTo(map);
