import { beforeEach, describe, expect, it, vi } from "vitest";
import { PANEL_CLASS } from "#ui/panelClassName.js";
import { CLASSES } from "#control/FullscreenControl/const.js";
import {
  buildFullscreenChangeHandler,
  releasePseudo,
  toggleFullscreen,
  updateUI,
} from "#control/FullscreenControl/logic.js";

// Mutable state controlled by each describe's beforeEach to switch between the
// native API path (isEnabled=true) and the pseudo path (isEnabled=false).
const mocks = vi.hoisted(() => ({
  FULLSCREEN_CHANGE: "fullscreenchange",
  isEnabled: false,
  getFullscreenEl: vi.fn<() => HTMLElement | null>(() => null),
}));

vi.mock("#control/FullscreenControl/api.js", () => ({
  FULLSCREEN_CHANGE: mocks.FULLSCREEN_CHANGE,
  // Production reads this lazily per call — keep the mock lazy too so
  // `mocks.isEnabled = …` flips the branch on the very next toggle.
  isEnabled: vi.fn(() => mocks.isEnabled),
  get getFullscreenEl() {
    return mocks.getFullscreenEl;
  },
  // Mirrors the production ownership test without importing the real module:
  // a native session only belongs to the map whose container it relates to.
  ownsFullscreen: (container: Element) => {
    const fs = mocks.getFullscreenEl();
    return Boolean(
      fs && (fs === container || fs.contains(container) || container.contains(fs)),
    );
  },
}));

const makeContainer = (): HTMLElement => {
  const el = document.createElement("div");
  el.innerHTML = `
    <button class="foliplus-fullscreen-toggle"></button>
    <button class="foliplus-zoom-in"></button>
    <button class="foliplus-zoom-out"></button>
  `;
  return el;
};

const makeMapMock = (container: HTMLElement): L.Map =>
  ({
    getContainer: () => container,
    isFullscreen: false,
    invalidateSize: vi.fn(),
    foliplus: { hint: { set: vi.fn(), clear: vi.fn(), registerIcon: vi.fn() } },
    on: vi.fn(),
    off: vi.fn(),
  }) as L.Map;

const makeNativeMapMock = (container: HTMLElement): L.Map => {
  const map = makeMapMock(container);
  (
    map.getContainer() as HTMLElement & { requestFullscreen: () => Promise<void> }
  ).requestFullscreen = vi.fn(() => Promise.resolve());
  return map;
};

// Mirrors what defineControl hands off via ControlEnv — T is the identity
// translator so tests can still compare on the raw key.
const makeEnv = (
  overrides: Partial<ComponentConfig> = {},
  extra: { signal?: AbortSignal } = {},
): { config: ComponentConfig; T: (k: string) => string; signal?: AbortSignal } => ({
  config: { name: "FullscreenControl", ...overrides } as ComponentConfig,
  T: (k: string) => k,
  ...extra,
});

