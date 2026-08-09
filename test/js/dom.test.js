import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPopupHtml,
  createIconButton,
  createLocationMarker,
  dom,
  escapeHTML,
  stopEvent,
} from "../../foliplus/js/common/dom.js";

describe("dom.el", () => {
  it("creates a basic element with tag", () => {
    const el = dom.el("div");
    expect(el.tagName).toBe("DIV");
  });

  it("sets class attribute", () => {
    const el = dom.el("div", { class: "foo bar" });
    expect(el.className).toBe("foo bar");
  });

  it("sets style from object", () => {
    const el = dom.el("div", { style: { color: "red", fontSize: "14px" } });
    expect(el.style.color).toBe("red");
    expect(el.style.fontSize).toBe("14px");
  });

  it("sets style from string", () => {
    const el = dom.el("div", { style: "color: blue; font-size: 16px" });
    expect(el.style.cssText).toContain("color: blue");
  });

  it("sets boolean properties", () => {
    const el = dom.el("input", { disabled: "", checked: true });
    expect(el.disabled).toBe(true);
    expect(el.checked).toBe(true);
  });

  it("sets value property", () => {
    const el = dom.el("input", { value: "test" });
    expect(el.value).toBe("test");
  });

  it("sets event handler", () => {
    const fn = vi.fn();
    const el = dom.el("button", { onclick: fn });
    el.click();
    expect(fn).toHaveBeenCalled();
  });

  it("appends child text", () => {
    const el = dom.el("p", null, "Hello");
    expect(el.textContent).toBe("Hello");
  });

  it("appends multiple children", () => {
    const el = dom.el("div", null, "A", "B", "C");
    expect(el.textContent).toBe("ABC");
  });

  it("inserts HTML via { html: ... }", () => {
    const el = dom.el("div", null, { html: "<span>inner</span>" });
    expect(el.querySelector("span")).not.toBeNull();
    expect(el.querySelector("span").textContent).toBe("inner");
  });

  it("appends child element", () => {
    const child = document.createElement("span");
    const el = dom.el("div", null, child);
    expect(el.firstChild).toBe(child);
  });

  it("skips null/undefined children", () => {
    const el = dom.el("div", null, "A", null, undefined, "B");
    expect(el.textContent).toBe("AB");
  });

  it("sets innerHTML", () => {
    const el = dom.el("div", { innerHTML: "<b>bold</b>" });
    expect(el.innerHTML).toBe("<b>bold</b>");
  });

  it("appends to parent via parent attr", () => {
    const parent = document.createElement("div");
    const el = dom.el("span", { parent });
    expect(parent.firstChild).toBe(el);
  });

  it("sets arbitrary attributes", () => {
    const el = dom.el("div", { "data-id": "42", title: "hello" });
    expect(el.getAttribute("data-id")).toBe("42");
    expect(el.getAttribute("title")).toBe("hello");
  });
});

describe("buildPopupHtml", () => {
  it("builds popup HTML with all fields", () => {
    const html = buildPopupHtml(
      120.5,
      30.2,
      "Some Address",
      "Location",
      "Loading...",
      "Lng,Lat:",
      "Address:",
    );
    expect(html).toContain("foliplus-popup-content");
    expect(html).toContain("Location");
    expect(html).toContain("120.5,30.2");
    expect(html).toContain("Some Address");
    expect(html).toContain("Lng,Lat:");
    expect(html).toContain("Address:");
  });

  it("shows loading indicator when addr is null", () => {
    const html = buildPopupHtml(
      120,
      30,
      null,
      "Location",
      "Loading...",
      "Lng,Lat:",
      "Address:",
    );
    expect(html).toContain("Loading...");
  });

  it("shows loading indicator when addr contains LOADING", () => {
    const html = buildPopupHtml(
      120,
      30,
      "LOADING",
      "Location",
      "Loading...",
      "Lng,Lat:",
      "Address:",
    );
    expect(html).toContain("Loading...");
  });
});

