// ExportControl UI — DOM construction and event binding.
// Standalone functions called with `mgr` (ExportManager instance) as first param.
import * as Icons from "../common/icon.js";
import { createTranslator } from "../common/locale.js";
import * as CONST from "./ExportControl.const.js";
import * as SVGs from "./ExportControl.icon.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).

const foliplus = window.foliplus;
const _ = createTranslator(CONF);

/** Update crop box element position/size. */
const updateBoxStyle = (mgr, el, r) => {
  el.style.left = `${r.left}px`;
  el.style.top = `${r.top}px`;
  el.style.width = `${r.width}px`;
  el.style.height = `${r.height}px`;
};

/** Show a global hint (e.g. exporting status). */
const showGlobalHint = (mgr, text, duration, withLoadingIcon) => {
  const loading = withLoadingIcon ? Icons.LOADING + " " : "";
  foliplus.showHint(
    CONF.name,
    loading + text,
    duration || foliplus.HINT_DURATION.PERSIST,
  );
};

/** Show a hint with crop box size info. */
const showHintWithInfo = (mgr, r, instruction) => {
  mgr.checkPixelLimit(r);
  foliplus.showHint(
    CONF.name,
    `${_(`${CONF.name}.label_size_prefix`)}${Math.round(r.width)} × ${Math.round(r.height)} ` +
      `${_(`${CONF.name}.label_size_suffix`)}${instruction ? ` — ${instruction}` : ""}`,
    foliplus.HINT_DURATION.PERSIST,
    null,
    "size",
  );
  if (mgr.pixelOverLimit) {
    foliplus.showHint(
      CONF.name,
      _(`${CONF.name}.err_too_large`).replace(
        "{limit}",
        foliplus.formatNumber(CONF.max_pixels),
      ),
      foliplus.HINT_DURATION.PERSIST,
      null,
      "limit",
    );
  } else foliplus.hideHint(CONF.name, "limit");
};

/** Build the crop box DOM and attach events. */
const showCropBox = (mgr) => {
  if (mgr.cropState) return;
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

  const overlay = foliplus.dom.el("div", {
    class: `foliplus-export-overlay active`,
    parent: mgr.mapContainer,
  });
  mgr.mapContainer.classList.add(CONST.CLASSES.MODE);
  document.body.classList.add(CONST.CLASSES.MODE);

  const cropBox = foliplus.dom.el("div", {
    class: CONST.CLASSES.BOX,
    parent: mgr.mapContainer,
  });

  ["tl", "tr", "bl", "br", "t", "b", "l", "r"].forEach((pos) => {
    foliplus.dom.el("div", {
      class: `${CONST.CLASSES.HANDLE} ${pos}`,
      parent: cropBox,
      "data-pos": pos,
    });
  });
  foliplus.dom.el("div", { class: CONST.CLASSES.CENTER, parent: cropBox });

  mgr.exportToolBar.innerHTML = "";
  foliplus.dom.el(
    "button",
    {
      class: `${CONST.CLASSES.TOOL_BTN} ${CONST.CLASSES.CONFIRM}`,
      title: _(`${CONF.name}.btn_confirm`),
      parent: mgr.exportToolBar,
    },
    { html: SVGs.CHECK },
  );
  foliplus.dom.el(
    "button",
    {
      class: `${CONST.CLASSES.TOOL_BTN} ${CONST.CLASSES.CANCEL} ${CONST.CLASSES.CLOSE}`,
      title: _(`${CONF.name}.btn_cancel`),
      parent: mgr.exportToolBar,
    },
    { html: Icons.CLOSE },
  );
  mgr.exportCtrl.classList.remove(CONST.CLASSES.COLLAPSED);
  mgr.exportCtrl.classList.add(CONST.CLASSES.EXPANDED);

  mgr.cropState = {
    overlay,
    box: cropBox,
    rect: box,
    locked: false,
    actions: mgr.exportToolBar,
  };
  updateBoxStyle(mgr, cropBox, box);
  mgr.pushUndoState();
  showHintWithInfo(mgr, box, _(`${CONF.name}.hint_unlocked`));
  cropBox.addEventListener("mousedown", mgr.onMouseDown);
  mgr.exportToolBar.querySelector(".cancel").onclick = (e) => {
    e.stopPropagation();
    mgr.removeCropBox();
  };
  mgr.exportToolBar.querySelector(".confirm").onclick = (e) => {
    e.stopPropagation();
    mgr.lockCropBox();
  };
  document.addEventListener("keydown", mgr.onKeyDown);
};

