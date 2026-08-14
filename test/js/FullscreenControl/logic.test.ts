import { CLASSES } from "#foliplus/FullscreenControl/const.js";
import {
  bindFullscreenEvents,
  toggleFullscreen,
  updateUI,
} from "#foliplus/FullscreenControl/logic.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mutable state controlled by each describe's beforeEach to switch between the
// native API path (isEnabled=true) and the pseudo path (isEnabled=false).
const mocks = vi.hoisted(() => ({
  nativeAPI: {
    requestFullscreen: "requestFullscreen",
    exitFullscreen: "exitFullscreen",
    fullscreenElement: "fullscreenElement",
    fullscreenEnabled: "fullscreenEnabled",
    fullscreenchange: "fullscreenchange",
    fullscreenerror: "fullscreenerror",
  },
  isEnabled: false,
  getFullscreenEl: vi.fn(() => null),
}));

vi.mock("#foliplus/FullscreenControl/api.js", () => ({
  nativeAPI: mocks.nativeAPI,
  get isEnabled() {
    return mocks.isEnabled;
  },
  get getFullscreenEl() {
    return mocks.getFullscreenEl;
  },
}));

const makeContainer = () => {
  const el = document.createElement("div");
  el.innerHTML = `
    <button class="foliplus-fullscreen-toggle"></button>
    <button class="foliplus-zoom-in"></button>
    <button class="foliplus-zoom-out"></button>
  `;
  return el;
};

const makeMapMock = container => ({
  getContainer: () => container,
  isFullscreen: false,
  invalidateSize: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
});

const makeNativeMapMock = container => {
  const map = makeMapMock(container);
  map.getContainer().requestFullscreen = vi.fn(() => Promise.resolve());
  return map;
};

describe("updateUI", () => {
  let fsBtn, container, mapMock;

  beforeEach(() => {
    vi.clearAllMocks();
    fsBtn = document.createElement("button");
    container = makeContainer();
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
    const selfBtns = container.querySelectorAll(
      ".foliplus-fullscreen-toggle, .foliplus-zoom-in, .foliplus-zoom-out",
    );
    for (const btn of selfBtns) {
      expect(btn.classList.contains(CLASSES.HIDDEN)).toBe(false);
    }
  });
});

describe("toggleFullscreen — pseudo path", () => {
  let fsBtn, container, mapMock;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isEnabled = false;
    mocks.getFullscreenEl.mockReturnValue(null);
    fsBtn = document.createElement("button");
    container = makeContainer();
    mapMock = makeMapMock(container);
  });

  it("enters pseudo-fullscreen", () => {
    toggleFullscreen(mapMock, fsBtn, container);
    expect(mapMock.getContainer().classList.contains(CLASSES.PSEUDO_FULLSCREEN)).toBe(
      true,
    );
    expect(mapMock.isFullscreen).toBe(true);
    expect(mapMock.invalidateSize).toHaveBeenCalled();
  });

  it("exits pseudo-fullscreen on second call", () => {
    toggleFullscreen(mapMock, fsBtn, container);
    toggleFullscreen(mapMock, fsBtn, container);
    expect(mapMock.getContainer().classList.contains(CLASSES.PSEUDO_FULLSCREEN)).toBe(
      false,
    );
    expect(mapMock.isFullscreen).toBe(false);
  });

  it("calls updateUI after toggle (icon changes to MINIMIZE)", () => {
    toggleFullscreen(mapMock, fsBtn, container);
    expect(fsBtn.innerHTML).toContain("M8 3v3"); // MINIMIZE
    expect(window.foliplus.showHint).toHaveBeenCalled();
  });
});

describe("bindFullscreenEvents — pseudo path", () => {
  let fsBtn, container, mapMock;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isEnabled = false;
    mocks.getFullscreenEl.mockReturnValue(null);
    fsBtn = document.createElement("button");
    container = makeContainer();
    mapMock = makeMapMock(container);
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

describe("toggleFullscreen — native API path", () => {
  let fsBtn, container, mapMock;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isEnabled = true;
    mocks.getFullscreenEl.mockReturnValue(null);
    fsBtn = document.createElement("button");
    container = makeContainer();
    mapMock = makeNativeMapMock(container);

    // Stub document methods used by the native API path
    (
      document as unknown as { requestFullscreen: () => Promise<void> }
    ).requestFullscreen = vi.fn(() => Promise.resolve());
    document.exitFullscreen = vi.fn(() => Promise.resolve());
    document.addEventListener = vi.fn();
    document.removeEventListener = vi.fn();
  });

  it("calls requestFullscreen and sets isFullscreen on resolve", async () => {
    toggleFullscreen(mapMock, fsBtn, container);
    expect(mapMock.getContainer().requestFullscreen).toHaveBeenCalled();
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
    mapMock.getContainer().requestFullscreen = vi.fn(() =>
      Promise.reject(new Error("denied")),
    );
    toggleFullscreen(mapMock, fsBtn, container);
    await Promise.resolve();
    await Promise.resolve();
    expect(mapMock.isFullscreen).toBe(false);
    // updateUI called with isFull=false → MAXIMIZE
    expect(fsBtn.innerHTML).toContain("M8 3H5");
  });

  describe("toggle — exit", () => {
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
});

describe("bindFullscreenEvents — native API path", () => {
  let fsBtn, container, mapMock;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isEnabled = true;
    mocks.getFullscreenEl.mockReturnValue(null);
    fsBtn = document.createElement("button");
    container = makeContainer();
    mapMock = makeNativeMapMock(container);

    document.addEventListener = vi.fn();
    document.removeEventListener = vi.fn();
  });

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
