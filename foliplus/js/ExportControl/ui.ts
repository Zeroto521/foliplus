// ExportControl UI — DOM construction and event binding.
// Standalone functions called with `mgr` (ExportManager instance) as first param.
import { HINT_DURATION } from "#core/hint.js";
import { ensureModes, guardBlocked } from "#core/mode.js";
import { createIconButton, dom } from "#common/dom.js";
import { formatNumber } from "#common/format.js";
import * as Icons from "#common/icon.js";
import { createScopedTranslator } from "#common/locale.js";
import { bindMapSync } from "#common/panel.js";
import * as CONST from "./const.js";
import * as SVGs from "./icon.js";
import { registerCropMouseDown } from "./interaction.js";
import type { ExportManager, Rect } from "./manager.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const T = createScopedTranslator(CONF);

/** Toolbar action button config. */
interface ToolbarButton {
  title: string;
  svg: string;
  onclick: (mgr: ExportManager) => void;
}

/**
 * Render confirm/cancel action buttons into the crop toolbar.
 * Shared by showCropBox / lockCropBox / unlockCropBox.
 */
const renderToolbarActions = (
  mgr: ExportManager,
  { confirm, cancel }: { confirm: ToolbarButton; cancel: ToolbarButton },
) => {
  const actions = mgr.cropState?.actions || mgr.exportToolBar;
  if (!actions) return;
  actions.innerHTML = "";
  createIconButton({
    class: `${CONST.CLASSES.TOOL_BTN} ${CONST.CLASSES.CONFIRM}`,
    title: confirm.title,
    svg: confirm.svg,
    parent: actions,
    onclick: event => {
      event.stopPropagation();
      confirm.onclick(mgr);
    },
  });
  createIconButton({
    class: `${CONST.CLASSES.TOOL_BTN} ${CONST.CLASSES.CANCEL} ${CONST.CLASSES.CLOSE}`,
    title: cancel.title,
    svg: cancel.svg,
    parent: actions,
    onclick: event => {
      event.stopPropagation();
      cancel.onclick(mgr);
    },
  });
};

/** Update crop box element position/size. */
const updateBoxStyle = (mgr: ExportManager, el: HTMLElement, r: Rect) => {
  el.style.left = `${r.left}px`;
  el.style.top = `${r.top}px`;
  el.style.width = `${r.width}px`;
  el.style.height = `${r.height}px`;
};

/** Show a global hint (e.g. exporting status). */
const showGlobalHint = (
  mgr: ExportManager,
  text: string,
  duration = HINT_DURATION.PERSIST,
  withLoadingIcon = false,
) => {
  const loading = withLoadingIcon ? Icons.LOADING + " " : "";
  map.foliplus!.showHint(CONF.name, loading + text, duration || HINT_DURATION.PERSIST);
};

/** Show a hint with crop box size info. */
const showHintWithInfo = (mgr: ExportManager, r: Rect, instruction?: string) => {
  mgr.checkPixelLimit(r);
  map.foliplus!.showHint(
    CONF.name,
    `${T("label_size_prefix")}${Math.round(r.width)} × ${Math.round(r.height)} ` +
      `${T("label_size_suffix")}${instruction ? ` — ${instruction}` : ""}`,
    HINT_DURATION.PERSIST,
    undefined,
    "size",
  );
  if (mgr.pixelOverLimit) {
    map.foliplus!.showHint(
      CONF.name,
      T("err_too_large").replace(
        "{limit}",
        formatNumber(CONF.max_pixels!, "auto", CONF.locale_code),
      ),
      HINT_DURATION.PERSIST,
      undefined,
      "limit",
    );
  } else map.foliplus!.hideHint(CONF.name, "limit");
};

/** Build the crop box DOM and attach events. */
const showCropBox = (mgr: ExportManager) => {
  if (mgr.cropState) return;
  // Symmetric lock with the other interactive components (measure / focus).
  if (guardBlocked(mgr.map, CONF.name, T("blocked"))) return;
  // Enter crop interaction: block measurement immediately (not just at
  // download), so map interaction is not interrupted by measure clicks.
  ensureModes(mgr.map).setMode(CONF.name, "selecting");
  const mapRect = mgr.mapContainer.getBoundingClientRect();
  let box;

  if (mgr.savedBounds) {
    const nw = mgr.map.latLngToContainerPoint(
      L.latLng(mgr.savedBounds.nw.lat, mgr.savedBounds.nw.lng),
    );
    const se = mgr.map.latLngToContainerPoint(
      L.latLng(mgr.savedBounds.se.lat, mgr.savedBounds.se.lng),
    );
    box = {
      left: Math.min(nw.x, se.x),
      top: Math.min(nw.y, se.y),
      width: Math.max(1, Math.abs(se.x - nw.x)),
      height: Math.max(1, Math.abs(se.y - nw.y)),
    };
  } else if (mgr.lastScreenRect) {
    box = {
      left: Math.max(
        0,
        Math.min(mgr.lastScreenRect.left, mapRect.width - CONST.CROP.MIN_SIZE),
      ),
      top: Math.max(
        0,
        Math.min(mgr.lastScreenRect.top, mapRect.height - CONST.CROP.MIN_SIZE),
      ),
      width: mgr.lastScreenRect.width,
      height: mgr.lastScreenRect.height,
    };
    box.width = Math.max(
      CONST.CROP.MIN_SIZE,
      Math.min(box.width, mapRect.width - box.left),
    );
    box.height = Math.max(
      CONST.CROP.MIN_SIZE,
      Math.min(box.height, mapRect.height - box.top),
    );
  } else {
    const padW = mapRect.width * CONST.CROP.PADDING_RATIO;
    const padH = mapRect.height * CONST.CROP.PADDING_RATIO;
    box = {
      left: padW,
      top: padH,
      width: mapRect.width - padW * 2,
      height: mapRect.height - padH * 2,
    };
  }

  const overlay = dom.el("div", {
    class: `foliplus-export-overlay active`,
    parent: mgr.mapContainer,
  });
  mgr.mapContainer.classList.add(CONST.CLASSES.MODE);
  document.body.classList.add(CONST.CLASSES.MODE);
  const cropBox = dom.el("div", { class: CONST.CLASSES.BOX, parent: mgr.mapContainer });

  ["tl", "tr", "bl", "br", "t", "b", "l", "r"].forEach(pos => {
    dom.el("div", {
      class: `${CONST.CLASSES.HANDLE} ${pos}`,
      parent: cropBox,
      "data-pos": pos,
    });
  });
  dom.el("div", { class: CONST.CLASSES.CENTER, parent: cropBox });

  renderToolbarActions(mgr, {
    confirm: {
      title: T("btn_confirm"),
      svg: SVGs.CHECK,
      onclick: () => mgr.lockCropBox(),
    },
    cancel: {
      title: T("btn_cancel"),
      svg: Icons.CLOSE,
      onclick: () => mgr.removeCropBox(),
    },
  });
  mgr.exportCtrl?.classList.remove(CONST.CLASSES.COLLAPSED);
  mgr.exportCtrl?.classList.add(CONST.CLASSES.EXPANDED);

  mgr.cropState = {
    overlay,
    box: cropBox,
    rect: box,
    locked: false,
    actions: mgr.exportToolBar!,
  };
  updateBoxStyle(mgr, cropBox, box);
  showHintWithInfo(mgr, box, T("hint_unlocked"));
  mgr.cropMousedownCleanup = registerCropMouseDown(mgr, cropBox);
  mgr.registerShortcuts();
};

