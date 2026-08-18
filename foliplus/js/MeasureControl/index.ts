import { ensureLayerAPI } from "#core/layer/index.js";
import { BaseControl } from "#foliplus/BaseControl.js";
import { createIconButton } from "#common/dom.js";
import { createControlEnv } from "#common/guard.js";
import * as Icons from "#common/icon.js";
import {
  bindFoldToggle,
  bindOutsideCollapse,
  createFoldControl,
} from "#common/panel.js";
import * as CONST from "./const.js";
import * as Export from "./export.js";
import * as SVGs from "./icon.js";
import { MeasureManager } from "./manager.js";

const { _ } = createControlEnv(CONF, SVGs.RULER);
ensureLayerAPI(map);

const measureManager = new MeasureManager(map);

/** Leaflet control wrapper for the MeasureManager. Handles DOM creation and tool button events. */
class MeasureControl extends BaseControl {
  declare manager: MeasureManager;

  constructor(options?: L.ControlOptions) {
    super(options);
    this.manager = measureManager;
  }

  /** Shorthand for manager */
  get m() {
    return this.manager;
  }

  buildDOM() {
    const { container, ctrl, toolBar, toggleBtn } = createFoldControl({
      cssClass: "foliplus-measure-ctrl",
      toggleTitle: _(`${CONF.name}.tool_toggle`),
      toggleSvg: SVGs.RULER,
      position: CONF.position,
    });
    const btnConfigs = [
      {
        mode: CONST.MODE.MARKER,
        title: _(`${CONF.name}.tool_marker`),
        svg: Icons.LOCATE,
      },
      {
        mode: CONST.MODE.DISTANCE,
        title: _(`${CONF.name}.tool_distance`),
        svg: SVGs.RULER,
      },
      {
        mode: CONST.MODE.POLYGON,
        title: _(`${CONF.name}.tool_polygon`),
        svg: SVGs.POLYGON,
      },
      {
        mode: CONST.MODE.CIRCLE,
        title: _(`${CONF.name}.tool_circle`),
        svg: SVGs.CIRCLE,
      },
    ];
    btnConfigs.forEach(({ mode, title, svg }) => {
      createIconButton({
        class: "foliplus-tool-btn",
        title,
        svg,
        parent: toolBar,
        data: { mode },
      });
    });

    // Export button (between circle and clear)
    const exportBtn = createIconButton({
      class: "foliplus-tool-btn foliplus-measure-export-btn",
      title: _(`${CONF.name}.tool_export`),
      svg: Icons.DOWNLOAD,
      parent: toolBar,
      data: {},
    });

    createIconButton({
      class: "foliplus-tool-btn",
      title: _(`${CONF.name}.tool_clear`),
      svg: SVGs.TRASH,
      parent: toolBar,
      data: { mode: CONST.MODE.CLEAR },
    });

    this.m.ctrl = ctrl;
    this.m.toolBtns = Array.from(toolBar.querySelectorAll(CONST.SEL.TOOL_BTN));

    bindFoldToggle({ container: ctrl, toggleBtn });

    // Collapse when clicking outside, but NOT when a tool is active
    bindOutsideCollapse({
      container: ctrl,
      skipCheck: () => this.m.currentMode !== null,
    });

    this.m.toolBtns.forEach((btn: HTMLElement) => {
      btn.onclick = (event: MouseEvent) => {
        event.stopPropagation();
        this.m.setMode(btn.dataset.mode ?? null);
      };
    });

    // Export button handler — set AFTER toolBtns.forEach (which overwrites all .foliplus-tool-btn onclick).
    exportBtn.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      if (!this.m) {
        alert("测量功能不可用，请刷新页面重试。");
        return;
      }
      const measurements = this.m.measurements;
      if (!measurements || measurements.length === 0) {
        const msg = _(`${CONF.name}.export_no_data`);
        try {
          map.foliplus?.showHint?.(CONF.name, msg, 4000);
        } catch (err) {
          alert(msg);
        }
        return;
      }
      try {
        const format = Export.getDefaultFormat();
        Export.exportMeasurements(measurements, format);
      } catch (err) {
        const msg = (err as Error).message || "导出失败";
        try {
          map.foliplus?.showHint?.(CONF.name, msg, 4000);
        } catch {
          alert(msg);
        }
      }
    };

    return container;
  }

  destroy() {
    this.m.destroy();
  }
}

new MeasureControl({ position: CONF.position }).addTo(map);
