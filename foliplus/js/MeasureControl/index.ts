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
  icon: SVGs.RULER,
  setup: () => ensureLayerAPI(map),
  createManager: env => new MeasureManager(map, env),
  buildDOM(this: any) {
    const { container, ctrl, toolBar, toggleBtn } = createFoldControl({
      cssClass: "foliplus-measure-ctrl",
      toggleTitle: this.T("tool_toggle"),
      toggleSvg: SVGs.RULER,
      position: this.config.position,
    });
    const btnConfigs: Array<{ mode?: string; title: string; svg: string }> = [
      {
        mode: CONST.MEASURE_MODE.MARKER,
        title: this.T("tool_marker"),
        svg: Icons.LOCATE_ICON,
      },
      {
        mode: CONST.MEASURE_MODE.DISTANCE,
        title: this.T("tool_distance"),
        svg: SVGs.RULER,
      },
      {
        mode: CONST.MEASURE_MODE.POLYGON,
        title: this.T("tool_polygon"),
        svg: SVGs.POLYGON,
      },
      {
        mode: CONST.MEASURE_MODE.CIRCLE,
        title: this.T("tool_circle"),
        svg: SVGs.CIRCLE,
      },
      // Export — no mode, so it stays out of toolBtns (no data-mode);
      // its click is bound via the interaction manager (see manager.ts).
      { title: this.T("tool_export"), svg: Icons.DOWNLOAD_ICON },
      {
        mode: CONST.MEASURE_MODE.EDIT,
        title: this.T("tool_edit"),
        svg: Icons.EDIT_ICON,
      },
      {
        mode: CONST.MEASURE_MODE.CLEAR,
        title: this.T("tool_clear"),
        svg: Icons.DELETE_ICON,
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

    this.m.ctrl = ctrl;
    this.m.toolBtns = Array.from(toolBar.querySelectorAll(CONST.SEL.TOOL_BTN));
    this.m.bindExportClick(exportBtn!);

    bindFoldToggle({ container: ctrl, toggleBtn });

    // Collapse when clicking outside, but NOT when a tool is active
    this.effect(() =>
      bindOutsideCollapse({
        container: ctrl,
        skipCheck: () =>
          this.m.currentMode !== null || this.config.collapse_on_outside === false,
      }),
    );

    this.m.toolBtns.forEach((btn: HTMLElement) => {
      btn.onclick = (event: MouseEvent) => {
        event.stopPropagation();
        this.m.setMode(btn.dataset.mode ?? null);
      };
    });

    return container;
  },
  destroy(this: any) {
    this.manager?.destroy();
  },
});

new MeasureControl({ position: CONFIG.position }).addTo(map);
