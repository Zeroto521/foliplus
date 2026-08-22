import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindEvents, initFromUrl } from "#foliplus/SearchControl/interaction.js";
import { Cache } from "#foliplus/common/cache.js";
import { dom } from "#foliplus/common/dom.js";

function makeCtrl(): any {
  const ctrlDiv = document.createElement("div");
  ctrlDiv.className = "foliplus-search collapsed";
  const toggleBtn = document.createElement("button");
  const clearBtn = document.createElement("button");
  const inp = document.createElement("input");
  const handlers = {};
  const originalAdd = inp.addEventListener.bind(inp);
  inp.addEventListener = vi.fn((event, fn) => {
    // keydown: let KeyboardManager bind normally (real listener)
    // other events (input, focus, blur): capture for direct test calls
    if (event !== "keydown") handlers[event] = fn;
    originalAdd(event, fn);
  });
  return {
    ctrl: ctrlDiv,
    toggleBtn,
    clearBtn,
    inp,
    _handlers: handlers,
    mode: "coord",
    marker: null,
    delIcon: null,
    debouncedFetch: { cancel: vi.fn() },
    suggestionsWrap: null,
    suggestionsThrottleTimer: null,
    selectedSuggestionIdx: -1,
    cachedAddress: {},
    cachedSuggestions: new Cache<string, object>(50),
    searchHistory: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Let panel.js bindFoldToggle delegate to real DOM listeners so clicks fire.
  window.L.DomEvent.on = vi.fn((el, event, fn) => el.addEventListener(event, fn));
  window.L.DomEvent.off = vi.fn((el, event, fn) => el.removeEventListener(event, fn));
  window.L.DomEvent.stop = vi.fn();
});

