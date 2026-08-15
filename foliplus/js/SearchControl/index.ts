import { BaseControl } from "#foliplus/BaseControl.js";
import type { Debounced } from "#common/debounce.js";
import { createIconButton, dom } from "#common/dom.js";
import { createControlEnv } from "#common/guard.js";
import { ensureHint } from "#core/hint.js";
import * as Icons from "#common/icon.js";
import { bindOutsideCollapse, createFoldControl } from "#common/panel.js";
import { CLASSES, MODE } from "./const.js";
import { bindEvents, initFromUrl } from "./event.js";
import * as SVGs from "./icon.js";
import { initDebouncedFetch, removeSuggestions } from "./logic.js";
import type { AddressResult, NominatimItem } from "./type.js";

const { _ } = createControlEnv(CONF, SVGs.SEARCH);
ensureHint(map);

// ==================== Control Definition ====================
export class SearchControl extends BaseControl {
  declare container: HTMLElement;
  declare ctrl: HTMLElement;
  declare toggleBtn: HTMLElement;
  declare toolBar: HTMLElement;
  declare modeBtn: HTMLElement;
  declare inp: HTMLInputElement;
  declare clearBtn: HTMLElement;
  declare debouncedFetch: Debounced;
  declare cachedSuggestions: Record<string, NominatimItem[]>;
  declare cachedAddress: Record<string, AddressResult>;
  declare scrollTargets: Array<Element | Window>;
  declare repositionHandler: () => void;
  declare addrAbortController: AbortController | null;
  declare suggestAbortController: AbortController | null;
  declare marker: L.Marker | null;
  declare delIcon: L.Marker | null;
  declare mode: string;
  declare suggestionsWrap: HTMLElement | null;
  declare selectedSuggestionIdx: number;
  declare lastSuggestFetch: number;
  declare suggestionsThrottleTimer: ReturnType<typeof setTimeout> | null;
  declare suggestSeq: number;

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
    this.scrollTargets.forEach(t =>
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

    const modeBtn = createIconButton({
      class: CLASSES.SEARCH_MODE_BTN,
      title: _(`${CONF.name}.mode_coord`),
      svg: Icons.LOCATE,
      parent: toolBar,
    });
    const inp = dom.el("input", {
      type: "text",
      placeholder: _(`${CONF.name}.coord_placeholder`),
    }) as HTMLInputElement;
    const clearBtn = createIconButton({
      class: "foliplus-ctrl-btn foliplus-close-btn",
      title: _(`${CONF.name}.clear_title`),
      svg: Icons.CLOSE,
    });
    this.modeBtn = modeBtn;
    this.inp = inp;
    this.clearBtn = clearBtn;

    dom.el("div", { class: CLASSES.CLEAR, parent: toolBar }, inp, clearBtn);
  }

  // ── State Initialization ──
  initState() {
    this.marker = null;
    this.delIcon = null;
    this.mode = CONF.mode ?? "";
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
    this.modeBtn.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      this.setMode(this.mode === MODE.COORD ? MODE.ADDR : MODE.COORD);
    };
  }

  // ── Mode Switching ──
  setMode(newMode: string) {
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
    if (this.delIcon) {
      map.removeLayer(this.delIcon);
      this.delIcon = null;
    }
    if (this.suggestAbortController) this.suggestAbortController.abort();
    map.foliplus!.hideHint(CONF.name);
    removeSuggestions(this);
    this.inp.focus();
  }
}

new SearchControl({ position: CONF.position }).addTo(map);
