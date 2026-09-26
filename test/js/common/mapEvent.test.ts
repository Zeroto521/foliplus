import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Map as LeafletMap } from "leaflet";
import { bindMapEvents, unbindMapEvents } from "#common/mapEvent.js";

describe("mapEvents", () => {
  let map: LeafletMap;

  beforeEach(() => {
    map = { on: vi.fn(), off: vi.fn() } as unknown as LeafletMap;
  });

  it("binds each [event, handler] pair", () => {
    const a = vi.fn();
    const b = vi.fn();
    bindMapEvents(map, [
      ["click", a],
      ["move", b],
    ]);
    expect(map.on).toHaveBeenCalledWith("click", a);
    expect(map.on).toHaveBeenCalledWith("move", b);
    expect(map.on).toHaveBeenCalledTimes(2);
  });

  it("unbinds each [event, handler] pair", () => {
    const a = vi.fn();
    unbindMapEvents(map, [
      ["click", a],
      ["move", a],
    ]);
    expect(map.off).toHaveBeenCalledWith("click", a);
    expect(map.off).toHaveBeenCalledWith("move", a);
    expect(map.off).toHaveBeenCalledTimes(2);
  });
});