describe("updateUI", () => {
  let fsBtn: HTMLElement;
  let container: HTMLElement;
  let mapMock: L.Map;

  beforeEach(() => {
    mocks.getFullscreenEl.mockReturnValue(null);
    fsBtn = document.createElement("button");
    container = makeContainer();
    mapMock = {
      getContainer: () => container,
      isFullscreen: false,
      foliplus: { hint: { set: vi.fn(), clear: vi.fn(), registerIcon: vi.fn() } },
    } as L.Map;
  });

  it("sets MAXIMIZE icon + title when not fullscreen", () => {
    updateUI(mapMock, fsBtn, container, makeEnv());
    expect(fsBtn.innerHTML).toContain("M8 3H5"); // MAXIMIZE
    expect(fsBtn.title).toContain("title");
    expect(mapMock.foliplus.hint.set).toHaveBeenCalled();
  });

  it("sets MINIMIZE icon + title when fullscreen", () => {
    mapMock.isFullscreen = true;
    updateUI(mapMock, fsBtn, container, makeEnv());
    expect(fsBtn.innerHTML).toContain("M8 3v3"); // MINIMIZE
    expect(fsBtn.title).toContain("title_cancel");
    expect(mapMock.foliplus.hint.set).toHaveBeenCalled();
  });

  it("ignores a sibling map's native fullscreen (stays MAXIMIZE)", () => {
    // Native fullscreen is document-global. Another map being fullscreen does
    // not make this map fullscreen, so its button must not offer an exit that
    // would close the other map.
    mocks.getFullscreenEl.mockReturnValue(document.createElement("div"));
    updateUI(mapMock, fsBtn, container, makeEnv());
    expect(fsBtn.innerHTML).toContain("M8 3H5"); // MAXIMIZE
    expect(mapMock.foliplus.hint.set).toHaveBeenCalled();
  });

  it("skips hide_others when CONFIG.hide_others is not set", () => {
    updateUI(mapMock, fsBtn, container, makeEnv());
    // No class toggling on other controls since CONFIG.hide_others is falsy
    expect(fsBtn.innerHTML).toContain("M8 3H5");
  });

  it("skips hide_self when CONFIG.hide_self is not set", () => {
    updateUI(mapMock, fsBtn, container, makeEnv());
    const selfBtns = container.querySelectorAll(
      ".foliplus-fullscreen-toggle, .foliplus-zoom-in, .foliplus-zoom-out",
    );
    for (const btn of selfBtns) {
      expect(btn.classList.contains(PANEL_CLASS.HIDDEN)).toBe(false);
    }
  });

  it("hide_others: hides sibling controls but skips its own container", () => {
    const selfCtrl = document.createElement("div");
    selfCtrl.className = "leaflet-control";
    selfCtrl.appendChild(container); // c.contains(container) → skip
    const otherCtrl = document.createElement("div");
    otherCtrl.className = "leaflet-control"; // neither → gets hidden
    const mapContainer = document.createElement("div");
    mapContainer.append(selfCtrl, otherCtrl);
    mapMock.getContainer = () => mapContainer;
    mapMock.isFullscreen = true;

    updateUI(mapMock, fsBtn, container, makeEnv({ hide_others: true }));

    expect(otherCtrl.classList.contains(PANEL_CLASS.HIDDEN)).toBe(true);
    expect(selfCtrl.classList.contains(PANEL_CLASS.HIDDEN)).toBe(false);
  });

  it("hide_self: leaves the toggle visible while not fullscreen", () => {
    // The hide is a fullscreen-session state: outside one the toggle is the
    // way in, so it must not carry the hidden marker.
    updateUI(mapMock, fsBtn, container, makeEnv({ hide_self: true }));
    const toggle = container.querySelector<HTMLElement>(".foliplus-fullscreen-toggle");
    expect(toggle?.classList.contains(PANEL_CLASS.HIDDEN)).toBe(false);
  });

  it("hide_self: hides only the toggle, leaving the bar zoom usable", () => {
    // The bar exists to keep zoom reachable while hide_others hides Leaflet's
    // own control. Folding the zoom buttons into hide_self left a fullscreen
    // map with no zoom at all, and the docstring promises the toggle only.
    mapMock.isFullscreen = true;
    updateUI(mapMock, fsBtn, container, makeEnv({ hide_self: true }));

    const toggle = container.querySelector<HTMLElement>(".foliplus-fullscreen-toggle");
    expect(toggle?.classList.contains(PANEL_CLASS.HIDDEN)).toBe(true);
    for (const zoom of container.querySelectorAll<HTMLElement>(
      ".foliplus-zoom-in, .foliplus-zoom-out",
    )) {
      expect(zoom.classList.contains(PANEL_CLASS.HIDDEN)).toBe(false);
    }
  });

  it("hintText override replaces the default enter/exit wording", () => {
    mapMock.isFullscreen = true;
    updateUI(mapMock, fsBtn, container, makeEnv(), "fallback");
    expect(mapMock.foliplus.hint.set).toHaveBeenCalledWith(
      expect.any(String),
      "",
      "fallback",
      { duration: expect.any(Number) },
    );
  });
});

