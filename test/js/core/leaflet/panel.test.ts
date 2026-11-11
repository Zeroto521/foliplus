import { repoPath } from "#test/path.js";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ROW_PANEL_EDGE,
  ROW_PANEL_MIN_HEIGHT,
  adjustPanelZIndex,
  bindFoldToggle,
  bindMapSync,
  bindOutsideCollapse,
  bindPanelToggle,
  createFoldControl,
  createPanelControl,
  createPanelHeader,
  createRowPanel,
  pinRowPanel,
  unpinRowPanel,
} from "#core/leaflet/index.js";
import { registerPortalRoot } from "#platform/portalRoot.js";
import { computePlacement } from "#ui/index.js";

// setup.js provides L.DomEvent mocks (disableClickPropagation, etc.),
// but panel.js also needs on/off/stop — stub them here.
const domEvent = window.L.DomEvent;
beforeEach(() => {
  // Delegate to real DOM addEventListener so click handlers actually fire.
  domEvent.on = vi.fn((el, event, fn) => el.addEventListener(event, fn));
  domEvent.off = vi.fn((el, event, fn) => el.removeEventListener(event, fn));
  domEvent.stop = vi.fn();
});

describe("adjustPanelZIndex", () => {
  it("resets z-index when collapsed", () => {
    const bar = document.createElement("div");
    bar.className = "leaflet-bar";
    const section = document.createElement("div");
    section.className = "leaflet-top";
    const container = document.createElement("div");
    bar.appendChild(container);
    section.appendChild(bar);
    // container.closest(".leaflet-bar") requires container to be inside the bar
    bar.style.zIndex = "501";
    section.style.zIndex = "509";

    adjustPanelZIndex({ container, expanded: false });
    expect(bar.style.zIndex).toBe("");
    expect(section.style.zIndex).toBe("");
  });

  it("sets z-index from cssVar when expanded", () => {
    const bar = document.createElement("div");
    bar.className = "leaflet-bar";
    const section = document.createElement("div");
    section.className = "leaflet-top";
    const container = document.createElement("div");
    bar.appendChild(container);
    section.appendChild(bar);

    // setup.js doesn't stub getComputedStyle globally here; cssVar
    // reads document.documentElement computed style. jsdom returns
    // empty string, so cssVar falls back to the token default "9990"
    // (--foliplus-z-index-floating). Offsets: bar +1, section +9.
    adjustPanelZIndex({ container, expanded: true });
    expect(bar.style.zIndex).toBe("9991");
    expect(section.style.zIndex).toBe("9999");
  });

  it("reads --foliplus-z-index-floating from the token when present", () => {
    const bar = document.createElement("div");
    bar.className = "leaflet-bar";
    const section = document.createElement("div");
    section.className = "leaflet-top";
    const container = document.createElement("div");
    bar.appendChild(container);
    section.appendChild(bar);

    const spy = vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (prop: string) =>
        prop === "--foliplus-z-index-floating" ? " 9990 " : "",
    } as CSSStyleDeclaration);
    try {
      adjustPanelZIndex({ container, expanded: true });
    } finally {
      spy.mockRestore();
    }
    expect(bar.style.zIndex).toBe("9991");
    expect(section.style.zIndex).toBe("9999");
  });

  it("handles container without bar/section", () => {
    const container = document.createElement("div");
    expect(() => adjustPanelZIndex({ container, expanded: true })).not.toThrow();
  });
});

