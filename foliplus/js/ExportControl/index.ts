import { defineControl } from "#core/defineControl.js";
import { requireLayerAPI } from "#core/layer/index.js";
import { createFoldControl } from "#core/leaflet/panel.js";
import * as SVGs from "./icon.js";
import { ExportManager } from "./manager.js";

// Browser tests inject a synchronous rafLoop scheduler on window before
// instantiation to make rafLoop deterministic (see
// TestExportControlBrowser._make_page) — typed locally, not as a runtime
// global, because this hook is test-only.
type ExportScheduler = (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;

const ExportControl = defineControl<ExportManager>({
  config: CONFIG,
  icon: SVGs.CAMERA,
  setup: env => requireLayerAPI(env.config.name, env.T, map),
  createManager: () =>
    new ExportManager(
      map,
      (window as unknown as { __foliplusExportScheduler?: ExportScheduler })
        .__foliplusExportScheduler ?? setTimeout,
    ),
  buildDOM(this: any) {
    const { container, ctrl, toolBar, toggleBtn } = createFoldControl({
      cssClass: `foliplus-export-ctrl`,
      toggleTitle: this.T("btn_title"),
      toggleSvg: SVGs.CAMERA,
      position: this.config.position,
    });
    // Self-declare export DOM-copy opt-out via the data attribute (primary
    // carrier). Hide-pass still lists this bar in SEL.CONTROL (layout);
    // the attribute is for traversal skip (SKIP_EXPORT), same as delicon.
    ctrl.setAttribute("data-foliplus-export", "exclude");
    this.m.attachUI(ctrl, toolBar);
    toggleBtn.onclick = () => {
      if (this.m.cropState) this.m.removeCropBox();
      else if (this.m.savedBounds) this.m.restoreFromSavedBounds();
      else this.m.showCropBox();
    };
    return container;
  },
  destroy(this: any) {
    if (this.manager?.cropState) this.manager.removeCropBox();
    this.manager?.unregisterShortcuts();
  },
});

new ExportControl({ position: CONFIG.position }).addTo(map);
