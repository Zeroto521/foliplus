import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Util from "#foliplus/MeasureControl/util.js";
import { stopEvent } from "#common/dom.js";

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

describe("nextToggleState", () => {
  it("defaults to toggling X when showX is undefined", () => {
    expect(Util.nextToggleState(false, true, undefined, undefined)).toEqual({
      isXVisible: true,
      isLabelsVisible: true,
    });
  });

  it("honors explicit showX and label toggles", () => {
    expect(Util.nextToggleState(true, true, false, false)).toEqual({
      isXVisible: false,
      isLabelsVisible: false,
    });
  });

  it("resets labels when toggleLbl is reset", () => {
    expect(Util.nextToggleState(true, false, undefined, "reset")).toEqual({
      isXVisible: false,
      isLabelsVisible: true,
    });
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