describe("toggleFullscreen — pseudo path", () => {
  let fsBtn: HTMLElement;
  let container: HTMLElement;
  let mapMock: L.Map;

  beforeEach(() => {
    mocks.isEnabled = false;
    mocks.getFullscreenEl.mockReturnValue(null);
    fsBtn = document.createElement("button");
    container = makeContainer();
    mapMock = makeMapMock(container);
  });

  it("enters pseudo-fullscreen", () => {
    toggleFullscreen(mapMock, fsBtn, container, makeEnv());
    expect(mapMock.getContainer().classList.contains(CLASSES.PSEUDO_FULLSCREEN)).toBe(
      true,
    );
    expect(mapMock.isFullscreen).toBe(true);
    expect(mapMock.invalidateSize).toHaveBeenCalled();
    // The enter hint is the fallback wording: in an embed without the
    // fullscreen permission the native claim "已进入全屏" would be a lie.
    expect(mapMock.foliplus.hint.set).toHaveBeenCalledWith(
      expect.any(String),
      "",
      expect.stringContaining("fallback"),
      { duration: expect.any(Number) },
    );
  });

  it("exits pseudo-fullscreen on second call", () => {
    toggleFullscreen(mapMock, fsBtn, container, makeEnv());
    toggleFullscreen(mapMock, fsBtn, container, makeEnv());
    expect(mapMock.getContainer().classList.contains(CLASSES.PSEUDO_FULLSCREEN)).toBe(
      false,
    );
    expect(mapMock.isFullscreen).toBe(false);
  });

  it("calls updateUI after toggle (icon changes to MINIMIZE)", () => {
    toggleFullscreen(mapMock, fsBtn, container, makeEnv());
    expect(fsBtn.innerHTML).toContain("M8 3v3"); // MINIMIZE
    expect(mapMock.foliplus.hint.set).toHaveBeenCalled();
  });
});

describe("releasePseudo", () => {
  it("strips a pseudo session left behind by a removed mounting", () => {
    const container = makeContainer();
    container.classList.add(CLASSES.PSEUDO_FULLSCREEN);
    const mapMock = makeMapMock(container);

    releasePseudo(mapMock);

    expect(container.classList.contains(CLASSES.PSEUDO_FULLSCREEN)).toBe(false);
    expect(mapMock.invalidateSize).toHaveBeenCalled();
    expect(mapMock.isFullscreen).toBe(false);
  });

  it("leaves a live native session alone (nothing pseudo to release)", () => {
    // Removing the control while the browser owns fullscreen must not tell the
    // map it left fullscreen — only the pseudo class is this control's to strip.
    const container = makeContainer();
    const mapMock = makeMapMock(container);
    mapMock.isFullscreen = true;

    releasePseudo(mapMock);

    expect(container.classList.contains(CLASSES.PSEUDO_FULLSCREEN)).toBe(false);
    expect(mapMock.isFullscreen).toBe(true);
    expect(mapMock.invalidateSize).not.toHaveBeenCalled();
  });
});

