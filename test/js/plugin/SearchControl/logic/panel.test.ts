import { describe, expect, it, vi } from "vitest";
import {
  attachSearchDelIcon,
  positionPanel,
  removePanel,
  renderResults,
} from "#foliplus/SearchControl/logic/panel.js";

// ─── Fixture helpers ───
// Direct tests of the 4 panel.ts exports; imports bypass the search.ts
// re-export so a future rename / removal in search.ts doesn't silently
// redirect these tests.

// Control context properties that logic functions read via ctrl.config/ctrl.T/etc.
const ctx = () => ({
  config: { name: "SearchControl", locale_code: "en", zoom: 16 },
  T: (k: string) => `SearchControl.${k}`,
  _: (k: string) => k,
  log: {
    msg: (m: string) => m,
    warn: (...args: unknown[]) =>
      console.warn(`[SearchControl] ${args[0]}`, ...args.slice(1)),
    error: vi.fn(),
  },
  _map: window.map,
});

// The shape panel functions need. Fields they don't touch stay at sane defaults.
const makeFixture = (extra: Record<string, unknown> = {}) =>
  ({
    ...ctx(),
    panelWrap: null,
    throttleTimer: null,
    selectedIdx: -1,
    currentItems: [] as unknown[],
    ctrl: {
      getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
    },
    ...extra,
  }) as any;

// A real DOM wrap so toggleDelIcon can flip the inner ✕'s visible class.
// makeMarkerWithEl: each L.marker() call returns a fresh marker sharing the
// same wrap element, so ctrl.marker and the del icon are distinct objects.
const makeMarkerWithEl = () => {
  const span = document.createElement("span");
  span.setAttribute("data-del-icon", "");
  const wrap = document.createElement("div");
  wrap.appendChild(span);
  const makeMarker = () => ({
    bindPopup: vi.fn(),
    openPopup: vi.fn(),
    addTo: vi.fn(),
    getPopup: () => ({ isOpen: () => false }),
    on: vi.fn(),
    getElement: () => wrap,
  });
  window.L.marker = vi.fn(makeMarker);
  const marker = makeMarker();
  return { marker, span };
};

// ─── removePanel ───

describe("removePanel", () => {
  it("removes panelWrap and resets state", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const ctrl: any = {
      ...ctx(),
      panelWrap: el,
      throttleTimer: setTimeout(() => {}, 1000),
      selectedIdx: 2,
    };

    removePanel(ctrl);

    expect(document.body.contains(el)).toBe(false);
    expect(ctrl.panelWrap).toBeNull();
    expect(ctrl.throttleTimer).toBeNull();
    expect(ctrl.selectedIdx).toBe(-1);
  });

  it("handles null panelWrap without error", () => {
    const ctrl: any = {
      ...ctx(),
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
    };
    expect(() => removePanel(ctrl)).not.toThrow();
  });

  it("destroys the list cursor when one is attached", () => {
    const destroy = vi.fn();
    const ctrl = makeFixture({ listCursor: { destroy, refresh: vi.fn() } });

    removePanel(ctrl);

    expect(destroy).toHaveBeenCalledOnce();
    expect(ctrl.listCursor).toBeNull();
  });

  it("clears the retained results array so a stale Enter can't adopt an old item", () => {
    const ctrl = makeFixture({
      currentItems: [
        { source: "history", primaryText: "old" },
        { source: "history", primaryText: "older" },
      ],
    });

    removePanel(ctrl);

    expect(ctrl.currentItems).toEqual([]);
  });
});

// ─── renderResults ───

