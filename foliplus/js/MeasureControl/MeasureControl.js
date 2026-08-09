import { dom } from "../common/dom.js";
import { requireRuntime } from "../common/guard.js";
import * as Icons from "../common/icon.js";
import { createTranslator } from "../common/locale.js";
import {
  adjustPanelZIndex,
  bindOutsideCollapse,
  createFoldControl,
} from "../common/panel.js";
import * as CONST from "./MeasureControl.const.js";
import * as SVGs from "./MeasureControl.icon.js";
import { MeasureManager } from "./MeasureControl.manager.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
requireRuntime(CONF.name);
const foliplus = window.foliplus;
const _ = createTranslator(CONF);
foliplus.registerHintIcon(CONF.name, SVGs.RULER);

// ==================== Guard: LayerControl required ====================
if (!foliplus.LayerAPI) {
  const msg = _(`${CONF.name}.no_layercontrol`);
  foliplus.showHint(CONF.name, msg, foliplus.HINT_DURATION.PERSIST);
  throw new Error(`[${CONF.name}] ${msg}`);
}

const measureManager = new MeasureManager(map);

/** Leaflet control wrapper for the MeasureManager. Handles DOM creation and tool button events. */
class MeasureControl extends L.Control {
  constructor(options) {
    super(options);
    this.manager = measureManager;
  }

  /** Shorthand for manager */
  get m() {
    return this.manager;
  }

  onAdd() {
    const { container, ctrl, toolBar, toggleBtn } = createFoldControl({
      cssClass: "foliplus-measure-ctrl",
      toggleTitle: _(`${CONF.name}.tool_toggle`),
      toggleSvg: SVGs.RULER,
      isLeft: CONF.position.indexOf("left") >= 0,
    });
    this.ctrl = ctrl;
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
      dom.el(
        "button",
        { class: "foliplus-tool-btn", "data-mode": mode, title, parent: toolBar },
        { html: svg },
      );
    });
    this.m.ctrl = ctrl;
    this.m.toolBtns = toolBar.querySelectorAll(CONST.SEL.TOOL_BTN);

    toggleBtn.onclick = (e) => {
      e.stopPropagation();
      const expanding = ctrl.classList.contains(CONST.CLASSES.COLLAPSED);
      ctrl.classList.toggle(CONST.CLASSES.COLLAPSED);
      ctrl.classList.toggle(CONST.CLASSES.EXPANDED);
      adjustPanelZIndex({ container: ctrl, expanded: expanding });
    };

    // Collapse when clicking outside, but NOT when a tool is active
    bindOutsideCollapse({
      container: ctrl,
      skipCheck: () => this.m.currentMode !== null,
    });

    this.m.toolBtns.forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        this.m.setMode(btn.dataset.mode);
      };
    });

    return container;
  }

  onRemove() {
    this.m.destroy();
  }
}

new MeasureControl({ position: CONF.position }).addTo(map);
