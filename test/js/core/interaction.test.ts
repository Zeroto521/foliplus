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
    ensureInteraction(map).register("Test", [{ key: "Enter", element: el, handler }]);
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);
    ensureInteraction(map).unregister("Test");
  });

  it("element-level shortcut does not fire on non-matching key", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const el = document.createElement("input");
    const handler = vi.fn();
    ensureInteraction(map).register("Test", [{ key: "Escape", element: el, handler }]);
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
    ensureInteraction(map).register("Test", [{ key: "Escape", element: el, handler }]);
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
    // Unregister must remove the correct event type, not just "keydown"
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("container option filters by focus", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const inner = document.createElement("input");
    container.appendChild(inner);
    const handler = vi.fn();
    ensureInteraction(map).register("Test", [{ key: "Escape", container, handler }]);
    // Without focus in container — should not fire
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(handler).not.toHaveBeenCalled();
    // With focus in container — should fire
    inner.focus();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(handler).toHaveBeenCalledTimes(1);
    ensureInteraction(map).unregister("Test");
    document.body.removeChild(container);
  });

  it("tied-priority: container shortcut wins over pure document shortcut", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const input = document.createElement("input");
    container.appendChild(input);

    const docHandler = vi.fn();
    const containerHandler = vi.fn();
    // Pure document shortcut (no container) — acts as a global fallback
    ensureInteraction(map).register("DocFallback", [
      { key: "Escape", handler: docHandler },
    ]);
    // Container-bound shortcut — specific to focused area
    ensureInteraction(map).register("Focused", [
      { key: "Escape", container, handler: containerHandler },
    ]);

    input.focus();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(containerHandler).toHaveBeenCalledTimes(1);
    expect(docHandler).not.toHaveBeenCalled();

    ensureInteraction(map).unregister("DocFallback");
    ensureInteraction(map).unregister("Focused");
    document.body.removeChild(container);
  });

  it("tied-priority container shortcuts: innermost container wins", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const outer = document.createElement("div");
    document.body.appendChild(outer);
    const inner = document.createElement("div");
    outer.appendChild(inner);
    const input = document.createElement("input");
    inner.appendChild(input);

    const outerHandler = vi.fn();
    const innerHandler = vi.fn();
    ensureInteraction(map).register("Outer", [
      { key: "Enter", container: outer, handler: outerHandler },
    ]);
    ensureInteraction(map).register("Inner", [
      { key: "Enter", container: inner, handler: innerHandler },
    ]);

    input.focus();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(innerHandler).toHaveBeenCalledTimes(1);
    expect(outerHandler).not.toHaveBeenCalled();

    ensureInteraction(map).unregister("Outer");
    ensureInteraction(map).unregister("Inner");
    document.body.removeChild(outer);
  });

  it("explicit priority overrides container depth tie-breaking", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const outer = document.createElement("div");
    document.body.appendChild(outer);
    const inner = document.createElement("div");
    outer.appendChild(inner);
    const input = document.createElement("input");
    inner.appendChild(input);

    // Inner container (deeper) but priority=0
    const innerHandler = vi.fn();
    ensureInteraction(map).register("Inner", [
      { key: "Enter", container: inner, priority: 0, handler: innerHandler },
    ]);
    // Outer container (shallower) but priority=1 — should win regardless of depth
    const outerHandler = vi.fn();
    ensureInteraction(map).register("Outer", [
      { key: "Enter", container: outer, priority: 1, handler: outerHandler },
    ]);

    input.focus();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(outerHandler).toHaveBeenCalledTimes(1);
    expect(innerHandler).not.toHaveBeenCalled();

    ensureInteraction(map).unregister("Inner");
    ensureInteraction(map).unregister("Outer");
    document.body.removeChild(outer);
  });
});
