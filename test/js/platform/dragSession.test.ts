// test/js/platform/dragSession.test.ts — one live pointer drag, ended however it ends.
import { afterEach, describe, expect, it, vi } from "vitest";
import { beginDragSession, type DragSession } from "#platform/dragSession.js";

const live: DragSession[] = [];

const start = (onEnd: () => void): DragSession => {
  const session = beginDragSession(onEnd);
  live.push(session);
  return session;
};

afterEach(() => {
  // End anything a test left live so the page-level subscription is released
  // and the next test starts from a clean page.
  for (const session of live.splice(0)) session.end();
  const state = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
  if (state) Object.defineProperty(document, "visibilityState", state);
});

describe("dragSession", () => {
  it("ends on the explicit release, exactly once", () => {
    const onEnd = vi.fn();
    const session = start(onEnd);
    expect(session.active).toBe(true);

    session.end();
    expect(session.active).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);

    // A release that arrives twice (pointerup plus a late lostpointercapture)
    // must not run the restore twice.
    session.end();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("ends when the window loses focus", () => {
    const onEnd = vi.fn();
    const session = start(onEnd);

    window.dispatchEvent(new Event("blur"));

    expect(session.active).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("ends when the tab goes hidden, but not when it comes back", () => {
    const onEnd = vi.fn();
    start(onEnd);
    const state = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "visibilityState",
    );

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onEnd).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onEnd).toHaveBeenCalledTimes(1);
    if (state) Object.defineProperty(document, "visibilityState", state);
  });

  it("ends on a move whose button is already up, and refuses that move", () => {
    // The release happened over another window: no pointerup reaches this page
    // and the window may not even blur. The move itself says no button is down.
    const onEnd = vi.fn();
    const session = start(onEnd);

    expect(session.track({ buttons: 1 })).toBe(true);
    expect(onEnd).not.toHaveBeenCalled();

    expect(session.track({ buttons: 0 })).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(session.active).toBe(false);
  });

  it("does not read a missing buttons value as a release", () => {
    // Synthetic events (and some synthetic mouse events in tests) carry no
    // buttons; treating undefined as 0 would end every drag on the first move.
    const onEnd = vi.fn();
    const session = start(onEnd);

    expect(session.track({})).toBe(true);
    expect(session.track({ buttons: undefined })).toBe(true);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("tracks nothing once ended", () => {
    const onEnd = vi.fn();
    const session = start(onEnd);
    session.end();

    expect(session.track({ buttons: 1 })).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("releases its interrupt subscription when the session ends", () => {
    // A page whose drags all ended must not keep reacting to a later blur.
    const onEnd = vi.fn();
    const session = start(onEnd);
    session.end();

    window.dispatchEvent(new Event("blur"));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
