import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Util from "#foliplus/MeasureControl/util.js";
import { stopEvent } from "#common/dom.js";

const fakeEv = (): any => ({ preventDefault: vi.fn(), stopPropagation: vi.fn() });

beforeEach(() => {
  vi.clearAllMocks();
  window.L.circleMarker = vi.fn(() => ({}));
  window.L.DomEvent = {
    ...window.L.DomEvent,
    stopPropagation: vi.fn(),
  };
  globalThis.turf = {
    point: coords => ({ coords }),
    polygon: vi.fn(rings => ({ type: "Polygon", coordinates: rings })),
    area: vi.fn(() => 5000),
    midpoint: vi.fn(() => ({ geometry: { coordinates: [50, 50] } })),
    distance: vi.fn(() => 100),
    bearing: vi.fn(() => 45),
    destination: vi.fn((coord, _, bearing) => ({
      geometry: { coordinates: [coord[0] + bearing, coord[1] + bearing] },
    })),
  };
});

afterEach(() => {
  delete globalThis.turf;
});

describe("pointsToLatLngs", () => {
  it("converts {lng,lat} points to LatLng array", () => {
    window.L.latLng = vi.fn((lat, lng) => ({ lat, lng }));
    const result = Util.pointsToLatLngs([
      { lng: 119.3, lat: 26.08 },
      { lng: 119.31, lat: 26.09 },
    ]);
    expect(result).toEqual([
      { lat: 26.08, lng: 119.3 },
      { lat: 26.09, lng: 119.31 },
    ]);
  });

  it("handles empty array", () => {
    window.L.latLng = vi.fn((lat, lng) => ({ lat, lng }));
    expect(Util.pointsToLatLngs([])).toEqual([]);
  });
});

describe("formatDistance", () => {
  it("formats meters below the km threshold", () => {
    expect(Util.formatDistance(500)).toBe("500 m");
  });

  it("formats km above the threshold", () => {
    expect(Util.formatDistance(1500)).toBe("1.5 km");
  });
});

describe("formatArea", () => {
  it("formats m² below 1e6", () => {
    expect(Util.formatArea(1234)).toBe("1,234 m²");
  });

  it("formats km² at or above 1e6", () => {
    expect(Util.formatArea(2_500_000)).toBe("2.50 km²");
  });
});

describe("toggleVisibility", () => {
  it("toggles the hidden class on elements", () => {
    const el = document.createElement("div");
    Util.toggleVisibility([el], false);
    expect(el.classList.contains("foliplus-measure-hidden")).toBe(true);
    Util.toggleVisibility([el], true);
    expect(el.classList.contains("foliplus-measure-hidden")).toBe(false);
  });

  it("skips null elements", () => {
    expect(() => Util.toggleVisibility([null, undefined], true)).not.toThrow();
  });
});

describe("label div icons", () => {
  it("makeLabelDivIcon builds a divIcon with label html", () => {
    Util.makeLabelDivIcon("hi", [0, -10], "extra");
    expect(window.L.divIcon).toHaveBeenCalled();
    const opts = window.L.divIcon.mock.calls[0][0];
    expect(opts.html).toContain("foliplus-measure-label");
    expect(opts.html).toContain("extra");
    expect(opts.html).toContain("hi");
  });

  it("makeMidLabelDivIcon uses the mid anchor and class", () => {
    Util.makeMidLabelDivIcon("mid");
    const opts = window.L.divIcon.mock.calls[0][0];
    expect(opts.html).toContain("foliplus-measure-label-mid");
  });
});

describe("makeNode", () => {
  it("creates a circle marker with default class", () => {
    Util.makeNode({ lat: 1, lng: 2 });
    expect(window.L.circleMarker).toHaveBeenCalledWith(
      { lat: 1, lng: 2 },
      { radius: 5, className: "foliplus-measure-node" },
    );
  });

  it("accepts a custom className", () => {
    Util.makeNode({ lat: 1, lng: 2 }, "custom");
    expect(window.L.circleMarker.mock.calls[0][1].className).toBe("custom");
  });
});

describe("setLabelText", () => {
  it("updates the label element text", () => {
    const labelEl = document.createElement("span");
    const marker = { getElement: () => ({ querySelector: () => labelEl }) };
    Util.setLabelText(marker, "new text");
    expect(labelEl.textContent).toBe("new text");
  });
});