/** Update toolbar for locked state (export button). */
const lockCropBox = (mgr, skipHint) => {
  if (!mgr.cropState || mgr.cropState.locked) return;
  mgr.cropState.locked = true;
  mgr.cropState.box.classList.add("locked");
  const r = mgr.cropState.rect;
  mgr.cropState.savedGeoBounds = {
    nw: mgr.map.containerPointToLatLng(L.point(r.left, r.top)),
    se: mgr.map.containerPointToLatLng(L.point(r.left + r.width, r.top + r.height)),
  };
  mgr.cropState.geoBounds = mgr.cropState.savedGeoBounds;
  mgr.cropState.actions.innerHTML = "";
  foliplus.dom.el(
    "button",
    {
      class: `${CONST.CLASSES.TOOL_BTN} ${CONST.CLASSES.CONFIRM}`,
      title: _(`${CONF.name}.btn_export`),
      parent: mgr.cropState.actions,
    },
    { html: SVGs.DOWNLOAD },
  );
  foliplus.dom.el(
    "button",
    {
      class: `${CONST.CLASSES.TOOL_BTN} ${CONST.CLASSES.CANCEL} ${CONST.CLASSES.CLOSE}`,
      title: _(`${CONF.name}.btn_cancel`),
      parent: mgr.cropState.actions,
    },
    { html: Icons.CLOSE },
  );
  mgr.cropState.actions.querySelector(`.${CONST.CLASSES.CANCEL}`).onclick = (e) => {
    e.stopPropagation();
    mgr.unlockCropBox();
  };
  mgr.cropState.actions.querySelector(`.${CONST.CLASSES.CONFIRM}`).onclick = (e) => {
    e.stopPropagation();
    mgr.doExport();
  };
  mgr.mapMoveCleanup = foliplus.bindMapSync({
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
  if (!skipHint) showHintWithInfo(mgr, r, _(`${CONF.name}.hint_locked`));
};

/** Update toolbar for unlocked state (confirm button). */
const unlockCropBox = (mgr) => {
  if (!mgr.cropState || !mgr.cropState.locked) return;
  mgr.cropState.locked = false;
  mgr.cropState.box.classList.remove("locked");
  if (mgr.mapMoveCleanup) mgr.mapMoveCleanup();
  mgr.cropState.actions.innerHTML = "";
  foliplus.dom.el(
    "button",
    {
      class: `${CONST.CLASSES.TOOL_BTN} ${CONST.CLASSES.CONFIRM}`,
      title: _(`${CONF.name}.btn_confirm`),
      parent: mgr.cropState.actions,
    },
    { html: SVGs.CHECK },
  );
  foliplus.dom.el(
    "button",
    {
      class: `${CONST.CLASSES.TOOL_BTN} ${CONST.CLASSES.CANCEL} ${CONST.CLASSES.CLOSE}`,
      title: _(`${CONF.name}.btn_cancel`),
      parent: mgr.cropState.actions,
    },
    { html: Icons.CLOSE },
  );
  mgr.cropState.actions.querySelector(`.${CONST.CLASSES.CANCEL}`).onclick = (e) => {
    e.stopPropagation();
    mgr.removeCropBox();
  };
  mgr.cropState.actions.querySelector(`.${CONST.CLASSES.CONFIRM}`).onclick = (e) => {
    e.stopPropagation();
    mgr.lockCropBox();
  };
  updateBoxStyle(mgr, mgr.cropState.box, mgr.cropState.rect);
  showHintWithInfo(mgr, mgr.cropState.rect, _(`${CONF.name}.hint_unlocked`));
};

/** Remove crop box DOM and restore UI state. */
const removeCropBox = (mgr) => {
  if (!mgr.cropState) return;
  mgr.lastScreenRect = Object.assign({}, mgr.cropState.rect);
  mgr.mapContainer.classList.remove(CONST.CLASSES.MODE);
  document.body.classList.remove(CONST.CLASSES.MODE);
  document.removeEventListener("keydown", mgr.onKeyDown);
  document.removeEventListener("mousemove", mgr.onMouseMove);
  document.removeEventListener("mouseup", mgr.onMouseUp);
  mgr.dragState.dragging = false;
  mgr.dragState.dragType = null;
  if (mgr.mapMoveCleanup) {
    mgr.mapMoveCleanup();
    mgr.mapMoveCleanup = null;
  }
  if (mgr.cropState.box)
    mgr.cropState.box.removeEventListener("mousedown", mgr.onMouseDown);
  if (mgr.cropState.overlay?.parentNode) mgr.cropState.overlay.remove();
  if (mgr.cropState.box?.parentNode) mgr.cropState.box.remove();
  if (mgr.cropState.actions) mgr.cropState.actions.innerHTML = "";
  if (mgr.exportCtrl) {
    mgr.exportCtrl.classList.remove(CONST.CLASSES.EXPANDED);
    mgr.exportCtrl.classList.add(CONST.CLASSES.COLLAPSED);
  }
  mgr.cropState = null;
  foliplus.hideHint(CONF.name);
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
