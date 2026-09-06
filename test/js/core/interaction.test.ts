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

// Mock map object with no foliplus namespace — triggers the `if (!map.foliplus)` branch
function makeBareMap(): any {
  const map: any = {
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

  it("element-level ctrl modifier requires ctrlKey or metaKey", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const el = document.createElement("input");
    const handler = vi.fn();

    ensureInteraction(map).register("Test", [
      { key: "z", ctrl: true, element: el, handler },
    ]);

    el.dispatchEvent(new KeyboardEvent("keydown", { key: "z", bubbles: true }));

    expect(handler).not.toHaveBeenCalled();

    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }),
    );

    expect(handler).toHaveBeenCalledTimes(1);

    ensureInteraction(map).unregister("Test");
  });

  it("element-level meta modifier requires metaKey", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const el = document.createElement("input");
    const handler = vi.fn();

    ensureInteraction(map).register("Test", [
      { key: "z", meta: true, element: el, handler },
    ]);

    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }),
    );

    expect(handler).not.toHaveBeenCalled();

    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }),
    );

    expect(handler).toHaveBeenCalledTimes(1);

    ensureInteraction(map).unregister("Test");
  });

  it("element-level shift modifier requires shiftKey", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const el = document.createElement("input");
    const handler = vi.fn();

    ensureInteraction(map).register("Test", [
      { key: "z", shift: true, element: el, handler },
    ]);

    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }),
    );

    expect(handler).not.toHaveBeenCalled();

    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", shiftKey: true, bubbles: true }),
    );

    expect(handler).toHaveBeenCalledTimes(1);

    ensureInteraction(map).unregister("Test");
  });

  it("element-level alt modifier requires altKey", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const el = document.createElement("input");
    const handler = vi.fn();

    ensureInteraction(map).register("Test", [
      { key: "z", alt: true, element: el, handler },
    ]);

    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }),
    );

    expect(handler).not.toHaveBeenCalled();

    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", altKey: true, bubbles: true }),
    );

    expect(handler).toHaveBeenCalledTimes(1);

    ensureInteraction(map).unregister("Test");
  });

  it("register third-arg container applies default container to unscoped defs", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const defaultContainer = document.createElement("div");

    document.body.appendChild(defaultContainer);
    const input = document.createElement("input");

    defaultContainer.appendChild(input);
    const ownContainer = document.createElement("div");

    document.body.appendChild(ownContainer);

    const scopedHandler = vi.fn();
    const unscopedHandler = vi.fn();

    ensureInteraction(map).register(
      "Test",
      [
        // Has its own container — default should NOT override
        { key: "a", container: ownContainer, handler: scopedHandler },
        // No container — default should apply
        { key: "b", handler: unscopedHandler },
      ],
      defaultContainer,
    );

    // Focus in defaultContainer — only "b" (default-container-bound) fires
    input.focus();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true }));

    expect(unscopedHandler).toHaveBeenCalledTimes(1);

    expect(scopedHandler).not.toHaveBeenCalled();

    ensureInteraction(map).unregister("Test");

    document.body.removeChild(defaultContainer);

    document.body.removeChild(ownContainer);
  });

  it("depth sort: container shortcut wins over non-container shortcut", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const container = document.createElement("div");

    document.body.appendChild(container);
    const input = document.createElement("input");

    container.appendChild(input);

    const noContainerHandler = vi.fn();
    const containerHandler = vi.fn();

    ensureInteraction(map).register("NoContainer", [
      { key: "Escape", handler: noContainerHandler },
    ]);

    ensureInteraction(map).register("Container", [
      { key: "Escape", container, handler: containerHandler },
    ]);

    input.focus();

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(containerHandler).toHaveBeenCalledTimes(1);

    expect(noContainerHandler).not.toHaveBeenCalled();

    ensureInteraction(map).unregister("NoContainer");

    ensureInteraction(map).unregister("Container");

    document.body.removeChild(container);
  });

  it("container-bound shortcuts: non-container shortcut fires when focus is outside", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const container = document.createElement("div");

    document.body.appendChild(container);

    const noContainerHandler = vi.fn();
    const containerHandler = vi.fn();

    ensureInteraction(map).register("NoContainer", [
      { key: "Escape", handler: noContainerHandler },
    ]);

    ensureInteraction(map).register("Container", [
      { key: "Escape", container, handler: containerHandler },
    ]);

    // Focus outside any container — only the non-container global fires
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(noContainerHandler).toHaveBeenCalledTimes(1);

    expect(containerHandler).not.toHaveBeenCalled();

    ensureInteraction(map).unregister("NoContainer");

    ensureInteraction(map).unregister("Container");

    document.body.removeChild(container);
  });

  it("MutationObserver: non-HTMLElement removed node is skipped", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const wrapper = document.createElement("div");

    document.body.appendChild(wrapper);
    const el = document.createElement("input");

    wrapper.appendChild(el);

    const handler = vi.fn();

    ensureInteraction(map).register("Test", [{ key: "Enter", element: el, handler }]);

    // Remove a text node (not HTMLElement) — should not affect tracked elements
    const textNode = document.createTextNode("hi");

    wrapper.appendChild(textNode);

    wrapper.removeChild(textNode);

    // Original element still works after non-HTMLElement removal
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(handler).toHaveBeenCalledTimes(1);

    ensureInteraction(map).unregister("Test");

    document.body.removeChild(wrapper);
  });

  it("initialize map.foliplus namespace if missing", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeBareMap();

    expect(map.foliplus).toBeUndefined();

    ensureInteraction(map);

    expect(map.foliplus).toBeDefined();

    expect(map.foliplus.interaction).toBeDefined();
  });

  it("non-container shortcut fires when focus is outside any container (tied priority)", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const container = document.createElement("div");

    container.tabIndex = 0;

    document.body.appendChild(container);

    const docHandler = vi.fn();
    const containerHandler = vi.fn();

    // Both registered — container shortcut is more specific
    ensureInteraction(map).register("DocFallback", [
      { key: "Escape", handler: docHandler },
    ]);

    ensureInteraction(map).register("Scoped", [
      { key: "Escape", container, handler: containerHandler },
    ]);

    // Focus OUTSIDE any container — doc-level fallback wins
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(docHandler).toHaveBeenCalledTimes(1);

    expect(containerHandler).not.toHaveBeenCalled();

    ensureInteraction(map).unregister("DocFallback");

    ensureInteraction(map).unregister("Scoped");

    document.body.removeChild(container);
  });

  it("destroy clears all shortcuts and listeners", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const im = ensureInteraction(map);

    im.register("BeforeDestroy", [
      { key: "Escape", handler: vi.fn() },
      { key: "Enter", handler: vi.fn() },
    ]);

    expect(im["shortcuts"]).toHaveLength(2);

    im.destroy();

    // shortcuts cleared
    expect(im["shortcuts"]).toHaveLength(0);

    // doc listeners removed
    expect(im["docListeners"].size).toBe(0);
  });

  it("clear() removes element-bound listeners when shortcuts include element bindings", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const im = ensureInteraction(map);
    const el = document.createElement("input");
    const handler = vi.fn();

    im.register("El", [{ key: "Enter", element: el, handler }]);

    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(handler).toHaveBeenCalledTimes(1);

    im.clear();

    expect(im["shortcuts"]).toHaveLength(0);

    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("reverse container depth sort: container-registered-first does not win over doc shortcut", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const container = document.createElement("div");

    document.body.appendChild(container);
    const input = document.createElement("input");

    container.appendChild(input);

    // Register container-bound shortcut BEFORE document-level — the reverse
    // sort branch (!a.container && b.container) must still keep doc shortcut
    // in lower priority position
    const containerHandler = vi.fn();
    const docHandler = vi.fn();

    ensureInteraction(map).register("ContainerFirst", [
      { key: "Escape", container, handler: containerHandler },
    ]);

    ensureInteraction(map).register("DocSecond", [
      { key: "Escape", handler: docHandler },
    ]);

    input.focus();

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(containerHandler).toHaveBeenCalledTimes(1);

    expect(docHandler).not.toHaveBeenCalled();

    ensureInteraction(map).unregister("ContainerFirst");

    ensureInteraction(map).unregister("DocSecond");

    document.body.removeChild(container);
  });

  it("same-priority document-level shortcuts: last-registered wins (later registration takes priority)", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    ensureInteraction(map).register("First", [
      { key: "Enter", priority: 0, handler: handler1 },
    ]);

    ensureInteraction(map).register("Second", [
      { key: "Enter", priority: 0, handler: handler2 },
    ]);

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    // Last-registered (handler2) wins — matches z-order / DOM overlay intuition
    expect(handler2).toHaveBeenCalledTimes(1);

    expect(handler1).not.toHaveBeenCalled();

    ensureInteraction(map).unregister("First");

    ensureInteraction(map).unregister("Second");
  });

  it("last-registered shortcut wins even when priorities differ only by 0", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const handler3 = vi.fn();

    // Register three shortcuts for the same key — only the last one should fire
    ensureInteraction(map).register("A", [{ key: "Escape", handler: handler1 }]);

    ensureInteraction(map).register("B", [{ key: "Escape", handler: handler2 }]);

    ensureInteraction(map).register("C", [{ key: "Escape", handler: handler3 }]);

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(handler3).toHaveBeenCalledTimes(1);

    expect(handler1).not.toHaveBeenCalled();

    expect(handler2).not.toHaveBeenCalled();

    ensureInteraction(map).unregister("A");

    ensureInteraction(map).unregister("B");

    ensureInteraction(map).unregister("C");
  });

  it("destroy also works when map.foliplus was not pre-existing", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeBareMap();
    const im = ensureInteraction(map);

    im.destroy();

    // Should not throw; shortcuts should be empty
    expect(im["shortcuts"]).toHaveLength(0);
  });

  it("handleEvent filters document-level shortcuts by ctrl/meta/shift modifiers", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const handler = vi.fn();

    // Register a ctrl modifier shortcut at the document level — handleEvent
    // (not element listener) processes the modifier guards
    ensureInteraction(map).register("CtrlMod", [{ key: "z", ctrl: true, handler }]);

    // Fire z without ctrlKey — should NOT match (s.ctrl && !ke.ctrlKey && !ke.metaKey returns false)
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "z", bubbles: true }));

    expect(handler).not.toHaveBeenCalled();

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }),
    );

    expect(handler).toHaveBeenCalledTimes(1);

    ensureInteraction(map).unregister("CtrlMod");
  });

  it("handleEvent filters document-level meta modifier", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const handler = vi.fn();

    ensureInteraction(map).register("MetaMod", [{ key: "z", meta: true, handler }]);

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }),
    );

    expect(handler).not.toHaveBeenCalled();

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }),
    );

    expect(handler).toHaveBeenCalledTimes(1);

    ensureInteraction(map).unregister("MetaMod");
  });

  it("handleEvent filters document-level shift modifier", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const handler = vi.fn();

    ensureInteraction(map).register("ShiftMod", [{ key: "z", shift: true, handler }]);

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }),
    );

    expect(handler).not.toHaveBeenCalled();

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", shiftKey: true, bubbles: true }),
    );

    expect(handler).toHaveBeenCalledTimes(1);

    ensureInteraction(map).unregister("ShiftMod");
  });

  it("handleEvent filters document-level alt modifier", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const handler = vi.fn();

    ensureInteraction(map).register("AltMod", [{ key: "z", alt: true, handler }]);

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }),
    );

    expect(handler).not.toHaveBeenCalled();

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", altKey: true, bubbles: true }),
    );

    expect(handler).toHaveBeenCalledTimes(1);

    ensureInteraction(map).unregister("AltMod");
  });

  it("handleEvent dispatches to only the highest-priority matching shortcut", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const container = document.createElement("div");

    container.tabIndex = 0;

    document.body.appendChild(container);

    const handler1 = vi.fn();
    const handler2 = vi.fn();

    // Register two document-level shortcuts for the same key, different priorities
    ensureInteraction(map).register("Low", [
      { key: "Enter", priority: 0, handler: handler1 },
    ]);

    ensureInteraction(map).register("High", [
      { key: "Enter", priority: 5, handler: handler2 },
    ]);

    container.focus();

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    expect(handler2).toHaveBeenCalledTimes(1);

    expect(handler1).not.toHaveBeenCalled();

    ensureInteraction(map).unregister("Low");

    ensureInteraction(map).unregister("High");

    document.body.removeChild(container);
  });

  it("handleEvent filters by event type (keydown vs mouse)", async () => {
    const { ensureInteraction } = await import("#core/interaction.js");
    const map = makeMap();
    const container = document.createElement("div");

    container.tabIndex = 0;

    document.body.appendChild(container);

    const keyHandler = vi.fn();
    const mouseHandler = vi.fn();

    ensureInteraction(map).register("Key", [
      { event: "keydown", key: "Enter", container, handler: keyHandler },
    ]);

    ensureInteraction(map).register("Mouse", [
      { event: "mousedown", container, handler: mouseHandler },
    ]);

    container.focus();

    // Dispatch keydown — only keydown handler fires
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    expect(keyHandler).toHaveBeenCalledTimes(1);

    expect(mouseHandler).not.toHaveBeenCalled();

    // Dispatch mousedown — only mouse handler fires
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(keyHandler).toHaveBeenCalledTimes(1);

    expect(mouseHandler).toHaveBeenCalledTimes(1);

    ensureInteraction(map).unregister("Key");

    ensureInteraction(map).unregister("Mouse");

    document.body.removeChild(container);
  });
});