describe("animateDashSweep", () => {
  it("applies sweep style and cleans up on animationend", () => {
    const path = {
      getTotalLength: () => 120,
      style: { setProperty: vi.fn(), removeProperty: vi.fn() },
      classList: { add: vi.fn(), remove: vi.fn() },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    Util.animateDashSweep(path as any);
    expect(path.style.setProperty).toHaveBeenCalledWith("--sweep-length", "120");
    expect(path.classList.add).toHaveBeenCalledWith("foliplus-measure-dash-sweep");

    // Fire animationend → cleanup runs
    const onEnd = path.addEventListener.mock.calls[0][1];
    onEnd();
    expect(path.classList.remove).toHaveBeenCalled();
    expect(path.style.removeProperty).toHaveBeenCalled();
  });

  it("does nothing for zero-length paths", () => {
    const path = { getTotalLength: () => 0 };
    expect(() => Util.animateDashSweep(path as any)).not.toThrow();
  });
});

describe("recalculateSegments", () => {
  it("computes segments and total distance", () => {
    const points = [
      { lng: 0, lat: 0 },
      { lng: 1, lat: 1 },
      { lng: 2, lat: 2 },
    ];
    const result = Util.recalculateSegments(points);
    expect(result.segments).toHaveLength(2);
    expect(result.totalDistance).toBe(200);
    expect(result.segments[0].distance).toBe(100);
  });
});

describe("formatSegmentLabel", () => {
  it("returns only distance when show_bearing is off", () => {
    window.CONF = { ...window.CONF, show_bearing: false };
    expect(Util.formatSegmentLabel({} as any, {} as any, 500)).toBe("500 m");
  });

  it("includes bearing when show_bearing is on", () => {
    window.CONF = { ...window.CONF, show_bearing: true };
    globalThis.turf.bearing = vi.fn(() => 45);
    const a = { lng: 0, lat: 0 };
    const b = { lng: 0, lat: 1 };
    const label = Util.formatSegmentLabel(a, b, 500);
    expect(label).toBe("45° | 500 m");
  });
});

describe("suppressHide", () => {
  it("sets a delayed flag and clears it after the delay", () => {
    vi.useFakeTimers();
    const manager = { isSuppressHideDel: false };
    Util.suppressHide(manager);
    expect(manager.isSuppressHideDel).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(manager.isSuppressHideDel).toBe(false);
    vi.useRealTimers();
  });
});

describe("applyVisibilityToggle", () => {
  it("toggles labels and calls onToggle", () => {
    const labelEl = document.createElement("span");
    labelEl.classList.add("foliplus-measure-label");
    const marker = { getElement: () => ({ querySelector: () => labelEl }) };
    const delMarker = { getElement: () => ({ querySelector: () => null }) };
    const onToggle = vi.fn();
    Util.applyVisibilityToggle(delMarker, true, [marker], false, null, onToggle);
    expect(labelEl.classList.contains("foliplus-measure-hidden")).toBe(true);
    expect(onToggle).toHaveBeenCalledWith(true, false);
  });
});

describe("buildPopup", () => {
  it("delegates to buildPopupHtml", () => {
    const result = Util.buildPopup(1, 2, "addr");
    expect(result).toBeDefined();
  });
});

describe("stopEvent", () => {
  it("prevents default and stops propagation", () => {
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as Event;
    stopEvent(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });
});

describe("formatDistance boundary", () => {
  it("formats exactly 1000m as '1 km'", () => {
    expect(Util.formatDistance(1000)).toBe("1.0 km");
  });

  it("formats 999m as '999 m'", () => {
    expect(Util.formatDistance(999)).toBe("999 m");
  });
});

describe("formatArea boundary", () => {
  it("formats exactly 1e6 m² as '1.00 km²'", () => {
    expect(Util.formatArea(1_000_000)).toBe("1.00 km²");
  });

  it("formats 999999 m² with locale thousands separator", () => {
    expect(Util.formatArea(999_999)).toBe("999,999 m²");
  });
});

describe("recalculateSegments edge cases", () => {
  it("returns empty segments for single point", () => {
    const result = Util.recalculateSegments([{ lat: 0, lng: 0 }] as any);
    expect(result.segments).toHaveLength(0);
    expect(result.totalDistance).toBe(0);
  });

  it("returns empty segments for empty array", () => {
    const result = Util.recalculateSegments([] as any);
    expect(result.segments).toHaveLength(0);
    expect(result.totalDistance).toBe(0);
  });

  it("computes one segment for two points", () => {
    const result = Util.recalculateSegments([
      { lat: 0, lng: 0 },
      { lat: 1, lng: 1 },
    ] as any);
    expect(result.segments).toHaveLength(1);
    expect(result.totalDistance).toBe(result.segments[0].distance);
  });
});

describe("applyVisibilityToggle edge cases", () => {
  it("handles null delMarker gracefully", () => {
    expect(() =>
      Util.applyVisibilityToggle(null, true, [], false, null, undefined),
    ).not.toThrow();
  });

  it("applies visibility to extra label", () => {
    const extraEl = document.createElement("span");
    extraEl.classList.add("foliplus-measure-label");
    const extraLabel = { getElement: () => ({ querySelector: () => extraEl }) };
    const onToggle = vi.fn();
    Util.applyVisibilityToggle(undefined, true, [], false, extraLabel as any, onToggle);
    expect(extraEl.classList.contains("foliplus-measure-hidden")).toBe(true);
    expect(onToggle).toHaveBeenCalledWith(true, false);
  });
});

describe("toggleVisibility edge cases", () => {
  it("handles empty array", () => {
    expect(() => Util.toggleVisibility([], true)).not.toThrow();
  });

  it("toggles multiple elements", () => {
    const el1 = document.createElement("div");
    const el2 = document.createElement("div");
    Util.toggleVisibility([el1, el2], false);
    expect(el1.classList.contains("foliplus-measure-hidden")).toBe(true);
    expect(el2.classList.contains("foliplus-measure-hidden")).toBe(true);
  });
});

describe("getEventTarget", () => {
  it("returns the target from a LeafletMouseEvent", () => {
    const el = document.createElement("div");
    const event = {
      originalEvent: { target: el },
    } as unknown as L.LeafletMouseEvent;
    expect(Util.getEventTarget(event)).toBe(el);
  });

  it("returns null when originalEvent is missing", () => {
    const event = {} as L.LeafletMouseEvent;
    expect(Util.getEventTarget(event)).toBeNull();
  });
});

describe("buildEditOverlay", () => {
  function makeMap() {
    return {
      on: vi.fn(),
      off: vi.fn(),
    } as any;
  }

  it("exposes open and cleanup", () => {
    const mgr = { map: makeMap(), isSuppressHideDel: false };
    const overlay = Util.buildEditOverlay(mgr, {});

    expect(typeof overlay.open).toBe("function");
    expect(typeof overlay.cleanup).toBe("function");
  });

  it("fires onOpen and calls stopEvent on open", () => {
    const mgr = { map: makeMap(), isSuppressHideDel: false };
    const onOpen = vi.fn();
    const overlay = Util.buildEditOverlay(mgr, { onOpen });
    const ev = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as any;

    overlay.open(ev);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(ev.stopPropagation).toHaveBeenCalled();
  });

  it("does not re-open while already open", () => {
    const mgr = { map: makeMap(), isSuppressHideDel: false };
    const onOpen = vi.fn();
    const overlay = Util.buildEditOverlay(mgr, { onOpen });

    overlay.open({} as any);
    overlay.open({} as any);

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("fires onEmpty when empty space is clicked", () => {
    const map = makeMap();
    const mgr = { map, isSuppressHideDel: false };
    const onEmpty = vi.fn();
    const overlay = Util.buildEditOverlay(mgr, { onOpen: vi.fn(), onEmpty });

    // find the map-click handler registered by buildEditOverlay
    overlay.open({} as any);
    const mapClickHandler = map.on.mock.calls.find(([ev]) => ev === "click")?.[1];
    expect(mapClickHandler).toBeDefined();
    mapClickHandler();
    expect(onEmpty).toHaveBeenCalledTimes(1);
  });

  it("does not close overlay when suppress-hide is active", () => {
    const map = makeMap();
    const mgr = { map, isSuppressHideDel: true };
    const onEmpty = vi.fn();
    const overlay = Util.buildEditOverlay(mgr, { onOpen: vi.fn(), onEmpty });

    overlay.open({} as any);
    const mapClickHandler = map.on.mock.calls.find(([ev]) => ev === "click")?.[1];
    mapClickHandler();
    expect(onEmpty).not.toHaveBeenCalled();
  });

  it("ignores a drag-synthetic click", () => {
    const map = makeMap();
    const mgr = { map, isSuppressHideDel: false };
    const onEmpty = vi.fn();
    const overlay = Util.buildEditOverlay(mgr, { onOpen: vi.fn(), onEmpty });

    overlay.open({} as any);
    const mapClickHandler = map.on.mock.calls.find(([ev]) => ev === "click")?.[1];
    Util.markDragSyntheticClick();
    mapClickHandler();
    expect(onEmpty).not.toHaveBeenCalled();
  });

  it("registers and cleans up the map-click listener", () => {
    const map = makeMap();
    const mgr = { map, isSuppressHideDel: false };
    const overlay = Util.buildEditOverlay(mgr, { onOpen: vi.fn() });

    overlay.open(fakeEv());
    overlay.cleanup();

    expect(map.off).toHaveBeenCalledWith("click", expect.any(Function));
  });
});

describe("markDragSyntheticClick / isDragSyntheticClick", () => {
  it("returns true once after markDragSyntheticClick", () => {
    Util.markDragSyntheticClick();
    expect(Util.isDragSyntheticClick()).toBe(true);
    expect(Util.isDragSyntheticClick()).toBe(false); // consumed-on-read
  });

  it("returns false by default", () => {
    expect(Util.isDragSyntheticClick()).toBe(false);
  });
});

describe("bindNodeDrag", () => {
  it("calls onDrag and onEnd through the drag lifecycle", () => {
    const node = {
      on: vi.fn(),
      off: vi.fn(),
      getLatLng: vi.fn(() => ({ lat: 1, lng: 1 })),
      setLatLng: vi.fn(),
    };
    const del = { on: vi.fn(), off: vi.fn(), setLatLng: vi.fn() };
    const onDrag = vi.fn();
    const onEnd = vi.fn();
    const map = {
      on: vi.fn(),
      off: vi.fn(),
      mouseEventToContainerPoint: vi.fn(
        (raw: { clientX: number; clientY: number }) => ({
          x: raw.clientX,
          y: raw.clientY,
        }),
      ),
      dragging: { disable: vi.fn(), enable: vi.fn() },
    };

    const { setEnabled, cleanup } = Util.bindNodeDrag(
      node as any,
      del as any,
      map as any,
      { onDrag, onEnd },
    );
    setEnabled(true);

    // find handlers
    const onDown = (node.on as any).mock.calls.find(([ev]) => ev === "mousedown")?.[1];
    const onMove = (map.on as any).mock.calls.find(([ev]) => ev === "mousemove")?.[1];
    const onUp = (map.on as any).mock.calls.find(([ev]) => ev === "mouseup")?.[1];

    onDown({ originalEvent: { clientX: 0, clientY: 0 }, latlng: { lat: 1, lng: 1 } });
    expect(map.dragging.disable).toHaveBeenCalled();

    onMove({ originalEvent: { clientX: 10, clientY: 0 }, latlng: { lat: 2, lng: 2 } });
    expect(node.setLatLng).toHaveBeenCalledWith({ lat: 2, lng: 2 });
    expect(del.setLatLng).toHaveBeenCalledWith({ lat: 2, lng: 2 });
    expect(onDrag).toHaveBeenCalledWith({ lat: 2, lng: 2 });

    onUp({ originalEvent: { clientX: 10, clientY: 0 }, latlng: { lat: 2, lng: 2 } });
    expect(onEnd).toHaveBeenCalledWith({ lat: 2, lng: 2 });
    expect(map.dragging.enable).toHaveBeenCalled();

    cleanup();
    expect(node.off).toHaveBeenCalledWith("mousedown", expect.any(Function));
  });

  it("does not drag when enabled is false", () => {
    const node = { on: vi.fn(), off: vi.fn() };
    const map = {
      on: vi.fn(),
      off: vi.fn(),
      mouseEventToContainerPoint: vi.fn(() => ({ x: 0, y: 0 })),
      dragging: { disable: vi.fn() },
    };
    const { setEnabled } = Util.bindNodeDrag(node as any, null, map as any, {});
    // enabled defaults to false
    const onDown = (node.on as any).mock.calls.find(([ev]) => ev === "mousedown")?.[1];
    onDown({});
    expect(map.dragging.disable).not.toHaveBeenCalled();
    setEnabled(true);
    onDown({ originalEvent: { clientX: 0, clientY: 0 } });
    expect(map.dragging.disable).toHaveBeenCalled();
  });

  it("skips onEnd when movement stayed inside the tap threshold", () => {
    const node = { on: vi.fn(), off: vi.fn() };
    const onEnd = vi.fn();
    const map = {
      on: vi.fn(),
      off: vi.fn(),
      mouseEventToContainerPoint: vi.fn(() => ({ x: 0, y: 0 })),
      dragging: { disable: vi.fn(), enable: vi.fn() },
    };

    const { setEnabled } = Util.bindNodeDrag(node as any, null, map as any, { onEnd });
    setEnabled(true);
    const onDown = (node.on as any).mock.calls.find(([ev]) => ev === "mousedown")?.[1];
    const onMove = (map.on as any).mock.calls.find(([ev]) => ev === "mousemove")?.[1];
    const onUp = (map.on as any).mock.calls.find(([ev]) => ev === "mouseup")?.[1];

    onDown({ originalEvent: { clientX: 0, clientY: 0 } });
    // movement of 2px < DRAG_THRESHOLD (4px)
    onMove({ originalEvent: { clientX: 2, clientY: 0 } });
    onUp({ originalEvent: { clientX: 2, clientY: 0 } });
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("gracefully ignores a synthesized mousedown with no originalEvent", () => {
    const node = { on: vi.fn(), off: vi.fn() };
    const onDrag = vi.fn();
    const map = {
      on: vi.fn(),
      off: vi.fn(),
      mouseEventToContainerPoint: vi.fn(),
      dragging: { disable: vi.fn(), enable: vi.fn() },
    };
    const { setEnabled } = Util.bindNodeDrag(node as any, null, map as any, { onDrag });
    setEnabled(true);
    const onDown = (node.on as any).mock.calls.find(([ev]) => ev === "mousedown")?.[1];
    const onMove = (map.on as any).mock.calls.find(([ev]) => ev === "mousemove")?.[1];

    onDown({ originalEvent: undefined, latlng: { lat: 1, lng: 1 } });
    expect(map.dragging.disable).not.toHaveBeenCalled();
    // No startPt was set, so a later move must not drag
    onMove({ originalEvent: { clientX: 10, clientY: 0 }, latlng: { lat: 2, lng: 2 } });
    expect(onDrag).not.toHaveBeenCalled();
  });
});

describe("geocodeAddress", () => {
  it("calls reverseGeocode and returns the resolved address", async () => {
    const resolvedAddr = "123 Main St";
    window.foliplus = {
      reverseGeocode: vi.fn(() => Promise.resolve(resolvedAddr)),
    } as any;
    const mgr = { map: {} };
    const result = await Util.geocodeAddress(mgr as any, 121, 31, "en", null);
    expect(window.foliplus.reverseGeocode).toHaveBeenCalledWith({}, 121, 31, "en");
    expect(result).toBe(resolvedAddr);
  });

  it("falls back to the previous address on geocode failure", async () => {
    window.foliplus = {
      reverseGeocode: vi.fn(() => Promise.reject(new Error("offline"))),
    } as any;
    const mgr = { map: {} };
    const prev = "fallback address";
    const result = await Util.geocodeAddress(mgr as any, 121, 31, "en", prev);
    expect(result).toBe(prev);
  });

  it("returns previous address when reverseGeocode returns null", async () => {
    window.foliplus = {
      reverseGeocode: vi.fn(() => Promise.resolve(null)),
    } as any;
    const mgr = { map: {} };
    const prev = "fallback address";
    const result = await Util.geocodeAddress(mgr as any, 121, 31, "en", prev);
    expect(result).toBe(prev);
  });

  it("returns previous when foliplus.reverseGeocode is unavailable", async () => {
    window.foliplus = undefined as any;
    const mgr = { map: {} };
    const prev = "fallback address";
    const result = await Util.geocodeAddress(mgr as any, 121, 31, "en", prev);
    expect(result).toBe(prev);
  });
});