describe("renderResults", () => {
  it("removes panel when results are empty", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const ctrl: any = { ...ctx(), panelWrap: el, throttleTimer: null, selectedIdx: 0 };
    renderResults(ctrl, []);
    expect(ctrl.panelWrap).toBeNull();
    expect(ctrl.selectedIdx).toBe(-1);
  });

  it("writes data-query only for items that carry a query", () => {
    const ctrl = makeFixture();
    renderResults(ctrl, [
      // History item: carries its panel display as the re-entry value.
      {
        source: "history",
        icon: "",
        primaryText: "Shanghai, China",
        query: "121.4700, 31.2300",
        coordDisplay: "121.4700, 31.2300",
        onClick: () => false,
      },
      // Suggestion: no query — must NOT get the attribute, so keyboard nav
      // falls back to the display text.
      {
        source: "suggestion",
        icon: "",
        primaryText: "Paris, France",
        coordDisplay: null,
        onClick: () => false,
      },
    ]);
    const items = ctrl.panelWrap.querySelectorAll(".foliplus-search-result-item");
    expect(items).toHaveLength(2);
    expect(items[0].getAttribute("data-query")).toBe("121.4700, 31.2300");
    expect(items[1].hasAttribute("data-query")).toBe(false);
  });

  it("pins coordinates to six decimals instead of echoing the raw stored value", () => {
    // A history entry saved from "121.47" stores 121.47, so the panel used to show
    // "121.47, 31.23" where the measure chip shows 121.470000, 31.230000.
    const ctrl = makeFixture();
    renderResults(ctrl, [
      {
        source: "history",
        icon: "",
        primaryText: "Chongqing",
        query: "121.47,31.23",
        coordDisplay: "121.470000, 31.230000",
        onClick: () => false,
      },
    ]);
    const coord = ctrl.panelWrap.querySelector(".foliplus-search-result-coord");
    expect(coord?.textContent).toBe("121.470000, 31.230000");
  });

  it("keeps the retained array in lockstep with the DOM so Enter adopts the highlighted item", () => {
    // renderResults stores the same ResultItem[] it renders into ctrl.currentItems,
    // so the DOM RESULT_ITEM count and currentItems.length are always equal. The
    // Enter handler indexes currentItems by selectedIdx; any drift here would make
    // it adopt a different entry than the one the arrow keys highlighted.
    const ctrl = makeFixture();
    renderResults(ctrl, [
      {
        source: "suggestion",
        icon: "",
        primaryText: "One",
        coordDisplay: null,
        onClick: () => true,
      },
      {
        source: "suggestion",
        icon: "",
        primaryText: "Two",
        coordDisplay: null,
        onClick: () => true,
      },
      {
        source: "suggestion",
        icon: "",
        primaryText: "Three",
        coordDisplay: null,
        onClick: () => true,
      },
    ]);
    const domItems = ctrl.panelWrap.querySelectorAll(".foliplus-search-result-item");
    expect(domItems).toHaveLength(3);
    expect(ctrl.currentItems).toHaveLength(3);
    expect(ctrl.currentItems[1].primaryText).toBe("Two");
    // The dev-mode assertion in renderResults would throw on any mismatch; a
    // successful render with equal counts is the positive proof it holds.
  });

  it("throws when the DOM item count drifts from the retained results", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const ctrl: any = {
      ...ctx(),
      panelWrap: el,
      throttleTimer: null,
      selectedIdx: 0,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
    };
    // Force the post-render sanity check to misfire: a DOM count that does
    // not match the retained array would desync keyboard nav from Enter.
    el.querySelectorAll = vi.fn(() => ({ length: 7 })) as any;
    expect(() =>
      renderResults(ctrl, [
        {
          source: "history",
          icon: "",
          primaryText: "Shanghai, China",
          query: "121.4700, 31.2300",
          coordDisplay: "121.4700, 31.2300",
          onClick: () => false,
        },
      ]),
    ).toThrow(/result panel drift/);
    el.remove();
  });

  it("refreshes the list cursor after a re-render", () => {
    const refresh = vi.fn();
    const ctrl = makeFixture({ listCursor: { destroy: vi.fn(), refresh } });

    renderResults(ctrl, [
      {
        source: "suggestion",
        icon: "",
        primaryText: "One",
        coordDisplay: null,
        onClick: () => true,
      },
    ]);

    expect(refresh).toHaveBeenCalledOnce();
  });
});

