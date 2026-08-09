import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLASSES } from "../../foliplus/js/FullscreenControl/FullscreenControl.const.js";
import {
  bindFullscreenEvents,
  toggleFullscreen,
  updateUI,
} from "../../foliplus/js/FullscreenControl/FullscreenControl.logic.js";

describe("updateUI", () => {
  let fsBtn, container, mapMock;

  beforeEach(() => {
    vi.clearAllMocks();
    fsBtn = document.createElement("button");
    container = document.createElement("div");
    container.innerHTML = `
      <button class="foliplus-fullscreen-toggle"></button>
      <button class="foliplus-zoom-in"></button>
      <button class="foliplus-zoom-out"></button>
    `;
    mapMock = {
      getContainer: () => container,
      isFullscreen: false,
    };
  });

  it("sets MAXIMIZE icon + title when not fullscreen", () => {
    updateUI(mapMock, fsBtn, container);
    expect(fsBtn.innerHTML).toContain("M8 3H5"); // MAXIMIZE
    expect(fsBtn.title).toContain("title");
    expect(window.foliplus.showHint).toHaveBeenCalled();
  });

  it("sets MINIMIZE icon + title when fullscreen", () => {
    mapMock.isFullscreen = true;
    updateUI(mapMock, fsBtn, container);
    expect(fsBtn.innerHTML).toContain("M8 3v3"); // MINIMIZE
    expect(fsBtn.title).toContain("title_cancel");
    expect(window.foliplus.showHint).toHaveBeenCalled();
  });

  it("skips hide_others when CONF.hide_others is not set", () => {
    updateUI(mapMock, fsBtn, container);
    // No class toggling on other controls since CONF.hide_others is falsy
    expect(fsBtn.innerHTML).toContain("M8 3H5");
  });

  it("skips hide_self when CONF.hide_self is not set", () => {
    updateUI(mapMock, fsBtn, container);
    const selfBtns = container.querySelectorAll(".foliplus-fullscreen-toggle, .foliplus-zoom-in, .foliplus-zoom-out");
    for (const btn of selfBtns) {
      expect(btn.classList.contains(CLASSES.HIDDEN)).toBe(false);
    }
  });
});

describe("toggleFullscreen — pseudo path", () => {
  let fsBtn, container, mapMock;

  beforeEach(() => {
    vi.clearAllMocks();
    fsBtn = document.createElement("button");
    container = document.createElement("div");
    mapMock = {
      _container: document.createElement("div"),
      getContainer: () => container,
      isFullscreen: false,
      invalidateSize: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
  });

  it("enters pseudo-fullscreen", () => {
    toggleFullscreen(mapMock, fsBtn, container);
    expect(mapMock._container.classList.contains(CLASSES.PSEUDO_FULLSCREEN)).toBe(true);
    expect(mapMock.isFullscreen).toBe(true);
    expect(mapMock.invalidateSize).toHaveBeenCalled();
  });

  it("exits pseudo-fullscreen on second call", () => {
    toggleFullscreen(mapMock, fsBtn, container);
    toggleFullscreen(mapMock, fsBtn, container);
    expect(mapMock._container.classList.contains(CLASSES.PSEUDO_FULLSCREEN)).toBe(false);
    expect(mapMock.isFullscreen).toBe(false);
  });

  it("calls updateUI after toggle (icon changes to MINIMIZE)", () => {
    toggleFullscreen(mapMock, fsBtn, container);
    expect(fsBtn.innerHTML).toContain("M8 3v3"); // MINIMIZE
    expect(window.foliplus.showHint).toHaveBeenCalled();
  });
});

describe("bindFullscreenEvents", () => {
  let fsBtn, container, mapMock;

  beforeEach(() => {
    vi.clearAllMocks();
    fsBtn = document.createElement("button");
    container = document.createElement("div");
    container.innerHTML = `
      <button class="foliplus-fullscreen-toggle"></button>
      <button class="foliplus-zoom-in"></button>
      <button class="foliplus-zoom-out"></button>
    `;
    mapMock = {
      _container: document.createElement("div"),
      getContainer: () => container,
      isFullscreen: false,
      invalidateSize: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
  });

  it("returns a handler function", () => {
    const handler = bindFullscreenEvents(mapMock, fsBtn, container);
    expect(typeof handler).toBe("function");
  });

  it("does not register fullscreenchange when native API is disabled", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    bindFullscreenEvents(mapMock, fsBtn, container);
    expect(addSpy).not.toHaveBeenCalled();
  });

  it("wires unload event listener", () => {
    bindFullscreenEvents(mapMock, fsBtn, container);
    expect(mapMock.on).toHaveBeenCalledWith("unload", expect.any(Function));
  });

  it("handler calls updateUI (MAXIMIZE when not fullscreen)", () => {
    const handler = bindFullscreenEvents(mapMock, fsBtn, container);
    handler();
    expect(mapMock.isFullscreen).toBe(false);
    expect(fsBtn.innerHTML).toContain("M8 3H5"); // MAXIMIZE
  });
});
