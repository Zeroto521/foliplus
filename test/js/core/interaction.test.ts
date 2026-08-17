import { describe, expect, it, vi } from "vitest";

// Mock map object
function makeMap(): any {
  const map: any = {
    foliplus: {},
    on: vi.fn(),
    off: vi.fn(),
    getContainer: vi.fn(() => document.createElement("div")),
  };
  return map;
}

describe("InteractionManager", () => {
  it("register returns a cleanup function", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const cleanup = ensureInteraction(map).register("Test", [
      { key: "Escape", handler: vi.fn() },
    ]);
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("element-level shortcut fires on matching keydown", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const el = document.createElement("input");
    const handler = vi.fn();
    ensureInteraction(map).register("Test", [
      { key: "Enter", element: el, handler },
    ]);
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);
    ensureInteraction(map).unregister("Test");
  });

  it("element-level shortcut does not fire on non-matching key", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const el = document.createElement("input");
    const handler = vi.fn();
    ensureInteraction(map).register("Test", [
      { key: "Escape", element: el, handler },
    ]);
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(handler).not.toHaveBeenCalled();
    ensureInteraction(map).unregister("Test");
  });

  it("once option auto-removes after first trigger", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const el = document.createElement("input");
    const handler = vi.fn();
    ensureInteraction(map).register("Test", [
      { key: "Enter", element: el, once: true, handler },
    ]);
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);
    ensureInteraction(map).unregister("Test");
  });

  it("unregister removes all shortcuts for a component", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const el = document.createElement("input");
    const handler = vi.fn();
    ensureInteraction(map).register("Test", [
      { key: "Escape", element: el, handler },
    ]);
    ensureInteraction(map).unregister("Test");
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(handler).not.toHaveBeenCalled();
  });

  it("supports mouse events via event field", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const el = document.createElement("div");
    const handler = vi.fn();
    ensureInteraction(map).register("Test", [
      { event: "mousedown", element: el, handler },
    ]);
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);
    ensureInteraction(map).unregister("Test");
  });

  it("container option filters by focus", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const inner = document.createElement("input");
    container.appendChild(inner);
    const handler = vi.fn();
    ensureInteraction(map).register("Test", [
      { key: "Escape", container, handler },
    ]);
    // Without focus in container — should not fire
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(handler).not.toHaveBeenCalled();
    // With focus in container — should fire
    inner.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);
    ensureInteraction(map).unregister("Test");
    document.body.removeChild(container);
  });
});
