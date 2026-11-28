import * as CONST from "./const.js";
import { CLASSES } from "./const.js";
import * as SVGs from "./icon.js";
import { MeasureManager } from "./manager.js";
import { ensureLayerAPI } from "#core/layer/index.js";
import {
  bindControlZoomRange,
  bindFoldOverlay,
  bindFoldToggle,
  createFoldControl,
} from "#core/leaflet/index.js";
import { type ControlEnv, defineControl } from "#core/lifecycle/index.js";
import type { ConfigMeasure } from "#foliplus/config-schema.js";
import { createIconButton } from "#platform/dom.js";
import * as Icons from "#platform/icon.js";
import { PANEL_CLASS } from "#ui/index.js";

const MeasureControl = defineControl<MeasureManager, ConfigMeasure>({
  config: CONFIG as ConfigMeasure,
  icon: SVGs.ICON_RULER,
  setup: () => ensureLayerAPI(map),
  createManager: env => {
    // The manager keeps the flat env contract and narrows config itself
    // (manager.config: ConfigMeasure); the entry's narrowed env carries the
    // same object, so hand it over rather than rebuilding translators.
    const m = new MeasureManager(map, env as ControlEnv);
    m.init();
    return m;
  },
  buildDOM(this: any) {
    const { container, ctrl, toolBar, toggleBtn } = createFoldControl({
      cssClass: CLASSES.CTRL,
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
        class: PANEL_CLASS.TOOL_BTN,
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

    // The registry owns outside-press dismissal for every floating surface;
    // registering the fold panel makes it exclusive against the other map
    // surfaces (row panels, the LayerControl menu) instead of the old
    // document click listener that a stopPropagation could kill.
    const fold = bindFoldOverlay({
      map: this.mgr.map,
      container: ctrl,
      id: "measure.panel",
      exclusiveGroup: "map:panel",
      pressPriority: 400,
      canClose: () =>
        this.mgr.currentMode === null && this.config.collapse_on_outside !== false,
    });
    this.effect(() => fold.detach);

    bindFoldToggle({
      container: ctrl,
      toggleBtn,
      onExpand: () => fold.groupOpen(),
    });

    this.mgr.toolBtns.forEach((btn: HTMLElement) => {
      // listener-exempt: toolbar button handler; control-DOM, removed with the control
      btn.onclick = (event: MouseEvent) => {
        event.stopPropagation();
        this.mgr.setMode(btn.dataset.mode ?? null);
      };
    });

    // The component-level zoom_range declaration gates the toolbar. It never
    // touches the measurements already on the map — the declaration is about
    // where the tool is offered, not about the data.
    this.effect(() =>
      bindControlZoomRange({
        map,
        container,
        range: this.config.zoom_range,
        log: this.log,
      }),
    );

    return container;
  },
  destroy(this: any) {
    this.manager?.destroy();
  },
});

new MeasureControl({ position: CONFIG.position }).addTo(map);
