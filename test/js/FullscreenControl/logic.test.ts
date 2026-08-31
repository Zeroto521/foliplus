import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLASSES } from "#foliplus/FullscreenControl/const.js";
import {
  bindFullscreenEvents,
  toggleFullscreen,
  updateUI,
} from "#foliplus/FullscreenControl/logic.js";

// Clear the scrim between tests so one test's container state never leaks
// into the next.
const resetScrim = () => {
  document.body.className = "";
  document.querySelectorAll(`.${CLASSES.DIM}`).forEach(el => {
    el.parentElement?.classList.remove(CLASSES.DIM_ACTIVE);
    el.remove();
  });
};

// Mutable state controlled by each describe's beforeEach to switch between the
// native API path (isEnabled=true) and the pseudo path (isEnabled=false).
const mocks = vi.hoisted(() => ({
  FULLSCREEN_CHANGE: "fullscreenchange",
  isEnabled: false,
  getFullscreenEl: vi.fn(() => null),
}));

vi.mock("#foliplus/FullscreenControl/api.js", () => ({
  FULLSCREEN_CHANGE: mocks.FULLSCREEN_CHANGE,
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
  foliplus: { showHint: vi.fn(), hideHint: vi.fn() },
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
    resetScrim();
    fsBtn = document.createElement("button");
    container = makeContainer();
    mapMock = {
      getContainer: () => container,
      isFullscreen: false,
      foliplus: { showHint: vi.fn(), hideHint: vi.fn() },
    };
  });

  it("sets MAXIMIZE icon + title when not fullscreen", () => {
    updateUI(mapMock, fsBtn, container);
    expect(fsBtn.innerHTML).toContain("M8 3H5"); // MAXIMIZE
    expect(fsBtn.title).toContain("title");
    expect(mapMock.foliplus.showHint).toHaveBeenCalled();
  });

  it("sets MINIMIZE icon + title when fullscreen", () => {
    mapMock.isFullscreen = true;
    updateUI(mapMock, fsBtn, container);
    expect(fsBtn.innerHTML).toContain("M8 3v3"); // MINIMIZE
    expect(fsBtn.title).toContain("title_cancel");
    expect(mapMock.foliplus.showHint).toHaveBeenCalled();
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
    resetScrim();
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
    expect(mapMock.foliplus.showHint).toHaveBeenCalled();
  });
});

describe("bindFullscreenEvents — pseudo path", () => {
  let fsBtn, container, mapMock;

  beforeEach(() => {
    vi.clearAllMocks();
    resetScrim();
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
    resetScrim();
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

    it("clears the scrim as the basemap lightens", async () => {
      mapMock.isFullscreen = true;
      document.exitFullscreen = vi.fn(() => Promise.resolve());
      container.classList.add(CLASSES.DIM_ACTIVE);
      toggleFullscreen(mapMock, fsBtn, container);
      expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
    });
  });

  describe("crossfade scrim", () => {
    it("fades the basemap in before requestFullscreen settles", async () => {
      toggleFullscreen(mapMock, fsBtn, container);
      // The scrim is toggled synchronously, ahead of the API promise, so there
      // is no frame between the click and the fade.
      expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
      await Promise.resolve();
      await Promise.resolve();
      expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
    });

    it("clears the scrim when requestFullscreen is rejected", async () => {
      mapMock.getContainer().requestFullscreen = vi.fn(() =>
        Promise.reject(new Error("denied")),
      );
      toggleFullscreen(mapMock, fsBtn, container);
      expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
      await Promise.resolve();
      await Promise.resolve();
      expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
    });
  });
});

describe("toggleFullscreen — crossfade scrim, pseudo path", () => {
  let fsBtn, container, mapMock;

  beforeEach(() => {
    vi.clearAllMocks();
    resetScrim();
    mocks.isEnabled = false;
    mocks.getFullscreenEl.mockReturnValue(null);
    fsBtn = document.createElement("button");
    container = makeContainer();
    mapMock = makeMapMock(container);
  });

  it("fades the basemap in on enter", () => {
    toggleFullscreen(mapMock, fsBtn, container);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
  });

  it("fades the basemap out on exit", () => {
    toggleFullscreen(mapMock, fsBtn, container);
    toggleFullscreen(mapMock, fsBtn, container);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
  });

  it("ends up dimmed after a third toggle", () => {
    toggleFullscreen(mapMock, fsBtn, container);
    toggleFullscreen(mapMock, fsBtn, container);
    toggleFullscreen(mapMock, fsBtn, container);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
  });

  it("mounts the scrim lazily — nothing is in the DOM before the first toggle", () => {
    expect(container.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(0);
    toggleFullscreen(mapMock, fsBtn, container);
    // The scrim is a child of the map container, not of body: in native
    // fullscreen the user agent paints only the fullscreen element and its
    // descendants, so a body-mounted scrim would never paint.
    expect(container.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(1);
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

  it("clears the dim when the API reports fullscreen is gone", () => {
    // Esc exits fullscreen without touching the button, so the dim has to
    // follow the API state from here or the basemap stays darkened.
    const handler = bindFullscreenEvents(mapMock, fsBtn, container);
    toggleFullscreen(mapMock, fsBtn, container);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
    mocks.getFullscreenEl.mockReturnValue(null);
    handler();
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
  });

  it("keeps the dim while the API still reports fullscreen", () => {
    const handler = bindFullscreenEvents(mapMock, fsBtn, container);
    mocks.getFullscreenEl.mockReturnValue({});
    handler();
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
  });
});
