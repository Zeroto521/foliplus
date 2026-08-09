import { beforeEach, describe, expect, it, vi } from "vitest";
import {
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

  it("sets MAXIMIZE icon when not fullscreen", () => {
    updateUI(mapMock, fsBtn, container);
    // Should contain MAXIMIZE SVG (path start M8 3H5...)
    expect(fsBtn.innerHTML).toContain("M8 3H5");
  });

  it("sets MINIMIZE icon when fullscreen", () => {
    mapMock.isFullscreen = true;
    updateUI(mapMock, fsBtn, container);
    expect(fsBtn.innerHTML).toContain("M8 3v3");
  });
});

describe("toggleFullscreen", () => {
  let fsBtn, container, mapMock;

  beforeEach(() => {
    vi.clearAllMocks();
    fsBtn = document.createElement("button");
    container = document.createElement("div");
    mapMock = {
      _container: document.createElement("div"),
      isFullscreen: false,
      invalidateSize: vi.fn(),
    };
  });

  it("enters pseudo-fullscreen when native API is disabled", () => {
    toggleFullscreen(mapMock, fsBtn, container);
    expect(mapMock._container.classList.contains("leaflet-pseudo-fullscreen")).toBe(
      true,
    );
    expect(mapMock.isFullscreen).toBe(true);
  });

  it("exits pseudo-fullscreen on second call", () => {
    toggleFullscreen(mapMock, fsBtn, container);
    toggleFullscreen(mapMock, fsBtn, container);
    expect(mapMock._container.classList.contains("leaflet-pseudo-fullscreen")).toBe(
      false,
    );
    expect(mapMock.isFullscreen).toBe(false);
  });
});