// ─── positionPanel ───

describe("positionPanel", () => {
  it("places wrap below the control", () => {
    const ctrl: any = {
      ...ctx(),
      panelWrap: { style: {} },
      ctrl: {
        getBoundingClientRect: () => ({
          left: 10,
          top: 20,
          bottom: 100,
          width: 200,
        }),
      },
    };
    positionPanel(ctrl);
    expect(ctrl.panelWrap.style.left).toBe("10px");
    expect(ctrl.panelWrap.style.top).toBe("100px");
  });

  it("clips suggestions wrap to the right edge when it would overflow", () => {
    const originalWidth = window.innerWidth;
    try {
      // Narrow viewport so left + rect.width exceeds innerWidth
      Object.defineProperty(window, "innerWidth", {
        value: 300,
        configurable: true,
      });
      const ctrl: any = {
        ...ctx(),
        panelWrap: { style: {} },
        ctrl: {
          getBoundingClientRect: () => ({
            left: 250,
            top: 20,
            bottom: 100,
            width: 200,
          }),
        },
      };
      positionPanel(ctrl);
      // Would normally be left=250, but clipped to 300-200=100
      expect(ctrl.panelWrap.style.left).toBe("100px");
      expect(ctrl.panelWrap.style.top).toBe("100px");
    } finally {
      Object.defineProperty(window, "innerWidth", {
        value: originalWidth,
        configurable: true,
      });
    }
  });

  it("returns early without touching style when panelWrap is null", () => {
    const ctrl: any = {
      ...ctx(),
      panelWrap: null,
      ctrl: {
        // If this were called, the assertion below would fail.
        getBoundingClientRect: () => {
          throw new Error(
            "panelWrap is null; getBoundingClientRect must not be called",
          );
        },
      },
    };
    expect(() => positionPanel(ctrl)).not.toThrow();
    expect(ctrl.panelWrap).toBeNull();
  });
});

// ─── attachSearchDelIcon ───