describe("createLocationMarker", () => {
  let map;
  const mockMarker = {
    bindPopup: vi.fn().mockReturnThis(),
    openPopup: vi.fn().mockReturnThis(),
    getPopup: vi.fn(() => ({
      _closeButton: null,
      isOpen: vi.fn(() => false),
    })),
    addTo: vi.fn().mockReturnThis(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    map = {
      removeLayer: vi.fn(),
      addLayer: vi.fn(),
    };
    window.L.marker = vi.fn(() => ({
      ...mockMarker,
      bindPopup: vi.fn().mockReturnThis(),
      openPopup: vi.fn().mockReturnThis(),
      getPopup: vi.fn(() => ({
        _closeButton: null,
        isOpen: vi.fn(() => false),
      })),
      addTo: vi.fn().mockReturnThis(),
    }));
    window.L.divIcon = vi.fn(() => ({}));
  });

  it("creates a marker with popup", () => {
    const marker = createLocationMarker(
      map,
      120,
      30,
      "Address",
      "Title",
      "Loading...",
      "Lng,Lat:",
      "Address:",
      "Close",
    );
    expect(window.L.marker).toHaveBeenCalledWith([30, 120], expect.any(Object));
    expect(map.addLayer).toHaveBeenCalled();
    expect(marker.bindPopup).toHaveBeenCalled();
    expect(marker.openPopup).toHaveBeenCalled();
  });

  it("removes existing marker", () => {
    const existing = { _map: map };
    createLocationMarker(
      map,
      120,
      30,
      "Address",
      "Title",
      "Loading...",
      "Lng,Lat:",
      "Address:",
      "Close",
      "en",
      existing,
    );
    expect(map.removeLayer).toHaveBeenCalledWith(existing);
  });

  it("adds marker to layerGroup instead of map", () => {
    const layerGroup = { addLayer: vi.fn() };
    createLocationMarker(
      map,
      120,
      30,
      "Address",
      "Title",
      "Loading...",
      "Lng,Lat:",
      "Address:",
      "Close",
      "en",
      null,
      layerGroup,
    );
    expect(layerGroup.addLayer).toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();
  });

  it("does not open popup when openPopup is false", () => {
    const marker = createLocationMarker(
      map,
      120,
      30,
      "Address",
      "Title",
      "Loading...",
      "Lng,Lat:",
      "Address:",
      "Close",
      "en",
      null,
      null,
      null,
      false,
    );
    expect(marker.openPopup).not.toHaveBeenCalled();
  });

  it("calls onAddress and updates popup when reverseGeocode resolves", async () => {
    const marker = {
      bindPopup: vi.fn().mockReturnThis(),
      openPopup: vi.fn(),
      setPopupContent: vi.fn(),
      getPopup: () => ({
        _closeButton: null,
        isOpen: vi.fn(() => true),
      }),
    };
    window.L.marker = vi.fn(() => marker);
    window.foliplus.reverseGeocode = vi.fn(() => Promise.resolve("Resolved Address"));
    const onAddress = vi.fn();

    createLocationMarker(
      map,
      120,
      30,
      null,
      "Title",
      "Loading...",
      "Lng,Lat:",
      "Address:",
      "Close",
      "en",
      null,
      null,
      onAddress,
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(onAddress).toHaveBeenCalledWith("Resolved Address");
    expect(marker.setPopupContent).toHaveBeenCalled();
  });

  it("does nothing when reverseGeocode is unavailable", () => {
    delete window.foliplus.reverseGeocode;
    expect(() =>
      createLocationMarker(
        map,
        120,
        30,
        null,
        "Title",
        "Loading...",
        "Lng,Lat:",
        "Address:",
        "Close",
      ),
    ).not.toThrow();
  });
});

describe("createIconButton", () => {
  it("creates a button with class, title, and svg content", () => {
    const btn = createIconButton({
      class: "foliplus-tool-btn",
      title: "Zoom in",
      svg: "<svg/>",
    });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.className).toBe("foliplus-tool-btn");
    expect(btn.title).toBe("Zoom in");
    // insertAdjacentHTML normalizes the self-closing tag.
    expect(btn.innerHTML).toBe("<svg></svg>");
  });

  it("appends to parent when provided", () => {
    const parent = document.createElement("div");
    const btn = createIconButton({ class: "btn", svg: "<svg/>", parent });
    expect(parent.contains(btn)).toBe(true);
  });

  it("sets aria-label when provided", () => {
    const btn = createIconButton({
      class: "btn",
      title: "T",
      ariaLabel: "A",
      svg: "<svg/>",
    });
    expect(btn.getAttribute("aria-label")).toBe("A");
  });

  it("omits aria-label when not provided", () => {
    const btn = createIconButton({ class: "btn", title: "T", svg: "<svg/>" });
    expect(btn.hasAttribute("aria-label")).toBe(false);
  });

  it("sets data-* attributes from data map", () => {
    const btn = createIconButton({
      class: "btn",
      svg: "<svg/>",
      data: { mode: "distance" },
    });
    expect(btn.getAttribute("data-mode")).toBe("distance");
  });

  it("assigns onclick handler", () => {
    const fn = vi.fn();
    const btn = createIconButton({ class: "btn", svg: "<svg/>", onclick: fn });
    btn.click();
    expect(fn).toHaveBeenCalled();
  });
});

describe("stopEvent", () => {
  it("stops propagation and prevents default on a DOM event", () => {
    const e = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
    stopEvent(e);
    expect(e.stopPropagation).toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("unwraps Leaflet events via originalEvent", () => {
    const original = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
    stopEvent({ originalEvent: original });
    expect(original.stopPropagation).toHaveBeenCalled();
    expect(original.preventDefault).toHaveBeenCalled();
  });
});

describe("escapeHTML", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHTML(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });

  it("coerces non-strings", () => {
    expect(escapeHTML(5)).toBe("5");
  });
});
