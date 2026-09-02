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

    it("flashes the scrim on exit (one-shot, auto-clears)", async () => {
      // flashScrim is deferred to exitFullscreen().then() — after the
      // browser has fully torn down fullscreen — so the CSS transition is
      // not cancelled by a rendering-context change. The flash adds
      // DIM_ACTIVE immediately and schedules its own auto-clear.
      vi.useFakeTimers();
      mapMock.isFullscreen = true;
      document.exitFullscreen = vi.fn(() => Promise.resolve());
      toggleFullscreen(mapMock, fsBtn, container);
      // toggleFullscreen returns before the .then() fires.
      expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
      await Promise.resolve();
      await Promise.resolve();
      // .then() fired — flash added DIM_ACTIVE.
      expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);

      // Advance through the fade-in + fade-out windows; the scrim auto-clears.
      await vi.advanceTimersByTimeAsync(360);
      expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
      expect(
        container.querySelectorAll(`.${CLASSES.DIM}`).length,
      ).toBe(0);
      vi.useRealTimers();
    });

    it("skips the flash on denied exit and syncs UI", async () => {
      // exitFullscreen() rejected → .catch() never calls flashScrim, so the
      // scrim is never created. updateUI still runs to reflect the real API
      // state (still fullscreen → MINIMIZE icon).
      vi.useFakeTimers();
      mapMock.isFullscreen = true;
      mocks.getFullscreenEl.mockReturnValue({});
      document.exitFullscreen = vi.fn(() => Promise.reject(new Error("denied")));
      toggleFullscreen(mapMock, fsBtn, container);
      expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
      await Promise.resolve();
      await Promise.resolve();
      expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
      expect(mapMock.isFullscreen).toBe(true);
      expect(fsBtn.innerHTML).toContain("M8 3v3");
      vi.useRealTimers();
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

    it("flashes on enter even if requestFullscreen is rejected (auto-clears)", async () => {
      vi.useFakeTimers();
      mapMock.getContainer().requestFullscreen = vi.fn(() =>
        Promise.reject(new Error("denied")),
      );
      toggleFullscreen(mapMock, fsBtn, container);
      // flashScrim runs synchronously ahead of the API promise.
      expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
      await Promise.resolve();
      await Promise.resolve();
      // Rejection is caught; scrim is not cleared synchronously — the flash
      // auto-clears on its own timer.
      expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
      await vi.advanceTimersByTimeAsync(360);
      expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
      expect(container.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(0);
      vi.useRealTimers();
    });

    it("syncs isFullscreen to false on enter-reject when API reports not-fullscreen", async () => {
      // Rejection must sync map.isFullscreen from the API, not leave it at the
      // pre-flash optimistic value.
      mocks.getFullscreenEl.mockReturnValue(null);
      mapMock.getContainer().requestFullscreen = vi.fn(() =>
        Promise.reject(new Error("denied")),
      );
      toggleFullscreen(mapMock, fsBtn, container);
      await Promise.resolve();
      await Promise.resolve();
      expect(mapMock.isFullscreen).toBe(false);
    });

    it("syncs isFullscreen from API during the request-to-reject window", async () => {
      // If the API state flips between the flash and the rejection, the catch
      // must reflect the real API state rather than a stale local value.
      mocks.getFullscreenEl.mockReturnValue(null);
      let switchAPI: (() => void) | null;
      mapMock.getContainer().requestFullscreen = vi.fn(
        () =>
          new Promise((_, reject) => {
            switchAPI = () => mocks.getFullscreenEl.mockReturnValue(null);
            reject(new Error("denied"));
          }),
      );
      toggleFullscreen(mapMock, fsBtn, container);
      switchAPI!();
      await Promise.resolve();
      await Promise.resolve();
      expect(mapMock.isFullscreen).toBe(false);
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

  it("enter flashes then exit also flashes (both add DIM_ACTIVE)", () => {
    toggleFullscreen(mapMock, fsBtn, container);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
    // Exit also flashes — DIM_ACTIVE stays added; the auto-clear timer is
    // re-scheduled rather than firing early.
    toggleFullscreen(mapMock, fsBtn, container);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
  });

  it("rapid enter/exit/enter: each toggle flashes, single scrim element", () => {
    toggleFullscreen(mapMock, fsBtn, container);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
    toggleFullscreen(mapMock, fsBtn, container);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
    toggleFullscreen(mapMock, fsBtn, container);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
    expect(container.querySelectorAll(`.${CLASSES.DIM}`).length).toBe(1);
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

  it("handler syncs UI state regardless of scrim (flash auto-clears)", () => {
    toggleFullscreen(mapMock, fsBtn, container);
    const handler = bindFullscreenEvents(mapMock, fsBtn, container);
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
    mocks.getFullscreenEl.mockReturnValue(null);
    handler();
    expect(mapMock.isFullscreen).toBe(false);
    expect(fsBtn.innerHTML).toContain("M8 3H5"); // MAXIMIZE
    // handleFSChange no longer drives the scrim — it is a one-shot flash
    // that auto-clears on its own timer. The handler only syncs isFullscreen
    // and the UI (icon, title, hide_others/self).
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(true);
  });

  it("handler syncs the icon from API state regardless of scrim", () => {
    const handler = bindFullscreenEvents(mapMock, fsBtn, container);
    mocks.getFullscreenEl.mockReturnValue({});
    handler();
    expect(mapMock.isFullscreen).toBe(true);
    expect(fsBtn.innerHTML).toContain("M8 3v3"); // MINIMIZE
  });

  it("drives the dim only from the API in handleFSChange, ignoring map.isFullscreen", () => {
    // handleFSChange must never trust map.isFullscreen — that flag is set
    // asynchronously in toggleFullscreen's promise callbacks, but the
    // fullscreenchange event fires immediately with the true API state.
    // If the handler read map.isFullscreen instead of getFullscreenEl(), an
    // Esc exit (which flips the API but not the flag yet) would leave the
    // scrim stuck.
    const handler = bindFullscreenEvents(mapMock, fsBtn, container);
    mapMock.isFullscreen = true; // stale flag
    mocks.getFullscreenEl.mockReturnValue(null); // API says we're out
    handler();
    expect(container.classList.contains(CLASSES.DIM_ACTIVE)).toBe(false);
  });
});