/** Update toolbar for locked state (export button). */
const lockCropBox = (mgr: ExportManager, skipHint = false) => {
  if (!mgr.cropState || mgr.cropState.locked) return;
  mgr.cropState.locked = true;
  mgr.cropState.box.classList.add("locked");
  const r = mgr.cropState.rect;
  mgr.cropState.savedGeoBounds = {
    nw: mgr.map.containerPointToLatLng(L.point(r.left, r.top)),
    se: mgr.map.containerPointToLatLng(L.point(r.left + r.width, r.top + r.height)),
  };
  mgr.cropState.geoBounds = mgr.cropState.savedGeoBounds;
  renderToolbarActions(mgr, {
    confirm: {
      title: T("btn_export"),
      svg: Icons.DOWNLOAD,
      onclick: () => mgr.doExport(),
    },
    cancel: {
      title: T("btn_cancel"),
      svg: Icons.CLOSE,
      onclick: () => mgr.unlockCropBox(),
    },
  });
  mgr.mapMoveCleanup = bindMapSync({
    map: mgr.map,
    updateEvents: ["zoomend"],
    onMove: () => {
      if (mgr.cropState?.locked) mgr.onMapChange(true);
    },
    onUpdate: () => {
      if (mgr.cropState?.locked) mgr.onMapChange();
    },
  });
  mgr.onMapChange();
  if (!skipHint) showHintWithInfo(mgr, r, T("hint_locked"));
};

/** Update toolbar for unlocked state (confirm button). */
const unlockCropBox = (mgr: ExportManager) => {
  if (!mgr.cropState || !mgr.cropState.locked) return;
  mgr.cropState.locked = false;
  mgr.cropState.box.classList.remove("locked");
  if (mgr.mapMoveCleanup) mgr.mapMoveCleanup();
  renderToolbarActions(mgr, {
    confirm: {
      title: T("btn_confirm"),
      svg: SVGs.CHECK,
      onclick: () => mgr.lockCropBox(),
    },
    cancel: {
      title: T("btn_cancel"),
      svg: Icons.CLOSE,
      onclick: () => mgr.removeCropBox(),
    },
  });
  updateBoxStyle(mgr, mgr.cropState.box, mgr.cropState.rect);
  showHintWithInfo(mgr, mgr.cropState.rect, T("hint_unlocked"));
};

/** Remove crop box DOM and restore UI state. */
const removeCropBox = (mgr: ExportManager) => {
  if (!mgr.cropState) return;
  mgr.lastScreenRect = Object.assign({}, mgr.cropState.rect);
  mgr.mapContainer.classList.remove(CONST.CLASSES.MODE);
  document.body.classList.remove(CONST.CLASSES.MODE);
  mgr.unregisterShortcuts();
  mgr.dragCleanup?.();
  mgr.dragState.dragging = false;
  mgr.dragState.dragType = null;
  if (mgr.mapMoveCleanup) {
    mgr.mapMoveCleanup();
    mgr.mapMoveCleanup = null;
  }
  if (mgr.cropState.box) mgr.cropMousedownCleanup?.();
  if (mgr.cropState.overlay?.parentNode) mgr.cropState.overlay.remove();
  if (mgr.cropState.box?.parentNode) mgr.cropState.box.remove();
  if (mgr.cropState.actions) mgr.cropState.actions.innerHTML = "";
  if (mgr.exportCtrl) {
    mgr.exportCtrl.classList.remove(CONST.CLASSES.EXPANDED);
    mgr.exportCtrl.classList.add(CONST.CLASSES.COLLAPSED);
  }
  mgr.cropState = null;
  ensureModes(mgr.map).setMode(CONF.name, null);
  map.foliplus!.hideHint(CONF.name);
};

export {
  lockCropBox,
  removeCropBox,
  showCropBox,
  showGlobalHint,
  showHintWithInfo,
  unlockCropBox,
  updateBoxStyle,
};
