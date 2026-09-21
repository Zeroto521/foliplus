import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextFrame, throttleRaf } from "#common/throttle.js";

describe("throttleRaf", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", cb => setTimeout(cb, 0));
    vi.stubGlobal("cancelAnimationFrame", id => clearTimeout(id));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("coalesces multiple calls into one per frame", async () => {
    const fn = vi.fn();
    const throttled = throttleRaf(fn);
    throttled();
    throttled();
    throttled();
    await new Promise(r => setTimeout(r, 20));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("runs again on a subsequent frame", async () => {
    const fn = vi.fn();
    const throttled = throttleRaf(fn);
    throttled();
    await new Promise(r => setTimeout(r, 20));
    throttled();
    await new Promise(r => setTimeout(r, 20));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("cancel() drops a pending frame", async () => {
    const fn = vi.fn();
    const throttled = throttleRaf(fn);
    throttled();
    throttled.cancel();
    await new Promise(r => setTimeout(r, 20));
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("nextFrame", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", cb => setTimeout(cb, 0));
    vi.stubGlobal("cancelAnimationFrame", id => clearTimeout(id));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs on the next frame", async () => {
    const fn = vi.fn();
    nextFrame(fn);
    expect(fn).not.toHaveBeenCalled();
    await new Promise(r => setTimeout(r, 20));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not coalesce — each call schedules its own frame", async () => {
    const fn = vi.fn();
    nextFrame(fn);
    nextFrame(fn);
    await new Promise(r => setTimeout(r, 20));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("cancel drops the pending frame", async () => {
    const fn = vi.fn();
    const cancel = nextFrame(fn);
    cancel();
    await new Promise(r => setTimeout(r, 20));
    expect(fn).not.toHaveBeenCalled();
  });
});
