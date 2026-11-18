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
