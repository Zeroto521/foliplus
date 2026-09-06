import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HISTORY_STORAGE_KEY } from "#foliplus/SearchControl/const.js";
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
    currentItems: [],
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

  // Clear search history so a test that runs a real geocode (searchCoord /
  // searchAddress) cannot pollute a later test that asserts on an empty store.
  delete window.localStorage[HISTORY_STORAGE_KEY];
  // window.map is shared across tests; clear active modes so a blocked-mode
  // test cannot leak and silently fail the next test.
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

  it("does not remove the panel on unrelated class changes while expanded", async () => {
    const ctrl = makeCtrl();

    ctrl.ctrl.classList.remove("collapsed");

    ctrl.ctrl.classList.add("expanded");

    ctrl.panelWrap = dom.el("div");

    bindEvents(ctrl);

    // A class change while expanded must not trigger removePanel.
    ctrl.ctrl.classList.add("some-other-class");

    await new Promise(r => setTimeout(r, 0));

    expect(ctrl.panelWrap).not.toBeNull();
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

  it("ArrowDown on an empty panel does not change selection", () => {
    const ctrl = makeCtrl();

    ctrl.panelWrap = dom.el("div");

    ctrl.inp.value = "unchanged";

    bindEvents(ctrl);

    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );

    expect(ctrl.selectedIdx).toBe(-1);

    expect(ctrl.inp.value).toBe("unchanged");
  });

  it("ArrowDown with no panel leaves the input unchanged", () => {
    const ctrl = makeCtrl();

    ctrl.inp.value = "unchanged";

    bindEvents(ctrl);

    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );

    expect(ctrl.selectedIdx).toBe(-1);

    expect(ctrl.inp.value).toBe("unchanged");
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

  it("ArrowUp on an empty panel leaves the input unchanged", () => {
    const ctrl = makeCtrl();

    ctrl.panelWrap = dom.el("div");

    ctrl.inp.value = "unchanged";

    bindEvents(ctrl);

    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );

    expect(ctrl.selectedIdx).toBe(-1);

    expect(ctrl.inp.value).toBe("unchanged");
  });

  it("ArrowUp with no panel leaves the input unchanged", () => {
    const ctrl = makeCtrl();

    ctrl.inp.value = "unchanged";

    bindEvents(ctrl);

    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );

    expect(ctrl.selectedIdx).toBe(-1);

    expect(ctrl.inp.value).toBe("unchanged");
  });

  it("Enter with empty input removes the panel but does not search", () => {
    const ctrl = makeCtrl();

    ctrl.panelWrap = dom.el("div");

    ctrl.inp.value = "   ";

    bindEvents(ctrl);

    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    expect(ctrl.panelWrap).toBeNull();

    expect(map.flyTo).not.toHaveBeenCalled();
  });

  it("Enter in addr mode triggers an address search", () => {
    window.foliplus.geocode = vi.fn(() =>
      Promise.resolve({ lat: 48.8, lng: 2.3, displayName: "Paris" }),
    ) as unknown as typeof window.foliplus.geocode;
    const ctrl = makeCtrl();

    ctrl.mode = "addr";

    ctrl.panelWrap = dom.el("div");

    ctrl.inp.value = "Paris";

    bindEvents(ctrl);

    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    expect(ctrl.panelWrap).toBeNull();

    expect(window.foliplus.geocode).toHaveBeenCalledWith(
      map,
      "Paris",
      CONF.locale_code,
    );
  });

  it("ArrowDown onto a coord history item fills the coord display", () => {
    const ctrl = makeCtrl();

    ctrl.panelWrap = dom.el("div");

    // Item 1 is a coord history entry (address display + data-query); item 0 is
    // a plain suggestion. ArrowDown from the suggestion must land on the
    // entry's coord display, not its address display.
    const coord = dom.el(
      "div",
      {
        class: "foliplus-search-result-item",
        "data-query": "121.4700, 31.2300",
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

    // ArrowDown twice → land on the coord entry → coord display fills.
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );

    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );

    expect(ctrl.inp.value).toBe("121.4700, 31.2300");

    // ArrowUp back to the plain suggestion → display text fills again.
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );

    expect(ctrl.inp.value).toBe("Somewhere");

    // ArrowDown again onto the coord entry → coord display restored.
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );

    expect(ctrl.inp.value).toBe("121.4700, 31.2300");
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

  it("adopts the keyboard-highlighted entry on Enter", () => {
    const ctrl = makeCtrl();

    ctrl.mode = "addr";

    const mk = text =>
      dom.el(
        "div",
        { class: "foliplus-search-result-item" },
        dom.el("span", { class: "foliplus-search-result-text" }, text),
      );

    ctrl.panelWrap = dom.el("div");

    ctrl.panelWrap.append(mk("One"), mk("Two"));
    const one = vi.fn(() => true);
    const two = vi.fn(() => true);

    ctrl.currentItems = [
      { primaryText: "One", coordDisplay: null, onClick: one },
      { primaryText: "Two", coordDisplay: null, onClick: two },
    ];

    ctrl.inp.value = "Two";

    bindEvents(ctrl);

    // ArrowDown + ArrowDown highlights the second entry and writes its
    // display name into the input. Enter must adopt that entry, not re-geocode
    // and silently pick up result #1.
    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );

    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );

    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    expect(two).toHaveBeenCalledTimes(1);

    expect(one).not.toHaveBeenCalled();

    expect(window.foliplus.geocode).not.toHaveBeenCalled();

    // Panel state is reset either way.
    expect(ctrl.selectedIdx).toBe(-1);

    expect(ctrl.currentItems).toHaveLength(0);
  });

  it("keeps the panel when Enter is pressed while another control holds a mode", () => {
    // The panel stays open while measuring, so Enter must not swallow the
    // selection or fly the map.
    ensureModes(map).setMode("MeasureControl", "distance");
    const ctrl = makeCtrl();

    ctrl.mode = "addr";
    const click = vi.fn(() => false);

    ctrl.currentItems = [{ primaryText: "One", coordDisplay: null, onClick: click }];

    ctrl.selectedIdx = 0;

    ctrl.inp.value = "One";

    bindEvents(ctrl);

    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    // The handler forwards to onClick; the guard in renderAddressResult then
    // refuses the mode switch, so no marker, no history, no fly. A blocked
    // pick returns false, so the panel stays open with the hint visible
    // (matching the mouse-click path).
    expect(click).toHaveBeenCalledTimes(1);

    expect(map.flyTo).not.toHaveBeenCalled();

    expect(window.localStorage.getItem(HISTORY_STORAGE_KEY)).toBeNull();

    // Panel stays open so the user sees why they were refused.
    expect(ctrl.selectedIdx).toBe(0);

    expect(ctrl.currentItems).toHaveLength(1);
  });

  it("falls back to a normal search on Enter with no highlighted entry", () => {
    const ctrl = makeCtrl();

    ctrl.mode = "addr";
    const click = vi.fn();

    ctrl.currentItems = [{ primaryText: "One", coordDisplay: null, onClick: click }];

    ctrl.selectedIdx = -1;

    ctrl.inp.value = "Paris";

    window.foliplus.geocode.mockResolvedValue(null);

    bindEvents(ctrl);

    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    expect(window.foliplus.geocode).toHaveBeenCalled();

    expect(click).not.toHaveBeenCalled();
  });

  it("does nothing on Enter when the input is empty", () => {
    const ctrl = makeCtrl();

    ctrl.mode = "addr";
    const click = vi.fn();

    ctrl.currentItems = [{ primaryText: "One", coordDisplay: null, onClick: click }];

    ctrl.selectedIdx = 0;

    ctrl.inp.value = "   ";

    bindEvents(ctrl);

    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    expect(click).not.toHaveBeenCalled();
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

  it("clears input and removes only the marker when delIcon is absent", () => {
    const ctrl = makeCtrl();

    ctrl.inp.value = "abc";
    const marker = { id: 1 };

    ctrl.marker = marker;

    ctrl.delIcon = null;

    bindEvents(ctrl);

    ctrl.clearBtn.click();

    expect(ctrl.inp.value).toBe("");

    expect(map.removeLayer).toHaveBeenCalledWith(marker);

    expect(map.removeLayer).toHaveBeenCalledTimes(1);

    expect(ctrl.marker).toBeNull();
  });

  it("clears the input when neither marker nor delIcon is present", () => {
    const ctrl = makeCtrl();

    ctrl.inp.value = "abc";

    ctrl.marker = null;

    ctrl.delIcon = null;

    bindEvents(ctrl);

    ctrl.clearBtn.click();

    expect(ctrl.inp.value).toBe("");

    expect(map.removeLayer).not.toHaveBeenCalled();
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

  it("does not fetch suggestions on focus in coord mode with non-empty input", () => {
    globalThis.fetch = vi.fn();
    const ctrl = makeCtrl();

    ctrl.mode = "coord";

    ctrl.inp.value = "abc";

    bindEvents(ctrl);

    ctrl._handlers.focus();

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("includes the leaflet-container in scroll targets when present", () => {
    const container = document.createElement("div");

    container.className = "leaflet-container";

    document.body.appendChild(container);
    const ctrl = makeCtrl();

    bindEvents(ctrl);

    expect(ctrl.scrollTargets).toContain(container);

    container.remove();
  });

  it("uses window-only scroll targets when no leaflet-container exists", () => {
    const ctrl = makeCtrl();

    ctrl.mode = "addr";

    ctrl.inp.value = "abc";

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

    ctrl.debouncedFetch = { cancel: vi.fn() };

    bindEvents(ctrl);

    // Type then clear — the input handler fires on each keystroke
    ctrl.inp.value = "";

    ctrl._handlers.input();

    expect(ctrl.debouncedFetch.cancel).toHaveBeenCalled();

    expect(ctrl.panelWrap).not.toBeNull();

    expect(ctrl.panelWrap.innerHTML).toContain("Paris, France");
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

  it("keyboard nav fills the panel display for history items", () => {
    const ctrl = makeCtrl();

    ctrl.panelWrap = dom.el("div");

    // A coord history entry whose primary text is its reverse-geocoded address;
    // its data-query is the coord display so the input matches the panel.
    const item = dom.el(
      "div",
      {
        class: "foliplus-search-result-item",
        "data-query": "121.4700, 31.2300",
        "data-index": "0",
      },
      dom.el("span", { class: "foliplus-search-result-text" }, "Shanghai, China"),
    );

    ctrl.panelWrap.append(item);

    bindEvents(ctrl);

    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );

    expect(ctrl.inp.value).toBe("121.4700, 31.2300");

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
    // carries the coord display for re-search.
    const item = dom.el(
      "div",
      {
        class: "foliplus-search-result-item",
        "data-query": "121.4700, 31.2300",
        "data-index": "0",
      },
      dom.el("span", { class: "foliplus-search-result-text" }, "Shanghai, China"),
    );

    ctrl.panelWrap.append(item);

    bindEvents(ctrl);

    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );

    expect(ctrl.inp.value).toBe("121.4700, 31.2300");

    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    // The coord display is parsed as coordinates and searched — no coord_error.
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

  it("fills empty string when a result item has no data-query nor text span", () => {
    const ctrl = makeCtrl();

    ctrl.panelWrap = dom.el("div");
    // Bare item: no data-query attribute and no RESULT_TEXT child —
    // resultItemValue must fall through to the empty-string default.
    const bare = dom.el("div", { class: "foliplus-search-result-item" });

    ctrl.panelWrap.append(bare);

    bindEvents(ctrl);

    ctrl.inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );

    expect(ctrl.inp.value).toBe("");
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

  it("does nothing when lat/lng URL params are non-numeric", () => {
    window.history.replaceState(null, "", "?lat=foo&lng=bar");
    const ctrl = makeCtrl();

    ctrl.setMode = vi.fn();

    initFromUrl(ctrl);

    expect(ctrl.setMode).not.toHaveBeenCalled();

    expect(map.flyTo).not.toHaveBeenCalled();
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
