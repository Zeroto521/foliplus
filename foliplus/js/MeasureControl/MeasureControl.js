import { BaseControl } from "#common/BaseControl.js";
import { createIconButton } from "#common/dom.js";
import { createControlEnv, requireLayerAPI } from "#common/guard.js";
import * as Icons from "#common/icon.js";
import {
  bindFoldToggle,
  bindOutsideCollapse,
  createFoldControl,
} from "#common/panel.js";
import * as CONST from "./MeasureControl.const.js";
import * as SVGs from "./MeasureControl.icon.js";
import { MeasureManager } from "./MeasureControl.manager.js";

const { _ } = createControlEnv(CONF, SVGs.RULER);
requireLayerAPI(CONF.name, _);

const measureManager = new MeasureManager(map);

/** Leaflet control wrapper for the MeasureManager. Handles DOM creation and tool button events. */
class MeasureControl extends BaseControl {
  constructor(options) {
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
      {
        mode: CONST.MODE.CLEAR,
        title: _(`${CONF.name}.tool_clear`),
        svg: SVGs.TRASH,
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
    this.m.ctrl = ctrl;
    this.m.toolBtns = toolBar.querySelectorAll(CONST.SEL.TOOL_BTN);

    bindFoldToggle({ container: ctrl, toggleBtn });

    // Collapse when clicking outside, but NOT when a tool is active
    bindOutsideCollapse({
      container: ctrl,
      skipCheck: () => this.m.currentMode !== null,
    });

    this.m.toolBtns.forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        this.m.setMode(btn.dataset.mode);
      };
    });

    return container;
  }

  destroy() {
    this.m.destroy();
  }
}

new MeasureControl({ position: CONF.position }).addTo(map);
