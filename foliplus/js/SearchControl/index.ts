import { defineControl } from "#core/defineControl.js";
import type { SuggestItem } from "#core/geocode/index.js";
import { ensureHint } from "#core/hint.js";
import { bindOutsideCollapse, createFoldControl } from "#core/leaflet/index.js";
import { ensureMapFoliplus } from "#core/mapApi.js";
import { Cache } from "#common/cache.js";
import type { Debounced } from "#common/debounce.js";
import { createIconButton, dom } from "#common/dom.js";
import * as Icons from "#common/icon.js";
import { AUTOCOMPLETE, CLASSES, MODE } from "./const.js";
import * as SVGs from "./icon.js";
import { bindEvents, initFromUrl } from "./interaction.js";
import {
  flushHistory,
  initDebouncedFetch,
  loadHistory,
  removePanel,
} from "./logic/index.js";
import type { ResultItem, SearchHistoryEntry, SearchType } from "./type.js";

class SearchControl extends defineControl({
  config: CONFIG,
  icon: SVGs.ICON_SEARCH,
  setup: () => ensureHint(map),
}) {
  declare container: HTMLElement;
  declare ctrl: HTMLElement;
  declare toggleBtn: HTMLElement;
  declare toolBar: HTMLElement;
  declare modeBtn: HTMLElement;
  declare inp: HTMLInputElement;
  declare clearBtn: HTMLElement;
  declare debouncedFetch: Debounced;
  declare cachedSuggestions: Cache<string, SuggestItem[]>;
  declare searchHistory: SearchHistoryEntry[];
  declare scrollTargets: Array<Element | Window>;
  declare repositionHandler: () => void;
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
    this.effect(() => bindEvents(this));
    initFromUrl(this);
    this.effect(() =>
      bindOutsideCollapse({
        container: this.ctrl,
        skipCheck: this.config.collapse_on_outside === false ? () => true : undefined,
      }),
    );
    return this.container;
  }

  destroy() {
    removePanel(this);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- debouncedFetch may be null
    if (this.debouncedFetch) this.debouncedFetch.cancel();
    if (this.addrAbortController) this.addrAbortController.abort();
    if (this.suggestAbortController) this.suggestAbortController.abort();
    this.cachedSuggestions.clear();
    // Flush any pending history write before the in-memory array is dropped,
    // so a last search that raced teardown is durable.
    flushHistory(this);
    this.searchHistory = [];
    if (this.throttleTimer) clearTimeout(this.throttleTimer);
    this.modeBtn.onclick = null;
    this.clearBtn.onclick = null;
  }

  createDOM() {
    const { container, ctrl, toolBar, toggleBtn } = createFoldControl({
      cssClass: CLASSES.MAP_SEARCH,
      toggleTitle: this.T("btn_title"),
      toggleSvg: SVGs.ICON_SEARCH,
      position: this.config.position,
    });
    ctrl.id = `${this.config.name}_${this.config.position}_ctrl`;
    this.container = container;
    this.ctrl = ctrl;
    this.toggleBtn = toggleBtn;
    this.toolBar = toolBar;

    const modeBtn = createIconButton({
      class: CLASSES.SEARCH_MODE_BTN,
      title: this.T("mode_coord"),
      svg: Icons.ICON_GLOBE,
      parent: toolBar,
    });
    const inp = dom.el("input", {
      type: "text",
      class: "foliplus-input",
      placeholder: this.T("coord_placeholder"),
    }) as HTMLInputElement;
    const clearBtn = createIconButton({
      class: "foliplus-ctrl-btn foliplus-close-btn",
      title: this.T("clear_title"),
      svg: Icons.ICON_CLOSE,
    });
    this.modeBtn = modeBtn;
    this.inp = inp;
    this.clearBtn = clearBtn;

    dom.el("div", { class: CLASSES.CLEAR, parent: toolBar }, inp, clearBtn);
  }

  initState() {
    this.marker = null;
    this.delIcon = null;
    // Register this control's provider as the map default so indirect
    // geocoding (foliplus.geocode / reverseGeocode without an explicit spec)
    // follows the same provider — cache keys and rate limits stay consistent.
    // Route through the shared seed so the namespace's typing stays sound.
    const api = ensureMapFoliplus(this._map);
    api.geocodeProvider = this.config.provider ?? "nominatim";
    this.mode =
      this.config.mode === MODE.COORD || this.config.mode === MODE.ADDR
        ? this.config.mode
        : MODE.COORD;
    this.panelWrap = null;
    this.selectedIdx = -1;
    this.lastSuggestFetch = 0;
    this.throttleTimer = null;
    this.cachedSuggestions = new Cache<string, SuggestItem[]>(
      AUTOCOMPLETE.CACHE_MAX,
      AUTOCOMPLETE.CACHE_TTL_MS,
    );
    this.searchHistory = loadHistory(this);
    this.suggestAbortController = null;
    this.suggestSeq = 0;
    this.currentItems = [];

    this.setMode(this.mode);
    this.modeBtn.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      this.setMode(this.mode === MODE.COORD ? MODE.ADDR : MODE.COORD);
    };
  }

  setMode(newMode: SearchType) {
    this.mode = newMode;
    if (this.mode === MODE.COORD) {
      this.modeBtn.innerHTML = Icons.ICON_GLOBE;
      this.modeBtn.title = this.T("mode_coord");
      this.inp.placeholder = this.T("coord_placeholder");
    } else {
      this.modeBtn.innerHTML = Icons.ICON_LOCATION_PIN;
      this.modeBtn.title = this.T("mode_addr");
      this.inp.placeholder = this.T("addr_placeholder");
    }
    this.inp.value = "";
    if (this.marker) {
      this._map.removeLayer(this.marker);
      this.marker = null;
    }
    if (this.delIcon) {
      this._map.removeLayer(this.delIcon);
      this.delIcon = null;
    }
    if (this.suggestAbortController) this.suggestAbortController.abort();
    this._map.foliplus!.hideHint(this.config.name);
    removePanel(this);
    this.inp.focus();
  }
}

new SearchControl({ position: CONFIG.position }).addTo(map);
