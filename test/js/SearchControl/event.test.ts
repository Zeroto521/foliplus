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
    ctrl.inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
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
    ctrl.inp.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(ctrl.selectedSuggestionIdx).toBe(0);
    expect(ctrl.inp.value).toBe("One");
  });

  it("searches on Enter", () => {
    const ctrl = makeCtrl();
    ctrl.inp.value = "121.47,31.23";
    bindEvents(ctrl);
    ctrl.inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
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
