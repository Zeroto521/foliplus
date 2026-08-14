import { stopEvent } from "#common/dom.js";
import * as Util from "#foliplus/MeasureControl/MeasureControl.util.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.clearAllMocks();
  window.L.circleMarker = vi.fn(() => ({}));
  window.L.DomEvent = {
    ...window.L.DomEvent,
    stopPropagation: vi.fn(),
  };
  globalThis.turf = {
    point: coords => ({ coords }),
    distance: vi.fn(() => 100),
    bearing: vi.fn(() => 45),
  };
});

afterEach(() => {
  delete globalThis.turf;
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

describe("calcToggle", () => {
  it("defaults to toggling X when showX is undefined", () => {
    expect(Util.calcToggle(false, true, undefined, undefined)).toEqual({
      isXVisible: true,
      isLabelsVisible: true,
    });
  });

  it("honors explicit showX and label toggles", () => {
    expect(Util.calcToggle(true, true, false, false)).toEqual({
      isXVisible: false,
      isLabelsVisible: false,
    });
  });

  it("resets labels when toggleLbl is reset", () => {
    expect(Util.calcToggle(true, false, undefined, "reset")).toEqual({
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

describe("makeDelIcon", () => {
  it("creates a marker with a delete icon divIcon", () => {
    const marker = Util.makeDelIcon({ lat: 1, lng: 2 });
    expect(window.L.marker).toHaveBeenCalled();
    const [latlng, opts] = window.L.marker.mock.calls[0];
    expect(latlng).toEqual({ lat: 1, lng: 2 });
    expect(opts.interactive).toBe(true);
    expect(opts.icon).toBeDefined();
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

describe("attachDelClick", () => {
  it("calls callback only for delete icon clicks", () => {
    const callback = vi.fn();
    const delMarker = { on: vi.fn() };
    Util.attachDelClick(delMarker, callback);
    const handler = delMarker.on.mock.calls[0][1];

    // Click on the delete icon → callback fires
    const target = document.createElement("span");
    target.className = "foliplus-measure-del-icon";
    handler({ originalEvent: { target } });
    expect(callback).toHaveBeenCalledTimes(1);

    // Click elsewhere → no callback
    handler({ originalEvent: { target: document.createElement("div") } });
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe("hideDelIcons", () => {
  it("removes visible class from delete icons", () => {
    const el = document.createElement("div");
    el.className = "foliplus-measure-del-icon visible";
    document.body.appendChild(el);
    Util.hideDelIcons();
    expect(el.classList.contains("visible")).toBe(false);
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
    Util.animateDashSweep(path);
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
    expect(() => Util.animateDashSweep(path)).not.toThrow();
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
    expect(Util.formatSegmentLabel({}, {}, 500)).toBe("500 m");
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

describe("applyToggle", () => {
  it("toggles labels and calls onToggle", () => {
    const labelEl = document.createElement("span");
    labelEl.classList.add("foliplus-measure-label");
    const marker = { getElement: () => ({ querySelector: () => labelEl }) };
    const delMarker = { getElement: () => ({ querySelector: () => null }) };
    const onToggle = vi.fn();
    Util.applyToggle(delMarker, true, [marker], false, null, onToggle);
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
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    stopEvent(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });
});

describe("toggleDelIcon", () => {
  it("toggles visible class on the delete icon element", () => {
    const icon = document.createElement("span");
    icon.className = "foliplus-measure-del-icon";
    document.body.appendChild(icon);
    const marker = { getElement: () => ({ querySelector: () => icon }) };
    Util.toggleDelIcon(marker, true);
    expect(icon.classList.contains("visible")).toBe(true);
    Util.toggleDelIcon(marker, false);
    expect(icon.classList.contains("visible")).toBe(false);
  });

  it("is safe when marker getElement returns null", () => {
    expect(() => Util.toggleDelIcon({ getElement: () => null }, true)).not.toThrow();
  });
});
