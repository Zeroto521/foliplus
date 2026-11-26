import { describe, expect, it, vi } from "vitest";
import { setInteractive, suspendMapInteractions } from "#core/layer/index.js";

describe("setInteractive", () => {
  const makeLeaf = (interactive: boolean) => {
    const el = document.createElement("path");
    if (interactive) el.classList.add("leaflet-interactive");
    const leaf = {
      options: { interactive },
      _map: {} as L.Map,
      _path: el,
      _icon: undefined as HTMLElement | undefined,
      _container: undefined as HTMLElement | undefined,
      addInteractiveTarget: vi.fn(),
      removeInteractiveTarget: vi.fn(),
    };
    return { leaf, el };
  };

  it("is a no-op when already at the target value", () => {
    const { leaf, el } = makeLeaf(false);
    setInteractive(leaf as never, false);
    expect(leaf.removeInteractiveTarget).not.toHaveBeenCalled();
    expect(el.classList.contains("leaflet-interactive")).toBe(false);
  });

  it("is a no-op for a detached layer (no _map)", () => {
    const { leaf } = makeLeaf(true);
    delete (leaf as unknown as { _map?: unknown })._map;
    setInteractive(leaf as never, false);
    // The option still flips (applied on next add), but no targets touched.
    expect(leaf.options.interactive).toBe(false);
    expect(leaf.removeInteractiveTarget).not.toHaveBeenCalled();
  });

  it("disabling an SVG path removes the class and unregisters its hit target", () => {
    const { leaf, el } = makeLeaf(true);
    setInteractive(leaf as never, false);
    expect(leaf.options.interactive).toBe(false);
    expect(el.classList.contains("leaflet-interactive")).toBe(false);
    expect(leaf.removeInteractiveTarget).toHaveBeenCalledWith(el);
    expect(leaf.addInteractiveTarget).not.toHaveBeenCalled();
  });

  it("enabling an SVG path re-adds the class and re-registers its hit target", () => {
    const { leaf, el } = makeLeaf(false);
    setInteractive(leaf as never, true);
    expect(leaf.options.interactive).toBe(true);
    expect(el.classList.contains("leaflet-interactive")).toBe(true);
    expect(leaf.addInteractiveTarget).toHaveBeenCalledWith(el);
  });

  it("disabling a marker removes the class and target from its icon", () => {
    const icon = document.createElement("div");
    icon.classList.add("leaflet-interactive");
    const leaf = {
      options: { interactive: true },
      _map: {} as L.Map,
      _path: undefined,
      _icon: icon,
      _container: undefined,
      addInteractiveTarget: vi.fn(),
      removeInteractiveTarget: vi.fn(),
    };
    setInteractive(leaf as never, false);
    expect(icon.classList.contains("leaflet-interactive")).toBe(false);
    expect(leaf.removeInteractiveTarget).toHaveBeenCalledWith(icon);
  });

  it("enabling a marker delegates to its _initInteraction", () => {
    const initInteraction = vi.fn();
    const leaf = {
      options: { interactive: false },
      _map: {} as L.Map,
      _path: undefined,
      _icon: document.createElement("div"),
      _container: undefined,
      _initInteraction: initInteraction,
      addInteractiveTarget: vi.fn(),
      removeInteractiveTarget: vi.fn(),
    };
    setInteractive(leaf as never, true);
    expect(initInteraction).toHaveBeenCalledTimes(1);
    // The icon is handled by _initInteraction — not double-registered here.
    expect(leaf.addInteractiveTarget).not.toHaveBeenCalled();
  });

  it("does not throw for a layer without options", () => {
    const layer = { _map: {} as L.Map };
    expect(() => setInteractive(layer as never, false)).not.toThrow();
  });
});
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
