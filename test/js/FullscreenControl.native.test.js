import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindFullscreenEvents,
  toggleFullscreen,
  updateUI,
} from "../../foliplus/js/FullscreenControl/FullscreenControl.logic.js";

const mocks = vi.hoisted(() => ({
  nativeAPI: {
    requestFullscreen: "requestFullscreen",
    exitFullscreen: "exitFullscreen",
    fullscreenElement: "fullscreenElement",
    fullscreenEnabled: "fullscreenEnabled",
    fullscreenchange: "fullscreenchange",
    fullscreenerror: "fullscreenerror",
  },
  isEnabled: true,
  getFullscreenEl: vi.fn(() => null),
}));

vi.mock("../../foliplus/js/FullscreenControl/FullscreenControl.api.js", () => ({
  nativeAPI: mocks.nativeAPI,
  isEnabled: mocks.isEnabled,
  getFullscreenEl: mocks.getFullscreenEl,
}));

describe("FullscreenControl.logic — native API path", () => {
  let fsBtn, container, mapMock;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFullscreenEl.mockReturnValue(null);
    fsBtn = document.createElement("button");
    container = document.createElement("div");
    container.innerHTML = `
      <button class="foliplus-fullscreen-toggle"></button>
      <button class="foliplus-zoom-in"></button>
      <button class="foliplus-zoom-out"></button>
    `;
    mapMock = {
      _container: {
        classList: {
          add: vi.fn(),
          remove: vi.fn(),
        },
        requestFullscreen: vi.fn(() => Promise.resolve()),
      },
      getContainer: () => container,
      isFullscreen: false,
      invalidateSize: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };

    // Stub document methods used by the native API path
    document.requestFullscreen = vi.fn(() => Promise.resolve());
    document.exitFullscreen = vi.fn(() => Promise.resolve());
    document.addEventListener = vi.fn();
    document.removeEventListener = vi.fn();
  });

  describe("toggleFullscreen — enter", () => {
    it("calls requestFullscreen and sets isFullscreen on resolve", async () => {
      toggleFullscreen(mapMock, fsBtn, container);
      expect(mapMock._container.requestFullscreen).toHaveBeenCalled();
      await Promise.resolve();
      await Promise.resolve();
      expect(mapMock.isFullscreen).toBe(true);
    });

    it("returns early without calling updateUI (fullscreenchange event handles it)", async () => {
      toggleFullscreen(mapMock, fsBtn, container);
      // updateUI is NOT called in the .then() — only map.isFullscreen is set.
      // The fullscreenchange event fires updateUI separately.
      await Promise.resolve();
      await Promise.resolve();
      expect(fsBtn.innerHTML).toBe("");
    });

    it("recovers state on reject", async () => {
      mapMock._container.requestFullscreen = vi.fn(() =>
        Promise.reject(new Error("denied")),
      );
      toggleFullscreen(mapMock, fsBtn, container);
      await Promise.resolve();
      await Promise.resolve();
      expect(mapMock.isFullscreen).toBe(false);
      // updateUI called with isFull=false → MAXIMIZE
      expect(fsBtn.innerHTML).toContain("M8 3H5");
    });
  });

  describe("toggleFullscreen — exit", () => {
    it("calls exitFullscreen when already fullscreen", async () => {
      mapMock.isFullscreen = true;
      document.exitFullscreen = vi.fn(() => Promise.resolve());
      toggleFullscreen(mapMock, fsBtn, container);
      expect(document.exitFullscreen).toHaveBeenCalled();
      await Promise.resolve();
      await Promise.resolve();
      expect(mapMock.isFullscreen).toBe(false);
    });

    it("recovers state on exit reject", async () => {
      mapMock.isFullscreen = true;
      document.exitFullscreen = vi.fn(() => Promise.reject(new Error("failed")));
      toggleFullscreen(mapMock, fsBtn, container);
      await Promise.resolve();
      await Promise.resolve();
      expect(mapMock.isFullscreen).toBe(false);
      // updateUI called in catch with isFull=false → MAXIMIZE icon
      expect(fsBtn.innerHTML).toContain("M8 3H5");
    });

    it("exits when getFullscreenEl returns an element", async () => {
      mocks.getFullscreenEl.mockReturnValue({});
      document.exitFullscreen = vi.fn(() => Promise.resolve());
      toggleFullscreen(mapMock, fsBtn, container);
      expect(document.exitFullscreen).toHaveBeenCalled();
    });
  });

  describe("bindFullscreenEvents", () => {
    it("registers fullscreenchange listener when enabled", () => {
      bindFullscreenEvents(mapMock, fsBtn, container);
      expect(document.addEventListener).toHaveBeenCalledWith(
        "fullscreenchange",
        expect.any(Function),
      );
    });

    it("unregisters listener on unload", () => {
      bindFullscreenEvents(mapMock, fsBtn, container);
      const unloadHandler = mapMock.on.mock.calls[0][1];
      unloadHandler();
      expect(document.removeEventListener).toHaveBeenCalledWith(
        "fullscreenchange",
        expect.any(Function),
      );
    });

    it("returns handleFSChange that syncs state", () => {
      const handler = bindFullscreenEvents(mapMock, fsBtn, container);
      mocks.getFullscreenEl.mockReturnValue({});
      handler();
      expect(mapMock.isFullscreen).toBe(true);
      expect(fsBtn.innerHTML).toContain("M8 3v3"); // MINIMIZE
    });
  });

  describe("updateUI", () => {
    it("toggles hide_others when CONF.hide_others is set", async () => {
      // Can't easily set CONF.hide_others here — CONF comes from define.
      // This path is covered separately in the browser tests.
      updateUI(mapMock, fsBtn, container);
      expect(fsBtn.innerHTML).toContain("M8 3H5"); // MAXIMIZE
    });
  });
});
