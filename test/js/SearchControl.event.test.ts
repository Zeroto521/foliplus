import {
  bindEvents,
  initFromUrl,
} from "#foliplus/SearchControl/SearchControl.event.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    debouncedFetch: { cancel: vi.fn() },
    suggestionsWrap: null,
    suggestionsThrottleTimer: null,
    selectedSuggestionIdx: -1,
    cachedAddress: {},
    cachedSuggestions: {},
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
    expect(foliplus.hideHint).toHaveBeenCalledWith("SearchControl");
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

  it("clears input and removes marker on clear", () => {
    const ctrl = makeCtrl();
    ctrl.inp.value = "abc";
    const marker = { id: 1 };
    ctrl.marker = marker;
    bindEvents(ctrl);
    ctrl.clearBtn.click();
    expect(ctrl.inp.value).toBe("");
    expect(map.removeLayer).toHaveBeenCalledWith(marker);
    expect(ctrl.marker).toBeNull();
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
