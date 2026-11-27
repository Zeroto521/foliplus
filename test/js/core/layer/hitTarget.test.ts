import { describe, expect, it, vi } from "vitest";
import hitTargetSource from "#core/layer/hitTarget?raw";
import { setInteractive } from "#core/layer/index.js";

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

// What is worth pinning here is the other half: nothing in this module touches
// a private field through a double assertion any more.
describe("source pins", () => {
  it("layer/hitTarget.ts: no double assertions left", () => {
    expect(hitTargetSource.match(/as unknown as/g)).toBeNull();
  });
});
