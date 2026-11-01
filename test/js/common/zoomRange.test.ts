import { describe, expect, it, vi } from "vitest";
import {
  HIDDEN_CLASS,
  bindControlZoomRange,
  intersectsMapZoom,
  isZoomRange,
  readZoomRange,
} from "#common/zoomRange.js";

type FakeMap = {
  zoom: number;
  minZoom: number;
  maxZoom: number;
  getZoom: () => number;
  getMinZoom: () => number;
  getMaxZoom: () => number;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  setZoom: (zoom: number) => void;
  emit: () => void;
};

const makeMap = (opts: { zoom?: number; minZoom?: number; maxZoom?: number } = {}) => {
  const handlers = new Set<() => void>();
  const map: FakeMap = {
    zoom: opts.zoom ?? 10,
    minZoom: opts.minZoom ?? 0,
    maxZoom: opts.maxZoom ?? 18,
    getZoom: () => map.zoom,
    getMinZoom: () => map.minZoom,
    getMaxZoom: () => map.maxZoom,
    on: vi.fn((_event: string, handler: () => void) => {
      handlers.add(handler);
    }),
    off: vi.fn((_event: string, handler: () => void) => {
      handlers.delete(handler);
    }),
    setZoom: (zoom: number) => {
      map.zoom = zoom;
      map.emit();
    },
    emit: () => {
      handlers.forEach(handler => handler());
    },
  };
  return map;
};

const makeLogger = () => ({ warn: vi.fn() });

const bind = (
  range: unknown,
  opts: {
    zoom?: number;
    minZoom?: number;
    maxZoom?: number;
  } = {},
) => {
  const map = makeMap(opts);
  const container = document.createElement("div");
  const log = makeLogger();
  const cleanup = bindControlZoomRange({
    map: map as unknown as L.Map,
    container,
    range,
    log,
  });
  return { map, container, log, cleanup };
};

