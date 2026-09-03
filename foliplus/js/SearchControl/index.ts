import { ensureHint } from "#core/hint.js";
import { BaseControl } from "#foliplus/BaseControl.js";
import { Cache } from "#common/cache.js";
import type { Debounced } from "#common/debounce.js";
import { createIconButton, dom } from "#common/dom.js";
import { createControlEnv } from "#common/guard.js";
import * as Icons from "#common/icon.js";
import { createScopedTranslator } from "#common/locale.js";
import { bindOutsideCollapse, createFoldControl } from "#common/panel.js";
import { CLASSES, MODE, type SearchType } from "./const.js";
import * as SVGs from "./icon.js";
import { bindEvents, initFromUrl } from "./interaction.js";
import { initDebouncedFetch, loadHistory, removePanel } from "./logic.js";
import type {
  AddressResult,
  NominatimItem,
  ResultItem,
  SearchHistoryEntry,
} from "./type.js";

createControlEnv(CONF, SVGs.SEARCH);
const T = createScopedTranslator(CONF);
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
  declare cachedSuggestions: Cache<string, NominatimItem[]>;
  declare searchHistory: SearchHistoryEntry[];
  declare scrollTargets: Array<Element | Window>;
  declare repositionHandler: () => void;
  declare interactionCleanup: (() => void) | null;
  declare addrAbortController: AbortController | null;
  declare suggestAbortController: AbortController | null;
  declare marker: L.Marker | null;
  declare delIcon: L.Marker | null;
  declare mode: SearchType;
  declare panelWrap: HTMLElement | null;
  declare selectedIdx: number;
  declare lastSuggestFetch: number;
  declare throttleTimer: ReturnType<typeof setTimeout> | null;
  declare suggestSeq: number;
  declare currentItems: ResultItem[];

  buildDOM() {
    this.createDOM();
    this.initState();
    initDebouncedFetch(this);
    this.interactionCleanup = bindEvents(this);
    initFromUrl(this);
    bindOutsideCollapse({ container: this.ctrl });
    return this.container;
  }

  destroy() {
    this.interactionCleanup?.();
    removePanel(this);
    if (this.debouncedFetch) this.debouncedFetch.cancel();
    if (this.addrAbortController) this.addrAbortController.abort();
    if (this.suggestAbortController) this.suggestAbortController.abort();
    this.cachedSuggestions.clear();
    this.searchHistory = [];
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
      toggleTitle: T("btn_title"),
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
      title: T("mode_coord"),
      svg: Icons.GLOBE,
      parent: toolBar,
    });
    const inp = dom.el("input", {
      type: "text",
      class: "foliplus-input",
      placeholder: T("coord_placeholder"),
    }) as HTMLInputElement;
    const clearBtn = createIconButton({
      class: "foliplus-ctrl-btn foliplus-close-btn",
      title: T("clear_title"),
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
    this.mode =
      CONF.mode === MODE.COORD || CONF.mode === MODE.ADDR ? CONF.mode : MODE.COORD;
    this.panelWrap = null;
    this.selectedIdx = -1;
    this.lastSuggestFetch = 0;
    this.throttleTimer = null;
    this.cachedSuggestions = new Cache<string, NominatimItem[]>(50);
    this.searchHistory = loadHistory();
    this.suggestAbortController = null;
    this.suggestSeq = 0;
    this.currentItems = [];

    this.setMode(this.mode);
    this.modeBtn.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      this.setMode(this.mode === MODE.COORD ? MODE.ADDR : MODE.COORD);
    };
  }

  // ── Mode Switching ──
  setMode(newMode: SearchType) {
    this.mode = newMode;
    if (this.mode === MODE.COORD) {
      this.modeBtn.innerHTML = Icons.GLOBE;
      this.modeBtn.title = T("mode_coord");
      this.inp.placeholder = T("coord_placeholder");
    } else {
      this.modeBtn.innerHTML = Icons.LOCATE;
      this.modeBtn.title = T("mode_addr");
      this.inp.placeholder = T("addr_placeholder");
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
    removePanel(this);
    this.inp.focus();
  }
}

new SearchControl({ position: CONF.position }).addTo(map);
