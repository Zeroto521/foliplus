import { ensureLayerAPI } from "#core/layer/index.js";
import { BaseControl } from "#foliplus/BaseControl.js";
import { createIconButton } from "#common/dom.js";
import { createControlEnv } from "#common/guard.js";
import * as Icons from "#common/icon.js";
import { createScopedTranslator } from "#common/locale.js";
import {
  bindFoldToggle,
  bindOutsideCollapse,
  createFoldControl,
} from "#common/panel.js";
import * as CONST from "./const.js";
import * as SVGs from "./icon.js";
import { MeasureManager } from "./manager.js";

const { _ } = createControlEnv(CONF, SVGs.RULER);
const T = createScopedTranslator(CONF);
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
      toggleTitle: T("tool_toggle"),
      toggleSvg: SVGs.RULER,
      position: CONF.position,
    });
    const btnConfigs: Array<{ mode?: string; title: string; svg: string }> = [
      {
        mode: CONST.MODE.MARKER,
        title: T("tool_marker"),
        svg: Icons.LOCATE,
      },
      {
        mode: CONST.MODE.DISTANCE,
        title: T("tool_distance"),
        svg: SVGs.RULER,
      },
      {
        mode: CONST.MODE.POLYGON,
        title: T("tool_polygon"),
        svg: SVGs.POLYGON,
      },
      {
        mode: CONST.MODE.CIRCLE,
        title: T("tool_circle"),
        svg: SVGs.CIRCLE,
      },
      // Export — no mode, so it stays out of toolBtns (no data-mode);
      // its click is bound via the interaction manager (see manager.ts).
      {
        title: T("tool_export"),
        svg: Icons.DOWNLOAD,
      },
      {
        mode: CONST.MODE.CLEAR,
        title: T("tool_clear"),
        svg: SVGs.TRASH,
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

    return container;
  }

  destroy() {
    this.m.destroy();
  }
}

new MeasureControl({ position: CONF.position }).addTo(map);
