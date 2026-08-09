import { BaseControl } from "../common/BaseControl.js";
import { dom } from "../common/dom.js";
import { createControlEnv } from "../common/guard.js";
import * as Icons from "../common/icon.js";
import { bindOutsideCollapse, createFoldControl } from "../common/panel.js";
import { CLASSES, MODE } from "./SearchControl.const.js";
import { bindEvents, initFromUrl } from "./SearchControl.event.js";
import * as SVGs from "./SearchControl.icon.js";
import { initDebouncedFetch, removeSuggestions } from "./SearchControl.logic.js";

const { _, foliplus } = createControlEnv(CONF, SVGs.SEARCH);

// ==================== Control Definition ====================
class SearchControl extends BaseControl {
  constructor(options) {
    super(options);
    this._ = _;
  }

  buildDOM() {
    this.createDOM();
    this.initState();
    initDebouncedFetch(this);
    bindEvents(this);
    initFromUrl(this);
    bindOutsideCollapse({ container: this.ctrl });
    return this.container;
  }

  destroy() {
    removeSuggestions(this);
    if (this.debouncedFetch) this.debouncedFetch.cancel();
    if (this.addrAbortController) this.addrAbortController.abort();
    if (this.suggestAbortController) this.suggestAbortController.abort();
    this.cachedSuggestions = {};
    this.cachedAddress = {};
    this.scrollTargets.forEach((t) =>
      t.removeEventListener("scroll", this.repositionHandler, true),
    );
    window.removeEventListener("resize", this.repositionHandler);
    this.modeBtn.onclick = null;
    this.clearBtn.onclick = null;
  }

  // ── DOM Creation ──
  createDOM() {
    const { container, ctrl, toolBar, toggleBtn } = createFoldControl({
      cssClass: CLASSES.MAP_SEARCH,
      toggleTitle: _(`${CONF.name}.btn_title`),
      toggleSvg: SVGs.SEARCH,
      position: CONF.position,
    });
    ctrl.id = `${CONF.name}_${CONF.position}_ctrl`;
    this.container = container;
    this.ctrl = ctrl;
    this.toggleBtn = toggleBtn;
    this.toolBar = toolBar;

    const modeBtn = dom.el(
      "button",
      {
        class: CLASSES.SEARCH_MODE_BTN,
        title: _(`${CONF.name}.mode_coord`),
        parent: toolBar,
      },
      { html: Icons.LOCATE },
    );
    const inp = dom.el("input", {
      type: "text",
      placeholder: _(`${CONF.name}.coord_placeholder`),
    });
    const clearBtn = dom.el(
      "button",
      {
        class: "foliplus-ctrl-btn foliplus-close-btn",
        title: _(`${CONF.name}.clear_title`),
      },
      { html: Icons.CLOSE },
    );
    this.modeBtn = modeBtn;
    this.inp = inp;
    this.clearBtn = clearBtn;

    dom.el("div", { class: CLASSES.CLEAR, parent: toolBar }, inp, clearBtn);
  }

  // ── State Initialization ──
  initState() {
    this.marker = null;
    this.mode = CONF.mode;
    if (this.mode !== MODE.COORD && this.mode !== MODE.ADDR) this.mode = MODE.COORD;
    this.suggestionsWrap = null;
    this.selectedSuggestionIdx = -1;
    this.lastSuggestFetch = 0;
    this.suggestionsThrottleTimer = null;
    this.cachedSuggestions = {};
    this.cachedAddress = {};
    this.suggestAbortController = null;
    this.suggestSeq = 0;

    this.setMode(this.mode);
    this.modeBtn.onclick = (e) => {
      e.stopPropagation();
      this.setMode(this.mode === MODE.COORD ? MODE.ADDR : MODE.COORD);
    };
  }

  // ── Mode Switching ──
  setMode(newMode) {
    this.mode = newMode;
    if (this.mode === MODE.COORD) {
      this.modeBtn.innerHTML = Icons.LOCATE;
      this.modeBtn.title = _(`${CONF.name}.mode_coord`);
      this.inp.placeholder = _(`${CONF.name}.coord_placeholder`);
    } else {
      this.modeBtn.innerHTML = Icons.GLOBE;
      this.modeBtn.title = _(`${CONF.name}.mode_addr`);
      this.inp.placeholder = _(`${CONF.name}.addr_placeholder`);
    }
    this.inp.value = "";
    if (this.marker) {
      map.removeLayer(this.marker);
      this.marker = null;
    }
    if (this.suggestAbortController) this.suggestAbortController.abort();
    foliplus.hideHint(CONF.name);
    removeSuggestions(this);
    this.inp.focus();
  }
}

new SearchControl({ position: CONF.position }).addTo(map);
