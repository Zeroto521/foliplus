import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindEvents, initFromUrl } from "#foliplus/SearchControl/event.js";
import { Cache } from "#foliplus/common/cache.js";

function makeCtrl(): any {
  const ctrlDiv = document.createElement("div");
  ctrlDiv.className = "foliplus-search collapsed";
  const toggleBtn = document.createElement("button");
  const clearBtn = document.createElement("button");
  const inp = document.createElement("input");
  const handlers = {};
  inp.addEventListener = vi.fn((event, fn) => {
    handlers[event] = fn;
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
    ctrl._handlers.keydown({ key: "Escape" });
    expect(ctrl.ctrl.classList.contains("collapsed")).toBe(true);
    expect(window.map.foliplus.hideHint).toHaveBeenCalledWith("SearchControl");
  });

  it("navigates suggestions with ArrowDown", () => {
    const ctrl = makeCtrl();
    ctrl.suggestionsWrap = document.createElement("div");
    const mk = text => {
      const el = document.createElement("div");
      el.innerHTML = `<span class="foliplus-search-suggestion-text">${text}</span>`;
      return el;
    };
    ctrl.suggestionsWrap.append(mk("One"), mk("Two"));
    bindEvents(ctrl);
    const event = { key: "ArrowDown", preventDefault: vi.fn() };
    ctrl._handlers.keydown(event);
    expect(ctrl.selectedSuggestionIdx).toBe(0);
    expect(ctrl.inp.value).toBe("One");
  });

  it("searches on Enter", () => {
    const ctrl = makeCtrl();
    ctrl.inp.value = "121.47,31.23";
    bindEvents(ctrl);
    ctrl._handlers.keydown({ key: "Enter" });
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
        label: "Paris, France",
        lat: 48.8,
        lng: 2.3,
        ts: 1000,
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

  it("navigates across history items (group header + entries) with ArrowDown", () => {
    const ctrl = makeCtrl();
    ctrl.mode = "addr";
    ctrl.suggestionsWrap = document.createElement("div");
    // History panel: group header (non-text item) + history entry
    const header = document.createElement("div");
    header.className = "foliplus-search-history-group-header";
    header.innerHTML =
      '<span class="foliplus-search-history-group-title">Search History</span>';
    const item = document.createElement("div");
    item.className = "foliplus-search-suggestion-item foliplus-search-history-item";
    item.innerHTML =
      '<span class="foliplus-search-suggestion-icon">📍</span><span class="foliplus-search-suggestion-text">Paris, France</span>';
    ctrl.suggestionsWrap.append(header, item);
    bindEvents(ctrl);

    // First ArrowDown: moves to group header (no text → inp stays "")
    ctrl._handlers.keydown({ key: "ArrowDown", preventDefault: vi.fn() });
    expect(ctrl.selectedSuggestionIdx).toBe(0);
    expect(ctrl.inp.value).toBe("");

    // Second ArrowDown: moves to history entry
    ctrl._handlers.keydown({ key: "ArrowDown", preventDefault: vi.fn() });
    expect(ctrl.selectedSuggestionIdx).toBe(1);
    expect(ctrl.inp.value).toBe("Paris, France");
  });

  it("keyboard navigation wraps at panel boundaries", () => {
    const ctrl = makeCtrl();
    ctrl.suggestionsWrap = document.createElement("div");
    const mk = text => {
      const el = document.createElement("div");
      el.innerHTML = `<span class="foliplus-search-suggestion-text">${text}</span>`;
      return el;
    };
    ctrl.suggestionsWrap.append(mk("One"), mk("Two"));
    bindEvents(ctrl);

    // Start at index -1, go up → stays at -1
    ctrl._handlers.keydown({ key: "ArrowUp", preventDefault: vi.fn() });
    expect(ctrl.selectedSuggestionIdx).toBe(-1);
    expect(ctrl.inp.value).toBe("");

    // Go down past the last item → clamps
    ctrl._handlers.keydown({ key: "ArrowDown", preventDefault: vi.fn() });
    ctrl._handlers.keydown({ key: "ArrowDown", preventDefault: vi.fn() });
    ctrl._handlers.keydown({ key: "ArrowDown", preventDefault: vi.fn() });
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
});
