import { describe, expect, it, vi } from "vitest";
import { suspendMapInteractions } from "#core/interaction/index.js";

describe("suspendMapInteractions", () => {
  /** Map whose eachLayer yields a single top-level group holding `leaf`. */
  const makeMapWithLeaf = (interactive = true) => {
    const el = document.createElement("path");
    if (interactive) el.classList.add("leaflet-interactive");
    const leaf = {
      options: { interactive },
      _path: el,
      _icon: undefined as HTMLElement | undefined,
      _container: undefined as HTMLElement | undefined,
      addInteractiveTarget: vi.fn(),
      removeInteractiveTarget: vi.fn(),
    };
    const map = {
      eachLayer: vi.fn((fn: (l: unknown) => void) =>
        fn({ eachLayer: (c: (l: unknown) => void) => c(leaf) }),
      ),
    };
    (leaf as unknown as { _map: unknown })._map = map;
    return { map, leaf, el };
  };

  it("disables interactive leaves and restores exactly those", () => {
    const { map, leaf, el } = makeMapWithLeaf();
    const restore = suspendMapInteractions(map as never);
    expect(leaf.options.interactive).toBe(false);
    expect(el.classList.contains("leaflet-interactive")).toBe(false);
    expect(leaf.removeInteractiveTarget).toHaveBeenCalledWith(el);

    restore();
    expect(leaf.options.interactive).toBe(true);
    expect(el.classList.contains("leaflet-interactive")).toBe(true);
    expect(leaf.addInteractiveTarget).toHaveBeenCalledWith(el);
  });

  it("leaves already non-interactive leaves untouched", () => {
    const { map, leaf } = makeMapWithLeaf(false);
    const restore = suspendMapInteractions(map as never);
    expect(leaf.options.interactive).toBe(false);
    expect(leaf.removeInteractiveTarget).not.toHaveBeenCalled();
    expect(() => restore()).not.toThrow();
  });

  it("walks top-level groups via map.eachLayer", () => {
    const map = { eachLayer: vi.fn() };
    suspendMapInteractions(map as never);
    expect(map.eachLayer).toHaveBeenCalledTimes(1);
  });
});