describe("buildFullscreenChangeHandler", () => {
  let fsBtn: HTMLElement;
  let container: HTMLElement;
  let mapMock: L.Map;

  beforeEach(() => {
    mocks.getFullscreenEl.mockReturnValue(null);
    fsBtn = document.createElement("button");
    container = makeContainer();
    mapMock = makeMapMock(container);
  });

  it("returns a handler function", () => {
    const handler = buildFullscreenChangeHandler(mapMock, fsBtn, container, makeEnv());
    expect(typeof handler).toBe("function");
  });

  it("handler no-ops when the transition belongs to another map", () => {
    // Nothing active on this container, no pseudo session, and this map does
    // not believe it is fullscreen: the event is somebody else's. Running
    // updateUI here was F-2 — it unhid controls and announced an exit.
    const handler = buildFullscreenChangeHandler(mapMock, fsBtn, container, makeEnv());
    handler();
    expect(mapMock.isFullscreen).toBe(false);
    expect(fsBtn.innerHTML).toBe(""); // never repainted
    expect(mapMock.foliplus.showHint).not.toHaveBeenCalled();
  });

  it("handler repaints when this map\'s own native session ends", () => {
    // The map believed it was fullscreen and the native element is gone: its
    // own session just ended, so this transition IS relevant and the icon
    // must go back to MAXIMIZE.
    mapMock.isFullscreen = true;
    const handler = buildFullscreenChangeHandler(mapMock, fsBtn, container, makeEnv());
    handler();
    expect(mapMock.isFullscreen).toBe(false);
    expect(fsBtn.innerHTML).toContain("M8 3H5"); // MAXIMIZE
  });

  it("handler syncs isFullscreen from the native fullscreen element", () => {
    const handler = buildFullscreenChangeHandler(mapMock, fsBtn, container, makeEnv());
    mocks.getFullscreenEl.mockReturnValue(container);
    handler();
    expect(mapMock.isFullscreen).toBe(true);
    expect(fsBtn.innerHTML).toContain("M8 3v3"); // MINIMIZE
  });

  it("handler ignores a sibling map's native fullscreen", () => {
    const handler = buildFullscreenChangeHandler(mapMock, fsBtn, container, makeEnv());
    mocks.getFullscreenEl.mockReturnValue(document.createElement("div"));

    handler();

    expect(mapMock.isFullscreen).toBe(false);
    // Scoped out before updateUI: the sibling transition owns its own map.
    expect(fsBtn.innerHTML).toBe("");
  });

  it("handler ignores a sibling transition without any side effect here", () => {
    // State was guarded before, but updateUI still ran: hide_others then
    // unhid every control on a map that was never fullscreen, and showHint
    // announced an exit the user never asked for on the wrong map.
    const mapContainer = document.createElement("div");
    const selfCtrl = document.createElement("div");
    selfCtrl.className = "leaflet-control";
    selfCtrl.appendChild(container);
    const otherCtrl = document.createElement("div");
    otherCtrl.className = "leaflet-control";
    mapContainer.append(selfCtrl, otherCtrl);
    mapMock.getContainer = () => mapContainer;
    mocks.getFullscreenEl.mockReturnValue(document.createElement("div"));

    const handler = buildFullscreenChangeHandler(
      mapMock,
      fsBtn,
      container,
      makeEnv({ hide_others: true, hide_self: true }),
    );
    handler();

    expect(mapMock.foliplus.showHint).not.toHaveBeenCalled();
    expect(otherCtrl.classList.contains(PANEL_CLASS.HIDDEN)).toBe(false);
  });

  it("handler keeps a pseudo session through a sibling map's native transition", () => {
    // The sibling's transition fires this handler too. This map is still in
    // pseudo mode, so its state must not be reset to "not fullscreen".
    container.classList.add(CLASSES.PSEUDO_FULLSCREEN);
    mocks.getFullscreenEl.mockReturnValue(document.createElement("div"));
    const handler = buildFullscreenChangeHandler(mapMock, fsBtn, container, makeEnv());

    handler();

    expect(mapMock.isFullscreen).toBe(true);
    expect(mapMock.getContainer().classList.contains(CLASSES.PSEUDO_FULLSCREEN)).toBe(
      true,
    );
    expect(fsBtn.innerHTML).toContain("M8 3v3"); // MINIMIZE
  });

  it("handler clears a stale pseudo class when native fullscreen wins", () => {
    // Native and pseudo cannot both own the same container: the class would
    // survive the native exit and keep every overlay hosted in a container
    // that is no longer a surface.
    container.classList.add(CLASSES.PSEUDO_FULLSCREEN);
    mocks.getFullscreenEl.mockReturnValue(container);
    const handler = buildFullscreenChangeHandler(mapMock, fsBtn, container, makeEnv());

    handler();

    expect(mapMock.getContainer().classList.contains(CLASSES.PSEUDO_FULLSCREEN)).toBe(
      false,
    );
    expect(mapMock.isFullscreen).toBe(true);
  });
});