describe("bindControlZoomRange", () => {
  it("shows the control inside the declared range and hides it outside", () => {
    const { map, container } = bind({ min: 8, max: 12 }, { zoom: 10 });

    expect(container.classList.contains(HIDDEN_CLASS)).toBe(false);

    map.setZoom(5);
    expect(container.classList.contains(HIDDEN_CLASS)).toBe(true);

    map.setZoom(8);
    expect(container.classList.contains(HIDDEN_CLASS)).toBe(false);

    map.setZoom(12);
    expect(container.classList.contains(HIDDEN_CLASS)).toBe(false);

    map.setZoom(13);
    expect(container.classList.contains(HIDDEN_CLASS)).toBe(true);
  });

  it("leaves an undeclared control visible without a listener", () => {
    const { container, map, cleanup } = bind(null, { zoom: 10 });

    expect(map.on).not.toHaveBeenCalled();
    expect(container.classList.contains(HIDDEN_CLASS)).toBe(false);
    map.setZoom(18);
    expect(container.classList.contains(HIDDEN_CLASS)).toBe(false);
    expect(() => cleanup()).not.toThrow();
  });

  it("treats a declaration that cannot meet the map as undeclared and warns once", () => {
    // Author [20, 30] on a map capped at 18: no reachable zoom can land
    // inside it. Hiding the control at every level is the permanent
    // disappearance the contract forbids, so it degrades to undeclared.
    const { container, log, map } = bind({ min: 20, max: 30 }, { zoom: 10 });

    expect(container.classList.contains(HIDDEN_CLASS)).toBe(false);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(log.warn.mock.calls[0][0])).toContain("treating it as undeclared");

    map.setZoom(18);
    expect(container.classList.contains(HIDDEN_CLASS)).toBe(false);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("warns once about a malformed payload and stays visible", () => {
    const { container, log, map } = bind({ min: 12, max: 8 }, { zoom: 10 });

    expect(container.classList.contains(HIDDEN_CLASS)).toBe(false);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(log.warn.mock.calls[0][0])).toContain("unusable zoom range");

    map.setZoom(18);
    expect(container.classList.contains(HIDDEN_CLASS)).toBe(false);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("warns once about a non-object payload", () => {
    const { container, log } = bind([8, 12], { zoom: 10 });

    expect(container.classList.contains(HIDDEN_CLASS)).toBe(false);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("honours a declaration that narrows the map without collapsing", () => {
    // [15, 30] on map [0, 18] intersects [15, 18], so it is usable and the
    // author's endpoints are not rewritten: zoom 10 is below the window.
    const { container, log, map } = bind({ min: 15, max: 30 }, { zoom: 10 });

    expect(container.classList.contains(HIDDEN_CLASS)).toBe(true);
    expect(log.warn).not.toHaveBeenCalled();

    map.setZoom(16);
    expect(container.classList.contains(HIDDEN_CLASS)).toBe(false);
  });

  it("re-evaluates when a basemap changes the map's own zoom levels", () => {
    // [20, 30] cannot meet [0, 18] at first, so it is undeclared and the
    // control stays visible. When a basemap widens the map to [20, 30] the
    // declaration becomes usable without a zoomend, so the zoomlevelschange
    // path must hide the control at the current level 10.
    const { container, log, map } = bind({ min: 20, max: 30 }, { zoom: 10 });
    expect(container.classList.contains(HIDDEN_CLASS)).toBe(false);
    expect(log.warn).toHaveBeenCalledTimes(1);

    map.minZoom = 20;
    map.maxZoom = 30;
    map.emit();

    expect(container.classList.contains(HIDDEN_CLASS)).toBe(true);
  });

  it("detaches its zoomend listener on cleanup", () => {
    const { map, container, cleanup } = bind({ min: 8, max: 12 }, { zoom: 10 });
    (map.off as ReturnType<typeof vi.fn>).mockClear();

    cleanup();

    expect(map.off).toHaveBeenCalledWith("zoomend", expect.any(Function));
    expect(map.off).toHaveBeenCalledWith("zoomlevelschange", expect.any(Function));
    container.classList.remove(HIDDEN_CLASS);
    map.setZoom(1);
    expect(container.classList.contains(HIDDEN_CLASS)).toBe(false);
  });
});

describe("readZoomRange", () => {
  it("narrows a valid payload to the shared shape", () => {
    const warn = vi.fn();
    const warned = { payload: false };

    expect(readZoomRange({ min: 8, max: 12 }, { warn }, warned)).toEqual({
      min: 8,
      max: 12,
    });
    expect(warned.payload).toBe(false);
  });

  it("returns undefined for an absent declaration without warning", () => {
    const warn = vi.fn();

    expect(readZoomRange(null, { warn }, { payload: false })).toBeUndefined();
    expect(readZoomRange(undefined, { warn }, { payload: false })).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("rejects non-finite and inverted bounds", () => {
    const warn = vi.fn();
    const logger = { warn };

    expect(
      readZoomRange({ min: Number.NaN, max: 12 }, logger, { payload: false }),
    ).toBeUndefined();
    expect(
      readZoomRange({ min: 12, max: Number.POSITIVE_INFINITY }, logger, {
        payload: false,
      }),
    ).toBeUndefined();
    expect(
      readZoomRange({ min: 12, max: 8 }, logger, { payload: false }),
    ).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("rejects fractional bounds, matching the Python integer contract", () => {
    const warn = vi.fn();
    const logger = { warn };

    expect(
      readZoomRange({ min: 8.5, max: 12 }, logger, { payload: false }),
    ).toBeUndefined();
    expect(
      readZoomRange({ min: 8, max: 12.5 }, logger, { payload: false }),
    ).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("warns once per mount about repeated malformed payloads", () => {
    const warn = vi.fn();
    const warned = { payload: false };

    expect(readZoomRange({ min: 12, max: 8 }, { warn }, warned)).toBeUndefined();
    expect(readZoomRange({ min: 12, max: 8 }, { warn }, warned)).toBeUndefined();
    expect(readZoomRange("not a range", { warn }, warned)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warned.payload).toBe(true);
  });
});

describe("isZoomRange", () => {
  it("accepts an ordered integer range", () => {
    expect(isZoomRange({ min: 8, max: 12 })).toBe(true);
    expect(isZoomRange({ min: 8, max: 8 })).toBe(true);
    expect(isZoomRange({ min: -2, max: 0 })).toBe(true);
  });

  it("rejects anything that is not an ordered integer range", () => {
    expect(isZoomRange(null)).toBe(false);
    expect(isZoomRange(undefined)).toBe(false);
    expect(isZoomRange([8, 12])).toBe(false);
    expect(isZoomRange("8-12")).toBe(false);
    expect(isZoomRange({ min: 12, max: 8 })).toBe(false);
    expect(isZoomRange({ min: 8.5, max: 12 })).toBe(false);
    expect(isZoomRange({ min: 8 })).toBe(false);
    expect(isZoomRange({ min: Number.NaN, max: 12 })).toBe(false);
  });
});

describe("intersectsMapZoom", () => {
  it("judges finite rails by overlap", () => {
    expect(intersectsMapZoom({ min: 8, max: 12 }, 0, 18)).toBe(true);
    expect(intersectsMapZoom({ min: 20, max: 30 }, 0, 18)).toBe(false);
    expect(intersectsMapZoom({ min: -10, max: -5 }, 0, 18)).toBe(false);
    expect(intersectsMapZoom({ min: 18, max: 30 }, 0, 18)).toBe(true);
  });

  it("never rules a range out against an open rail", () => {
    expect(intersectsMapZoom({ min: 20, max: 30 }, 0, Number.POSITIVE_INFINITY)).toBe(
      true,
    );
    expect(intersectsMapZoom({ min: 20, max: 30 }, Number.NEGATIVE_INFINITY, 18)).toBe(
      true,
    );
  });
});
