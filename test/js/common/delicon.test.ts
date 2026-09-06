import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEL_ICON_CHAR,
  DEL_ICON_MARKER_ANCHOR,
  DEL_ICON_SELECTOR,
  DEL_ICON_Z_OFFSET,
  attachDelClick,
  bindDelIconToPopup,
  hideDelIcons,
  makeDelIcon,
  toggleDelIcon,
} from "#common/delicon.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("delicon constants", () => {
  it("exports the shared delete-icon contract values", () => {
    expect(DEL_ICON_CHAR).toBe("\u2715");

    expect(DEL_ICON_SELECTOR).toBe("[data-del-icon]");

    expect(DEL_ICON_Z_OFFSET).toBe(11000);

    // Pin-only anchor: ✕ floats at the marker/pin bottom tip.
    expect(DEL_ICON_MARKER_ANCHOR).toEqual([0, 24]);
  });
});

describe("makeDelIcon", () => {
  it("creates a marker with default anchor / z-index / html structure", () => {
    const marker = makeDelIcon({ lat: 1, lng: 2 });

    expect(window.L.marker).toHaveBeenCalled();
    const [latlng, opts] = window.L.marker.mock.calls[0];

    expect(latlng).toEqual({ lat: 1, lng: 2 });

    expect(opts.interactive).toBe(true);

    // Defaults: line/area/circle nodes anchor at [0, 0], above any layer.
    expect(opts.zIndexOffset).toBe(DEL_ICON_Z_OFFSET);

    const iconOpts = window.L.divIcon.mock.calls[0][0];

    expect(iconOpts.iconAnchor).toEqual([0, 0]);

    expect(iconOpts.iconSize).toEqual([0, 0]);

    expect(iconOpts.className).toBe("foliplus-del-icon");

    expect(iconOpts.html).toContain("data-del-icon");

    expect(iconOpts.html).toContain('data-foliplus-export="exclude"');

    expect(iconOpts.html).toContain(DEL_ICON_CHAR);
  });

  it("lets callers override className / anchor / z-index / title", () => {
    makeDelIcon(
      { lat: 1, lng: 2 },
      {
        className: "extra",
        iconAnchor: [5, 10],
        zIndexOffset: 99,
        title: "delete",
      },
    );
    const [, opts] = window.L.marker.mock.calls[0];
    const iconOpts = window.L.divIcon.mock.calls[0][0];

    expect(opts.zIndexOffset).toBe(99);

    expect(opts.title).toBe("delete");

    expect(iconOpts.iconAnchor).toEqual([5, 10]);

    expect(iconOpts.className).toBe("extra foliplus-del-icon");
  });
});

describe("attachDelClick", () => {
  it("fires callback and stops the event only for ✕ clicks", () => {
    const callback = vi.fn();
    const delMarker = { on: vi.fn() };

    attachDelClick(delMarker, callback);
    const handler = delMarker.on.mock.calls[0][1];

    // Click on the delete icon span → callback fires + event stopped
    const x = document.createElement("span");

    x.setAttribute("data-del-icon", "");
    const orig = { target: x, stopPropagation: vi.fn(), preventDefault: vi.fn() };

    handler({ originalEvent: orig });

    expect(callback).toHaveBeenCalledTimes(1);

    expect(orig.stopPropagation).toHaveBeenCalled();

    expect(orig.preventDefault).toHaveBeenCalled();

    // Click elsewhere on the marker → no callback
    handler({
      originalEvent: {
        target: document.createElement("div"),
        stopPropagation: vi.fn(),
        preventDefault: vi.fn(),
      },
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe("toggleDelIcon", () => {
  it("toggles the visible class on the inner ✕ span", () => {
    const icon = document.createElement("span");

    icon.setAttribute("data-del-icon", "");
    const marker = { getElement: () => ({ querySelector: () => icon }) };

    toggleDelIcon(marker, true);

    expect(icon.classList.contains("visible")).toBe(true);

    toggleDelIcon(marker, false);

    expect(icon.classList.contains("visible")).toBe(false);
  });

  it("is safe when the marker has no DOM element or ✕ span yet", () => {
    expect(() => toggleDelIcon({ getElement: () => null }, true)).not.toThrow();

    expect(() =>
      toggleDelIcon({ getElement: () => ({ querySelector: () => null }) }, true),
    ).not.toThrow();
  });
});

describe("hideDelIcons", () => {
  it("removes the visible class from every shown delete icon", () => {
    const shown = document.createElement("div");

    shown.setAttribute("data-del-icon", "");

    shown.classList.add("visible");
    const hidden = document.createElement("div");

    hidden.setAttribute("data-del-icon", "");

    document.body.append(shown, hidden);

    hideDelIcons();

    expect(shown.classList.contains("visible")).toBe(false);

    expect(hidden.classList.contains("visible")).toBe(false);
  });
});

describe("bindDelIconToPopup", () => {
  it("binds handlers to popupopen and popupclose", () => {
    const markerDom = document.createElement("div");
    const delSpan = document.createElement("span");

    delSpan.setAttribute("data-del-icon", "");

    markerDom.appendChild(delSpan);
    const delIcon = { _id: "del", getElement: () => markerDom };
    const marker = { on: vi.fn() };

    bindDelIconToPopup(marker, delIcon);

    expect(marker.on).toHaveBeenCalledWith("popupopen", expect.any(Function));

    expect(marker.on).toHaveBeenCalledWith("popupclose", expect.any(Function));

    const openHandler = marker.on.mock.calls[0][1];
    const closeHandler = marker.on.mock.calls[1][1];

    openHandler();

    expect(delSpan.classList.contains("visible")).toBe(true);

    closeHandler();

    expect(delSpan.classList.contains("visible")).toBe(false);
  });

  it("does nothing when marker is null", () => {
    const delIcon = { _id: "del" };

    expect(() => bindDelIconToPopup(null, delIcon)).not.toThrow();
  });
});
