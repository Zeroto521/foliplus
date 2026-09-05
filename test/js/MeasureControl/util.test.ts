import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindNodeDrag,
  buildEditOverlay,
  isDragSyntheticClick,
  markDragSyntheticClick,
} from "#foliplus/MeasureControl/edit.js";
import * as Util from "#foliplus/MeasureControl/util.js";
import { getMapCrsType } from "#common/coord.js";
import { stopEvent } from "#common/dom.js";

const fakeEv = (): any => ({ preventDefault: vi.fn(), stopPropagation: vi.fn() });

beforeEach(() => {
  vi.clearAllMocks();
  // Consume any pending drag-synthetic-click flag so a prior test's drag end
  // doesn't leak into this test's click handler.
  isDragSyntheticClick();
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

describe("roundCoord", () => {
  it("rounds to the persisted 6-decimal precision", () => {
    expect(Util.roundCoord(121.987654321)).toBe(121.987654);
    expect(Util.roundCoord(31.123456789)).toBe(31.123457);
  });

  it("preserves whole numbers and trailing zeros", () => {
    expect(Util.roundCoord(122)).toBe(122);
    expect(Util.roundCoord(121.5)).toBe(121.5);
  });
});

describe("formatCoord", () => {
  it("rounds to the persisted 6-decimal precision and keeps trailing zeros", () => {
    expect(Util.formatCoord(121.987654321)).toBe("121.987654");
    expect(Util.formatCoord(122)).toBe("122.000000");
  });
  it("renders negative zero as a plain zero", () => {
    expect(Util.formatCoord(-0.0000001)).toBe("0.000000");
    expect(Util.formatCoord(-0.0000004)).toBe("0.000000");
  });

  it("formats negatives", () => {
    expect(Util.formatCoord(-31.123456789)).toBe("-31.123457");
  });
});

describe("formatLatLng", () => {
  it("leads with the longitude, matching every other location display", () => {
    expect(Util.formatLatLng(121.473701, 31.230955)).toBe("121.473701, 31.230955");
  });
  it("rounds both values to the persisted precision", () => {
    expect(Util.formatLatLng(121.987654321, -31.123456789)).toBe(
      "121.987654, -31.123457",
    );
  });
  it("keeps trailing zeros on round numbers", () => {
    expect(Util.formatLatLng(0, 0)).toBe("0.000000, 0.000000");
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

  it("makeLabelDivIcon falls back to the default anchor when none is given", () => {
    Util.makeLabelDivIcon("hi");
    const opts = window.L.divIcon.mock.calls[0][0];
    expect(opts.iconAnchor).toEqual([0, -10]);
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

  it("does nothing when the marker has no element", () => {
    const marker = { getElement: () => null };
    expect(() => Util.setLabelText(marker, "new text")).not.toThrow();
  });

  it("does nothing when the label element is absent", () => {
    const marker = { getElement: () => ({ querySelector: () => null }) };
    expect(() => Util.setLabelText(marker, "new text")).not.toThrow();
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

describe("coord readout", () => {
  // buildCoordReadout appends into the map container, so each test owns a
  // real detached container (document.body is proxied by jsdom and rejects
  // the append path).
  function makeMap() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    return { map: { getContainer: () => container } as any, container };
  }

  it("builds a hidden readout inside the map container", () => {
    const { map, container } = makeMap();
    const el = Util.buildCoordReadout(map);
    expect(el.parentElement).toBe(container);
    expect(el.hidden).toBe(true);
    expect(el.querySelector(".foliplus-measure-coord")).not.toBeNull();
    container.remove();
  });

  it("updates the chip text, reveals it, and returns the text", () => {
    const { map, container } = makeMap();
    const el = Util.buildCoordReadout(map);
    expect(el.hidden).toBe(true);
    const text = Util.setCoordReadout(el, "121.473701, 31.230955");
    expect(text).toBe("121.473701, 31.230955");
    expect(el.hidden).toBe(false);
    expect(el.querySelector(".foliplus-measure-coord")?.textContent).toBe(text);
    el.remove();
    container.remove();
  });

  it("hides the chip on request", () => {
    const { map, container } = makeMap();
    const el = Util.buildCoordReadout(map);
    Util.setCoordReadout(el, "0.000000, 0.000000");
    expect(el.hidden).toBe(false);
    Util.setCoordReadoutHidden(el);
    expect(el.hidden).toBe(true);
    el.remove();
    container.remove();
  });

  it("ignores a missing element without throwing", () => {
    expect(Util.setCoordReadout(null, "x")).toBe("x");
    expect(() => Util.setCoordReadoutHidden(null)).not.toThrow();
  });
});

describe("coordText", () => {
  // No domestic tile URL → CRS resolves to WGS84, so the value passes through
  // unchanged. This locks in the "readout matches export" contract without a
  // gcoord dependency; the pass-through is the WGS84 branch, not a fallback.
  it("formats a display-CRS lat/lng to the WGS84 readout string", () => {
    const map = { options: {}, _layers: {} } as any;
    expect(Util.coordText(map, { lat: 31.230955, lng: 121.473701 })).toBe(
      "121.473701, 31.230955",
    );
  });
  it("accepts Leaflet's latitude/longitude object shape", () => {
    const map = { options: {}, _layers: {} } as any;
    expect(Util.coordText(map, { latitude: 31.230955, longitude: 121.473701 })).toBe(
      "121.473701, 31.230955",
    );
  });
  it("accepts an L.LatLng instance whose lat/lng come from getters", () => {
    const map = { options: {}, _layers: {} } as any;
    const ll: any = {
      get lat() {
        return 31.230955;
      },
      get lng() {
        return 121.473701;
      },
    };
    expect(Util.coordText(map, ll)).toBe("121.473701, 31.230955");
  });
  it("rejects a point with no coordinates instead of rendering NaN", () => {
    const map = { options: {}, _layers: {} } as any;
    expect(() => Util.coordText(map, {} as any)).toThrowError(TypeError);
  });
  it("detects a non-WGS84 map so the conversion path is taken", () => {
    // getMapCrsType keys off the CRS code, not the tile URL string.
    const map = { options: { crs: { code: "GCJ02" } }, _layers: {} } as any;
    expect(getMapCrsType(map)).toBe("GCJ02");
    // and the same string through the domestic-tile URL patterns:
    expect(
      getMapCrsType({
        options: {},
        _layers: { x: { _url: "https://webrd02.is.autonavi.com/" } },
      } as any),
    ).toBe("GCJ02");
  });
});

describe("buildEditOverlay", () => {
  function makeMap() {
    return {
      on: vi.fn(),
      off: vi.fn(),
    } as any;
  }
  function makeMgr(overrides: Record<string, unknown> = {}) {
    return { map: makeMap(), isEditMode: true, ...overrides };
  }

  it("exposes open and cleanup", () => {
    const mgr = makeMgr();
    const overlay = buildEditOverlay(mgr as any, {});

    expect(typeof overlay.open).toBe("function");
    expect(typeof overlay.cleanup).toBe("function");
    expect(typeof overlay.close).toBe("function");
  });

  it("close() is a no-op when the overlay is not open", () => {
    const onEmpty = vi.fn();
    const overlay = buildEditOverlay(makeMgr() as any, {
      onOpen: vi.fn(),
      onEmpty,
    });

    overlay.close();

    expect(onEmpty).not.toHaveBeenCalled();
  });

  it("fires onOpen and stops Leaflet propagation on open", () => {
    const mgr = makeMgr();
    const onOpen = vi.fn();
    const overlay = buildEditOverlay(mgr as any, { onOpen });
    const ev = { originalEvent: {} } as any;

    overlay.open(ev);

    expect(onOpen).toHaveBeenCalledTimes(1);
    // Stops layer→map propagation so the overlay's own map-click handler
    // (which closes it) doesn't fire right after open.
    expect(window.L.DomEvent.stopPropagation).toHaveBeenCalledWith(ev);
  });

  it("closes other open overlays on open (single ✕ set at a time)", () => {
    const closeOtherEditOverlays = vi.fn();
    const mgr = makeMgr({ closeOtherEditOverlays });
    const overlay = buildEditOverlay(mgr as any, {
      onOpen: vi.fn(),
      id: "m42",
    });

    overlay.open({ originalEvent: {} } as any);

    expect(closeOtherEditOverlays).toHaveBeenCalledTimes(1);
    expect(closeOtherEditOverlays).toHaveBeenCalledWith("m42");
  });

  it("does not open when not in edit mode", () => {
    const mgr = makeMgr({ isEditMode: false });
    const onOpen = vi.fn();
    const overlay = buildEditOverlay(mgr as any, { onOpen });

    overlay.open({} as any);

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("does not open on a drag-synthetic click", () => {
    const onOpen = vi.fn();
    const overlay = buildEditOverlay(makeMgr() as any, { onOpen });

    markDragSyntheticClick();
    overlay.open({ originalEvent: {} } as any);

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("does not re-open while already open", () => {
    const mgr = makeMgr();
    const onOpen = vi.fn();
    const overlay = buildEditOverlay(mgr as any, { onOpen });

    overlay.open({} as any);
    overlay.open({} as any);

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("fires onEmpty when empty space is clicked", () => {
    const map = makeMap();
    const mgr = { map, isEditMode: true };
    const onEmpty = vi.fn();
    const overlay = buildEditOverlay(mgr as any, { onOpen: vi.fn(), onEmpty });

    // find the map-click handler registered by buildEditOverlay
    overlay.open({} as any);
    const mapClickHandler = map.on.mock.calls.find(([ev]) => ev === "click")?.[1];
    expect(mapClickHandler).toBeDefined();
    mapClickHandler();
    expect(onEmpty).toHaveBeenCalledTimes(1);
  });

  it("ignores a drag-synthetic click", () => {
    const map = makeMap();
    const mgr = { map, isEditMode: true };
    const onEmpty = vi.fn();
    const overlay = buildEditOverlay(mgr as any, { onOpen: vi.fn(), onEmpty });

    overlay.open({} as any);
    const mapClickHandler = map.on.mock.calls.find(([ev]) => ev === "click")?.[1];
    markDragSyntheticClick();
    mapClickHandler();
    expect(onEmpty).not.toHaveBeenCalled();
  });

  it("registers and cleans up the map-click listener", () => {
    const map = makeMap();
    const mgr = { map, isEditMode: true };
    const overlay = buildEditOverlay(mgr as any, { onOpen: vi.fn() });

    overlay.open(fakeEv());
    overlay.cleanup();

    expect(map.off).toHaveBeenCalledWith("click", expect.any(Function));
  });

  it("registers a closer and close() hides the overlay via onEmpty", () => {
    const closers: Array<() => void> = [];
    const mgr = {
      map: makeMap(),
      isEditMode: true,
      registerEditOverlayCloser: (c: () => void) => {
        closers.push(c);
        return () => {
          const i = closers.indexOf(c);
          if (i !== -1) closers.splice(i, 1);
        };
      },
    };
    const onEmpty = vi.fn();
    const overlay = buildEditOverlay(mgr as any, { onOpen: vi.fn(), onEmpty });

    overlay.open({} as any);
    expect(closers).toHaveLength(1);

    closers[0]();
    expect(onEmpty).toHaveBeenCalledTimes(1);
  });

  it("cleanup unregisters the closer so deleted measurements drop their entry", () => {
    const closers: Array<() => void> = [];
    const mgr = {
      map: makeMap(),
      isEditMode: true,
      registerEditOverlayCloser: (c: () => void) => {
        closers.push(c);
        return () => {
          const i = closers.indexOf(c);
          if (i !== -1) closers.splice(i, 1);
        };
      },
    };
    const overlay = buildEditOverlay(mgr as any, { onOpen: vi.fn() });
    expect(closers).toHaveLength(1);

    overlay.cleanup();
    expect(closers).toHaveLength(0);
  });
});

describe("markDragSyntheticClick / isDragSyntheticClick", () => {
  it("returns true once after markDragSyntheticClick", () => {
    markDragSyntheticClick();
    expect(isDragSyntheticClick()).toBe(true);
    expect(isDragSyntheticClick()).toBe(false); // consumed-on-read
  });

  it("returns false by default", () => {
    expect(isDragSyntheticClick()).toBe(false);
  });
});

describe("bindNodeDrag", () => {
  it("re-queries the node element when applying the move cursor (regression)", () => {
    // resortLayers() re-creates a node's SVG path, so a cursor captured at
    // bind time would go stale and the "move" cursor would silently stop.
    let current: { style: { cursor: string } } = { style: { cursor: "" } };
    const node = {
      on: vi.fn(),
      off: vi.fn(),
      getElement: vi.fn(() => current),
      setLatLng: vi.fn(),
    };
    const map = {
      on: vi.fn(),
      off: vi.fn(),
      dragging: { disable: vi.fn(), enable: vi.fn() },
    };
    const { setEnabled } = bindNodeDrag(node as any, null, map as any, {});

    // Simulate the node's element being replaced (resortLayers re-render).
    current = { style: { cursor: "" } };

    setEnabled(true);
    expect(current.style.cursor).toBe("move");
  });

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

    const { setEnabled, cleanup } = bindNodeDrag(node as any, del as any, map as any, {
      onDrag,
      onEnd,
    });
    setEnabled(true);

    // find handlers
    const onDown = (node.on as any).mock.calls.find(([ev]) => ev === "mousedown")?.[1];
    const onNodeUp = (node.on as any).mock.calls.find(([ev]) => ev === "mouseup")?.[1];
    const onMove = (map.on as any).mock.calls.find(([ev]) => ev === "mousemove")?.[1];

    onDown({ originalEvent: { clientX: 0, clientY: 0 }, latlng: { lat: 1, lng: 1 } });
    expect(map.dragging.disable).toHaveBeenCalled();

    onMove({ originalEvent: { clientX: 10, clientY: 0 }, latlng: { lat: 2, lng: 2 } });
    expect(node.setLatLng).toHaveBeenCalledWith({ lat: 2, lng: 2 });
    expect(del.setLatLng).toHaveBeenCalledWith({ lat: 2, lng: 2 });
    expect(onDrag).toHaveBeenCalledWith({ lat: 2, lng: 2 });

    // node-level mouseup delegates to the shared onUp handler
    onNodeUp({
      originalEvent: { clientX: 10, clientY: 0 },
      latlng: { lat: 2, lng: 2 },
    });
    expect(onEnd).toHaveBeenCalledWith({ lat: 2, lng: 2 });
    expect(map.dragging.enable).toHaveBeenCalled();

    cleanup();
    expect(node.off).toHaveBeenCalledWith("mousedown", expect.any(Function));
  });

  it("invokes onDrag before moving the node (findPtIdx sees the old latlng)", () => {
    // Regression: onDrag handlers in distance/polygon locate the point by
    // node.getLatLng(); if the node is moved first, they can't find it and the
    // drag silently no-ops.
    let currentLatLng = { lat: 1, lng: 1 };
    const node = {
      on: vi.fn(),
      off: vi.fn(),
      getLatLng: vi.fn(() => currentLatLng),
      setLatLng: vi.fn(l => {
        currentLatLng = l;
      }),
    };
    const seen: Array<{ lat: number; lng: number }> = [];
    const onDrag = vi.fn(() => {
      seen.push(node.getLatLng());
    });
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
    const { setEnabled } = bindNodeDrag(node as any, null, map as any, { onDrag });
    setEnabled(true);
    const onDown = (node.on as any).mock.calls.find(([ev]) => ev === "mousedown")?.[1];
    const onMove = (map.on as any).mock.calls.find(([ev]) => ev === "mousemove")?.[1];

    onDown({ originalEvent: { clientX: 0, clientY: 0 } });
    onMove({ originalEvent: { clientX: 10, clientY: 0 }, latlng: { lat: 2, lng: 2 } });

    // During onDrag the node still reports its ORIGINAL position.
    expect(seen).toEqual([{ lat: 1, lng: 1 }]);
    // After onDrag, the node is moved.
    expect(node.setLatLng).toHaveBeenCalledWith({ lat: 2, lng: 2 });
  });

  it("does not drag when enabled is false", () => {
    const node = { on: vi.fn(), off: vi.fn() };
    const map = {
      on: vi.fn(),
      off: vi.fn(),
      mouseEventToContainerPoint: vi.fn(() => ({ x: 0, y: 0 })),
      dragging: { disable: vi.fn() },
    };
    const { setEnabled } = bindNodeDrag(node as any, null, map as any, {});
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

    const { setEnabled } = bindNodeDrag(node as any, null, map as any, { onEnd });
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
    const { setEnabled } = bindNodeDrag(node as any, null, map as any, { onDrag });
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
