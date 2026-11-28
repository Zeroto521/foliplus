import { describe, expect, it, vi } from "vitest";
import { type RejectFn, readDeclaredKey } from "#control/LayerControl/declaredKey.js";

/** A linked carrier carrying a foliplus declaration. Fresh object per test:
 *  the reader caches per layer object, the way a folium layer's options are
 *  final once it exists. */
const layerWith = (foliplus: unknown) => ({ options: { foliplus } }) as never;

describe("readDeclaredKey", () => {
  it("reads the raw value and caches per (layer, declared-key)", () => {
    const layer = layerWith({ fill: { field: "a" } });
    const parse = vi.fn((raw: unknown) => ({ declared: raw, invalid: [] }));
    const first = readDeclaredKey(layer, "overlay1", "fill", parse);
    const second = readDeclaredKey(layer, "overlay1", "fill", parse);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("caches each declared key independently on the same layer", () => {
    const layer = layerWith({ fill: { field: "a" }, icon: { symbol: "x" } });
    const fillParse = vi.fn((raw: unknown) => ({ declared: raw, invalid: [] }));
    const iconParse = vi.fn((raw: unknown) => ({ declared: raw, invalid: [] }));
    readDeclaredKey(layer, "overlay1", "fill", fillParse);
    readDeclaredKey(layer, "overlay1", "icon", iconParse);
    readDeclaredKey(layer, "overlay1", "fill", fillParse);
    readDeclaredKey(layer, "overlay1", "icon", iconParse);
    expect(fillParse).toHaveBeenCalledTimes(1);
    expect(iconParse).toHaveBeenCalledTimes(1);
  });

  it("warns once per (declared-key, layer, key)", () => {
    const layer = layerWith({ fill: { field: "a", bogus: 1 } });
    const warn = vi.fn();
    const parse = vi.fn(
      (raw: unknown, layerId: string | undefined, reject: RejectFn) => {
        const invalid: string[] = [];
        const rejectKey = (key: string, message: string): void => {
          invalid.push(message);
          reject(
            `${layerId ?? ""}:${key}`,
            `declared fill: ignoring ${message} on layer "${layerId ?? "<unregistered>"}"`,
          );
        };
        rejectKey("bogus", "an unknown fill key");
        rejectKey("bogus", "an unknown fill key");
        return { invalid };
      },
    );
    const read = readDeclaredKey(layer, "overlay1", "fill", parse, warn);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(read.invalid).toHaveLength(2);
  });

  it("warns once per key on each of two layers (dedupe is per layer, not process-wide)", () => {
    const warn = vi.fn();
    const parse = (_raw: unknown, layerId: string | undefined, reject: RejectFn) => {
      reject(
        `${layerId ?? ""}:bogus`,
        `declared fill: ignoring a bad key on layer "${layerId}"`,
      );
      return { invalid: [] };
    };
    readDeclaredKey(layerWith({ fill: {} }), "overlay1", "fill", parse, warn);
    readDeclaredKey(layerWith({ fill: {} }), "overlay2", "fill", parse, warn);
    expect(warn).toHaveBeenCalledTimes(2);
    const messages = warn.mock.calls.map(call => String(call[0]));
    expect(messages[0]).toContain("overlay1");
    expect(messages[1]).toContain("overlay2");
  });

  it("warns once for the same rejected key however often the layer is read", () => {
    const warn = vi.fn();
    const layer = layerWith({ fill: {} });
    const parse = (_raw: unknown, layerId: string | undefined, reject: RejectFn) => {
      reject(`${layerId ?? ""}:bogus`, "declared fill: ignoring a bad key");
      return { invalid: [] };
    };
    readDeclaredKey(layer, "overlay1", "fill", parse, warn);
    readDeclaredKey(layer, "overlay1", "fill", parse, warn);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not cache a null layer read (declaration may arrive later)", () => {
    const parse = vi.fn((_raw: unknown) => ({ invalid: [] }));
    const first = readDeclaredKey(null, "overlay1", "fill", parse);
    const second = readDeclaredKey(null, "overlay1", "fill", parse);
    expect(parse).not.toHaveBeenCalled();
    expect(first).toEqual({ invalid: [] });
    expect(second).toEqual({ invalid: [] });
  });

  it("reads nothing for an absent declared key (still cached)", () => {
    const layer = layerWith({ fill: { field: "a" } });
    const parse = vi.fn((_raw: unknown) => ({ invalid: [] }));
    const read = readDeclaredKey(layer, "overlay1", "border", parse);
    expect(parse).toHaveBeenCalledWith(undefined, "overlay1", expect.any(Function));
    expect(read).toEqual({ invalid: [] });
  });
});

describe("readDeclaredKey — the folium-rendered camelCase spelling", () => {
  // folium's renderer camelizes every option key at render time, so the
  // namespace a real map carries spells a multi-word key as `iconSize`, not
  // `icon_size`. These are the death tests for that channel: a reader that
  // only looks up the snake_case name reads nothing on a rendered map.
  it("reads a multi-word key folium spelled in lowerCamelCase", () => {
    const layer = layerWith({ iconSize: 50 });
    const parse = vi.fn((raw: unknown) => ({ declared: raw, invalid: [] }));
    const read = readDeclaredKey(layer, "overlay1", "icon_size", parse);
    expect(read.declared).toBe(50);
  });

  it("prefers the snake_case spelling when both are declared", () => {
    const layer = layerWith({ icon_size: 50, iconSize: 36 });
    const parse = vi.fn((raw: unknown) => ({ declared: raw, invalid: [] }));
    const read = readDeclaredKey(layer, "overlay1", "icon_size", parse);
    expect(read.declared).toBe(50);
  });

  it("reads nothing when neither spelling is declared", () => {
    const layer = layerWith({ icon: { symbol: "x" } });
    const parse = vi.fn((_raw: unknown) => ({ invalid: [] }));
    const read = readDeclaredKey(layer, "overlay1", "icon_size", parse);
    expect(parse).toHaveBeenCalledWith(undefined, "overlay1", expect.any(Function));
    expect(read).toEqual({ invalid: [] });
  });

  it("caches the camelCase read like any other (no re-parse)", () => {
    const layer = layerWith({ markerColor: "blue" });
    const parse = vi.fn((raw: unknown) => ({ declared: raw, invalid: [] }));
    readDeclaredKey(layer, "overlay1", "marker_color", parse);
    readDeclaredKey(layer, "overlay1", "marker_color", parse);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenLastCalledWith("blue", "overlay1", expect.any(Function));
  });
});
