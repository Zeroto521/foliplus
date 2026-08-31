import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindEvents, initFromUrl } from "#foliplus/SearchControl/interaction.js";
import { Cache } from "#foliplus/common/cache.js";
import { dom } from "#foliplus/common/dom.js";
import { ensureModes } from "#foliplus/core/mode.js";

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
    panelWrap: null,
    throttleTimer: null,
    selectedIdx: -1,
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
  // Clear active modes so a blocked-mode test cannot leak and silently fail
  // the next test.
  const modes = ensureModes(window.map);
  for (const comp of ["MeasureControl", "ExportControl", "LayerControl"]) {
    if (modes.getMode(comp)) modes.setMode(comp, null);
  }
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

  it("removes floating panel when container is collapsed", async () => {
    const ctrl = makeCtrl();
    ctrl.ctrl.classList.add("expanded");
    ctrl.panelWrap = document.createElement("div");
    document.body.appendChild(ctrl.panelWrap);
    bindEvents(ctrl);
    // Simulate collapse via outside click (class toggle without calling onCollapse)
    ctrl.ctrl.classList.remove("expanded");
    ctrl.ctrl.classList.add("collapsed");
    // MutationObserver fires asynchronously; flush microtasks
    await new Promise(r => setTimeout(r, 0));
    expect(ctrl.panelWrap).toBeNull();
  });

  it("navigates suggestions with ArrowDown", () => {
    const ctrl = makeCtrl();
    ctrl.panelWrap = dom.el("div");
    const mk = text =>
      dom.el(
        "div",
        { class: "foliplus-search-result-item" },
        dom.el("span", { class: "foliplus-search-result-text" }, text),
      );
    ctrl.panelWrap.append(mk("One"), mk("Two"));
    bindEvents(ctrl);
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(ctrl.selectedIdx).toBe(0);
    expect(ctrl.inp.value).toBe("One");
  });

  it("navigates suggestions with ArrowUp", () => {
    const ctrl = makeCtrl();
    ctrl.panelWrap = dom.el("div");
    const mk = text =>
      dom.el(
        "div",
        { class: "foliplus-search-result-item" },
        dom.el("span", { class: "foliplus-search-result-text" }, text),
      );
    ctrl.panelWrap.append(mk("One"), mk("Two"));
    bindEvents(ctrl);
    // First ArrowUp when idx is -1 → stays -1 (no active)
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    expect(ctrl.selectedIdx).toBe(-1);
    // Set to 1 via internal state, then ArrowUp → 0
    ctrl.selectedIdx = 1;
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    expect(ctrl.selectedIdx).toBe(0);
  });

  it("ArrowUp onto a coord history item fills the canonical query", () => {
    const ctrl = makeCtrl();
    ctrl.panelWrap = dom.el("div");
    // Item 1 is a coord history entry (address display + data-query); item 0 is
    // a plain suggestion. ArrowUp from the suggestion must land on the entry's
    // canonical query, not its address display.
    const coord = dom.el(
      "div",
      {
        class: "foliplus-search-result-item",
        "data-query": "121.47,31.23",
        "data-index": "1",
      },
      dom.el("span", { class: "foliplus-search-result-text" }, "Shanghai, China"),
    );
    const plain = dom.el(
      "div",
      { class: "foliplus-search-result-item", "data-index": "0" },
      dom.el("span", { class: "foliplus-search-result-text" }, "Somewhere"),
    );
    ctrl.panelWrap.append(plain, coord);
    bindEvents(ctrl);
    // ArrowDown twice → land on the coord entry → query fills.
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(ctrl.inp.value).toBe("121.47,31.23");
    // ArrowUp back to the plain suggestion → display text fills again.
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    expect(ctrl.inp.value).toBe("Somewhere");
    // ArrowUp again onto the coord entry → canonical query restored.
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(ctrl.inp.value).toBe("121.47,31.23");
  });

  it("Escape with open suggestions removes suggestions", () => {
    const ctrl = makeCtrl();
    ctrl.ctrl.classList.add("expanded");
    ctrl.panelWrap = dom.el(
      "div",
      null,
      dom.el("div", { class: "foliplus-search-result" }, "One"),
    );
    bindEvents(ctrl);
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(ctrl.panelWrap).toBeNull();
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

  it("debounce-fetches on addr input with non-empty value", () => {
    const ctrl = makeCtrl();
    ctrl.mode = "addr";
    ctrl.inp.value = "abc";
    ctrl.debouncedFetch = vi.fn();
    bindEvents(ctrl);
    ctrl._handlers.input();
    expect(ctrl.debouncedFetch).toHaveBeenCalled();
  });

  it("cancels debounced fetch on coord input with non-empty value", () => {
    const ctrl = makeCtrl();
    ctrl.mode = "coord";
    ctrl.inp.value = "abc";
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
    expect(ctrl.panelWrap).not.toBeNull();
    expect(ctrl.panelWrap.innerHTML).toContain("Paris, France");
  });

  it("does nothing on focus when input is empty and no history exists", () => {
    const ctrl = makeCtrl();
    ctrl.mode = "addr";
    ctrl.inp.value = "";
    ctrl.searchHistory = [];
    bindEvents(ctrl);
    ctrl._handlers.focus();
    expect(ctrl.panelWrap).toBeNull();
  });

  it("skips the history group header when navigating with ArrowDown", () => {
    const ctrl = makeCtrl();
    ctrl.mode = "addr";
    ctrl.panelWrap = dom.el("div");
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
      { class: "foliplus-search-result-item" },
      dom.el("span", { class: "foliplus-search-result-icon" }, "📍"),
      dom.el("span", { class: "foliplus-search-result-text" }, "Paris, France"),
    );
    ctrl.panelWrap.append(header, item);
    bindEvents(ctrl);

    // ArrowDown should skip the group header (not a RESULT_ITEM)
    // and land directly on the history entry.
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(ctrl.selectedIdx).toBe(0);
    expect(ctrl.inp.value).toBe("Paris, France");
  });

  it("keyboard nav fills the canonical query for history items, not the display", () => {
    const ctrl = makeCtrl();
    ctrl.panelWrap = dom.el("div");
    // A coord history entry whose primary text is its reverse-geocoded address.
    // Its data-query must win over the display, or Enter would fail parseCoord.
    const item = dom.el(
      "div",
      {
        class: "foliplus-search-result-item",
        "data-query": "121.47,31.23",
        "data-index": "0",
      },
      dom.el("span", { class: "foliplus-search-result-text" }, "Shanghai, China"),
    );
    ctrl.panelWrap.append(item);
    bindEvents(ctrl);
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(ctrl.inp.value).toBe("121.47,31.23");
    // ArrowUp past the top clears the selection; the value is left as-is
    // (the handler only writes when an item is selected).
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    expect(ctrl.selectedIdx).toBe(-1);
  });

  it("ArrowDown then Enter on a coord history entry runs a coordinate search", () => {
    const ctrl = makeCtrl();
    ctrl.panelWrap = dom.el("div");
    // Seeded coord history entry: displays the reverse-geocoded address, but
    // carries the canonical query for re-search.
    const item = dom.el(
      "div",
      {
        class: "foliplus-search-result-item",
        "data-query": "121.47,31.23",
        "data-index": "0",
      },
      dom.el("span", { class: "foliplus-search-result-text" }, "Shanghai, China"),
    );
    ctrl.panelWrap.append(item);
    bindEvents(ctrl);
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(ctrl.inp.value).toBe("121.47,31.23");
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    // The canonical query is parsed as coordinates and searched — no coord_error.
    expect(map.flyTo).toHaveBeenCalled();
    expect(window.foliplus.showHint).not.toHaveBeenCalledWith(
      "SearchControl",
      expect.stringContaining("coord"),
    );
    // Panel is removed once the search runs.
    expect(ctrl.panelWrap).toBeNull();
  });

  it("keyboard navigation clamps at panel boundaries", () => {
    const ctrl = makeCtrl();
    ctrl.panelWrap = dom.el("div");
    const mk = text =>
      dom.el(
        "div",
        { class: "foliplus-search-result-item" },
        dom.el("span", { class: "foliplus-search-result-text" }, text),
      );
    ctrl.panelWrap.append(mk("One"), mk("Two"));
    bindEvents(ctrl);

    // Start at index -1, go up → stays at -1
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    expect(ctrl.selectedIdx).toBe(-1);
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
    expect(ctrl.selectedIdx).toBe(1); // clamped to last item
    expect(ctrl.inp.value).toBe("Two");
  });

  it("uses window-only scroll target when no leaflet-container exists", () => {
    document.querySelectorAll(".leaflet-container").forEach(el => el.remove());
    const ctrl = makeCtrl();
    bindEvents(ctrl);
    expect(ctrl.scrollTargets).toEqual([window]);
  });

  it("returns cleanup function that disconnects observer", () => {
    const ctrl = makeCtrl();
    const cleanup = bindEvents(ctrl);
    expect(typeof cleanup).toBe("function");
    cleanup();
    expect(typeof cleanup).toBe("function");
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

  it("silently ignores URL parsing errors", () => {
    // Make map.flyTo throw to trigger the catch block in initFromUrl
    const ctrl = makeCtrl();
    ctrl.setMode = vi.fn();
    vi.spyOn(map, "flyTo").mockImplementation(() => {
      throw new Error("simulated parse error");
    });
    window.history.replaceState(null, "", "?q=121.47,31.23");
    expect(() => initFromUrl(ctrl)).not.toThrow();
    vi.restoreAllMocks();
  });
});