afterEach(() => {
  delete globalThis.fetch;
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

describe("bindEvents", () => {
  it("expands and collapses via toggle button", () => {
    const ctrl = makeCtrl();
    bindEvents(ctrl);
    ctrl.toggleBtn.click();
    expect(ctrl.ctrl.classList.contains("expanded")).toBe(true);
    ctrl.toggleBtn.click();
    expect(ctrl.ctrl.classList.contains("collapsed")).toBe(true);
  });

  it("collapses and hides hint on Escape", () => {
    const ctrl = makeCtrl();
    ctrl.ctrl.classList.add("expanded");
    bindEvents(ctrl);
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(ctrl.ctrl.classList.contains("collapsed")).toBe(true);
    expect(window.map.foliplus.hideHint).toHaveBeenCalledWith("SearchControl");
  });

  it("navigates suggestions with ArrowDown", () => {
    const ctrl = makeCtrl();
    ctrl.suggestionsWrap = dom.el("div");
    const mk = text =>
      dom.el(
        "div",
        { class: "foliplus-search-suggestion-item" },
        dom.el("span", { class: "foliplus-search-suggestion-text" }, text),
      );
    ctrl.suggestionsWrap.append(mk("One"), mk("Two"));
    bindEvents(ctrl);
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(ctrl.selectedSuggestionIdx).toBe(0);
    expect(ctrl.inp.value).toBe("One");
  });

  it("navigates suggestions with ArrowUp", () => {
    const ctrl = makeCtrl();
    ctrl.suggestionsWrap = dom.el("div");
    const mk = text =>
      dom.el(
        "div",
        { class: "foliplus-search-suggestion-item" },
        dom.el("span", { class: "foliplus-search-suggestion-text" }, text),
      );
    ctrl.suggestionsWrap.append(mk("One"), mk("Two"));
    bindEvents(ctrl);
    // First ArrowUp when idx is -1 → stays -1 (no active)
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    expect(ctrl.selectedSuggestionIdx).toBe(-1);
    // Set to 1 via internal state, then ArrowUp → 0
    ctrl.selectedSuggestionIdx = 1;
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    expect(ctrl.selectedSuggestionIdx).toBe(0);
  });

  it("Escape with open suggestions removes suggestions", () => {
    const ctrl = makeCtrl();
    ctrl.ctrl.classList.add("expanded");
    ctrl.suggestionsWrap = dom.el(
      "div",
      null,
      dom.el("div", { class: "foliplus-search-suggestion" }, "One"),
    );
    bindEvents(ctrl);
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(ctrl.suggestionsWrap).toBeNull();
  });

  it("searches on Enter", () => {
    const ctrl = makeCtrl();
    ctrl.inp.value = "121.47,31.23";
    bindEvents(ctrl);
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(map.flyTo).toHaveBeenCalled();
  });

  it("clears input and removes marker + del icon on clear", () => {
    const ctrl = makeCtrl();
    ctrl.inp.value = "abc";
    const marker = { id: 1 };
    const delIcon = { id: 2 };
    ctrl.marker = marker;
    ctrl.delIcon = delIcon;
    bindEvents(ctrl);
    ctrl.clearBtn.click();
    expect(ctrl.inp.value).toBe("");
    expect(map.removeLayer).toHaveBeenCalledWith(marker);
    expect(map.removeLayer).toHaveBeenCalledWith(delIcon);
    expect(ctrl.marker).toBeNull();
    expect(ctrl.delIcon).toBeNull();
  });

  it("debounce-fetches on addr input", () => {
    const ctrl = makeCtrl();
    ctrl.mode = "addr";
    ctrl.debouncedFetch = vi.fn();
    bindEvents(ctrl);
    ctrl._handlers.input();
    expect(ctrl.debouncedFetch).toHaveBeenCalled();
  });

  it("cancels debounced fetch on coord input", () => {
    const ctrl = makeCtrl();
    ctrl.mode = "coord";
    ctrl.debouncedFetch = { cancel: vi.fn() };
    bindEvents(ctrl);
    ctrl._handlers.input();
    expect(ctrl.debouncedFetch.cancel).toHaveBeenCalled();
  });

  it("fetches suggestions on focus in ADDR mode", () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve([]) }),
    ) as unknown as typeof fetch;
    const ctrl = makeCtrl();
    ctrl.mode = "addr";
    ctrl.inp.value = "abcdef";
    ctrl.lastSuggestFetch = 0;
    ctrl.suggestSeq = 0;
    ctrl.suggestAbortController = null;
    bindEvents(ctrl);
    ctrl._handlers.focus();
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it("renders search history on focus when input is empty", () => {
    const ctrl = makeCtrl();
    ctrl.mode = "addr";
    ctrl.inp.value = "";
    ctrl.searchHistory = [
      {
        query: "Paris",
        type: "addr",
        coordDisplay: "2.3, 48.8",
        addrDisplay: "Paris, France",
        lat: 48.8,
        lng: 2.3,
        ts: 1000,
        count: 1,
      },
    ];
    bindEvents(ctrl);
    ctrl._handlers.focus();
    expect(ctrl.suggestionsWrap).not.toBeNull();
    expect(ctrl.suggestionsWrap.innerHTML).toContain("Paris, France");
  });

  it("does nothing on focus when input is empty and no history exists", () => {
    const ctrl = makeCtrl();
    ctrl.mode = "addr";
    ctrl.inp.value = "";
    ctrl.searchHistory = [];
    bindEvents(ctrl);
    ctrl._handlers.focus();
    expect(ctrl.suggestionsWrap).toBeNull();
  });

  it("skips the history group header when navigating with ArrowDown", () => {
    const ctrl = makeCtrl();
    ctrl.mode = "addr";
    ctrl.suggestionsWrap = dom.el("div");
    // History panel: group header (non-selectable) + history entry
    const header = dom.el(
      "div",
      { class: "foliplus-search-history-group-header" },
      dom.el(
        "span",
        { class: "foliplus-search-history-group-title" },
        "Search History",
      ),
    );
    const item = dom.el(
      "div",
      { class: "foliplus-search-suggestion-item" },
      dom.el("span", { class: "foliplus-search-suggestion-icon" }, "📍"),
      dom.el("span", { class: "foliplus-search-suggestion-text" }, "Paris, France"),
    );
    ctrl.suggestionsWrap.append(header, item);
    bindEvents(ctrl);

    // ArrowDown should skip the group header (not a SUGGESTION_ITEM)
    // and land directly on the history entry.
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(ctrl.selectedSuggestionIdx).toBe(0);
    expect(ctrl.inp.value).toBe("Paris, France");
  });

  it("keyboard navigation clamps at panel boundaries", () => {
    const ctrl = makeCtrl();
    ctrl.suggestionsWrap = dom.el("div");
    const mk = text =>
      dom.el(
        "div",
        { class: "foliplus-search-suggestion-item" },
        dom.el("span", { class: "foliplus-search-suggestion-text" }, text),
      );
    ctrl.suggestionsWrap.append(mk("One"), mk("Two"));
    bindEvents(ctrl);

    // Start at index -1, go up → stays at -1
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    expect(ctrl.selectedSuggestionIdx).toBe(-1);
    expect(ctrl.inp.value).toBe("");

    // Go down past the last item → clamps
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(ctrl.selectedSuggestionIdx).toBe(1); // clamped to last item
    expect(ctrl.inp.value).toBe("Two");
  });
});

describe("initFromUrl", () => {
  it("does nothing without params", () => {
    const ctrl = makeCtrl();
    ctrl.setMode = vi.fn();
    expect(() => initFromUrl(ctrl)).not.toThrow();
    expect(ctrl.setMode).not.toHaveBeenCalled();
  });

  it("searches by lat/lng from URL params", () => {
    window.history.replaceState(null, "", "?lng=120&lat=30");
    const ctrl = makeCtrl();
    ctrl.setMode = vi.fn();
    initFromUrl(ctrl);
    expect(ctrl.setMode).toHaveBeenCalledWith("coord");
    expect(map.flyTo).toHaveBeenCalled();
  });

  it("searches by address from URL params", () => {
    window.history.replaceState(null, "", "?q=hello");
    const ctrl = makeCtrl();
    ctrl.setMode = vi.fn();
    ctrl.inp.value = "";
    initFromUrl(ctrl);
    expect(ctrl.setMode).toHaveBeenCalledWith("addr");
    expect(ctrl.inp.value).toBe("hello");
  });
});
