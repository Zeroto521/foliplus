import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adjustPanelZIndex,
  bindFoldToggle,
  bindMapSync,
  bindOutsideCollapse,
  bindPanelToggle,
  createFoldControl,
  createPanelControl,
} from "#common/panel.js";

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
    // empty string, so cssVar falls back to "500".
    adjustPanelZIndex({ container, expanded: true });

    expect(bar.style.zIndex).toBe("501");

    expect(section.style.zIndex).toBe("509");
  });

  it("handles container without bar/section", () => {
    const container = document.createElement("div");

    expect(() => adjustPanelZIndex({ container, expanded: true })).not.toThrow();
  });
});

describe("bindPanelToggle", () => {
  function makePanel() {
    const container = document.createElement("div");

    container.className = "foliplus-panel collapsed";
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

    expect(container.classList.contains("expanded")).toBe(true);

    expect(container.classList.contains("collapsed")).toBe(false);

    expect(domEvent.stop).toHaveBeenCalled();
  });

  it("collapses when header clicked", () => {
    const { container, hdr } = makePanel();

    container.classList.add("expanded");

    container.classList.remove("collapsed");

    bindPanelToggle({
      container,
      toggleBtn: ".foliplus-toggle-btn",
      header: ".foliplus-panel-header",
    });

    hdr.click();

    expect(container.classList.contains("collapsed")).toBe(true);

    expect(container.classList.contains("expanded")).toBe(false);
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

    container.className = "foliplus-ctrl-fold collapsed";
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

    expect(container.classList.contains("expanded")).toBe(true);

    expect(container.classList.contains("collapsed")).toBe(false);

    btn.click();

    expect(container.classList.contains("collapsed")).toBe(true);

    expect(container.classList.contains("expanded")).toBe(false);
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

    container.className = "foliplus-panel expanded";

    document.body.appendChild(container);
    return container;
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

    expect(container.classList.contains("collapsed")).toBe(true);

    expect(container.classList.contains("expanded")).toBe(false);
  });

  it("does not collapse when clicking inside", () => {
    const container = makePanel();

    bindOutsideCollapse({ container });

    container.click();

    expect(container.classList.contains("expanded")).toBe(true);
  });

  it("skips collapse when skipCheck returns true", () => {
    const container = makePanel();

    bindOutsideCollapse({ container, skipCheck: () => true });
    const outside = document.createElement("div");

    document.body.appendChild(outside);

    outside.click();

    expect(container.classList.contains("expanded")).toBe(true);
  });

  it("does nothing for collapsed panel when clicking outside", () => {
    const container = makePanel();

    container.classList.remove("expanded");

    container.classList.add("collapsed");

    bindOutsideCollapse({ container });
    const outside = document.createElement("div");

    document.body.appendChild(outside);

    outside.click();

    expect(container.classList.contains("collapsed")).toBe(true);
  });

  it("returns cleanup that removes the listener", () => {
    const container = makePanel();
    const cleanup = bindOutsideCollapse({ container });

    cleanup();
    const outside = document.createElement("div");

    document.body.appendChild(outside);

    outside.click();

    expect(container.classList.contains("expanded")).toBe(true);
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
});

describe("createPanelControl", () => {
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

  it("toggle button expands the panel", () => {
    const result = createPanelControl({
      cssClass: "heatmap-ctrl",
      toggleTitle: "Toggle",
      toggleSvg: "<svg/>",
      panelTitle: "Panel",
      closeTitle: "Close",
    });

    result.toggleBtn.click();

    expect(result.ctrl.classList.contains("expanded")).toBe(true);
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
