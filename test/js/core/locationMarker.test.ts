import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLocationMarker } from "#core/locationMarker.js";

describe("createLocationMarker", () => {
  let map;
  // A real anchor so `setPopupCloseTitle` has a target to write to; the
  // adapter is a no-op when _closeButton is null, which is why every other
  // test in this block stubs it to null (the title-setting branch is only
  // exercised by the dedicated test below).
  const closeBtn = document.createElement("a");
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

  it("sets the popup's close button title to the close label", () => {
    // The reach goes through leafletAdapter.setPopupCloseTitle — the only
    // module allowed to touch Leaflet's private surface. The mock returns a
    // real anchor so the reach is exercised; every other test in this block
    // stubs _closeButton to null, which is exactly why this behavior was
    // zero-covered before.
    const marker = {
      bindPopup: vi.fn().mockReturnThis(),
      openPopup: vi.fn(),
      getPopup: () => ({
        _closeButton: closeBtn,
        isOpen: vi.fn(() => false),
      }),
    };
    window.L.marker = vi.fn(() => marker);

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
    );

    expect(closeBtn.title).toBe("Close");
  });

  it("falls back to an empty title when the close label is empty", () => {
    const marker = {
      bindPopup: vi.fn().mockReturnThis(),
      openPopup: vi.fn(),
      getPopup: () => ({
        _closeButton: closeBtn,
        isOpen: vi.fn(() => false),
      }),
    };
    window.L.marker = vi.fn(() => marker);

    createLocationMarker(
      map,
      120,
      30,
      "Address",
      "Title",
      "Loading...",
      "Lng,Lat:",
      "Address:",
      "",
    );

    expect(closeBtn.title).toBe("");
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

  it("leaves the loading placeholder when the popup is closed by the time the lookup resolves", async () => {
    // A slow lookup resolving after the user closed the marker would otherwise
    // overwrite the closed marker's content with the resolved address. The
    // popup must stay closed and keep its loading placeholder.
    const openPopup = vi.fn().mockReturnThis();
    const setPopupContent = vi.fn();
    let open = true;
    const marker = {
      bindPopup: vi.fn().mockReturnThis(),
      openPopup,
      setPopupContent,
      getPopup: () => ({
        _closeButton: null,
        isOpen: () => open,
      }),
    };
    window.L.marker = vi.fn(() => marker);
    const deferred = new Promise<string>(resolve => {
      open = false;
      setTimeout(() => resolve("Resolved Address"), 0);
    });
    window.foliplus.reverseGeocode = vi.fn(() => deferred);

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
    );

    await new Promise(r => setTimeout(r, 10));
    expect(setPopupContent).not.toHaveBeenCalled();
    expect(openPopup).toHaveBeenCalled();
  });

  it("swallows reverseGeocode rejection without surfacing", async () => {
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
    window.foliplus.reverseGeocode = vi.fn(() => Promise.reject(new Error("network")));

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

    await Promise.resolve();
    await Promise.resolve();
    expect(marker.setPopupContent).not.toHaveBeenCalled();
  });
});
