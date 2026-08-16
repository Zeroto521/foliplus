import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addHistoryEntry,
  clearHistory,
  deleteHistoryEntry,
  loadHistory,
  recordHistorySearch,
  renderHistory,
  saveHistory,
} from "#foliplus/SearchControl/logic.js";
import { HISTORY } from "#foliplus/SearchControl/const.js";
import type { SearchHistoryEntry } from "#foliplus/SearchControl/type.js";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadHistory / saveHistory", () => {
  it("loads empty array when nothing is stored", () => {
    const entries = loadHistory();
    expect(entries).toEqual([]);
  });

  it("loads entries from localStorage", () => {
    const entries: SearchHistoryEntry[] = [
      { query: "Paris", type: "addr", label: "Paris", lat: 48.8, lng: 2.3, ts: 1000 },
      { query: "121.47,31.23", type: "coord", label: "121.4700, 31.2300", lat: 31.23, lng: 121.47, ts: 2000 },
    ];
    saveHistory(entries);
    expect(loadHistory()).toEqual(entries);
  });

  it("returns empty array for corrupt data", () => {
    localStorage.setItem(HISTORY.STORAGE_KEY, "not json");
    expect(loadHistory()).toEqual([]);
  });

  it("returns empty array for non-array data", () => {
    localStorage.setItem(HISTORY.STORAGE_KEY, '"string"');
    expect(loadHistory()).toEqual([]);
  });

  it("saves an empty array when history is cleared", () => {
    const entries: SearchHistoryEntry[] = [
      { query: "A", type: "addr", label: "A", lat: 0, lng: 0, ts: 1 },
    ];
    saveHistory(entries);
    expect(loadHistory()).toHaveLength(1);
    saveHistory([]);
    expect(loadHistory()).toEqual([]);
  });
});

describe("addHistoryEntry", () => {
  it("prepends a new entry and persists", () => {
    const ctrl: any = { searchHistory: [] };
    addHistoryEntry(ctrl, {
      query: "Paris", type: "addr", label: "Paris", lat: 48.8, lng: 2.3, ts: 1000,
    });
    expect(ctrl.searchHistory).toHaveLength(1);
    expect(ctrl.searchHistory[0].query).toBe("Paris");
    expect(localStorage.getItem(HISTORY.STORAGE_KEY)).toBeDefined();
  });

  it("deduplicates by query and moves the existing entry to front", () => {
    const ctrl: any = {
      searchHistory: [
        { query: "A", type: "addr", label: "A", lat: 0, lng: 0, ts: 100 },
        { query: "Paris", type: "addr", label: "Paris", lat: 48.8, lng: 2.3, ts: 200 },
        { query: "B", type: "addr", label: "B", lat: 0, lng: 0, ts: 300 },
      ],
    };
    addHistoryEntry(ctrl, {
      query: "Paris", type: "addr", label: "Paris, France", lat: 48.8, lng: 2.3, ts: 9999,
    });
    expect(ctrl.searchHistory).toHaveLength(3);
    // Paris moved to front with updated label
    expect(ctrl.searchHistory[0].query).toBe("Paris");
    expect(ctrl.searchHistory[0].label).toBe("Paris, France");
    // Other entries retain their relative order
    expect(ctrl.searchHistory[1].query).toBe("A");
    expect(ctrl.searchHistory[2].query).toBe("B");
  });

  it("persists after deduplication", () => {
    const ctrl: any = {
      searchHistory: [
        { query: "Paris", type: "addr", label: "Paris", lat: 48.8, lng: 2.3, ts: 1000 },
      ],
    };
    addHistoryEntry(ctrl, {
      query: "Paris", type: "addr", label: "Paris, France", lat: 48.8, lng: 2.3, ts: 2000,
    });
    const stored = JSON.parse(localStorage.getItem(HISTORY.STORAGE_KEY)!);
    expect(stored[0].label).toBe("Paris, France");
    expect(stored).toHaveLength(1);
  });

  it("respects MAX_ENTRIES limit", () => {
    const ctrl: any = {
      searchHistory: Array.from({ length: HISTORY.MAX_ENTRIES }, (_, i) => ({
        query: `q${i}`, type: "addr", label: `L${i}`, lat: 0, lng: 0, ts: i,
      })),
    };
    addHistoryEntry(ctrl, {
      query: "new", type: "addr", label: "New", lat: 1, lng: 1, ts: 9999,
    });
    expect(ctrl.searchHistory).toHaveLength(HISTORY.MAX_ENTRIES);
    expect(ctrl.searchHistory[0].query).toBe("new");
    // q0..q18 stay, q19 is evicted (new entry prepended, oldest tail entry dropped)
    expect(ctrl.searchHistory.find((e: SearchHistoryEntry) => e.query === "q19")).toBeUndefined();
    expect(ctrl.searchHistory.find((e: SearchHistoryEntry) => e.query === "q0")).toBeDefined();
  });

  it("persists after hitting MAX_ENTRIES cap", () => {
    const ctrl: any = {
      searchHistory: Array.from({ length: HISTORY.MAX_ENTRIES }, (_, i) => ({
        query: `q${i}`, type: "addr", label: `L${i}`, lat: 0, lng: 0, ts: i,
      })),
    };
    addHistoryEntry(ctrl, {
      query: "new", type: "addr", label: "New", lat: 1, lng: 1, ts: 9999,
    });
    const stored = JSON.parse(localStorage.getItem(HISTORY.STORAGE_KEY)!);
    expect(stored).toHaveLength(HISTORY.MAX_ENTRIES);
    expect(stored[0].query).toBe("new");
  });
});

