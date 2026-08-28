import { beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/MeasureControl/const.js";
import { MarkerMode } from "#foliplus/MeasureControl/mode/index.js";
import { initMocks, makeManagerMock } from "./setup.js";

beforeEach(initMocks);

/** Flush all pending microtasks (the onEnd → geocodeAddress await chain spans
 *  several microtask hops, so a single `await Promise.resolve()` is not enough). */
const flushAsync = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe("MarkerMode — TYPE", () => {
  it("has correct TYPE constant", () => {
    expect(MarkerMode.TYPE).toBe(CONST.MODE.MARKER);
  });
});

describe("MarkerMode — toGeoFeature", () => {
  it("returns a Point feature with address as name", () => {
    const feature = MarkerMode.toGeoFeature({
      id: "m1",
      type: "marker",
      lng: 121.5,
      lat: 31.2,
      address: "Shanghai",
    });
    expect(feature.type).toBe("Feature");
    expect(feature.properties.type).toBe("marker");
    expect(feature.properties.address).toBe("Shanghai");
    expect(feature.geometry.type).toBe("Point");
    expect(feature.geometry.coordinates).toEqual([121.5, 31.2]);
  });

  it("uses fallback name when address is missing", () => {
    const feature = MarkerMode.toGeoFeature({
      id: "m2",
      type: "marker",
      lng: 0,
      lat: 0,
    });
    expect(feature.properties.name).toBe("Location Marker");
  });

  it("includes id in properties", () => {
    const feature = MarkerMode.toGeoFeature({
      id: "m3",
      type: "marker",
      lng: 0,
      lat: 0,
    });
    expect(feature.properties.id).toBe("m3");
  });

  it("has NAME_LABEL and TYPE static properties", async () => {
    const { MarkerMode } = await import("#foliplus/MeasureControl/mode/index.js");
    expect(MarkerMode.NAME_LABEL).toBe("Location Marker");
    expect(MarkerMode.NAME_LABEL_KEY).toContain("name_marker");
  });
});

describe("MarkerMode — restore", () => {
  it("rebuilds a marker and registers the measure layer", () => {
    const manager = makeManagerMock();
    MarkerMode.restore(manager as any, {
      id: "m_r1",
      type: "marker",
      lng: 121.5,
      lat: 31.2,
      address: null,
    });

    expect(window.L.marker).toHaveBeenCalled();
    expect(manager.layers.addLayer).toHaveBeenCalled();
  });

  it("binds a delete handler to the rebuilt marker", () => {
    const manager = makeManagerMock();
    const data = {
      id: "m_r2",
      type: "marker",
      lng: 121.5,
      lat: 31.2,
      address: null,
    };
    MarkerMode.restore(manager as any, data);

    // createLocationMarker + del marker both use L.marker
    const markerCalls = (window.L.marker as any).mock.calls;
    expect(markerCalls.length).toBeGreaterThan(1); // pin + delete icon
  });
});

describe("MarkerMode — start + click", () => {
  it("binds a map click handler on start", () => {
    const manager = makeManagerMock() as any;
    manager.currentMode = CONST.MODE.MARKER;
    const mode = new MarkerMode(manager);
    mode.start();

    expect(manager.map.on).toHaveBeenCalledWith("click", expect.any(Function));
  });

  it("places a marker and persists measurement on click", () => {
    const manager = makeManagerMock() as any;
    manager.currentMode = CONST.MODE.MARKER;
    const mode = new MarkerMode(manager);
    mode.start();

    const clickHandler = manager.map.on.mock.calls.find(([ev]) => ev === "click")?.[1];
    clickHandler({ latlng: { lat: 31.2, lng: 121.5 } });

    expect(manager.measurements.length).toBe(1);
    expect(manager.measurements[0].type).toBe("marker");
    expect(manager.saveMeasurements).toHaveBeenCalled();
    expect(window.L.marker).toHaveBeenCalled();
  });

  it("pushes pin-drag cleanup into finalizedClickHandlers (regression: cleanup must run on clearAll)", () => {
    const manager = makeManagerMock() as any;
    MarkerMode.restore(manager, {
      id: "m_wire",
      type: "marker",
      lng: 121,
      lat: 31,
      address: "test",
    });

    expect(manager.finalizedClickHandlers.length).toBe(1);
    expect(typeof manager.finalizedClickHandlers[0]).toBe("function");

    // Cleanup must not throw even though mocks are shallow
    expect(() => manager.finalizedClickHandlers[0]()).not.toThrow();
  });

  it("drags a restored pin in edit mode: live update + geocode on end persists by reference", async () => {
    // requestAnimationFrame is unavailable in jsdom/node — stub it to queue
    // the throttled saveMeasurements callback.
    let rafCb: (() => void) | null = null;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: () => void) => {
        rafCb = cb;
        return 1;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const geocode = vi.fn(() => Promise.resolve("New Address"));
    const prevFoliplus = (window as any).foliplus;
    (window as any).foliplus = { ...prevFoliplus, reverseGeocode: geocode };

    try {
      const manager = makeManagerMock() as any;
      manager.isEditMode = true;
      const data: MeasureData = {
        id: "m_drag",
        type: "marker",
        lng: 121,
        lat: 31,
        address: "Old",
      };
      manager.measurements = [data];
      MarkerMode.restore(manager, data);

      // restore creates the pin (L.marker #1) then the del icon (L.marker #2).
      const pin = (window.L.marker as any).mock.results[0].value;
      const del = (window.L.marker as any).mock.results[1].value;

      // popup opens in edit mode → ✕ shown + drag enabled. There are two
      // popupopen handlers on the pin: the content-refresh one (registered
      // first in restore) and the drag-gate one (registered by bindPinDrag).
      const onPopupOpen = pin.on.mock.calls
        .filter(([ev]: [string]) => ev === "popupopen")
        .at(-1)[1];
      onPopupOpen();

      const onDown = pin.on.mock.calls.find(
        ([ev]: [string]) => ev === "mousedown",
      )?.[1];
      const onMove = manager.map.on.mock.calls.find(
        ([ev]: [string]) => ev === "mousemove",
      )?.[1];
      const onUp = manager.map.on.mock.calls.find(
        ([ev]: [string]) => ev === "mouseup",
      )?.[1];

      onDown({
        originalEvent: { clientX: 0, clientY: 0 },
        latlng: { lat: 31, lng: 121 },
      });
      expect(manager.map.dragging.disable).toHaveBeenCalled();

      onMove({
        originalEvent: { clientX: 10, clientY: 0 },
        latlng: { lat: 32, lng: 122 },
      });
      expect(pin.setLatLng).toHaveBeenCalledWith({ lat: 32, lng: 122 });
      expect(del.setLatLng).toHaveBeenCalledWith({ lat: 32, lng: 122 });
      // Live coordinate update mutates the measurement by reference
      expect(data.lng).toBe(122);
      expect(data.lat).toBe(32);

      // Flush the RAF-throttled persist
      expect(rafCb).toBeTruthy();
      rafCb!();
      expect(manager.saveMeasurements).toHaveBeenCalled();

      onUp({
        originalEvent: { clientX: 10, clientY: 0 },
        latlng: { lat: 32, lng: 122 },
      });
      await flushAsync(); // flush the geocode await chain
      expect(geocode).toHaveBeenCalled();
      expect(data.address).toBe("New Address");
      expect(manager.map.dragging.enable).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      (window as any).foliplus = prevFoliplus;
    }
  });

  it("does not enable drag when popup opens outside edit mode", () => {
    const manager = makeManagerMock() as any;
    manager.isEditMode = false;
    MarkerMode.restore(manager, {
      id: "m_noedit",
      type: "marker",
      lng: 121,
      lat: 31,
      address: "Old",
    });

    const pin = (window.L.marker as any).mock.results[0].value;
    const onPopupOpen = pin.on.mock.calls
      .filter(([ev]: [string]) => ev === "popupopen")
      .at(-1)[1];
    onPopupOpen();

    // Drag stays disabled: mousedown is a no-op, map dragging is not disabled.
    const onDown = pin.on.mock.calls.find(([ev]: [string]) => ev === "mousedown")?.[1];
    onDown({
      originalEvent: { clientX: 0, clientY: 0 },
      latlng: { lat: 31, lng: 121 },
    });
    expect(manager.map.dragging.disable).not.toHaveBeenCalled();
  });

  it("discards a stale geocode result when a newer drag supersedes it", async () => {
    let rafCb: (() => void) | null = null;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: () => void) => {
        rafCb = cb;
        return 1;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    // Two deferred geocodes: the first resolves late, the second resolves first.
    let resolveFirst!: (v: string) => void;
    const first = new Promise<string>(r => (resolveFirst = r));
    const geocode = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(Promise.resolve("Second Address"));
    const prevFoliplus = (window as any).foliplus;
    (window as any).foliplus = { ...prevFoliplus, reverseGeocode: geocode };

    try {
      const manager = makeManagerMock() as any;
      manager.isEditMode = true;
      const data: MeasureData = {
        id: "m_race",
        type: "marker",
        lng: 121,
        lat: 31,
        address: "Old",
      };
      MarkerMode.restore(manager, data);

      const pin = (window.L.marker as any).mock.results[0].value;
      pin.on.mock.calls
        .filter(([ev]: [string]) => ev === "popupopen")
        .at(-1)[1]();

      const onDown = pin.on.mock.calls.find(
        ([ev]: [string]) => ev === "mousedown",
      )?.[1];
      const onMove = manager.map.on.mock.calls.find(
        ([ev]: [string]) => ev === "mousemove",
      )?.[1];
      const onUp = manager.map.on.mock.calls.find(
        ([ev]: [string]) => ev === "mouseup",
      )?.[1];

      onDown({ originalEvent: { clientX: 0, clientY: 0 } });
      onMove({
        originalEvent: { clientX: 10, clientY: 0 },
        latlng: { lat: 32, lng: 122 },
      });
      onUp({
        originalEvent: { clientX: 10, clientY: 0 },
        latlng: { lat: 32, lng: 122 },
      });

      // second drag begins (supersedes gen 1)
      onDown({ originalEvent: { clientX: 0, clientY: 0 } });
      onMove({
        originalEvent: { clientX: 20, clientY: 0 },
        latlng: { lat: 33, lng: 123 },
      });
      onUp({
        originalEvent: { clientX: 20, clientY: 0 },
        latlng: { lat: 33, lng: 123 },
      });
      await flushAsync();
      expect(data.address).toBe("Second Address");

      // stale first geocode resolves late — must NOT overwrite
      resolveFirst!("Stale Address");
      await flushAsync();
      expect(data.address).toBe("Second Address");
    } finally {
      vi.unstubAllGlobals();
      (window as any).foliplus = prevFoliplus;
    }
  });

  it("hides ✕ and disables drag on popupclose", () => {
    const manager = makeManagerMock() as any;
    manager.isEditMode = true;
    MarkerMode.restore(manager, {
      id: "m_close",
      type: "marker",
      lng: 121,
      lat: 31,
      address: "Old",
    });
    const pin = (window.L.marker as any).mock.results[0].value;
    // open popup → drag enabled
    pin.on.mock.calls.filter(([ev]: [string]) => ev === "popupopen").at(-1)[1]();

    const onPopupClose = pin.on.mock.calls.find(
      ([ev]: [string]) => ev === "popupclose",
    )?.[1];
    onPopupClose();

    const onDown = pin.on.mock.calls.find(([ev]: [string]) => ev === "mousedown")?.[1];
    onDown({ originalEvent: { clientX: 0, clientY: 0 } });
    expect(manager.map.dragging.disable).not.toHaveBeenCalled();
  });

  it("refreshes popup content on popupopen when the address is resolved", () => {
    const manager = makeManagerMock() as any;
    MarkerMode.restore(manager, {
      id: "m_content",
      type: "marker",
      lng: 121,
      lat: 31,
      address: "Some Address",
    });
    const pin = (window.L.marker as any).mock.results[0].value;
    // the first popupopen handler is the content-refresh one from restore
    const onPopupOpen = pin.on.mock.calls.find(([ev]: [string]) => ev === "popupopen")?.[1];
    onPopupOpen();
    expect(pin.setPopupContent).toHaveBeenCalled();
  });

  it("updates the open popup content after the geocode resolves", async () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const geocode = vi.fn(() => Promise.resolve("New Address"));
    const prevFoliplus = (window as any).foliplus;
    (window as any).foliplus = { ...prevFoliplus, reverseGeocode: geocode };
    try {
      const manager = makeManagerMock() as any;
      manager.isEditMode = true;
      const data: MeasureData = {
        id: "m_open",
        type: "marker",
        lng: 121,
        lat: 31,
        address: "Old",
      };
      MarkerMode.restore(manager, data);
      const pin = (window.L.marker as any).mock.results[0].value;
      pin.getPopup = vi.fn(() => ({ isOpen: () => true }));

      pin.on.mock.calls.filter(([ev]: [string]) => ev === "popupopen").at(-1)[1]();
      const onDown = pin.on.mock.calls.find(([ev]: [string]) => ev === "mousedown")?.[1];
      const onMove = manager.map.on.mock.calls.find(
        ([ev]: [string]) => ev === "mousemove",
      )?.[1];
      const onUp = manager.map.on.mock.calls.find(([ev]: [string]) => ev === "mouseup")?.[1];
      onDown({ originalEvent: { clientX: 0, clientY: 0 } });
      onMove({ originalEvent: { clientX: 10, clientY: 0 }, latlng: { lat: 32, lng: 122 } });
      onUp({ originalEvent: { clientX: 10, clientY: 0 }, latlng: { lat: 32, lng: 122 } });
      await flushAsync();
      expect(pin.setPopupContent).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      (window as any).foliplus = prevFoliplus;
    }
  });

  it("cancels a pending RAF persist on cleanup", () => {
    let rafCb: (() => void) | null = null;
    const cancelSpy = vi.fn();
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: () => void) => {
        rafCb = cb;
        return 1;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", cancelSpy);
    try {
      const manager = makeManagerMock() as any;
      manager.isEditMode = true;
      MarkerMode.restore(manager, {
        id: "m_cancel",
        type: "marker",
        lng: 121,
        lat: 31,
        address: "Old",
      });
      const pin = (window.L.marker as any).mock.results[0].value;
      pin.on.mock.calls.filter(([ev]: [string]) => ev === "popupopen").at(-1)[1]();
      const onDown = pin.on.mock.calls.find(([ev]: [string]) => ev === "mousedown")?.[1];
      const onMove = manager.map.on.mock.calls.find(
        ([ev]: [string]) => ev === "mousemove",
      )?.[1];
      onDown({ originalEvent: { clientX: 0, clientY: 0 } });
      onMove({ originalEvent: { clientX: 10, clientY: 0 }, latlng: { lat: 32, lng: 122 } });
      expect(rafCb).toBeTruthy(); // a RAF persist is pending
      manager.finalizedClickHandlers[0]();
      expect(cancelSpy).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("deletes a restored marker via the ✕ handle", () => {
    const manager = makeManagerMock() as any;
    const data: MeasureData = { id: "m_del", type: "marker", lng: 121, lat: 31, address: "Old" };
    manager.measurements = [data];
    MarkerMode.restore(manager, data);

    const del = (window.L.marker as any).mock.results[1].value; // del icon
    const delClickHandler = del.on.mock.calls.find(([ev]: [string]) => ev === "click")?.[1];
    delClickHandler({
      originalEvent: {
        target: { closest: () => ({}) },
        stopPropagation: vi.fn(),
        preventDefault: vi.fn(),
      },
    });
    expect(manager.measurements.length).toBe(0);
    expect(manager.layers.removeLayer).toHaveBeenCalled();
  });

  it("deletes a placed marker via the ✕ handle", () => {
    const manager = makeManagerMock() as any;
    manager.currentMode = CONST.MODE.MARKER;
    const mode = new MarkerMode(manager);
    mode.start();
    const clickHandler = manager.map.on.mock.calls.find(([ev]: [string]) => ev === "click")?.[1];
    clickHandler({ latlng: { lat: 31.2, lng: 121.5 } });

    const del = (window.L.marker as any).mock.results[1].value;
    const delClickHandler = del.on.mock.calls.find(([ev]: [string]) => ev === "click")?.[1];
    delClickHandler({
      originalEvent: {
        target: { closest: () => ({}) },
        stopPropagation: vi.fn(),
        preventDefault: vi.fn(),
      },
    });
    expect(manager.measurements.length).toBe(0);
  });

  it("refreshes placed-marker popup content when the address is set", () => {
    const manager = makeManagerMock() as any;
    manager.currentMode = CONST.MODE.MARKER;
    const mode = new MarkerMode(manager);
    mode.start();
    const clickHandler = manager.map.on.mock.calls.find(([ev]: [string]) => ev === "click")?.[1];
    clickHandler({ latlng: { lat: 31.2, lng: 121.5 } });

    const pin = (window.L.marker as any).mock.results[0].value;
    manager.measurements[0].address = "Resolved";
    const onPopupOpen = pin.on.mock.calls.find(([ev]: [string]) => ev === "popupopen")?.[1];
    onPopupOpen();
    expect(pin.setPopupContent).toHaveBeenCalled();
  });
});