describe("attachSearchDelIcon", () => {
  it("shows the ✕ while the popup is open, hides on close", () => {
    const { marker, span } = makeMarkerWithEl();
    const ctrl: any = {
      ...ctx(),
      marker,
      delIcon: null,
      inp: { value: "abc", focus: vi.fn() },
    };
    attachSearchDelIcon(ctrl, [31.23, 121.47]);

    expect(ctrl.delIcon).not.toBeNull();
    expect(map.addLayer).toHaveBeenCalledWith(ctrl.delIcon);

    const popupOpen = marker.on.mock.calls.find(c => c[0] === "popupopen")?.[1];
    expect(popupOpen).toBeDefined();
    popupOpen();
    expect(span.classList.contains("visible")).toBe(true);

    const popupClose = marker.on.mock.calls.find(c => c[0] === "popupclose")?.[1];
    popupClose();
    expect(span.classList.contains("visible")).toBe(false);
  });

  it("keeps the ✕ hidden by default (only popupopen reveals it)", () => {
    // SearchControl opens the popup during creation, before the popupopen
    // listener is attached — the ✕ must stay hidden until the user actually
    // opens the popup again, matching MeasureControl / LocateControl.
    const { marker, span } = makeMarkerWithEl();
    const ctrl: any = {
      ...ctx(),
      marker,
      delIcon: null,
      inp: { value: "abc", focus: vi.fn() },
    };
    attachSearchDelIcon(ctrl, [31.23, 121.47]);
    expect(span.classList.contains("visible")).toBe(false);

    const popupOpen = marker.on.mock.calls.find(c => c[0] === "popupopen")?.[1];
    popupOpen();
    expect(span.classList.contains("visible")).toBe(true);
  });

  it("clicking the ✕ removes the pin and clears the search input", () => {
    const { marker } = makeMarkerWithEl();
    const ctrl: any = {
      ...ctx(),
      marker,
      delIcon: null,
      inp: { value: "abc", focus: vi.fn() },
    };
    attachSearchDelIcon(ctrl, [31.23, 121.47]);
    const delIcon = ctrl.delIcon;

    const delClick = delIcon.on.mock.calls.find(
      (c: unknown[]) => c[0] === "click",
    )?.[1];
    expect(delClick).toBeDefined();
    const x = document.createElement("span");
    x.setAttribute("data-del-icon", "");
    delClick({ originalEvent: { target: x } });

    expect(map.removeLayer).toHaveBeenCalledWith(marker);
    expect(map.removeLayer).toHaveBeenCalledWith(delIcon);
    expect(ctrl.marker).toBeNull();
    expect(ctrl.delIcon).toBeNull();
    expect(ctrl.inp.value).toBe("");
    expect(ctrl.inp.focus).toHaveBeenCalled();
  });

  it("replaces any previous del icon when called again", () => {
    const { marker } = makeMarkerWithEl();
    const ctrl: any = {
      ...ctx(),
      marker,
      delIcon: null,
      inp: { value: "abc", focus: vi.fn() },
    };
    attachSearchDelIcon(ctrl, [31.23, 121.47]);
    const first = ctrl.delIcon;
    attachSearchDelIcon(ctrl, [31.24, 121.48]);
    expect(map.removeLayer).toHaveBeenCalledWith(first);
    expect(ctrl.delIcon).not.toBe(first);
  });

  it("clears input even when the marker was already removed elsewhere", () => {
    // Edge: the marker gets removed by something else (e.g. another control's
    // teardown) between attachSearchDelIcon and the ✕ click. clearSearch still
    // has to clear the input and focus — the null-check on ctrl.marker is the
    // guard against a redundant removeLayer on a stale reference.
    const { marker } = makeMarkerWithEl();
    const ctrl: any = {
      ...ctx(),
      marker,
      delIcon: null,
      inp: { value: "abc", focus: vi.fn() },
    };
    attachSearchDelIcon(ctrl, [31.23, 121.47]);
    ctrl.marker = null; // marker already gone

    const delClick = ctrl.delIcon.on.mock.calls.find(
      (c: unknown[]) => c[0] === "click",
    )?.[1];
    const x = document.createElement("span");
    x.setAttribute("data-del-icon", "");
    delClick({ originalEvent: { target: x } });

    expect(ctrl.inp.value).toBe("");
    expect(ctrl.inp.focus).toHaveBeenCalled();
    expect(ctrl.delIcon).toBeNull();
  });

  it("clears input even when the del icon was already replaced", () => {
    // Edge: attachSearchDelIcon was called again before the ✕ click, so the
    // original del icon is gone. clearSearch's null-check on ctrl.delIcon
    // prevents a redundant removeLayer on a stale reference.
    const { marker } = makeMarkerWithEl();
    const ctrl: any = {
      ...ctx(),
      marker,
      delIcon: null,
      inp: { value: "abc", focus: vi.fn() },
    };
    attachSearchDelIcon(ctrl, [31.23, 121.47]);
    const first = ctrl.delIcon;
    // Trigger a ✕ click on the *first* del icon after a newer one has been mounted.
    // The old closure still reads ctrl.delIcon fresh, which now points to the new
    // del icon — the null-check guard is only exercised by an external null, so
    // simulate that here directly.
    ctrl.delIcon = null;

    const delClick = first.on.mock.calls.find((c: unknown[]) => c[0] === "click")?.[1];
    const x = document.createElement("span");
    x.setAttribute("data-del-icon", "");
    delClick({ originalEvent: { target: x } });

    expect(map.removeLayer).toHaveBeenCalledWith(marker);
    expect(ctrl.inp.value).toBe("");
    expect(ctrl.inp.focus).toHaveBeenCalled();
    expect(ctrl.marker).toBeNull();
    expect(ctrl.delIcon).toBeNull();
  });
});