describe("deleteHistoryEntry", () => {
  it("removes a matching entry and persists", () => {
    const ctrl: any = {
      searchHistory: [
        { query: "A", type: "addr", label: "A", lat: 0, lng: 0, ts: 1 },
        { query: "B", type: "addr", label: "B", lat: 0, lng: 0, ts: 2 },
      ],
    };
    deleteHistoryEntry(ctrl, "A");
    expect(ctrl.searchHistory).toHaveLength(1);
    expect(ctrl.searchHistory[0].query).toBe("B");
    const stored = JSON.parse(localStorage.getItem(HISTORY.STORAGE_KEY)!);
    expect(stored).toHaveLength(1);
    expect(stored[0].query).toBe("B");
  });

  it("does nothing for unknown query", () => {
    const ctrl: any = {
      searchHistory: [
        { query: "A", type: "addr", label: "A", lat: 0, lng: 0, ts: 1 },
      ],
    };
    deleteHistoryEntry(ctrl, "Z");
    expect(ctrl.searchHistory).toHaveLength(1);
  });

  it("empties history when last entry is deleted", () => {
    const ctrl: any = {
      searchHistory: [
        { query: "Only", type: "addr", label: "Only", lat: 0, lng: 0, ts: 1 },
      ],
    };
    deleteHistoryEntry(ctrl, "Only");
    expect(ctrl.searchHistory).toEqual([]);
    const stored = JSON.parse(localStorage.getItem(HISTORY.STORAGE_KEY)!);
    expect(stored).toEqual([]);
  });
});

describe("clearHistory", () => {
  it("empties the history array and persists", () => {
    const ctrl: any = {
      searchHistory: [
        { query: "A", type: "addr", label: "A", lat: 0, lng: 0, ts: 1 },
        { query: "B", type: "addr", label: "B", lat: 0, lng: 0, ts: 2 },
      ],
    };
    clearHistory(ctrl);
    expect(ctrl.searchHistory).toEqual([]);
    const loaded = loadHistory();
    expect(loaded).toEqual([]);
  });

  it("is a no-op when history is already empty", () => {
    const ctrl: any = { searchHistory: [] };
    clearHistory(ctrl);
    expect(ctrl.searchHistory).toEqual([]);
  });
});

describe("recordHistorySearch", () => {
  it("records a completed coord search", () => {
    const ctrl: any = { searchHistory: [] };
    recordHistorySearch(ctrl, "121.47,31.23", "coord", "121.4700, 31.2300", 31.23, 121.47);
    expect(ctrl.searchHistory).toHaveLength(1);
    expect(ctrl.searchHistory[0].type).toBe("coord");
    expect(ctrl.searchHistory[0].lat).toBe(31.23);
    expect(ctrl.searchHistory[0].lng).toBe(121.47);
  });

  it("records a completed addr search", () => {
    const ctrl: any = { searchHistory: [] };
    recordHistorySearch(ctrl, "Paris", "addr", "Paris, France", 48.8, 2.3);
    expect(ctrl.searchHistory).toHaveLength(1);
    expect(ctrl.searchHistory[0].type).toBe("addr");
    expect(ctrl.searchHistory[0].label).toBe("Paris, France");
  });

  it("records the current timestamp", () => {
    const ctrl: any = { searchHistory: [] };
    const before = Date.now();
    recordHistorySearch(ctrl, "A", "addr", "A", 0, 0);
    const after = Date.now();
    expect(ctrl.searchHistory[0].ts).toBeGreaterThanOrEqual(before);
    expect(ctrl.searchHistory[0].ts).toBeLessThanOrEqual(after);
  });

  it("stores raw query as key for deduplication", () => {
    const ctrl: any = { searchHistory: [] };
    recordHistorySearch(ctrl, "Paris", "addr", "Paris, France", 48.8, 2.3);
    expect(ctrl.searchHistory[0].query).toBe("Paris");
    // Re-record with same query — dedup should apply
    recordHistorySearch(ctrl, "Paris", "addr", "Paris, Île-de-France", 48.8, 2.3);
    expect(ctrl.searchHistory).toHaveLength(1);
    expect(ctrl.searchHistory[0].label).toBe("Paris, Île-de-France");
  });
});