describe("bindPanelToggle", () => {
  function makePanel() {
    const container = document.createElement("div");
    container.className = "foliplus-panel foliplus-is-collapsed";
    const btn = document.createElement("button");
    btn.className = "foliplus-toggle-btn";
    const hdr = document.createElement("div");
    hdr.className = "foliplus-panel-header";
    container.appendChild(btn);
    container.appendChild(hdr);
    document.body.appendChild(container);
    return { container, btn, hdr };
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("expands when toggle button clicked", () => {
    const { container, btn } = makePanel();
    bindPanelToggle({
      container,
      toggleBtn: ".foliplus-toggle-btn",
      header: ".foliplus-panel-header",
    });

    expect(domEvent.on).toHaveBeenCalledTimes(2);
    btn.click();
    expect(container.classList.contains("foliplus-is-expanded")).toBe(true);
    expect(container.classList.contains("foliplus-is-collapsed")).toBe(false);
    expect(domEvent.stop).toHaveBeenCalled();
  });

  it("collapses when header clicked", () => {
    const { container, hdr } = makePanel();
    container.classList.add("foliplus-is-expanded");
    container.classList.remove("foliplus-is-collapsed");
    bindPanelToggle({
      container,
      toggleBtn: ".foliplus-toggle-btn",
      header: ".foliplus-panel-header",
    });

    hdr.click();
    expect(container.classList.contains("foliplus-is-collapsed")).toBe(true);
    expect(container.classList.contains("foliplus-is-expanded")).toBe(false);
  });

  it("no-ops when toggle/header not found", () => {
    const container = document.createElement("div");
    expect(() =>
      bindPanelToggle({ container, toggleBtn: ".none", header: ".none-missing" }),
    ).not.toThrow();
    expect(domEvent.on).not.toHaveBeenCalled();
  });
});

describe("bindFoldToggle", () => {
  function makeFold() {
    const container = document.createElement("div");
    container.className = "foliplus-ctrl-fold foliplus-is-collapsed";
    const btn = document.createElement("button");
    btn.className = "foliplus-toggle-btn";
    container.appendChild(btn);
    document.body.appendChild(container);
    return { container, btn };
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("expands on first click and collapses on second", () => {
    const { container, btn } = makeFold();
    bindFoldToggle({ container, toggleBtn: btn });

    btn.click();
    expect(container.classList.contains("foliplus-is-expanded")).toBe(true);
    expect(container.classList.contains("foliplus-is-collapsed")).toBe(false);

    btn.click();
    expect(container.classList.contains("foliplus-is-collapsed")).toBe(true);
    expect(container.classList.contains("foliplus-is-expanded")).toBe(false);
  });

  it("calls onExpand/onCollapse hooks", () => {
    const { container, btn } = makeFold();
    const onExpand = vi.fn();
    const onCollapse = vi.fn();
    bindFoldToggle({ container, toggleBtn: btn, onExpand, onCollapse });

    btn.click();
    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(onCollapse).not.toHaveBeenCalled();

    btn.click();
    expect(onCollapse).toHaveBeenCalledTimes(1);
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("stops propagation on click", () => {
    const { container, btn } = makeFold();
    bindFoldToggle({ container, toggleBtn: btn });
    btn.click();
    expect(domEvent.stop).toHaveBeenCalled();
  });
});

describe("bindOutsideCollapse", () => {
  function makePanel() {
    const container = document.createElement("div");
    container.className = "foliplus-panel foliplus-is-expanded";
    document.body.appendChild(container);
    return container;
  }

  // bindOutsideCollapse watches document.body for removal; stub the observer
  // so a callback never leaks past jsdom unloading globals.
  function withObserverStub<T>(fn: () => T): T {
    const real = globalThis.MutationObserver;
    (globalThis as any).MutationObserver = class {
      observe() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    };
    try {
      return fn();
    } finally {
      (globalThis as any).MutationObserver = real;
    }
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("collapses when clicking outside an expanded panel", () => {
    const container = makePanel();
    bindOutsideCollapse({ container });
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.click();
    expect(container.classList.contains("foliplus-is-collapsed")).toBe(true);
    expect(container.classList.contains("foliplus-is-expanded")).toBe(false);
  });

  it("does not collapse when clicking inside", () => {
    const container = makePanel();
    bindOutsideCollapse({ container });
    container.click();
    expect(container.classList.contains("foliplus-is-expanded")).toBe(true);
  });

  it("does not collapse when the click detaches its own target (fold rebuild)", () => {
    // LayerControl's fold click rebuilds the list and detaches the clicked
    // row before the event reaches document. The capture-phase check runs
    // before any handler can rebuild the tree, so the node is still attached
    // and this must NOT count as an outside click.
    const container = makePanel();
    bindOutsideCollapse({ container });
    const inside = document.createElement("button");
    container.appendChild(inside);
    inside.addEventListener("click", () => inside.remove());
    inside.click();
    expect(container.classList.contains("foliplus-is-expanded")).toBe(true);
  });

  it("keeps the panel open for a press on a registered portal root", () => {
    // The shared dropdown mounts its open list on <body> and registers that
    // node under the trigger it was mounted for. A press on a row is then an
    // inside press for the panel that owns that trigger, even though the node
    // is not a descendant of the panel. (Attribution itself — and the fact
    // that one overlay's list is *not* inside another's — is asserted in
    // platform/portalRoot.test.ts, where the predicate is the unit under test;
    // bindOutsideCollapse deliberately shares one "inside" verdict per event
    // across its bindings, so nested/sister panels cannot collapse each
    // other.)
    const container = makePanel();
    const portalList = document.createElement("div");
    const row = document.createElement("button");
    portalList.appendChild(row);
    document.body.appendChild(portalList);
    const release = registerPortalRoot(portalList, container);
    try {
      bindOutsideCollapse({ container });
      row.click();
      expect(container.classList.contains("foliplus-is-expanded")).toBe(true);
      expect(container.classList.contains("foliplus-is-collapsed")).toBe(false);
    } finally {
      release();
    }
    // Once released the same node is ordinary page furniture again.
    row.click();
    expect(container.classList.contains("foliplus-is-collapsed")).toBe(true);
  });

  it("skips collapse when skipCheck returns true", () => {
    const container = makePanel();
    bindOutsideCollapse({ container, skipCheck: () => true });
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.click();
    expect(container.classList.contains("foliplus-is-expanded")).toBe(true);
  });

  it("does nothing for collapsed panel when clicking outside", () => {
    const container = makePanel();
    container.classList.remove("foliplus-is-expanded");
    container.classList.add("foliplus-is-collapsed");
    bindOutsideCollapse({ container });
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.click();
    expect(container.classList.contains("foliplus-is-collapsed")).toBe(true);
  });

  it("returns cleanup that removes the listener", () => {
    const container = makePanel();
    const cleanup = bindOutsideCollapse({ container });
    cleanup();
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.click();
    expect(container.classList.contains("foliplus-is-expanded")).toBe(true);
  });

  it("cleanup detaches the capture listener as well as the bubble one", () => {
    // A stale capture listener would leave insidePress true and swallow the
    // real outside press, so the panel would wrongly stay open.
    const container = makePanel();
    const inside = document.createElement("div");
    container.appendChild(inside);
    const cleanup = bindOutsideCollapse({ container });
    cleanup();

    inside.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(container.classList.contains("foliplus-is-expanded")).toBe(true);
    outside.remove();
  });

  it("keeps the panel open when the pressed node is detached before bubble", () => {
    withObserverStub(() => {
      // Minimal fixture, not createPanelControl: this case must fail on the old
      // bubble-phase handler, which would also keep the panel open via a factory.
      const ctrl = document.createElement("div");
      ctrl.className = "foliplus-panel foliplus-ctrl-fold foliplus-is-expanded";
      document.body.appendChild(ctrl);
      const content = document.createElement("div");
      ctrl.appendChild(content);
      const btn = document.createElement("button");
      content.appendChild(btn);
      const cleanup = bindOutsideCollapse({ container: ctrl });

      // LayerControl's fold click replaces the list, so the pressed button is
      // gone by the time the document-level handler runs.
      btn.addEventListener("click", () => {
        content.innerHTML = "";
      });
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(ctrl.classList.contains("foliplus-is-expanded")).toBe(true);
      expect(ctrl.classList.contains("foliplus-is-collapsed")).toBe(false);

      cleanup();
      ctrl.remove();
    });
  });

  it("still collapses on an outside click", () => {
    withObserverStub(() => {
      const ctrl = document.createElement("div");
      ctrl.className = "foliplus-panel foliplus-ctrl-fold foliplus-is-expanded";
      document.body.appendChild(ctrl);
      const cleanup = bindOutsideCollapse({ container: ctrl });

      const outside = document.createElement("div");
      document.body.appendChild(outside);
      outside.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(ctrl.classList.contains("foliplus-is-collapsed")).toBe(true);
      expect(ctrl.classList.contains("foliplus-is-expanded")).toBe(false);

      cleanup();
      ctrl.remove();
      outside.remove();
    });
  });

  it("several panels share one document without leaking state", () => {
    // Two open panels coexist on one map (LayerControl + HeatmapControl); an
    // outside press must close both, not just the binding that happens to run
    // second. The verdict is recorded on a module-level WeakSet, so every
    // binding reads the same answer keyed by the event.
    withObserverStub(() => {
      const a = document.createElement("div");
      a.className = "foliplus-panel foliplus-ctrl-fold foliplus-is-expanded";
      const b = document.createElement("div");
      b.className = "foliplus-panel foliplus-ctrl-fold foliplus-is-expanded";
      document.body.appendChild(a);
      document.body.appendChild(b);
      const cleanupA = bindOutsideCollapse({ container: a });
      const cleanupB = bindOutsideCollapse({ container: b });

      // Both stay open: no press has happened yet.
      expect(a.classList.contains("foliplus-is-expanded")).toBe(true);
      expect(b.classList.contains("foliplus-is-expanded")).toBe(true);

      const outside = document.createElement("div");
      document.body.appendChild(outside);
      outside.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(a.classList.contains("foliplus-is-collapsed")).toBe(true);
      expect(b.classList.contains("foliplus-is-collapsed")).toBe(true);

      cleanupA();
      cleanupB();
      a.remove();
      b.remove();
      outside.remove();
    });
  });

  it("several panels: an inside press must not collapse the other one", () => {
    // The capture listeners on document all run before any bubble handler, so a
    // per-binding snapshot would let panel B read "outside" for a press that
    // panel A already claimed and collapse B on the way past. Sharing the
    // verdict per event is what keeps a press inside *any* panel inside all of
    // them.
    withObserverStub(() => {
      const a = document.createElement("div");
      a.className = "foliplus-panel foliplus-ctrl-fold foliplus-is-expanded";
      const b = document.createElement("div");
      b.className = "foliplus-panel foliplus-ctrl-fold foliplus-is-expanded";
      const insideA = document.createElement("div");
      a.appendChild(insideA);
      document.body.appendChild(a);
      document.body.appendChild(b);
      const cleanupA = bindOutsideCollapse({ container: a });
      const cleanupB = bindOutsideCollapse({ container: b });

      insideA.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(a.classList.contains("foliplus-is-expanded")).toBe(true);
      expect(b.classList.contains("foliplus-is-expanded")).toBe(true);

      // A later, genuinely outside press still closes both: the verdict is
      // per event, so the previous inside press must not bleed into it.
      const outside = document.createElement("div");
      document.body.appendChild(outside);
      outside.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(a.classList.contains("foliplus-is-collapsed")).toBe(true);
      expect(b.classList.contains("foliplus-is-collapsed")).toBe(true);

      cleanupA();
      cleanupB();
      a.remove();
      b.remove();
      outside.remove();
    });
  });

  it("skips the capture snapshot too when skipCheck returns true", () => {
    // skipCheck is per press, so answering it only in the bubble handler would
    // record a press the caller asked to ignore; the next real outside click
    // would then find itself already marked inside and be swallowed.
    withObserverStub(() => {
      let skip = true;
      const container = makePanel();
      bindOutsideCollapse({ container, skipCheck: () => skip });

      const outside = document.createElement("div");
      document.body.appendChild(outside);
      outside.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(container.classList.contains("foliplus-is-expanded")).toBe(true);

      skip = false;
      outside.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(container.classList.contains("foliplus-is-collapsed")).toBe(true);
    });
  });
});

describe("createFoldControl", () => {
  it("creates a fold control with toggle & toolbar", () => {
    const result = createFoldControl({
      cssClass: "measure-ctrl",
      toggleTitle: "Toggle",
      toggleSvg: "<svg/>",
      isLeft: true,
    });
    expect(result.container.className).toContain("leaflet-bar");
    expect(result.ctrl.className).toContain("measure-ctrl");
    expect(result.ctrl.className).toContain("foliplus-ctrl-fold");
    expect(result.toggleBtn).not.toBeNull();
    expect(result.toolBar).not.toBeNull();
    expect(domEvent.disableClickPropagation).toHaveBeenCalledWith(result.container);
    expect(domEvent.disableScrollPropagation).toHaveBeenCalledWith(result.container);
  });

  it("adds align-right class when not left", () => {
    const result = createFoldControl({
      cssClass: "export-ctrl",
      toggleTitle: "Toggle",
      toggleSvg: "<svg/>",
      isLeft: false,
    });
    expect(result.ctrl.className).toContain("foliplus-align-right");
  });

  it("prefers the Leaflet position over isLeft when both are given", () => {
    // `position` is the modern knob: its corner decides the alignment, and
    // `isLeft` is only the fallback for callers that still pass a boolean.
    const left = createFoldControl({
      cssClass: "measure-ctrl",
      toggleTitle: "Toggle",
      toggleSvg: "<svg/>",
      position: "bottomleft",
      isLeft: false,
    });
    const right = createFoldControl({
      cssClass: "measure-ctrl",
      toggleTitle: "Toggle",
      toggleSvg: "<svg/>",
      position: "topright",
      isLeft: true,
    });

    expect(left.ctrl.className).not.toContain("foliplus-align-right");
    expect(right.ctrl.className).toContain("foliplus-align-right");
  });
});

describe("createPanelHeader", () => {
  const build = (extra: Record<string, string> = {}) =>
    createPanelHeader({
      title: "Layer A",
      iconSvg: "<svg/>",
      closeTitle: "Collapse",
      ...extra,
    });

  it("builds title + logo + close in the shared order", () => {
    const header = build();
    expect(header.className).toBe("foliplus-panel-header");
    expect(header.getAttribute("title")).toBe("Collapse");

    const title = header.querySelector(".foliplus-header-title") as HTMLElement;
    expect(title).not.toBeNull();
    const icon = header.querySelector(".foliplus-header-icon") as HTMLElement;
    expect(icon).not.toBeNull();
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(title.textContent).toBe("Layer A");

    // Logo precedes the label, close button closes the bar.
    const children = Array.from(header.children);
    expect(children[0].className).toBe("foliplus-header-title");
    // Unified on the shared panelChrome.closeButton recipe (close-btn first);
    // class order is CSS-order-independent, only the string is canonicalized.
    expect(children[1].className).toBe("foliplus-close-btn foliplus-ctrl-btn");
  });

  it("names the close button for pointer and screen reader users", () => {
    const close = build().querySelector(".foliplus-close-btn") as HTMLElement;
    expect(close.getAttribute("title")).toBe("Collapse");
    expect(close.getAttribute("aria-label")).toBe("Collapse");
    // A bare `button` element defaults to `submit` inside a form.
    expect(close.getAttribute("type")).toBe("button");
  });

  it("accepts component class overrides for title and icon", () => {
    // The layer attributes panel adds its own hook class without giving up the
    // shared ones, so it is styled by the same rules plus its own.
    const header = build({
      iconClass: "foliplus-layer-attrs-icon foliplus-header-icon",
    });
    const icon = header.querySelector(".foliplus-header-icon") as HTMLElement;
    expect(icon.classList.contains("foliplus-layer-attrs-icon")).toBe(true);
  });
});

describe("createPanelControl", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("creates panel with toggle, header, content", () => {
    const result = createPanelControl({
      cssClass: "heatmap-ctrl",
      toggleTitle: "Toggle",
      toggleSvg: "<svg/>",
      panelTitle: "Panel",
      closeTitle: "Close",
    });
    expect(result.ctrl.className).toContain("foliplus-panel");
    expect(result.ctrl.className).toContain("heatmap-ctrl");
    expect(result.toggleBtn).not.toBeNull();
    expect(result.panelContent).not.toBeNull();
    expect(domEvent.disableClickPropagation).toHaveBeenCalled();
  });

  it("marks the header as a labeled dialog for screen readers", () => {
    const result = createPanelControl({
      cssClass: "heatmap-ctrl",
      toggleTitle: "Toggle",
      toggleSvg: "<svg/>",
      panelTitle: "Panel",
      closeTitle: "Close",
    });
    const header = result.ctrl.querySelector(".foliplus-panel-header") as HTMLElement;
    expect(header).not.toBeNull();
    expect(header.getAttribute("role")).toBe("dialog");
    expect(header.getAttribute("aria-label")).toBe("Panel");
    // The toggle button is the only reachable control in the collapsed state,
    // so its accessible name must not depend on inner SVG text.
    expect(result.toggleBtn!.getAttribute("aria-label")).toBe("Toggle");
  });

  it("applies ctrlId when given, otherwise derives one from cssClass", () => {
    const withId = createPanelControl({
      cssClass: "heatmap-ctrl",
      toggleTitle: "Toggle",
      toggleSvg: "<svg/>",
      panelTitle: "Panel",
      closeTitle: "Close",
      ctrlId: "LayerControl_ctrl",
    });
    expect(withId.ctrl.id).toBe("LayerControl_ctrl");

    // Every panel carries a stable id so tests and the fold-state store can
    // key on it without the caller having to spell one out.
    const without = createPanelControl({
      cssClass: "heatmap-ctrl",
      toggleTitle: "Toggle",
      toggleSvg: "<svg/>",
      panelTitle: "Panel",
      closeTitle: "Close",
    });
    expect(without.ctrl.id).toBe("heatmap-ctrl_ctrl");
  });

  it("labels the close button for both tooltip and screen readers", () => {
    const result = createPanelControl({
      cssClass: "heatmap-ctrl",
      toggleTitle: "Toggle",
      toggleSvg: "<svg/>",
      panelTitle: "Panel",
      closeTitle: "Close",
    });
    const close = result.ctrl.querySelector(".foliplus-close-btn") as HTMLElement;
    expect(close).not.toBeNull();
    expect(close.getAttribute("title")).toBe("Close");
    // The glyph is the button's only content, so it needs its own name.
    expect(close.getAttribute("aria-label")).toBe("Close");
  });

  it("destroy unbinds the outside-collapse listeners", () => {
    const result = createPanelControl({
      cssClass: "heatmap-ctrl",
      toggleTitle: "Toggle",
      toggleSvg: "<svg/>",
      panelTitle: "Panel",
      closeTitle: "Close",
    });
    document.body.appendChild(result.container);
    result.toggleBtn!.click();
    expect(result.ctrl.classList.contains("foliplus-is-expanded")).toBe(true);

    result.destroy();

    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.click();
    expect(result.ctrl.classList.contains("foliplus-is-expanded")).toBe(true);
  });

  it("collapses on an outside press by default", () => {
    const result = createPanelControl({
      cssClass: "heatmap-ctrl",
      toggleTitle: "Toggle",
      toggleSvg: "<svg/>",
      panelTitle: "Panel",
      closeTitle: "Close",
    });
    document.body.appendChild(result.container);
    result.toggleBtn!.click();
    expect(result.ctrl.classList.contains("foliplus-is-expanded")).toBe(true);

    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.click();
    expect(result.ctrl.classList.contains("foliplus-is-collapsed")).toBe(true);
  });

  it("stays open on an outside press when collapseOnOutside is false", () => {
    const result = createPanelControl({
      cssClass: "layer-ctrl",
      toggleTitle: "Toggle",
      toggleSvg: "<svg/>",
      panelTitle: "Panel",
      closeTitle: "Close",
      collapseOnOutside: false,
    });
    document.body.appendChild(result.container);
    result.toggleBtn!.click();
    expect(result.ctrl.classList.contains("foliplus-is-expanded")).toBe(true);

    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.click();
    expect(result.ctrl.classList.contains("foliplus-is-expanded")).toBe(true);
  });

  it("toggle button expands the panel", () => {
    const result = createPanelControl({
      cssClass: "heatmap-ctrl",
      toggleTitle: "Toggle",
      toggleSvg: "<svg/>",
      panelTitle: "Panel",
      closeTitle: "Close",
    });
    result.toggleBtn!.click();
    expect(result.ctrl.classList.contains("foliplus-is-expanded")).toBe(true);
  });
});

describe("bindMapSync", () => {
  function makeMap() {
    const handlers = {} as Record<string, (...args: unknown[]) => unknown>;
    return {
      on: vi.fn((event, fn) => {
        handlers[event] = fn;
      }),
      off: vi.fn(),
      _handlers: handlers,
    };
  }

  it("binds hide/update/show events and cleans up", () => {
    const map = makeMap();
    const opts = {
      map,
      hideEvents: ["zoom"],
      updateEvents: ["moveend"],
      showEvents: ["click"],
      onHide: vi.fn(),
      onUpdate: vi.fn(),
      onShow: vi.fn(),
    };
    const cleanup = bindMapSync(opts);

    expect(map.on).toHaveBeenCalledTimes(3);
    map._handlers.zoom();
    map._handlers.moveend();
    map._handlers.click();
    expect(opts.onHide).toHaveBeenCalled();
    expect(opts.onUpdate).toHaveBeenCalled();
    expect(opts.onShow).toHaveBeenCalled();

    cleanup();
    expect(map.off).toHaveBeenCalledTimes(3);
  });

  it("throttles onMove with requestAnimationFrame", () => {
    vi.useFakeTimers();
    const map = makeMap();
    const onMove = vi.fn();
    const cleanup = bindMapSync({ map, onMove });

    map._handlers.move();
    map._handlers.move();
    vi.advanceTimersByTime(16);
    expect(onMove).toHaveBeenCalledTimes(1);

    cleanup();
    vi.useRealTimers();
  });

  it("skips binding when events/fn missing", () => {
    const map = makeMap();
    const opts = { map, hideEvents: ["zoom"] } as any;
    const cleanup = bindMapSync(opts);
    expect(opts.onHide).toBeUndefined();
    expect(map.on).not.toHaveBeenCalled();
    cleanup();
  });
});

describe("createRowPanel", () => {
  const opts = {
    cssClass: "foliplus-layer-style-panel",
    title: "Style",
    iconSvg: "<svg></svg>",
    closeTitle: "Collapse",
    iconClass: "foliplus-layer-style-icon foliplus-header-icon",
  };

  it("builds the shared row-panel shell with a dialog role", () => {
    const { panel, header, content } = createRowPanel(opts);

    expect(panel.classList.contains("foliplus-panel")).toBe(true);
    expect(panel.classList.contains("foliplus-row-panel")).toBe(true);
    expect(panel.classList.contains(opts.cssClass)).toBe(true);
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.contains(header)).toBe(true);
    expect(panel.contains(content)).toBe(true);
    expect(content.classList.contains("foliplus-panel-content")).toBe(true);
  });

  it("names the dialog after the header title by default", () => {
    // Most row panels are named by the same string they show; the attributes
    // panel overrides it because its header shows the layer, not the surface.
    expect(createRowPanel(opts).panel.getAttribute("aria-label")).toBe("Style");
  });

  it("takes an explicit accessible name when the two differ", () => {
    const { panel } = createRowPanel({ ...opts, ariaLabel: "Layer attributes" });

    expect(panel.getAttribute("aria-label")).toBe("Layer attributes");
    expect(panel.querySelector(".foliplus-header-title")?.textContent).toContain(
      "Style",
    );
  });

  it("sizes the icon through the caller's class", () => {
    const { header } = createRowPanel(opts);

    const icon = header.querySelector(".foliplus-header-icon");
    expect(icon?.className).toContain("foliplus-layer-style-icon");
    expect(header.querySelector(".foliplus-close-btn")).not.toBeNull();
  });
});

describe("pinRowPanel", () => {
  type Box = { top: number; left: number; width: number; height: number };

  const stubBox = (el: HTMLElement, box: Box): void => {
    el.getBoundingClientRect = () =>
      ({
        top: box.top,
        left: box.left,
        width: box.width,
        height: box.height,
        right: box.left + box.width,
        bottom: box.top + box.height,
        x: box.left,
        y: box.top,
        toJSON: () => ({}),
      }) as DOMRect;
  };

  const setViewport = (width: number, height: number): void => {
    Object.defineProperty(window, "innerWidth", {
      value: width,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: height,
      configurable: true,
    });
  };

  const make = (card: { width: number; height: number }) => {
    const row = document.createElement("div");
    const panel = document.createElement("div");
    document.body.append(row, panel);
    stubBox(panel, { top: 0, left: 0, ...card });
    return { row, panel };
  };

  beforeEach(() => setViewport(1024, 720));
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("drops the card under its row, right-aligned with it", () => {
    const { row, panel } = make({ width: 280, height: 200 });
    stubBox(row, { top: 100, left: 10, width: 300, height: 30 });

    pinRowPanel(panel, row);

    // Right edge == row right (310), clamped inside the viewport.
    expect(panel.style.left).toBe("30px");
    expect(panel.style.top).toBe("132px");
  });

  it("flips upward when the strip below the row is the tight side", () => {
    // A bottom-row anchor has 88px below it and 598px above: the card lands
    // above the row and keeps its full natural height inside the upper strip.
    const { row, panel } = make({ width: 280, height: 400 });
    stubBox(row, { top: 600, left: 10, width: 300, height: 30 });

    pinRowPanel(panel, row);

    expect(panel.classList.contains("foliplus-row-panel-up")).toBe(true);
    expect(panel.style.top).toBe("198px");
    expect(panel.style.getPropertyValue("--foliplus-row-panel-max-height")).toBe(
      "400px",
    );
  });

  it("caps a long card to the strip below its row", () => {
    // 388px below, 298px above, 600px of content: flipping would be tighter,
    // so the card stays under the row and its content scrolls inside the cap.
    const { row, panel } = make({ width: 280, height: 600 });
    stubBox(row, { top: 300, left: 10, width: 300, height: 30 });

    pinRowPanel(panel, row);

    expect(panel.classList.contains("foliplus-row-panel-up")).toBe(false);
    expect(panel.style.top).toBe("332px");
    expect(panel.style.getPropertyValue("--foliplus-row-panel-max-height")).toBe(
      "388px",
    );
  });

  it("reads the natural height from the content's scroll box", () => {
    // The card is the flex column; `.foliplus-panel-content` is what scrolls.
    // 300px of visible content over 700px of natural content adds 400px of
    // unseen rows to the measured card, so the cap must use 800px, not 400px.
    const { row, panel } = make({ width: 280, height: 400 });
    stubBox(row, { top: 100, left: 10, width: 300, height: 30 });
    const content = document.createElement("div");
    content.className = "foliplus-panel-content";
    Object.defineProperty(content, "clientHeight", { value: 300 });
    Object.defineProperty(content, "scrollHeight", { value: 700 });
    panel.appendChild(content);

    pinRowPanel(panel, row);

    // 588px below the row, 98px above -> stay down and cap to the strip.
    expect(panel.classList.contains("foliplus-row-panel-up")).toBe(false);
    expect(panel.style.getPropertyValue("--foliplus-row-panel-max-height")).toBe(
      "588px",
    );
  });

  const flushPlacement = (): Promise<void> =>
    new Promise(resolve => requestAnimationFrame(() => resolve()));

  it("clamps to the map box rather than the raw viewport", () => {
    // A map embedded in a page: its right edge is at 500 and its top at 100,
    // well inside the 1024x720 test viewport. The row sits past the right edge
    // and near the map's bottom, so both axes must use the map's box.
    const map = document.createElement("div");
    map.className = "leaflet-container";
    const row = document.createElement("div");
    const panel = document.createElement("div");
    map.append(row);
    row.append(panel);
    document.body.append(map);
    stubBox(map, { top: 100, left: 100, width: 400, height: 400 });
    stubBox(row, { top: 450, left: 400, width: 200, height: 30 });
    stubBox(panel, { top: 0, left: 0, width: 280, height: 200 });

    pinRowPanel(panel, row);

    // row.right - card.width = 320, clamped to map right (500) - 280 - 8.
    expect(panel.style.left).toBe("212px");
    expect(panel.classList.contains("foliplus-row-panel-up")).toBe(true);
    expect(panel.style.top).toBe("248px");
  });

  it("shrinks the card when the map is narrower than the card", () => {
    const map = document.createElement("div");
    map.className = "leaflet-container";
    const row = document.createElement("div");
    const panel = document.createElement("div");
    map.append(row);
    row.append(panel);
    document.body.append(map);
    stubBox(map, { top: 100, left: 100, width: 200, height: 400 });
    stubBox(row, { top: 200, left: 110, width: 180, height: 30 });
    stubBox(panel, { top: 0, left: 0, width: 280, height: 200 });

    pinRowPanel(panel, row);

    // 200px map - 2 * 8px edge. The card aligns to the map's left edge.
    expect(panel.style.maxWidth).toBe("184px");
    expect(panel.style.left).toBe("108px");
  });

  it("holds the floor inside the map's top edge on a short map", () => {
    // 8px below, 58px above, 300px of content: the flip lands on the wider
    // strip but the 120px floor is taller than it, so the top clamps to the
    // map's edge instead of escaping above it.
    const map = document.createElement("div");
    map.className = "leaflet-container";
    const row = document.createElement("div");
    const panel = document.createElement("div");
    map.append(row);
    row.append(panel);
    document.body.append(map);
    stubBox(map, { top: 100, left: 100, width: 400, height: 100 });
    stubBox(row, { top: 160, left: 120, width: 200, height: 30 });
    stubBox(panel, { top: 0, left: 0, width: 280, height: 300 });

    pinRowPanel(panel, row);

    expect(panel.classList.contains("foliplus-row-panel-up")).toBe(true);
    // 100px map - 2 * 8px edge: the 120px floor shrinks to the usable box.
    expect(panel.style.getPropertyValue("--foliplus-row-panel-max-height")).toBe(
      "84px",
    );
    expect(panel.style.top).toBe("108px");
  });

  it("keeps the last placement while the row is hidden (folded role)", async () => {
    const { row, panel } = make({ width: 280, height: 200 });
    stubBox(row, { top: 100, left: 10, width: 300, height: 30 });
    pinRowPanel(panel, row);

    stubBox(row, { top: 0, left: 0, width: 0, height: 0 });
    window.dispatchEvent(new Event("resize"));
    await flushPlacement();

    expect(panel.style.left).toBe("30px");
    expect(panel.style.top).toBe("132px");
  });

  it("follows the row on a scroll and a resize", async () => {
    const { row, panel } = make({ width: 280, height: 400 });
    stubBox(row, { top: 300, left: 10, width: 300, height: 30 });
    pinRowPanel(panel, row);
    expect(panel.style.top).toBe("332px");

    stubBox(row, { top: 200, left: 20, width: 300, height: 30 });
    window.dispatchEvent(new Event("resize"));
    await flushPlacement();
    expect(panel.style.top).toBe("232px");

    stubBox(row, { top: 100, left: 20, width: 300, height: 30 });
    window.dispatchEvent(new Event("scroll"));
    await flushPlacement();
    expect(panel.style.top).toBe("132px");
    // Placement never writes an inline height cap.
    expect(panel.style.maxHeight).toBe("");
  });

  it("returns the card to its CSS box once unpinned", async () => {
    const { row, panel } = make({ width: 280, height: 200 });
    stubBox(row, { top: 100, left: 10, width: 300, height: 30 });
    pinRowPanel(panel, row);
    expect(panel.style.top).toBe("132px");

    unpinRowPanel(row);
    expect(panel.classList.contains("foliplus-is-pinned")).toBe(false);
    expect(panel.classList.contains("foliplus-row-panel-up")).toBe(false);
    expect(panel.style.top).toBe("");
    expect(panel.style.left).toBe("");
    expect(panel.style.getPropertyValue("--foliplus-row-panel-max-height")).toBe("");

    // The page-level listener pair goes away with the last card, so a later
    // resize cannot move the released box.
    stubBox(row, { top: 400, left: 10, width: 300, height: 30 });
    window.dispatchEvent(new Event("resize"));
    await flushPlacement();
    expect(panel.style.top).toBe("");
  });

  it("releases the previous card when the same row is pinned again", () => {
    const row = document.createElement("div");
    const first = document.createElement("div");
    const second = document.createElement("div");
    document.body.append(row, first, second);
    stubBox(row, { top: 100, left: 10, width: 300, height: 30 });
    stubBox(first, { top: 0, left: 0, width: 280, height: 200 });
    stubBox(second, { top: 0, left: 0, width: 280, height: 200 });

    pinRowPanel(first, row);
    pinRowPanel(second, row);

    expect(first.classList.contains("foliplus-is-pinned")).toBe(false);
    expect(first.style.top).toBe("");
    expect(second.classList.contains("foliplus-is-pinned")).toBe(true);
    expect(second.style.top).toBe("132px");
  });

  it("drops a detached card instead of positioning it", async () => {
    const { row, panel } = make({ width: 280, height: 200 });
    stubBox(row, { top: 100, left: 10, width: 300, height: 30 });
    pinRowPanel(panel, row);
    const placed = panel.style.top;

    panel.remove();
    stubBox(row, { top: 400, left: 10, width: 300, height: 30 });
    expect(() => window.dispatchEvent(new Event("resize"))).not.toThrow();
    await flushPlacement();
    expect(panel.style.top).toBe(placed);
  });

  it("accepts a missing row on unpin", () => {
    // Close paths read the row back off the card; a card whose row was rebuilt
    // away answers null, and unpinning must stay a no-op instead of throwing.
    expect(() => unpinRowPanel(null)).not.toThrow();
  });

  it("adds the pinned marker on pin and takes it off on unpin", () => {
    const { row, panel } = make({ width: 280, height: 200 });
    stubBox(row, { top: 100, left: 10, width: 300, height: 30 });
    expect(panel.classList.contains("foliplus-is-pinned")).toBe(false);

    pinRowPanel(panel, row);
    expect(panel.classList.contains("foliplus-is-pinned")).toBe(true);

    unpinRowPanel(row);
    expect(panel.classList.contains("foliplus-is-pinned")).toBe(false);
  });

  it("leaves a createRowPanel card unpinned (plain absolute row card)", () => {
    // #724's filter panel builds a row panel without knowing about pinning.
    // The shared shell must keep working for it: no marker, no inline
    // placement, so it renders as the plain row-anchored absolute card.
    const { panel } = createRowPanel({
      cssClass: "foliplus-filter-panel",
      title: "Filter",
      iconSvg: "<svg></svg>",
      closeTitle: "Close",
      iconClass: "foliplus-header-icon",
    });

    expect(panel.classList.contains("foliplus-row-panel")).toBe(true);
    expect(panel.classList.contains("foliplus-is-pinned")).toBe(false);
    expect(panel.style.position).toBe("");
    expect(panel.style.top).toBe("");
    expect(panel.style.left).toBe("");
  });

  it("leaves a zero-height row's card unplaced on the vertical axis", () => {
    // A row inside a collapsed group still reports its width but no height.
    // There is no strip to fit, so the card keeps the horizontal placement it
    // already got and writes no top / cap.
    const { row, panel } = make({ width: 280, height: 200 });
    stubBox(row, { top: 100, left: 10, width: 300, height: 0 });

    pinRowPanel(panel, row);

    expect(panel.style.left).toBe("30px");
    expect(panel.style.top).toBe("");
    expect(panel.style.getPropertyValue("--foliplus-row-panel-max-height")).toBe("");
  });

  it("falls back to the map's own box when the map is fully off screen", () => {
    // A page scrolled past the map leaves an empty intersection with the
    // viewport. Snapping to the viewport then would park the card in the page
    // corner; keeping the map coordinates leaves it where the row is.
    const map = document.createElement("div");
    map.className = "leaflet-container";
    const row = document.createElement("div");
    const panel = document.createElement("div");
    map.append(row);
    row.append(panel);
    document.body.append(map);
    stubBox(map, { top: 800, left: 100, width: 400, height: 400 });
    stubBox(row, { top: 900, left: 200, width: 200, height: 30 });
    stubBox(panel, { top: 0, left: 0, width: 280, height: 200 });

    pinRowPanel(panel, row);

    expect(panel.style.left).toBe("120px");
    expect(panel.style.top).toBe("932px");
  });

  it("keeps the card's own width when the map leaves no usable strip", () => {
    // A 10px map cannot hold the card minus both edge insets. Shrinking it to
    // the negative remainder would set `max-width: 0`; keep the card's width
    // and let the horizontal clamp land it on the map's inset instead.
    const map = document.createElement("div");
    map.className = "leaflet-container";
    const row = document.createElement("div");
    const panel = document.createElement("div");
    map.append(row);
    row.append(panel);
    document.body.append(map);
    stubBox(map, { top: 100, left: 100, width: 10, height: 400 });
    stubBox(row, { top: 200, left: 100, width: 10, height: 30 });
    stubBox(panel, { top: 0, left: 0, width: 280, height: 200 });

    pinRowPanel(panel, row);

    expect(panel.style.maxWidth).toBe("");
    expect(panel.style.left).toBe("108px");
    expect(panel.style.top).toBe("232px");
  });

  it("ignores an unpin for a row it never pinned", () => {
    const { row, panel } = make({ width: 280, height: 200 });
    stubBox(row, { top: 100, left: 10, width: 300, height: 30 });
    pinRowPanel(panel, row);

    expect(() => unpinRowPanel(document.createElement("div"))).not.toThrow();

    // The real card is untouched: a close path that read back the wrong row
    // must not tear down the placement of the one that is open.
    expect(panel.classList.contains("foliplus-is-pinned")).toBe(true);
    expect(panel.style.top).toBe("132px");
  });

  it("does not touch the page listeners when nothing is pinned", async () => {
    // Drain any bookkeeping a previous test left behind, so the early return
    // in the teardown path is what runs below.
    window.dispatchEvent(new Event("resize"));
    await flushPlacement();

    const remove = vi.spyOn(window, "removeEventListener");
    try {
      unpinRowPanel(document.createElement("div"));
      expect(remove).not.toHaveBeenCalled();
    } finally {
      remove.mockRestore();
    }
  });

  it("keeps the card inside a narrow viewport (map edge to edge)", () => {
    // A phone-width viewport with the map flush to both edges: the card is
    // wider than the strip, so it shrinks to the usable width and stays
    // inside the bounds on every axis (no overflow past the right edge).
    setViewport(320, 568);
    const map = document.createElement("div");
    map.className = "leaflet-container";
    const row = document.createElement("div");
    const panel = document.createElement("div");
    map.append(row);
    row.append(panel);
    document.body.append(map);
    stubBox(map, { top: 0, left: 0, width: 320, height: 568 });
    stubBox(row, { top: 200, left: 0, width: 320, height: 30 });
    stubBox(panel, { top: 0, left: 0, width: 280, height: 400 });

    pinRowPanel(panel, row);

    // Usable width = 320 - 2*8 = 304; the 280 card fits, so no maxWidth.
    expect(panel.style.maxWidth).toBe("");
    expect(panel.style.left).toBe("32px");
    expect(panel.style.top).toBe("232px");
  });

  it("does not overflow when the row sits at the map's bottom edge", () => {
    // The row's bottom is at the map's bottom edge: the below strip is just
    // the gap, so the card flips above and must land inside the map's box.
    const map = document.createElement("div");
    map.className = "leaflet-container";
    const row = document.createElement("div");
    const panel = document.createElement("div");
    map.append(row);
    row.append(panel);
    document.body.append(map);
    stubBox(map, { top: 100, left: 100, width: 400, height: 400 });
    stubBox(row, { top: 468, left: 120, width: 200, height: 30 });
    stubBox(panel, { top: 0, left: 0, width: 280, height: 200 });

    pinRowPanel(panel, row);

    expect(panel.classList.contains("foliplus-row-panel-up")).toBe(true);
    expect(panel.style.top).toBe("266px");
    expect(panel.style.getPropertyValue("--foliplus-row-panel-max-height")).toBe(
      "200px",
    );
  });

  it("keeps a wide card inside the bounds on a short map", () => {
    // The map is narrower than the card but tall enough: the card shrinks to
    // the usable width and the placement keeps it inside the map's box.
    const map = document.createElement("div");
    map.className = "leaflet-container";
    const row = document.createElement("div");
    const panel = document.createElement("div");
    map.append(row);
    row.append(panel);
    document.body.append(map);
    stubBox(map, { top: 100, left: 100, width: 240, height: 300 });
    stubBox(row, { top: 150, left: 110, width: 220, height: 30 });
    stubBox(panel, { top: 0, left: 0, width: 400, height: 300 });

    pinRowPanel(panel, row);

    // Usable width = 240 - 2*8 = 224, so the 400px card shrinks to 224.
    expect(panel.style.maxWidth).toBe("224px");
    expect(panel.style.left).toBe("108px");
    expect(panel.style.top).toBe("182px");
  });

  it("keeps the card on screen when the map is degenerate (offscreen)", () => {
    // The map is fully off the viewport bottom, so visibleRowPanelBounds
    // returns the map's own box (not the viewport). The card must stay within
    // that box rather than snapping to the page corner, and the cap must not
    // exceed the box height (the strip clamp from #846).
    const map = document.createElement("div");
    map.className = "leaflet-container";
    const row = document.createElement("div");
    const panel = document.createElement("div");
    map.append(row);
    row.append(panel);
    document.body.append(map);
    stubBox(map, { top: 800, left: 100, width: 400, height: 100 });
    stubBox(row, { top: 860, left: 200, width: 200, height: 30 });
    stubBox(panel, { top: 0, left: 0, width: 280, height: 400 });

    pinRowPanel(panel, row);

    // bounds = map box (top 800, bottom 900, height 100). The 400px card caps
    // to the usable box (100 - 16 = 84) and the top clamps to the map's edge.
    expect(panel.style.getPropertyValue("--foliplus-row-panel-max-height")).toBe(
      "84px",
    );
    expect(parseFloat(panel.style.top)).toBeGreaterThanOrEqual(808);
    expect(parseFloat(panel.style.top)).toBeLessThanOrEqual(900);
  });

  it("keeps its own floor and horizontal policy instead of the kernel outputs", () => {
    // The row panel is a partial adapter: it consumes only placement.side
    // and placement.maxHeight, and deliberately keeps its own ROW_PANEL_EDGE
    // insets + comfort floor. This pins the #853 P3-3 / P3-5 decision: no
    // minRows/rowHeight is passed (no kernel row-floor), and the kernel's
    // left/top/maxWidth are not written to the card.
    //
    // Fixture: map box 100..500 x 100..500 (bounds 400 tall), row at top 300
    // bottom 330, natural card 280x400. The kernel picks above (the larger
    // strip, 198 vs 168) and caps the height to 198. The adapter's own floor
    // (ROW_PANEL_MIN_HEIGHT=120) is smaller than that cap, so it does not
    // override the strip cap — the cap stays the kernel's.
    const map = document.createElement("div");
    map.className = "leaflet-container";
    const row = document.createElement("div");
    const panel = document.createElement("div");
    map.append(row);
    row.append(panel);
    document.body.append(map);
    stubBox(map, { top: 100, left: 100, width: 400, height: 400 });
    stubBox(row, { top: 300, left: 120, width: 200, height: 30 });
    stubBox(panel, { top: 0, left: 0, width: 280, height: 400 });

    const bounds = { top: 100, right: 500, bottom: 500, left: 100 };
    const anchor = { top: 300, right: 320, bottom: 330, left: 120 };
    const kernel = computePlacement(anchor, { width: 280, height: 400 }, bounds, {
      gap: 2,
    });
    expect(kernel.side).toBe("above");
    expect(kernel.maxHeight).toBe(198);
    expect(kernel.maxWidth).toBe(280);
    // The kernel has no edge inset: top and left are the raw computed values.
    expect(kernel.top).toBe(100);
    expect(kernel.left).toBe(100);

    pinRowPanel(panel, row);

    // Adapter consumes side + maxHeight; it does NOT consume left/top/maxWidth.
    // Its own ROW_PANEL_EDGE inset wins on both axes (bounds edge + 8), and no
    // max-width is written (the 280 card fits the usable 384 strip).
    expect(panel.classList.contains("foliplus-row-panel-up")).toBe(
      kernel.side === "above",
    );
    expect(panel.style.getPropertyValue("--foliplus-row-panel-max-height")).toBe(
      `${kernel.maxHeight}px`,
    );
    expect(panel.style.maxWidth).toBe("");
    expect(panel.style.left).toBe(`${bounds.left + ROW_PANEL_EDGE}px`);
    expect(panel.style.top).toBe(`${bounds.top + ROW_PANEL_EDGE}px`);
  });

  it("applies its own comfort floor after the kernel on a short strip", () => {
    // The kernel caps to the chosen strip (88px below a low row). That cap is
    // BELOW the adapter's ROW_PANEL_MIN_HEIGHT (120), so the adapter's own
    // comfort floor kicks in after the kernel and raises the cap to 120 — the
    // kernel's maxHeight is not the final word on a short strip.
    const map = document.createElement("div");
    map.className = "leaflet-container";
    const row = document.createElement("div");
    const panel = document.createElement("div");
    map.append(row);
    row.append(panel);
    document.body.append(map);
    stubBox(map, { top: 100, left: 100, width: 400, height: 200 });
    stubBox(row, { top: 180, left: 120, width: 200, height: 30 });
    stubBox(panel, { top: 0, left: 0, width: 280, height: 400 });

    const bounds = { top: 100, right: 500, bottom: 300, left: 100 };
    const anchor = { top: 180, right: 320, bottom: 210, left: 120 };
    const kernel = computePlacement(anchor, { width: 280, height: 400 }, bounds, {
      gap: 2,
    });
    expect(kernel.side).toBe("below");
    expect(kernel.maxHeight).toBe(88);

    pinRowPanel(panel, row);

    // The kernel would cap to 88; the adapter's floor (120, below the usable
    // 184) wins, so the written cap is 120 — floor applied AFTER the kernel.
    expect(panel.classList.contains("foliplus-row-panel-up")).toBe(false);
    expect(panel.style.getPropertyValue("--foliplus-row-panel-max-height")).toBe(
      `${ROW_PANEL_MIN_HEIGHT}px`,
    );
    expect(panel.style.left).toBe(`${bounds.left + ROW_PANEL_EDGE}px`);
    expect(panel.style.top).toBe("180px");
  });
});

// Structural guard for core/leaflet/panel: a .foliplus-panel-content element
// may only be created inside the two panel factories (createRowPanel /
// createPanelControl in core/leaflet/panel.ts), and each factory must call
// bindFloatingGestures. A third ad-hoc creation point (or a factory that
// forgets the bind) fails here. This is a factory-location guard, not a
// call-site enum: every resident panel body is made by these two factories,
// so a new control that uses the factory gets the containment automatically.
//
// Red-proof (recorded, both directions):
//  - Removing bindFloatingGestures(content) from createRowPanel made the
//    factory-bind assertion fail with "factory createRowPanel missing
//    bindFloatingGestures"; restoring it returned green.
describe("floating gesture containment goes through the unified entry", () => {
  const panelSrc = readFileSync(repoPath("foliplus/js/core/leaflet/panel.ts"), "utf8");

  it("B: .foliplus-panel-content created only in the two panel factories, each bound", () => {
    const createSites: string[] = [];
    panelSrc.split("\n").forEach((line, i) => {
      // A creation site is a dom.el element whose class is the panel-content
      // (the selector `:scope > .foliplus-panel-content` is a reference, not
      // a creation point).
      if (/class: "foliplus-panel-content"/.test(line)) {
        createSites.push(`L${i + 1}: ${line.trim()}`);
      }
    });
    expect(createSites.length).toBeGreaterThanOrEqual(2);
    const rowLine =
      panelSrc.split("\n").findIndex(l => l.includes("const createRowPanel")) + 1;
    const ctrlLine =
      panelSrc.split("\n").findIndex(l => l.includes("const createPanelControl")) + 1;
    expect(rowLine).toBeGreaterThan(0);
    expect(ctrlLine).toBeGreaterThan(0);
    for (const site of createSites) {
      const lineNo = Number(/L(\d+)/.exec(site)?.[1] ?? 0);
      const inRow = lineNo > rowLine && lineNo < ctrlLine;
      const inCtrl = lineNo > ctrlLine;
      expect(inRow || inCtrl).toBe(true);
    }
    // Each factory must bind the unified gesture entry.
    const rowLines = panelSrc.split("\n");
    const rowBody = rowLines.slice(rowLine - 1, ctrlLine - 1).join("\n");
    const ctrlBody = rowLines.slice(ctrlLine - 1).join("\n");
    const stripComments = (s: string): string =>
      s
        .split("\n")
        .filter(l => !l.trim().startsWith("//"))
        .join("\n");
    expect(stripComments(rowBody)).toMatch(/bindFloatingGestures\s*\(/);
    expect(stripComments(ctrlBody)).toMatch(/bindFloatingGestures\s*\(/);
  });
});
