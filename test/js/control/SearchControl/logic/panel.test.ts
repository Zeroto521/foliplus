import { describe, expect, it, vi } from "vitest";
import {
  attachSearchDelIcon,
  positionPanel,
  removePanel,
  renderResults,
} from "#control/SearchControl/logic/panel.js";

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

// Wheel-bind counter over an addEventListener spy: keyed by the element the
// listener was registered on, counting only plain wheel registrations (no
// capture flag) — the shape bindWheelContainment uses.
const wheelBindTargets = (spy: ReturnType<typeof vi.spyOn>) => {
  const counts = new Map<EventTarget, number>();
  const contexts = (spy as unknown as { mock: { contexts: unknown[] } }).mock.contexts;
  for (let i = 0; i < spy.mock.calls.length; i++) {
    const [type, , options] = spy.mock.calls[i] as [string, unknown, unknown];
    if (type !== "wheel") continue;
    if (options !== undefined && (options as unknown) !== false) continue;
    const target = contexts[i] as EventTarget;
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  return counts;
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
        { source: "history" as const, primaryText: "old" },
        { source: "history" as const, primaryText: "older" },
      ],
    });

    removePanel(ctrl);

    expect(ctrl.currentItems).toEqual([]);
  });
});

// ─── renderResults ───

describe("renderResults", () => {
  it("stops a wheel that can scroll the panel from reaching the map container", () => {
    // The result panel is mounted on the map container, so a wheel over it
    // bubbles to Leaflet's scrollWheelZoom and zooms the map. The shared
    // containment must stop a wheel that can actually scroll the panel, while
    // the panel's own overflow-y keeps working.
    const ctrl = makeFixture();
    renderResults(ctrl, [
      {
        source: "suggestion" as const,
        icon: "",
        primaryText: "Paris, France",
        coordDisplay: null,
        onClick: () => false,
      },
    ]);
    const mapWheel = vi.fn();
    document.addEventListener("wheel", mapWheel);
    const panel = ctrl.panelWrap;
    // Panel is scrollable and mid-list: a deltaY wheel can move it.
    Object.defineProperty(panel, "scrollTop", { value: 100, configurable: true });
    Object.defineProperty(panel, "clientHeight", { value: 200, configurable: true });
    Object.defineProperty(panel, "scrollHeight", { value: 500, configurable: true });
    panel.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 }),
    );
    expect(mapWheel).not.toHaveBeenCalled();
    document.removeEventListener("wheel", mapWheel);
  });

  it("lets a wheel at a scroll boundary reach the map container", () => {
    // At the bottom of a scrollable panel, a downward wheel cannot scroll the
    // panel any further — it must bubble so the map zooms (not a scroll trap).
    const ctrl = makeFixture();
    renderResults(ctrl, [
      {
        source: "suggestion" as const,
        icon: "",
        primaryText: "Paris, France",
        coordDisplay: null,
        onClick: () => false,
      },
    ]);
    const mapWheel = vi.fn();
    document.addEventListener("wheel", mapWheel);
    const panel = ctrl.panelWrap;
    Object.defineProperty(panel, "scrollTop", { value: 300, configurable: true });
    Object.defineProperty(panel, "clientHeight", { value: 200, configurable: true });
    Object.defineProperty(panel, "scrollHeight", { value: 500, configurable: true });
    panel.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 }),
    );
    expect(mapWheel).toHaveBeenCalled();
    document.removeEventListener("wheel", mapWheel);
  });

  it("lets a wheel at the top boundary reach the map container", () => {
    // At the top of a scrollable panel, an upward wheel cannot scroll it any
    // further — it must bubble so the map zooms (not a scroll trap). This is
    // the mirror of the bottom-boundary case.
    const ctrl = makeFixture();
    renderResults(ctrl, [
      {
        source: "suggestion" as const,
        icon: "",
        primaryText: "Paris, France",
        coordDisplay: null,
        onClick: () => false,
      },
    ]);
    const mapWheel = vi.fn();
    document.addEventListener("wheel", mapWheel);
    const panel = ctrl.panelWrap;
    Object.defineProperty(panel, "scrollTop", { value: 0, configurable: true });
    Object.defineProperty(panel, "clientHeight", { value: 200, configurable: true });
    Object.defineProperty(panel, "scrollHeight", { value: 500, configurable: true });
    panel.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -120 }),
    );
    expect(mapWheel).toHaveBeenCalled();
    document.removeEventListener("wheel", mapWheel);
  });

  it("lets a zero-delta wheel reach the map container", () => {
    // A wheel event with no vertical delta has no scroll intent — it must not
    // be contained, so horizontal-only wheels / trackpad gestures still reach
    // the map.
    const ctrl = makeFixture();
    renderResults(ctrl, [
      {
        source: "suggestion" as const,
        icon: "",
        primaryText: "Paris, France",
        coordDisplay: null,
        onClick: () => false,
      },
    ]);
    const mapWheel = vi.fn();
    document.addEventListener("wheel", mapWheel);
    const panel = ctrl.panelWrap;
    Object.defineProperty(panel, "scrollTop", { value: 100, configurable: true });
    Object.defineProperty(panel, "clientHeight", { value: 200, configurable: true });
    Object.defineProperty(panel, "scrollHeight", { value: 500, configurable: true });
    panel.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 0 }),
    );
    expect(mapWheel).toHaveBeenCalled();
    document.removeEventListener("wheel", mapWheel);
  });

  it("lets a wheel over a non-scrollable panel reach the map container", () => {
    // A panel with no overflow (scrollHeight <= clientHeight) has nothing to
    // scroll, so every wheel must bubble — the map keeps zooming, not a
    // scroll trap over a fixed-size list.
    const ctrl = makeFixture();
    renderResults(ctrl, [
      {
        source: "suggestion" as const,
        icon: "",
        primaryText: "Paris, France",
        coordDisplay: null,
        onClick: () => false,
      },
    ]);
    const mapWheel = vi.fn();
    document.addEventListener("wheel", mapWheel);
    const panel = ctrl.panelWrap;
    Object.defineProperty(panel, "scrollTop", { value: 0, configurable: true });
    Object.defineProperty(panel, "clientHeight", { value: 300, configurable: true });
    Object.defineProperty(panel, "scrollHeight", { value: 300, configurable: true });
    panel.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 }),
    );
    expect(mapWheel).toHaveBeenCalled();
    document.removeEventListener("wheel", mapWheel);
  });
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
        source: "history" as const,
        icon: "",
        primaryText: "Shanghai, China",
        query: "121.4700, 31.2300",
        coordDisplay: "121.4700, 31.2300",
        onClick: () => false,
      },
      // Suggestion: no query — must NOT get the attribute, so keyboard nav
      // falls back to the display text.
      {
        source: "suggestion" as const,
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
        source: "history" as const,
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
        source: "suggestion" as const,
        icon: "",
        primaryText: "One",
        coordDisplay: null,
        onClick: () => true,
      },
      {
        source: "suggestion" as const,
        icon: "",
        primaryText: "Two",
        coordDisplay: null,
        onClick: () => true,
      },
      {
        source: "suggestion" as const,
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
          source: "history" as const,
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
        source: "suggestion" as const,
        icon: "",
        primaryText: "One",
        coordDisplay: null,
        onClick: () => true,
      },
    ]);

    expect(refresh).toHaveBeenCalledOnce();
  });

  it("binds exactly one wheel listener per panel element across repeated renders", () => {
    // The panel element is created once and reused across renderResults calls
    // (only its innerHTML is rebuilt), so the wheel containment must be bound
    // once per element lifecycle — not once per render, or the listeners stack
    // linearly and the panel behaves differently on each subsequent render.
    //
    // Spy the registration itself and key it on the receiving element:
    // counting stopPropagation from a test-owned wheel listener only ever sees
    // that one listener, so a stacking bind stays invisible to it.
    const addSpy = vi.spyOn(EventTarget.prototype, "addEventListener");
    const ctrl = makeFixture();
    const item = {
      source: "suggestion" as const,
      icon: "",
      primaryText: "Paris, France",
      coordDisplay: null,
      onClick: () => false,
    };
    renderResults(ctrl, [item]);
    renderResults(ctrl, [item, { ...item, primaryText: "London, UK" }]);
    const panel = ctrl.panelWrap as HTMLElement;
    expect(wheelBindTargets(addSpy).get(panel)).toBe(1);
    addSpy.mockRestore();
  });

  it("binds one wheel listener on a fresh panel after removePanel", () => {
    // removePanel drops the element and nulls panelWrap; the next render must
    // build a NEW element and bind a NEW listener. If a stale "already bound"
    // flag survived (the panelWheelBound regression), the new element would
    // carry zero listeners and a wheel over it would zoom the map again.
    const addSpy = vi.spyOn(EventTarget.prototype, "addEventListener");
    const ctrl = makeFixture();
    const item = {
      source: "suggestion" as const,
      icon: "",
      primaryText: "Paris, France",
      coordDisplay: null,
      onClick: () => false,
    };
    renderResults(ctrl, [item]);
    const firstPanel = ctrl.panelWrap as HTMLElement;
    removePanel(ctrl);
    renderResults(ctrl, [item]);

    const newPanel = ctrl.panelWrap as HTMLElement;
    expect(newPanel).not.toBe(firstPanel);
    // The fresh element carries its own containment listener; the stale-flag
    // regression would leave it with none.
    expect(wheelBindTargets(addSpy).get(newPanel)).toBe(1);
    addSpy.mockRestore();
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

  it("keeps the wrap fixed to the control when the page is scrolled", () => {
    // The result panel is position: fixed (viewport-relative), so the scroll
    // offset must NOT be added to the control's rect — otherwise the panel
    // drifts by scrollX/scrollY once the page scrolls (real bug, #846 step 3).
    const originalScrollX = window.scrollX;
    const originalScrollY = window.scrollY;
    try {
      Object.defineProperty(window, "scrollX", {
        value: 120,
        configurable: true,
      });
      Object.defineProperty(window, "scrollY", {
        value: 80,
        configurable: true,
      });
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
      // Same as the scroll=0 case: rect.left and rect.bottom, no +scroll.
      expect(ctrl.panelWrap.style.left).toBe("10px");
      expect(ctrl.panelWrap.style.top).toBe("100px");
    } finally {
      Object.defineProperty(window, "scrollX", {
        value: originalScrollX,
        configurable: true,
      });
      Object.defineProperty(window, "scrollY", {
        value: originalScrollY,
        configurable: true,
      });
    }
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