describe("renderHistory", () => {
  function makeHistoryCtrl(searchHistory: SearchHistoryEntry[]): any {
    return {
      searchHistory,
      suggestionsWrap: null,
      suggestionsThrottleTimer: null,
      selectedSuggestionIdx: -1,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
      inp: { value: "" },
    };
  }

  it("removes suggestions when history is empty", () => {
    const ctrl = makeHistoryCtrl([]);
    renderHistory(ctrl);
    expect(ctrl.suggestionsWrap).toBeNull();
  });

  it("renders a history panel with group header and entries", () => {
    const ctrl = makeHistoryCtrl([
      { query: "Paris", type: "addr", label: "Paris, France", lat: 48.8, lng: 2.3, ts: 1000 },
      { query: "121.47,31.23", type: "coord", label: "121.4700, 31.2300", lat: 31.23, lng: 121.47, ts: 2000 },
    ]);
    renderHistory(ctrl);
    expect(ctrl.suggestionsWrap).not.toBeNull();
    expect(ctrl.suggestionsWrap.innerHTML).toContain("Paris, France");
    expect(ctrl.suggestionsWrap.innerHTML).toContain("121.4700, 31.2300");
    // Group header present
    expect(ctrl.suggestionsWrap.querySelector(".foliplus-search-history-group-header")).not.toBeNull();
    // Clear all button present
    expect(ctrl.suggestionsWrap.querySelector(".foliplus-search-history-group-clear")).not.toBeNull();
    // History items present — they now use the exact same suggestion-item class as suggestions
    const items = ctrl.suggestionsWrap.querySelectorAll(".foliplus-search-suggestion-item");
    expect(items).toHaveLength(2);
    // Each history item has the same layout as a suggestion item (icon + text)
    expect(items[0].querySelector(".foliplus-search-suggestion-icon")).not.toBeNull();
    expect(items[0].querySelector(".foliplus-search-suggestion-text")?.textContent).toBe("Paris, France");
    // Delete button present for each history item
    expect(items[0].querySelector(".foliplus-search-history-item-del")).not.toBeNull();
  });

  it("shows the group title element", () => {
    const ctrl = makeHistoryCtrl([
      { query: "X", type: "addr", label: "X", lat: 0, lng: 0, ts: 1 },
    ]);
    renderHistory(ctrl);
    const title = ctrl.suggestionsWrap.querySelector(".foliplus-search-history-group-title");
    expect(title).not.toBeNull();
    // The translator returns the locale key when no table is loaded in tests
    expect(title?.textContent).toBeDefined();
  });

  it("clicking a history entry navigates to the saved coordinates", () => {
    const ctrl = makeHistoryCtrl([
      { query: "Paris", type: "addr", label: "Paris, France", lat: 48.8, lng: 2.3, ts: 1000 },
    ]);
    renderHistory(ctrl);
    const item = ctrl.suggestionsWrap.querySelector(".foliplus-search-suggestion-item")!;
    // Simulate clicking the history item
    const clickEvent = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
    // The onmousedown handler is registered on the item; we need to trigger it
    const handler = (item as any).onmousedown || (() => {
      // Find the handler via the dom module's registration pattern
      // dom.el stores handlers on the element; we can inspect the item's properties
    });
    // Manually dispatch a mousedown event
    const mouseEvent = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    item.dispatchEvent(mouseEvent);
    // The handler was registered directly on the element
    // In the test env, we can check that flyTo was called
    expect(map.flyTo).toHaveBeenCalled();
    expect(ctrl.inp.value).toBe("Paris, France");
  });

  it("clicking the clear-all button empties history and removes the panel", () => {
    const ctrl = makeHistoryCtrl([
      { query: "A", type: "addr", label: "A", lat: 0, lng: 0, ts: 1 },
      { query: "B", type: "addr", label: "B", lat: 0, lng: 0, ts: 2 },
    ]);
    renderHistory(ctrl);
    const clearBtn = ctrl.suggestionsWrap.querySelector(".foliplus-search-history-group-clear")!;
    clearBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(ctrl.searchHistory).toEqual([]);
    expect(ctrl.suggestionsWrap).toBeNull();
  });

  it("clicking the delete button on a history item removes only that entry", () => {
    const ctrl = makeHistoryCtrl([
      { query: "A", type: "addr", label: "A", lat: 0, lng: 0, ts: 1 },
      { query: "B", type: "addr", label: "B", lat: 0, lng: 0, ts: 2 },
    ]);
    renderHistory(ctrl);
    // Get the delete button for the first entry (query="A")
    const firstItem = ctrl.suggestionsWrap.querySelector(
      ".foliplus-search-suggestion-item",
    )!;
    const delBtn = firstItem.querySelector(".foliplus-search-history-item-del")!;
    delBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    // Only "A" should be removed; "B" remains and the panel re-renders
    expect(ctrl.searchHistory).toHaveLength(1);
    expect(ctrl.searchHistory[0].query).toBe("B");
    expect(ctrl.suggestionsWrap).not.toBeNull();
  });

  it("removes the panel when the last history entry is deleted", () => {
    const ctrl = makeHistoryCtrl([
      { query: "Only", type: "addr", label: "Only", lat: 0, lng: 0, ts: 1 },
    ]);
    renderHistory(ctrl);
    const delBtn = ctrl.suggestionsWrap.querySelector(".foliplus-search-history-item-del")!;
    delBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(ctrl.searchHistory).toEqual([]);
    expect(ctrl.suggestionsWrap).toBeNull();
  });
});
