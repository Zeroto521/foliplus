import type { Map as LeafletMap } from "leaflet";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLocationMarker } from "#core/geo/index.js";
import { reverseGeocode } from "#core/geocode/index.js";

vi.mock("#core/geocode/geocoder.js", () => ({
  reverseGeocode: vi.fn(),
}));

describe("createLocationMarker", () => {
  let map: LeafletMap;
  // Every test stubs _closeButton to null; the two title-setting tests below
  // create their own real anchor so the adapter reach is exercised.
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
    vi.mocked(reverseGeocode).mockReset();
    map = {
      removeLayer: vi.fn(),
      addLayer: vi.fn(),
      // The continuation's liveness gate: a fresh marker is on its map.
      // Tests that exercise removal flip this back off.
      hasLayer: vi.fn(() => true),
    } as unknown as LeafletMap;
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
    const closeBtn = document.createElement("a");
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

  it("falls back to an empty title when the close label is undefined", () => {
    // Passing undefined (not "") distinguishes the two implementations:
    // without the || "" fallback, DOM coerces undefined to "undefined".
    const closeBtn = document.createElement("a");
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
      undefined as unknown as string,
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
      undefined,
      undefined,
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
    vi.mocked(reverseGeocode).mockReturnValue(Promise.resolve("Resolved Address"));
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
    vi.mocked(reverseGeocode).mockReturnValue(Promise.reject(new Error("offline")));
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
    vi.mocked(reverseGeocode).mockReturnValue(deferred);

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
    vi.mocked(reverseGeocode).mockReturnValue(Promise.reject(new Error("network")));

    const result = createLocationMarker(
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
    expect(result).toBe(marker);

    await Promise.resolve();
    await Promise.resolve();
    expect(reverseGeocode).toHaveBeenCalled();
    expect(marker.setPopupContent).not.toHaveBeenCalled();
  });

  /** A marker stub whose popup is open, plus a map whose hasLayer flips with
   *  the returned setter — the liveness fact the continuation must consult. */
  const pendingAddress = () => {
    const marker = {
      bindPopup: vi.fn().mockReturnThis(),
      openPopup: vi.fn(),
      setPopupContent: vi.fn(),
      getPopup: () => ({ _closeButton: null, isOpen: vi.fn(() => true) }),
    };
    window.L.marker = vi.fn(() => marker);
    let release: (addr: string) => void = () => {};
    vi.mocked(reverseGeocode).mockReturnValue(
      new Promise<string>(resolve => {
        release = resolve;
      }),
    );
    let live = true;
    (map as unknown as { hasLayer: (m: unknown) => boolean }).hasLayer = vi.fn(
      () => live,
    );
    return {
      marker,
      release: async (addr: string) => {
        release(addr);
        await Promise.resolve();
        await Promise.resolve();
      },
      detach: () => {
        live = false;
      },
      attach: () => {
        live = true;
      },
    };
  };

  it("drops a resolved address for a pin that is no longer on the map", async () => {
    // The lookup outlives the click that asked for it the way a geolocation
    // permission prompt does. Removing the pin is the liveness fact: a marker
    // that is not on the map has no owner left to repaint — the control was
    // destroyed (destroy() -> removeMarker()) or the pin was replaced — so the
    // address is dropped before it reaches onAddress.
    const { marker, release, detach } = pendingAddress();
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
      false,
    );

    detach();
    await release("Resolved Address");

    expect(
      onAddress,
      "a late address must not reach a marker nobody owns",
    ).not.toHaveBeenCalled();
    expect(marker.setPopupContent).not.toHaveBeenCalled();
  });

  it("still repaints the popup while the pin is on the map", async () => {
    // The gate is liveness, not a blanket drop: a marker that is still on the
    // map must receive its resolved address.
    const { marker, release } = pendingAddress();
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
      false,
    );

    await release("Resolved Address");

    expect(onAddress).toHaveBeenCalledWith("Resolved Address");
    expect(marker.setPopupContent).toHaveBeenCalled();
  });
});
