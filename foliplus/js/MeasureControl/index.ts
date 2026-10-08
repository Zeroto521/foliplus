import { defineControl } from "#core/defineControl.js";
import { ensureLayerAPI } from "#core/layer/index.js";
import {
  bindFoldToggle,
  bindOutsideCollapse,
  createFoldControl,
} from "#core/leaflet/index.js";
import { createIconButton } from "#common/dom.js";
import * as Icons from "#common/icon.js";
import * as CONST from "./const.js";
import * as SVGs from "./icon.js";
import { MeasureManager } from "./manager.js";

const MeasureControl = defineControl<MeasureManager>({
  config: CONFIG,
  icon: SVGs.ICON_RULER,
  setup: () => ensureLayerAPI(map),
  createManager: env => {
    const m = new MeasureManager(map, env);
    m.init();
    return m;
  },
  buildDOM(this: any) {
    const { container, ctrl, toolBar, toggleBtn } = createFoldControl({
      cssClass: "foliplus-measure-ctrl",
      toggleTitle: this.T("tool_toggle"),
      toggleSvg: SVGs.ICON_RULER,
      position: this.config.position,
    });
    const btnConfigs: Array<{ mode?: string; title: string; svg: string }> = [
      {
        mode: CONST.MEASURE_MODE.MARKER,
        title: this.T("tool_marker"),
        svg: Icons.ICON_LOCATION_PIN,
      },
      {
        mode: CONST.MEASURE_MODE.DISTANCE,
        title: this.T("tool_distance"),
        svg: SVGs.ICON_RULER,
      },
      {
        mode: CONST.MEASURE_MODE.POLYGON,
        title: this.T("tool_polygon"),
        svg: SVGs.ICON_POLYGON,
      },
      {
        mode: CONST.MEASURE_MODE.CIRCLE,
        title: this.T("tool_circle"),
        svg: SVGs.ICON_CIRCLE,
      },
      // Export — no mode, so it stays out of toolBtns (no data-mode);
      // its click is bound via the interaction manager (see manager.ts).
      { title: this.T("tool_export"), svg: Icons.ICON_DOWNLOAD },
      {
        mode: CONST.MEASURE_MODE.EDIT,
        title: this.T("tool_edit"),
        svg: Icons.ICON_EDIT,
      },
      {
        mode: CONST.MEASURE_MODE.CLEAR,
        title: this.T("tool_clear"),
        svg: Icons.ICON_DELETE,
      },
    ];
    let exportBtn: HTMLElement | null = null;
    btnConfigs.forEach(({ mode, title, svg }) => {
      const btn = createIconButton({
        class: "foliplus-tool-btn",
        title,
        svg,
        parent: toolBar,
        ...(mode ? { data: { mode } } : {}),
      });
      if (!mode) exportBtn = btn;
    });

    this.mgr.ctrl = ctrl;
    this.mgr.toolBtns = Array.from(toolBar.querySelectorAll(CONST.SEL.TOOL_BTN));
    this.mgr.bindExportClick(exportBtn!);

    bindFoldToggle({ container: ctrl, toggleBtn });

    // Collapse when clicking outside, but NOT when a tool is active
    this.effect(() =>
      bindOutsideCollapse({
        container: ctrl,
        skipCheck: () =>
          this.mgr.currentMode !== null || this.config.collapse_on_outside === false,
      }),
    );

    this.mgr.toolBtns.forEach((btn: HTMLElement) => {
      btn.onclick = (event: MouseEvent) => {
        event.stopPropagation();
        this.mgr.setMode(btn.dataset.mode ?? null);
      };
    });

    return container;
  },
  destroy(this: any) {
    this.manager?.destroy();
  },
});

new MeasureControl({ position: CONFIG.position }).addTo(map);