describe("toggleFullscreen — native API path", () => {
  let fsBtn: HTMLElement;
  let container: HTMLElement;
  let mapMock: L.Map;

  beforeEach(() => {
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
  });

  it("calls requestFullscreen and sets isFullscreen on resolve", async () => {
    toggleFullscreen(mapMock, fsBtn, container, makeEnv());
    expect(mapMock.getContainer().requestFullscreen).toHaveBeenCalled();
    await Promise.resolve();
    await Promise.resolve();
    expect(mapMock.isFullscreen).toBe(true);
  });

  it("keeps the exit transition relevant after the exit branch clears the flag", async () => {
    // Enter natively, then exit through the toggle. The exit branch clears
    // map.isFullscreen in its .then() before the fullscreenchange event lands,
    // so a guard that only reads the map would treat this map's own exit as
    // somebody else's transition and swallow the exit hint.
    const handler = buildFullscreenChangeHandler(mapMock, fsBtn, container, makeEnv());

    toggleFullscreen(mapMock, fsBtn, container, makeEnv());
    await Promise.resolve();
    await Promise.resolve();
    expect(mapMock.isFullscreen).toBe(true);

    // The exit branch is the ownsFullscreen one: the browser says this
    // container is fullscreen, so the toggle asks the native API to leave.
    mocks.getFullscreenEl.mockReturnValue(container);
    toggleFullscreen(mapMock, fsBtn, container, makeEnv());
    await Promise.resolve();
    await Promise.resolve();
    expect(mapMock.isFullscreen).toBe(false);
    expect(mapMock.foliplus.showHint).not.toHaveBeenCalled();

    mocks.getFullscreenEl.mockReturnValue(null);
    handler();

    expect(mapMock.isFullscreen).toBe(false);
    expect(mapMock.foliplus.showHint).toHaveBeenCalledTimes(1);
    expect(fsBtn.innerHTML).toContain("M8 3H5"); // MAXIMIZE
  });

  it("returns early without calling updateUI (fullscreenchange event handles it)", async () => {
    toggleFullscreen(mapMock, fsBtn, container, makeEnv());
    // updateUI is NOT called in the .then() — only map.isFullscreen is set.
    // The fullscreenchange event fires updateUI separately.
    await Promise.resolve();
    await Promise.resolve();
    expect(fsBtn.innerHTML).toBe("");
  });

  it("falls back to pseudo-fullscreen with the fallback hint on reject", async () => {
    mapMock.getContainer().requestFullscreen = vi.fn(() =>
      Promise.reject(new Error("denied")),
    );
    toggleFullscreen(mapMock, fsBtn, container, makeEnv());
    await Promise.resolve();
    await Promise.resolve();
    // The rejection must not dead-end: the container lands in pseudo mode so
    // the click still maximizes the map within the page.
    expect(mapMock.getContainer().classList.contains(CLASSES.PSEUDO_FULLSCREEN)).toBe(
      true,
    );
    expect(mapMock.isFullscreen).toBe(true);
    expect(mapMock.invalidateSize).toHaveBeenCalled();
    // The hint explains the fallback instead of announcing "entered fullscreen".
    expect(mapMock.foliplus.hint.set).toHaveBeenCalledWith(
      expect.any(String),
      "",
      expect.stringContaining("fallback"),
      { duration: expect.any(Number) },
    );
  });

  it("does not enter pseudo when a rejection still left native fullscreen on", async () => {
    // Some implementations reject after the transition completed. Entering
    // pseudo here would leave both states on the container, and the exit
    // branch (native first) would never clear the class.
    // Null at the toggle's entry check, the map container by the time the
    // rejection lands: the "reject after a successful transition" ordering.
    mocks.getFullscreenEl.mockReturnValueOnce(null).mockReturnValue(container);
    mapMock.getContainer().requestFullscreen = vi.fn(() =>
      Promise.reject(new Error("late reject")),
    );

    toggleFullscreen(mapMock, fsBtn, container, makeEnv());
    await Promise.resolve();
    await Promise.resolve();

    expect(mapMock.getContainer().classList.contains(CLASSES.PSEUDO_FULLSCREEN)).toBe(
      false,
    );
    expect(mapMock.isFullscreen).toBe(true);
  });

  it("drops a stale pseudo class on a rejected native request", async () => {
    // Defense in depth: even if a class was already present (a previous
    // partial transition), a rejection with native active must reconcile it.
    container.classList.add(CLASSES.PSEUDO_FULLSCREEN);
    mocks.getFullscreenEl.mockReturnValueOnce(null).mockReturnValue(container);
    mapMock.getContainer().requestFullscreen = vi.fn(() =>
      Promise.reject(new Error("denied")),
    );
    document.exitFullscreen = vi.fn(() => Promise.resolve());

    toggleFullscreen(mapMock, fsBtn, container, makeEnv());
    await Promise.resolve();
    await Promise.resolve();

    expect(mapMock.getContainer().classList.contains(CLASSES.PSEUDO_FULLSCREEN)).toBe(
      false,
    );
  });

  it("does not fall back when the mounting was removed mid-request", async () => {
    // The rejection lands after map.removeControl(): falling back to pseudo
    // would re-enter with the toggle already gone, and nothing would ever
    // strip the class — every body-level overlay would keep resolving its host
    // to a container no control owns.
    mapMock.getContainer().requestFullscreen = vi.fn(() =>
      Promise.reject(new Error("denied")),
    );
    const ac = new AbortController();
    toggleFullscreen(mapMock, fsBtn, container, makeEnv({}, { signal: ac.signal }));
    ac.abort();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mapMock.getContainer().classList.contains(CLASSES.PSEUDO_FULLSCREEN)).toBe(
      false,
    );
    expect(mapMock.isFullscreen).toBe(false);
    // The fallback hint explains an in-page fallback; a removed mounting must
    // not announce one.
    expect(mapMock.foliplus.hint.set).not.toHaveBeenCalled();
  });

  it("does not exit a sibling map's native fullscreen; requests its own", async () => {
    // Another map owns the document's fullscreen session. Clicking this
    // control must not exit that session — it has nothing of its own to exit,
    // so it enters fullscreen for its own container.
    mocks.getFullscreenEl.mockReturnValue(document.createElement("div"));

    toggleFullscreen(mapMock, fsBtn, container, makeEnv());

    expect(document.exitFullscreen).not.toHaveBeenCalled();
    expect(mapMock.getContainer().requestFullscreen).toHaveBeenCalled();

    await Promise.resolve();
    await Promise.resolve();
    expect(mapMock.isFullscreen).toBe(true);
  });

  it("exits its own pseudo session without touching a sibling's native one", () => {
    // Permission was off when the pseudo session started, then a sibling map
    // went native. The click must close this map's pseudo mode and leave the
    // sibling's session alone.
    mocks.isEnabled = false;
    toggleFullscreen(mapMock, fsBtn, container, makeEnv());
    expect(mapMock.isFullscreen).toBe(true);

    mocks.isEnabled = true;
    mocks.getFullscreenEl.mockReturnValue(document.createElement("div"));
    toggleFullscreen(mapMock, fsBtn, container, makeEnv());

    expect(document.exitFullscreen).not.toHaveBeenCalled();
    expect(mapMock.getContainer().classList.contains(CLASSES.PSEUDO_FULLSCREEN)).toBe(
      false,
    );
    expect(mapMock.isFullscreen).toBe(false);
  });

  describe("toggle — exit", () => {
    it("calls exitFullscreen when a native fullscreen element exists", async () => {
      mocks.getFullscreenEl.mockReturnValue(container);
      document.exitFullscreen = vi.fn(() => Promise.resolve());
      toggleFullscreen(mapMock, fsBtn, container, makeEnv());
      expect(document.exitFullscreen).toHaveBeenCalled();
      await Promise.resolve();
      await Promise.resolve();
      expect(mapMock.isFullscreen).toBe(false);
    });

    it("exits pseudo mode when only map.isFullscreen is set (stale permission flip)", async () => {
      // A pseudo session started while the API was disabled must exit as
      // pseudo even if isEnabled() flips true afterwards — exitFullscreen on
      // a null element would reject and strand the pseudo class.
      mapMock.isFullscreen = true;
      document.exitFullscreen = vi.fn(() => Promise.resolve());
      toggleFullscreen(mapMock, fsBtn, container, makeEnv());
      expect(document.exitFullscreen).not.toHaveBeenCalled();
      expect(mapMock.getContainer().classList.contains(CLASSES.PSEUDO_FULLSCREEN)).toBe(
        false,
      );
      expect(mapMock.isFullscreen).toBe(false);
    });

    it("drops a stale pseudo class when a native exit completes", async () => {
      // A native session that began during a pseudo session can leave both
      // states on one container. The native exit path is the last chance to
      // clear the class; without this it would outlive the session.
      container.classList.add(CLASSES.PSEUDO_FULLSCREEN);
      mocks.getFullscreenEl.mockReturnValue(container);
      document.exitFullscreen = vi.fn(() => Promise.resolve());

      toggleFullscreen(mapMock, fsBtn, container, makeEnv());
      await Promise.resolve();
      await Promise.resolve();

      expect(mapMock.getContainer().classList.contains(CLASSES.PSEUDO_FULLSCREEN)).toBe(
        false,
      );
      expect(mapMock.isFullscreen).toBe(false);
    });

    it("recovers state and reports the exit-fail hint on exit reject", async () => {
      mocks.getFullscreenEl.mockReturnValue(container);
      document.exitFullscreen = vi.fn(() => Promise.reject(new Error("failed")));
      toggleFullscreen(mapMock, fsBtn, container, makeEnv());
      await Promise.resolve();
      await Promise.resolve();
      // Recovered to the real state — the exit failed, fullscreen is still on.
      expect(mapMock.isFullscreen).toBe(true);
      // No updateUI on the failed exit — the icon must not claim "exited".
      expect(fsBtn.innerHTML).toBe("");
      expect(mapMock.foliplus.hint.set).toHaveBeenCalledWith(
        expect.any(String),
        "",
        expect.stringContaining("exit_fail"),
        { duration: expect.any(Number) },
      );
    });
  });

  describe("nativeSessions — control teardown (P3)", () => {
    it("a re-added control discards a sibling's native transition after teardown", async () => {
      // P3: nativeSessions is module-level and only deleted by the handler's
      // exit branch. A control removed before the fullscreenchange event leaves
      // a stale entry (the handler that would clean it is unbound on removal),
      // so the re-added control's fresh handler misjudges a sibling's native
      // transition as this map's own exit — repainting the button and showing
      // an exit hint for a session it was never part of. Teardown must delete
      // the map from nativeSessions.
      const { releaseNativeSession } =
        await import("#control/FullscreenControl/logic.js");

      // Enter natively: the enter branch records the map in nativeSessions.
      toggleFullscreen(mapMock, fsBtn, container, makeEnv());
      await Promise.resolve();
      await Promise.resolve();
      expect(mapMock.isFullscreen).toBe(true);

      // Control removed mid-session (teardown). Without the release the stale
      // entry survives the re-add and the fresh handler below misjudges a
      // sibling's transition as this map's own.
      releaseNativeSession(mapMock);
      mapMock.isFullscreen = false;

      // Re-added control: a fresh handler bound by the new mounting.
      const reAdd = buildFullscreenChangeHandler(mapMock, fsBtn, container, makeEnv());

      // A sibling map's native transition fires fullscreenchange for every map.
      const sibling = document.createElement("div");
      mocks.getFullscreenEl.mockReturnValue(sibling);

      reAdd();

      // The re-added control must discard it: no repaint, no exit hint.
      expect(fsBtn.innerHTML).toBe("");
      expect(mapMock.foliplus.showHint).not.toHaveBeenCalled();
    });
  });
});
