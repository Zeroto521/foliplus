import { afterEach, describe, expect, it, vi } from "vitest";
import { setPseudoFullscreen } from "#platform/fullscreen.js";
import {
  SLIDER_CLASS,
  Slider,
  type SliderOptions,
  finishSlidersIn,
  sliderOf,
} from "#ui/index.js";

const hosts: HTMLElement[] = [];

const make = (options: SliderOptions) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const slider = new Slider(host, options);
  return { host, slider };
};

const thumb = (host: HTMLElement, index = 0): HTMLElement =>
  host.querySelectorAll<HTMLElement>(`.${SLIDER_CLASS.THUMB}`)[index];

const press = (el: HTMLElement, key: string): void => {
  el.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
};

type RectInit = { left?: number; top?: number; width?: number; height?: number };

const fakeRect = ({
  left = 0,
  top = 0,
  width = 100,
  height = 14,
}: RectInit = {}): DOMRect =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

const trackOf = (host: HTMLElement): HTMLElement =>
  host.querySelector(`.${SLIDER_CLASS.TRACK}`) as HTMLElement;

/** jsdom reports a 0×0 rect for everything; the pointer paths need a rail. */
const stubTrack = (host: HTMLElement, init: RectInit = {}): HTMLElement => {
  const track = trackOf(host);
  track.getBoundingClientRect = () => fakeRect(init);
  return track;
};

const pointer = (type: string, clientX: number): MouseEvent =>
  new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY: 7,
    button: 0,
  });

afterEach(() => {
  for (const host of hosts.splice(0)) {
    sliderOf(host)?.destroy();
    host.remove();
  }
});

describe("Slider primitive", () => {
  it("renders one thumb for a value and two for a range", () => {
    const single = make({
      min: 0,
      max: 100,
      value: 40,
      label: "透明度",
      values: { min: "0", max: "100" },
    });
    expect(single.host.querySelectorAll(`.${SLIDER_CLASS.THUMB}`)).toHaveLength(1);
    expect(thumb(single.host).getAttribute("aria-valuenow")).toBe("40");

    const range = make({ min: 0, max: 19, value: [4, 8], label: "可见范围" });
    expect(range.host.querySelectorAll(`.${SLIDER_CLASS.THUMB}`)).toHaveLength(2);
    expect(range.host.getAttribute("role")).toBe("group");
  });

  it("exposes the instance from the host", () => {
    const { host, slider } = make({ min: 0, max: 10, value: 3, label: "x" });
    expect(sliderOf(host)).toBe(slider);
  });

  it("clamps and snaps external writes", () => {
    const { host } = make({ min: 0, max: 100, step: 10, value: 40, label: "x" });
    const slider = sliderOf(host)!;
    slider.setValue(37);
    expect(slider.value).toBe(40);
    slider.setValue(1000);
    expect(slider.value).toBe(100);
    slider.setValue(-5);
    expect(slider.value).toBe(0);
  });

  it("keeps a range ordered when written backwards", () => {
    const { host } = make({ min: 0, max: 19, value: [4, 8], label: "x" });
    const slider = sliderOf(host)!;
    slider.setValue([15, 5]);
    expect(slider.value).toEqual([5, 15]);
  });

  it("drives the value and aria from the keyboard", () => {
    const input = vi.fn();
    const change = vi.fn();
    const { host } = make({ min: 0, max: 100, value: 40, label: "x", input, change });
    press(thumb(host), "ArrowRight");
    expect(sliderOf(host)!.value).toBe(41);
    expect(input).toHaveBeenCalledWith(41);
    expect(change).toHaveBeenCalledWith(41);
    expect(thumb(host).getAttribute("aria-valuenow")).toBe("41");
    press(thumb(host), "Home");
    expect(sliderOf(host)!.value).toBe(0);
    press(thumb(host), "End");
    expect(sliderOf(host)!.value).toBe(100);
  });

  it("slides a collapsed pair together instead of dead-locking", () => {
    const { host } = make({ min: 0, max: 19, value: [10, 10], label: "x" });
    const slider = sliderOf(host)!;
    press(thumb(host, 0), "ArrowRight");
    expect(slider.value).toEqual([11, 11]);
    press(thumb(host, 1), "ArrowLeft");
    expect(slider.value).toEqual([10, 10]);
  });

  it("clamps a normal range at the neighbour", () => {
    const { host } = make({ min: 0, max: 19, value: [5, 9], label: "x" });
    for (let i = 0; i < 4; i += 1) press(thumb(host, 0), "ArrowRight");
    expect(sliderOf(host)!.value).toEqual([9, 9]);
    // One more step touches the neighbour; the pair then slides together.
    press(thumb(host, 0), "ArrowRight");
    expect(sliderOf(host)!.value).toEqual([10, 10]);
  });

  it("goes inert when disabled", () => {
    const change = vi.fn();
    const { host } = make({
      min: 0,
      max: 100,
      value: 40,
      label: "x",
      disabled: true,
      change,
    });
    expect(host.classList.contains(SLIDER_CLASS.DISABLED)).toBe(true);
    expect(thumb(host).getAttribute("aria-disabled")).toBe("true");
    expect(thumb(host).tabIndex).toBe(-1);
    press(thumb(host), "ArrowRight");
    expect(sliderOf(host)!.value).toBe(40);
    expect(change).not.toHaveBeenCalled();

    sliderOf(host)!.setDisabled(false);
    expect(thumb(host).tabIndex).toBe(0);
    expect(thumb(host).getAttribute("aria-disabled")).toBe("false");
  });

  it("mirrors the rail in RTL", () => {
    const host = document.createElement("div");
    host.style.direction = "rtl";
    document.body.appendChild(host);
    hosts.push(host);
    new Slider(host, { min: 0, max: 100, value: 25, label: "x" });
    expect(thumb(host).style.left).toBe("75%");
  });

  it("announces a description with the control and the group", () => {
    const single = make({
      min: 0,
      max: 10,
      value: 2,
      label: "x",
      describedBy: "hint-1",
    });
    expect(thumb(single.host).getAttribute("aria-describedby")).toBe("hint-1");

    const range = make({
      min: 0,
      max: 10,
      value: [2, 4],
      label: "x",
      describedBy: "hint-2",
    });
    expect(range.host.getAttribute("aria-describedby")).toBe("hint-2");
    expect(thumb(range.host, 0).getAttribute("aria-describedby")).toBe("hint-2");
    expect(thumb(range.host, 1).getAttribute("aria-describedby")).toBe("hint-2");
  });

  it("rebuilds the marks and the current label when their data changes", () => {
    const { host } = make({
      min: 0,
      max: 19,
      value: [4, 8],
      label: "x",
      marks: [{ at: 0, tone: "limit" }],
      values: { min: "0", max: "19" },
      current: { at: 12, text: "12" },
    });
    const slider = sliderOf(host)!;
    slider.setMarks([
      { at: 0, tone: "limit" },
      { at: 19, tone: "limit" },
    ]);
    expect(host.querySelectorAll(`.${SLIDER_CLASS.DOT}`)).toHaveLength(2);
    slider.setCurrent({ at: 13, text: "13" });
    expect(host.querySelector(`.${SLIDER_CLASS.VALUE_CURRENT}`)?.textContent).toBe(
      "13",
    );
    slider.setCurrent(null);
    expect(host.querySelector(`.${SLIDER_CLASS.VALUE_CURRENT}`)).toBeNull();
    slider.setCurrent(null);
    expect(host.querySelector(`.${SLIDER_CLASS.VALUE_CURRENT}`)).toBeNull();
  });

  it("toggles describedBy and disabled state in place", () => {
    const { host } = make({ min: 0, max: 10, value: 2, label: "x" });
    const slider = sliderOf(host)!;
    slider.setDescribedBy("hint-9");
    expect(thumb(host).getAttribute("aria-describedby")).toBe("hint-9");
    slider.setDescribedBy(undefined);
    expect(thumb(host).hasAttribute("aria-describedby")).toBe(false);

    slider.setDisabled(true);
    expect(thumb(host).getAttribute("aria-disabled")).toBe("true");
    slider.setDisabled(true);
    expect(thumb(host).getAttribute("aria-disabled")).toBe("true");
    slider.setDisabled(false);
    expect(thumb(host).getAttribute("aria-disabled")).toBe("false");
  });

  it("re-reads the inline direction on demand", () => {
    const { host } = make({ min: 0, max: 100, value: 25, label: "x" });
    expect(thumb(host).style.left).toBe("25%");
    host.style.direction = "rtl";
    sliderOf(host)!.refreshDirection();
    expect(thumb(host).style.left).toBe("75%");
  });

  it("dismisses the bubble on demand and on scroll", () => {
    const { host } = make({ min: 0, max: 100, value: 42, label: "x" });
    const thumbEl = thumb(host);
    thumbEl.dispatchEvent(new Event("focus"));
    const bubble = document.querySelector(`.${SLIDER_CLASS.BUBBLE}`) as HTMLElement;
    expect(bubble.classList.contains("is-on")).toBe(true);
    sliderOf(host)!.dismissBubble();
    expect(bubble.classList.contains("is-on")).toBe(false);
    thumbEl.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("scroll"));
    expect(bubble.classList.contains("is-on")).toBe(false);
  });

  it("clamps a normal range at the neighbour through the pointer path", () => {
    const { host } = make({ min: 0, max: 100, value: [20, 80], label: "x" });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 10));
    track.dispatchEvent(pointer("pointermove", 95));
    expect(sliderOf(host)!.value).toEqual([80, 80]);
    track.dispatchEvent(pointer("pointerup", 95));
  });

  it("ignores non-primary buttons and stray pointer events", () => {
    const { host } = make({ min: 0, max: 100, value: 40, label: "x" });
    const track = stubTrack(host);
    const secondary = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      clientX: 90,
      clientY: 7,
      button: 1,
    });
    track.dispatchEvent(secondary);
    thumb(host).dispatchEvent(secondary);
    expect(sliderOf(host)!.value).toBe(40);
    track.dispatchEvent(pointer("pointermove", 90));
    track.dispatchEvent(pointer("pointerup", 90));
    track.dispatchEvent(new Event("lostpointercapture"));
    expect(sliderOf(host)!.value).toBe(40);
  });

  it("ignores a press on a zero-width range rail", () => {
    const { host } = make({ min: 0, max: 100, value: [20, 80], label: "x" });
    const track = stubTrack(host, { width: 0 });
    track.dispatchEvent(pointer("pointerdown", 60));
    expect(sliderOf(host)!.value).toEqual([20, 80]);
  });

  it("handles PageUp/PageDown and ignores keys it does not own", () => {
    const { host } = make({ min: 0, max: 100, value: 40, label: "x" });
    const thumbEl = thumb(host);
    press(thumbEl, "PageUp");
    expect(sliderOf(host)!.value).toBe(50);
    press(thumbEl, "PageDown");
    expect(sliderOf(host)!.value).toBe(40);
    press(thumbEl, "a");
    expect(sliderOf(host)!.value).toBe(40);
  });

  it("does not emit when a keyboard step stays put", () => {
    const input = vi.fn();
    const { host } = make({ min: 0, max: 100, value: 100, label: "x", input });
    press(thumb(host), "ArrowRight");
    expect(input).not.toHaveBeenCalled();
  });

  it("places the bubble on the next frame and hides it after a beat", async () => {
    const { host } = make({ min: 0, max: 100, value: 40, label: "x" });
    const thumbEl = thumb(host);
    thumbEl.dispatchEvent(new Event("focus"));
    press(thumbEl, "ArrowRight");
    const bubble = document.querySelector(`.${SLIDER_CLASS.BUBBLE}`) as HTMLElement;
    await new Promise(resolve => window.setTimeout(resolve, 40));
    expect(bubble.textContent).toBe("41");
    thumbEl.dispatchEvent(new Event("blur"));
    await new Promise(resolve => window.setTimeout(resolve, 200));
    expect(bubble.hidden).toBe(true);
  });

  it("clamps a normal range at the neighbour through the pointer path", () => {
    const { host } = make({ min: 0, max: 100, value: [20, 80], label: "x" });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 10));
    track.dispatchEvent(pointer("pointermove", 95));
    expect(sliderOf(host)!.value).toEqual([80, 80]);
    track.dispatchEvent(pointer("pointerup", 95));
  });

  it("ignores non-primary buttons and stray pointer events", () => {
    const { host } = make({ min: 0, max: 100, value: 40, label: "x" });
    const track = stubTrack(host);
    const secondary = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      clientX: 90,
      clientY: 7,
      button: 1,
    });
    track.dispatchEvent(secondary);
    thumb(host).dispatchEvent(secondary);
    expect(sliderOf(host)!.value).toBe(40);
    track.dispatchEvent(pointer("pointermove", 90));
    track.dispatchEvent(pointer("pointerup", 90));
    track.dispatchEvent(new Event("lostpointercapture"));
    expect(sliderOf(host)!.value).toBe(40);
  });

  it("ignores a press on a zero-width range rail", () => {
    const { host } = make({ min: 0, max: 100, value: [20, 80], label: "x" });
    const track = stubTrack(host, { width: 0 });
    track.dispatchEvent(pointer("pointerdown", 60));
    expect(sliderOf(host)!.value).toEqual([20, 80]);
  });

  it("handles PageUp/PageDown and ignores keys it does not own", () => {
    const { host } = make({ min: 0, max: 100, value: 40, label: "x" });
    const thumbEl = thumb(host);
    press(thumbEl, "PageUp");
    expect(sliderOf(host)!.value).toBe(50);
    press(thumbEl, "PageDown");
    expect(sliderOf(host)!.value).toBe(40);
    press(thumbEl, "a");
    expect(sliderOf(host)!.value).toBe(40);
  });

  it("does not emit when a keyboard step stays put", () => {
    const input = vi.fn();
    const { host } = make({ min: 0, max: 100, value: 100, label: "x", input });
    press(thumb(host), "ArrowRight");
    expect(input).not.toHaveBeenCalled();
  });

  it("places the bubble on the next frame and hides it after a beat", async () => {
    const { host } = make({ min: 0, max: 100, value: 40, label: "x" });
    const thumbEl = thumb(host);
    thumbEl.dispatchEvent(new Event("focus"));
    press(thumbEl, "ArrowRight");
    const bubble = document.querySelector(`.${SLIDER_CLASS.BUBBLE}`) as HTMLElement;
    await new Promise(resolve => window.setTimeout(resolve, 40));
    expect(bubble.textContent).toBe("41");
    thumbEl.dispatchEvent(new Event("blur"));
    await new Promise(resolve => window.setTimeout(resolve, 200));
    expect(bubble.hidden).toBe(true);
  });

  it("moves the thumb by pointer and commits on release", () => {
    const input = vi.fn();
    const change = vi.fn();
    const { host } = make({
      min: 0,
      max: 100,
      value: 0,
      label: "x",
      input,
      change,
    });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 40));
    expect(sliderOf(host)!.value).toBe(40);
    track.dispatchEvent(pointer("pointermove", 70));
    expect(sliderOf(host)!.value).toBe(70);
    track.dispatchEvent(pointer("pointerup", 70));
    expect(input).toHaveBeenLastCalledWith(70);
    expect(change).toHaveBeenLastCalledWith(70);
  });

  it("treats a press on a thumb as click-to-position", () => {
    const { host } = make({ min: 0, max: 100, value: 90, label: "x" });
    const track = stubTrack(host);
    thumb(host).dispatchEvent(pointer("pointerdown", 30));
    expect(sliderOf(host)!.value).toBe(30);
    track.dispatchEvent(pointer("pointerup", 30));
  });

  it("picks the nearer thumb for a press on the rail", () => {
    const { host } = make({ min: 0, max: 100, value: [20, 80], label: "x" });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 90));
    expect(sliderOf(host)!.value).toEqual([20, 90]);
    track.dispatchEvent(pointer("pointerup", 90));
  });

  it("slides a collapsed pair from a press on the stack and separates on the open side", () => {
    const { host } = make({ min: 0, max: 100, value: [50, 50], label: "x" });
    const track = stubTrack(host);
    // A press on the stack waits for the movement; moving right slides both.
    thumb(host, 0).dispatchEvent(pointer("pointerdown", 48));
    track.dispatchEvent(pointer("pointermove", 70));
    expect(sliderOf(host)!.value).toEqual([70, 70]);
    track.dispatchEvent(pointer("pointerup", 70));
    // Right half takes the upper thumb; moving right separates it.
    track.dispatchEvent(pointer("pointerdown", 72));
    track.dispatchEvent(pointer("pointermove", 90));
    expect(sliderOf(host)!.value).toEqual([70, 90]);
    track.dispatchEvent(pointer("pointerup", 90));
  });

  it("commits a drag interrupted by pointercancel", () => {
    const change = vi.fn();
    const { host } = make({ min: 0, max: 100, value: 0, label: "x", change });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 40));
    track.dispatchEvent(new Event("pointercancel", { bubbles: true }));
    expect(change).toHaveBeenCalledWith(40);
  });

  it("commits when the pointer capture is lost", () => {
    const change = vi.fn();
    const { host } = make({ min: 0, max: 100, value: 0, label: "x", change });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 40));
    track.dispatchEvent(new Event("lostpointercapture"));
    expect(change).toHaveBeenCalledWith(40);
  });

  it("ignores a press on a zero-width track", () => {
    const { host } = make({ min: 0, max: 100, value: 30, label: "x" });
    const track = stubTrack(host, { width: 0 });
    track.dispatchEvent(pointer("pointerdown", 60));
    expect(sliderOf(host)!.value).toBe(30);
  });

  it("ignores pointer presses when disabled", () => {
    const { host } = make({
      min: 0,
      max: 100,
      value: 40,
      label: "x",
      disabled: true,
    });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 80));
    expect(sliderOf(host)!.value).toBe(40);
  });

  it("shows the value bubble on focus and hides it on blur", () => {
    const { host } = make({ min: 0, max: 100, value: 42, label: "x" });
    const thumbEl = thumb(host);
    thumbEl.dispatchEvent(new Event("focus"));
    const bubble = document.querySelector(`.${SLIDER_CLASS.BUBBLE}`) as HTMLElement;
    expect(bubble).not.toBeNull();
    expect(bubble.textContent).toBe("42");
    expect(bubble.classList.contains("is-on")).toBe(true);
    thumbEl.dispatchEvent(new Event("blur"));
    expect(bubble.classList.contains("is-on")).toBe(false);
  });

  it("ignores a show for a thumb the slider no longer has", () => {
    const { slider } = make({ min: 0, max: 10, value: 4, label: "x" });
    // An out-of-range index finds no thumb: the bubble path must no-op rather
    // than create a bubble for a missing anchor.
    (slider as unknown as { showBubble: (i: number) => void }).showBubble(99);
    expect(document.querySelector(`.${SLIDER_CLASS.BUBBLE}`)).toBeNull();
  });

  it("skips bubbles whose anchor left the pool", () => {
    const { slider } = make({ min: 0, max: 10, value: 4, label: "x" });
    // An anchor that is no longer in the pool (e.g. hidden by an owner
    // switch) must be skipped on refresh, not crash the frame.
    (slider as unknown as { bubbleAnchors: Set<HTMLElement> }).bubbleAnchors.add(
      document.createElement("div"),
    );
    expect(() =>
      (slider as unknown as { updateBubbles: () => void }).updateBubbles(),
    ).not.toThrow();
  });

  it("keeps the bubble text in step with keyboard steps", () => {
    const { host } = make({ min: 0, max: 100, value: 40, label: "x" });
    const thumbEl = thumb(host);
    thumbEl.dispatchEvent(new Event("focus"));
    press(thumbEl, "ArrowRight");
    const bubble = document.querySelector(`.${SLIDER_CLASS.BUBBLE}`) as HTMLElement;
    expect(bubble.textContent).toBe("41");
  });

  it("flips the bubble below when there is no room above", () => {
    const { host } = make({ min: 0, max: 100, value: 42, label: "x" });
    const thumbEl = thumb(host);
    thumbEl.getBoundingClientRect = () =>
      fakeRect({ left: 100, top: 2, width: 14, height: 14 });
    thumbEl.dispatchEvent(new Event("focus"));
    // The bubble node only exists once an anchor shows it: grab the live node
    // (is-on is set after focus) and re-place it with the stubbed size — a
    // keyboard step drives the placement.
    const bubble = document.querySelector(
      `.${SLIDER_CLASS.BUBBLE}.is-on`,
    ) as HTMLElement;
    expect(bubble).not.toBeNull();
    bubble.getBoundingClientRect = () =>
      fakeRect({ left: 0, top: 0, width: 40, height: 30 });
    press(thumbEl, "ArrowRight");
    expect(bubble.dataset.side).toBe("below");
  });

  it("does not emit on a silent write but commits on demand", () => {
    const input = vi.fn();
    const change = vi.fn();
    const { host } = make({
      min: 0,
      max: 100,
      value: 10,
      label: "x",
      input,
      change,
    });
    const slider = sliderOf(host)!;
    slider.setValue(30, { silent: true });
    expect(input).not.toHaveBeenCalled();
    slider.commit();
    expect(change).toHaveBeenCalledWith(30);
  });

  it("keeps the mark and current nodes when re-synced with the same data", () => {
    const { host } = make({
      min: 0,
      max: 19,
      value: [4, 8],
      label: "x",
      marks: [
        { at: 0, tone: "limit" },
        { at: 19, tone: "limit" },
      ],
      values: { min: "0", max: "19" },
      current: { at: 12, text: "12" },
    });
    const slider = sliderOf(host)!;
    const dot = host.querySelector(`.${SLIDER_CLASS.DOT}`);
    const label = host.querySelector(`.${SLIDER_CLASS.VALUE_CURRENT}`);
    slider.setMarks([
      { at: 0, tone: "limit" },
      { at: 19, tone: "limit" },
    ]);
    slider.setCurrent({ at: 12, text: "12" });
    expect(host.querySelector(`.${SLIDER_CLASS.DOT}`)).toBe(dot);
    expect(host.querySelector(`.${SLIDER_CLASS.VALUE_CURRENT}`)).toBe(label);
  });

  it("tears down the instance and its DOM", () => {
    const { host, slider } = make({ min: 0, max: 10, value: 2, label: "x" });
    slider.destroy();
    expect(sliderOf(host)).toBeUndefined();
    expect(host.children).toHaveLength(0);
    expect(host.classList.contains(SLIDER_CLASS.ROOT)).toBe(false);
  });

  it("destroy commits a live drag, and still clears the host when the commit throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onChange = vi.fn(() => {
      throw new Error("consumer broke");
    });
    const { host, slider } = make({
      min: 0,
      max: 10,
      value: 2,
      label: "x",
      change: onChange,
    });
    stubTrack(host).dispatchEvent(pointer("pointerdown", 75));

    expect(() => slider.destroy()).not.toThrow();

    // Destroy commits the value the user's drag already produced, and the
    // cleanup behind the throwing consumer still runs.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(sliderOf(host)).toBeUndefined();
    expect(host.children).toHaveLength(0);
    expect(host.classList.contains(SLIDER_CLASS.ROOT)).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      '[LayerControl] slider destroy step "commit-drag" threw',
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it("inverts the pointer mapping in RTL", () => {
    const host = document.createElement("div");
    host.style.direction = "rtl";
    document.body.appendChild(host);
    hosts.push(host);
    new Slider(host, { min: 0, max: 100, value: 0, label: "x" });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 25));
    expect(sliderOf(host)!.value).toBe(75);
    track.dispatchEvent(pointer("pointerup", 25));
  });

  it("answers sliderOf for null and non-HTML elements", () => {
    expect(sliderOf(null)).toBeUndefined();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    expect(sliderOf(svg)).toBeUndefined();
  });

  it("places the bubble above when there is room", () => {
    const { host } = make({ min: 0, max: 100, value: 42, label: "x" });
    const thumbEl = thumb(host);
    thumbEl.dispatchEvent(new Event("focus"));
    const bubble = document.querySelector(`.${SLIDER_CLASS.BUBBLE}`) as HTMLElement;
    bubble.getBoundingClientRect = () =>
      fakeRect({ left: 0, top: 0, width: 40, height: 30 });
    thumbEl.getBoundingClientRect = () =>
      fakeRect({ left: 100, top: 400, width: 14, height: 14 });
    thumbEl.dispatchEvent(new Event("focus"));
    expect(bubble.dataset.side).toBe("above");
  });

  it("ignores non-finite writes", () => {
    const { host } = make({ min: 0, max: 100, value: 40, label: "x" });
    const slider = sliderOf(host)!;
    slider.setValue(Number.NaN);
    expect(slider.value).toBe(40);
    slider.setValue(Number.POSITIVE_INFINITY);
    expect(slider.value).toBe(40);
  });

  it("adds marks to a slider built without them and treats a missing tone as limit", () => {
    const { host } = make({ min: 0, max: 100, value: 40, label: "x" });
    const slider = sliderOf(host)!;
    slider.setMarks([{ at: 0 }, { at: 100 }]);
    expect(host.querySelectorAll(`.${SLIDER_CLASS.DOT}`)).toHaveLength(2);
    // The same data again compares equal through the tone fallback.
    slider.setMarks([{ at: 0 }, { at: 100 }]);
    expect(host.querySelectorAll(`.${SLIDER_CLASS.DOT}`)).toHaveLength(2);
  });

  it("clamps the upper thumb when it is dragged below the lower one", () => {
    const { host } = make({ min: 0, max: 100, value: [20, 80], label: "x" });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 90)); // picks the upper thumb
    track.dispatchEvent(pointer("pointermove", 5));
    expect(sliderOf(host)!.value).toEqual([20, 20]);
    track.dispatchEvent(pointer("pointerup", 5));
  });

  it("falls back to plain numbers when format and step are not given", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    hosts.push(host);
    new Slider(host, {
      min: 0,
      max: 100,
      value: 40,
      label: "x",
      format: undefined,
      step: undefined,
    });
    expect(thumb(host).getAttribute("aria-valuetext")).toBe("40");
    press(thumb(host), "ArrowRight");
    expect(sliderOf(host)!.value).toBe(41);
  });

  it("ignores pointer events from another pointer id", () => {
    const change = vi.fn();
    const { host } = make({ min: 0, max: 100, value: 0, label: "x", change });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 40));
    const move = pointer("pointermove", 80);
    Object.defineProperty(move, "pointerId", { value: 99 });
    track.dispatchEvent(move);
    expect(sliderOf(host)!.value).toBe(40);
    const up = pointer("pointerup", 80);
    Object.defineProperty(up, "pointerId", { value: 99 });
    track.dispatchEvent(up);
    expect(change).not.toHaveBeenCalled();
    track.dispatchEvent(pointer("pointerup", 40));
    expect(change).toHaveBeenCalledWith(40);
  });

  it("commits nothing when capture is lost without movement", () => {
    const change = vi.fn();
    const { host } = make({ min: 0, max: 100, value: 40, label: "x", change });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 40));
    track.dispatchEvent(new Event("lostpointercapture"));
    expect(change).not.toHaveBeenCalled();
  });

  it("ignores a thumb press while disabled", () => {
    const { host } = make({
      min: 0,
      max: 100,
      value: 40,
      label: "x",
      disabled: true,
    });
    thumb(host).dispatchEvent(pointer("pointerdown", 80));
    expect(sliderOf(host)!.value).toBe(40);
    expect(
      host
        .querySelector(`.${SLIDER_CLASS.THUMB}`)
        ?.classList.contains(SLIDER_CLASS.DRAGGING),
    ).toBe(false);
  });

  it("takes the lower thumb when a stacked pair is pressed on its left half", () => {
    const { host } = make({ min: 0, max: 100, value: [50, 50], label: "x" });
    const track = stubTrack(host);
    thumb(host, 1).dispatchEvent(pointer("pointerdown", 48));
    track.dispatchEvent(pointer("pointermove", 70));
    expect(sliderOf(host)!.value).toEqual([70, 70]);
    track.dispatchEvent(pointer("pointerup", 70));
  });

  it("drops a stale bubble frame when another slider takes over", async () => {
    const a = make({ min: 0, max: 100, value: 40, label: "a" });
    const b = make({ min: 0, max: 100, value: 60, label: "b" });
    const thumbA = thumb(a.host);
    thumbA.dispatchEvent(new Event("focus"));
    press(thumbA, "ArrowRight"); // schedules a placement frame
    thumb(b.host).dispatchEvent(new Event("focus")); // owner changes
    await new Promise(resolve => window.setTimeout(resolve, 40));
    const bubble = document.querySelector(`.${SLIDER_CLASS.BUBBLE}`) as HTMLElement;
    expect(bubble.textContent).toBe("60");
  });

  it("keeps the bubble when it is reshown before the hide delay", async () => {
    const { host } = make({ min: 0, max: 100, value: 42, label: "x" });
    const thumbEl = thumb(host);
    thumbEl.dispatchEvent(new Event("focus"));
    thumbEl.dispatchEvent(new Event("blur"));
    thumbEl.dispatchEvent(new Event("focus"));
    await new Promise(resolve => window.setTimeout(resolve, 200));
    const bubble = document.querySelector(`.${SLIDER_CLASS.BUBBLE}`) as HTMLElement;
    expect(bubble.classList.contains("is-on")).toBe(true);
    expect(bubble.hidden).toBe(false);
  });

  it("keeps a degenerate range pinned at the start", () => {
    const { host } = make({ min: 5, max: 5, value: 5, label: "x" });
    expect(thumb(host).style.left).toBe("0%");
  });

  it("does not swap an already ordered range", () => {
    const { host } = make({ min: 0, max: 19, value: [4, 8], label: "x" });
    const slider = sliderOf(host)!;
    slider.setValue([2, 15]);
    expect(slider.value).toEqual([2, 15]);
  });

  it("marks the current tone dot with its class", () => {
    const { host } = make({ min: 0, max: 100, value: 40, label: "x" });
    sliderOf(host)!.setMarks([{ at: 50, tone: "current" }]);
    expect(
      host
        .querySelector(`.${SLIDER_CLASS.DOT}`)!
        .classList.contains("foliplus-slider-dot-current"),
    ).toBe(true);
  });

  it("hides the current label when it sits near an end", () => {
    const { host } = make({
      min: 0,
      max: 100,
      value: 50,
      label: "x",
      values: { min: "0", max: "100" },
      current: { at: 2, text: "2", hideGapPct: 10 },
    });
    expect(
      host
        .querySelector(`.${SLIDER_CLASS.VALUE_CURRENT}`)!
        .classList.contains(SLIDER_CLASS.LABEL_HIDDEN),
    ).toBe(true);
    sliderOf(host)!.setCurrent({ at: 50, text: "50", hideGapPct: 10 });
    expect(
      host
        .querySelector(`.${SLIDER_CLASS.VALUE_CURRENT}`)!
        .classList.contains(SLIDER_CLASS.LABEL_HIDDEN),
    ).toBe(false);
  });

  it("does not commit when a press ends without movement", () => {
    const change = vi.fn();
    const { host } = make({ min: 0, max: 100, value: 40, label: "x", change });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 40));
    track.dispatchEvent(pointer("pointerup", 40));
    expect(change).not.toHaveBeenCalled();
  });

  it("falls back to plain numbers in the bubble on change when format is omitted", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    hosts.push(host);
    new Slider(host, {
      min: 0,
      max: 100,
      value: 40,
      label: "x",
      format: undefined,
    });
    const thumbEl = thumb(host);
    thumbEl.dispatchEvent(new Event("focus"));
    press(thumbEl, "ArrowRight");
    const bubble = document.querySelector(`.${SLIDER_CLASS.BUBBLE}`) as HTMLElement;
    expect(bubble.textContent).toBe("41");
  });

  it("moves a stacked pair from a click on the rail", () => {
    const { host } = make({ min: 0, max: 100, value: [50, 50], label: "x" });
    const track = stubTrack(host);
    // The rail press is not ambiguous: the far side takes the upper thumb, so
    // a click to the right opens the pair instead of doing nothing.
    track.dispatchEvent(pointer("pointerdown", 90));
    expect(sliderOf(host)!.value).toEqual([50, 90]);
    track.dispatchEvent(pointer("pointerup", 90));
  });

  it("ignores a second pointer while a drag is active", () => {
    const change = vi.fn();
    const { host } = make({
      min: 0,
      max: 100,
      value: [20, 80],
      label: "x",
      change,
    });
    const track = stubTrack(host);
    const first = pointer("pointerdown", 10);
    Object.defineProperty(first, "pointerId", { value: 1 });
    track.dispatchEvent(first);
    // A second finger on the other thumb must not take over the session.
    const second = pointer("pointerdown", 75);
    Object.defineProperty(second, "pointerId", { value: 2 });
    thumb(host, 1).dispatchEvent(second);
    const move = pointer("pointermove", 30);
    Object.defineProperty(move, "pointerId", { value: 1 });
    track.dispatchEvent(move);
    const up = pointer("pointerup", 30);
    Object.defineProperty(up, "pointerId", { value: 1 });
    track.dispatchEvent(up);
    expect(sliderOf(host)!.value).toEqual([30, 80]);
    expect(change).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledWith([30, 80]);
  });

  it("ignores a capture loss from another pointer", () => {
    const change = vi.fn();
    const { host } = make({ min: 0, max: 100, value: 0, label: "x", change });
    const track = stubTrack(host);
    const down = pointer("pointerdown", 40);
    Object.defineProperty(down, "pointerId", { value: 1 });
    track.dispatchEvent(down);
    const lost = new Event("lostpointercapture");
    Object.defineProperty(lost, "pointerId", { value: 2 });
    track.dispatchEvent(lost);
    expect(change).not.toHaveBeenCalled();
    const up = pointer("pointerup", 40);
    Object.defineProperty(up, "pointerId", { value: 1 });
    track.dispatchEvent(up);
    expect(change).toHaveBeenCalledWith(40);
  });

  it("ends a live drag when it is disabled", () => {
    const change = vi.fn();
    const { host } = make({ min: 0, max: 100, value: 10, label: "x", change });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 20));
    sliderOf(host)!.setDisabled(true);
    track.dispatchEvent(pointer("pointermove", 80));
    expect(sliderOf(host)!.value).toBe(20);
    expect(change).toHaveBeenCalledWith(20);
    expect(
      host
        .querySelector(`.${SLIDER_CLASS.THUMB}`)
        ?.classList.contains(SLIDER_CLASS.DRAGGING),
    ).toBe(false);
  });

  it("mounts the bubble on the fullscreen element", () => {
    const { host } = make({ min: 0, max: 100, value: 42, label: "x" });
    thumb(host).dispatchEvent(new Event("focus"));
    const bubble = document.querySelector(`.${SLIDER_CLASS.BUBBLE}`) as HTMLElement;
    const stage = document.createElement("div");
    document.body.appendChild(stage);
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => stage,
    });
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(bubble.parentElement).toBe(stage);
    // A second change with no move (already on the stage) is a no-op.
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(bubble.parentElement).toBe(stage);
    // Leaving fullscreen moves it back to the document body.
    delete (document as unknown as { fullscreenElement?: Element }).fullscreenElement;
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(bubble.parentElement).toBe(document.body);
    stage.remove();
  });

  it("re-seats an open bubble when pseudo-fullscreen activates", () => {
    // Pseudo mode toggles a class and fires no fullscreenchange: a bubble that
    // was opened before the transition must still follow the surface, or it
    // stays on <body> under the opaque map.
    const map = document.createElement("div");
    map.className = "leaflet-container";
    const host = document.createElement("div");
    map.appendChild(host);
    document.body.appendChild(map);
    hosts.push(host);
    new Slider(host, { min: 0, max: 100, value: 42, label: "x" });

    thumb(host).dispatchEvent(new Event("focus"));
    const bubble = document.querySelector(`.${SLIDER_CLASS.BUBBLE}`) as HTMLElement;
    expect(bubble.parentElement).toBe(document.body);
    expect(bubble.classList.contains("is-on")).toBe(true);

    setPseudoFullscreen(map, true);
    expect(bubble.parentElement).toBe(map);
    // The readout is dismissed on any transition (its anchor moved); the next
    // focus re-shows it inside the surface.
    expect(bubble.classList.contains("is-on")).toBe(false);

    thumb(host).dispatchEvent(new Event("focus"));
    expect(bubble.parentElement).toBe(map);
    expect(bubble.classList.contains("is-on")).toBe(true);

    setPseudoFullscreen(map, false);
    expect(bubble.parentElement).toBe(document.body);
    map.remove();
  });

  it("takes the start-side half of a stacked pair in RTL", () => {
    const host = document.createElement("div");
    host.style.direction = "rtl";
    document.body.appendChild(host);
    hosts.push(host);
    new Slider(host, { min: 0, max: 100, value: [50, 50], label: "x" });
    const track = stubTrack(host);
    // RTL: the lower thumb sits on the right, so a press right of centre takes
    // it and the first movement slides the pair.
    thumb(host, 1).dispatchEvent(pointer("pointerdown", 55));
    track.dispatchEvent(pointer("pointermove", 45));
    expect(sliderOf(host)!.value).toEqual([55, 55]);
    track.dispatchEvent(pointer("pointerup", 45));
  });

  it("skips the deferred direction read when the host never mounts", async () => {
    const host = document.createElement("div");
    hosts.push(host);
    new Slider(host, { min: 0, max: 100, value: 25, label: "x" });
    await new Promise(resolve => window.setTimeout(resolve, 40));
    expect(host.querySelector<HTMLElement>(`.${SLIDER_CLASS.THUMB}`)!.style.left).toBe(
      "25%",
    );
  });

  it("picks up an RTL ancestor after mounting", async () => {
    const host = document.createElement("div");
    const wrap = document.createElement("div");
    wrap.style.direction = "rtl";
    // Built detached: the constructor cannot see the RTL ancestor yet.
    new Slider(host, { min: 0, max: 100, value: 25, label: "x" });
    wrap.appendChild(host);
    document.body.appendChild(wrap);
    hosts.push(wrap);
    const thumbEl = () => host.querySelector<HTMLElement>(`.${SLIDER_CLASS.THUMB}`)!;
    expect(thumbEl().style.left).toBe("25%");
    await new Promise(resolve => window.setTimeout(resolve, 40));
    expect(thumbEl().style.left).toBe("75%");
  });

  it("follows the visual direction with horizontal arrows in RTL", () => {
    const host = document.createElement("div");
    host.style.direction = "rtl";
    document.body.appendChild(host);
    hosts.push(host);
    new Slider(host, { min: 0, max: 100, value: 50, label: "x" });
    const thumbEl = host.querySelector<HTMLElement>(`.${SLIDER_CLASS.THUMB}`)!;
    press(thumbEl, "ArrowRight");
    expect(sliderOf(host)!.value).toBe(49);
    press(thumbEl, "ArrowLeft");
    expect(sliderOf(host)!.value).toBe(50);
    press(thumbEl, "ArrowUp");
    expect(sliderOf(host)!.value).toBe(51);
  });

  it("commits an in-flight drag when finish() is called", () => {
    const change = vi.fn();
    const { host } = make({ min: 0, max: 100, value: 0, label: "x", change });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 40));
    expect(sliderOf(host)!.value).toBe(40);
    sliderOf(host)!.finish();
    expect(change).toHaveBeenCalledWith(40);
    // The release after the session ended must not emit a second change.
    track.dispatchEvent(pointer("pointerup", 40));
    expect(change).toHaveBeenCalledTimes(1);
  });

  it("does not touch the DOM when a pointer move keeps the same value", async () => {
    const { host } = make({ min: 0, max: 100, value: 20, label: "x" });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 20));
    let mutations = 0;
    const observer = new MutationObserver(list => {
      mutations += list.length;
    });
    observer.observe(host, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
    });
    for (let i = 0; i < 5; i += 1) {
      track.dispatchEvent(pointer("pointermove", 20));
    }
    await new Promise(resolve => window.setTimeout(resolve, 0));
    observer.disconnect();
    expect(mutations).toBe(0);
    track.dispatchEvent(pointer("pointerup", 20));
  });

  it("normalises an out-of-range initial value", () => {
    const single = make({ min: 0, max: 10, value: 42, label: "x" });
    expect(sliderOf(single.host)!.value).toBe(10);

    const range = make({ min: 0, max: 10, value: [20, 30], label: "x" });
    expect(sliderOf(range.host)!.value).toEqual([10, 10]);

    const inverted = make({ min: 0, max: 10, value: [8, 3], label: "x" });
    expect(sliderOf(inverted.host)!.value).toEqual([3, 8]);

    const nonFinite = make({ min: 5, max: 10, value: Number.NaN, label: "x" });
    expect(sliderOf(nonFinite.host)!.value).toBe(5);
  });
});
describe("Slider middle-segment pan", () => {
  it("pans both thumbs together, preserving the width", () => {
    const { host } = make({ min: 0, max: 100, value: [20, 80], label: "x" });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 50));
    track.dispatchEvent(pointer("pointermove", 60));
    expect(sliderOf(host)!.value).toEqual([30, 90]);
    track.dispatchEvent(pointer("pointerup", 60));
  });

  it("keeps the width unchanged across several pan steps", () => {
    const { host } = make({ min: 0, max: 100, value: [20, 80], label: "x" });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 50));
    track.dispatchEvent(pointer("pointermove", 40));
    track.dispatchEvent(pointer("pointermove", 45));
    track.dispatchEvent(pointer("pointermove", 35));
    const [lo, hi] = sliderOf(host)!.value as [number, number];
    expect(hi - lo).toBe(60);
    track.dispatchEvent(pointer("pointerup", 35));
  });

  it("clamps a pan at the lower bound", () => {
    const { host } = make({ min: 0, max: 100, value: [20, 80], label: "x" });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 50));
    track.dispatchEvent(pointer("pointermove", -100));
    expect(sliderOf(host)!.value).toEqual([0, 60]);
    track.dispatchEvent(pointer("pointerup", -100));
  });

  it("clamps a pan at the upper bound", () => {
    const { host } = make({ min: 0, max: 100, value: [20, 80], label: "x" });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 50));
    track.dispatchEvent(pointer("pointermove", 200));
    expect(sliderOf(host)!.value).toEqual([40, 100]);
    track.dispatchEvent(pointer("pointerup", 200));
  });

  it("syncs aria-valuenow for both thumbs while panning", () => {
    const { host } = make({ min: 0, max: 100, value: [20, 80], label: "x" });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 50));
    track.dispatchEvent(pointer("pointermove", 60));
    expect(thumb(host, 0).getAttribute("aria-valuenow")).toBe("30");
    expect(thumb(host, 1).getAttribute("aria-valuenow")).toBe("90");
    track.dispatchEvent(pointer("pointerup", 60));
  });

  it("does not move on a pure click of the middle segment", () => {
    const change = vi.fn();
    const { host } = make({ min: 0, max: 100, value: [20, 80], label: "x", change });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 50));
    track.dispatchEvent(pointer("pointerup", 50));
    expect(sliderOf(host)!.value).toEqual([20, 80]);
    expect(change).not.toHaveBeenCalled();
  });

  it("releases pointer capture when the pan is released", () => {
    const { host } = make({ min: 0, max: 100, value: [20, 80], label: "x" });
    const track = stubTrack(host);
    const release = vi.fn();
    track.releasePointerCapture = release;
    track.dispatchEvent(pointer("pointerdown", 50));
    track.dispatchEvent(pointer("pointerup", 50));
    expect(release).toHaveBeenCalled();
  });

  it("still drags a single thumb when pressed on it", () => {
    const { host } = make({ min: 0, max: 100, value: [20, 80], label: "x" });
    const track = stubTrack(host);
    thumb(host, 0).dispatchEvent(pointer("pointerdown", 22));
    track.dispatchEvent(pointer("pointermove", 40));
    expect(sliderOf(host)!.value).toEqual([40, 80]);
    track.dispatchEvent(pointer("pointerup", 40));
  });

  it("emits input while panning and change on release", () => {
    const input = vi.fn();
    const change = vi.fn();
    const { host } = make({
      min: 0,
      max: 100,
      value: [20, 80],
      label: "x",
      input,
      change,
    });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 50));
    track.dispatchEvent(pointer("pointermove", 60));
    expect(input).toHaveBeenCalledWith([30, 90]);
    track.dispatchEvent(pointer("pointerup", 60));
    expect(change).toHaveBeenCalledWith([30, 90]);
  });

  it("ignores a pan press when disabled", () => {
    const { host } = make({
      min: 0,
      max: 100,
      value: [20, 80],
      label: "x",
      disabled: true,
    });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 50));
    track.dispatchEvent(pointer("pointermove", 60));
    expect(sliderOf(host)!.value).toEqual([20, 80]);
  });

  it("pans correctly in RTL, mirroring the direction and keeping the width", () => {
    const host = document.createElement("div");
    host.style.direction = "rtl";
    document.body.appendChild(host);
    hosts.push(host);
    new Slider(host, { min: 0, max: 100, value: [20, 80], label: "x" });
    const track = stubTrack(host);
    // RTL: value 20 paints at 80% (right), value 80 at 20% (left); the pan
    // segment is the px span between them. A press at 50 then a move left to
    // 40 raises both values (mirrored direction), width unchanged.
    track.dispatchEvent(pointer("pointerdown", 50));
    track.dispatchEvent(pointer("pointermove", 40));
    expect(sliderOf(host)!.value).toEqual([30, 90]);
    const [lo, hi] = sliderOf(host)!.value as [number, number];
    expect(hi - lo).toBe(60);
    track.dispatchEvent(pointer("pointerup", 40));
  });

  it("clears the hover grab cursor when the pointer leaves the track", () => {
    const { host } = make({ min: 0, max: 100, value: [20, 80], label: "x" });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointermove", 50));
    expect(track.classList.contains(SLIDER_CLASS.CAN_PAN)).toBe(true);
    track.dispatchEvent(new Event("pointerleave"));
    expect(track.classList.contains(SLIDER_CLASS.CAN_PAN)).toBe(false);
  });

  it("keeps a pan active when the pointer leaves the track mid-drag", () => {
    const { host } = make({ min: 0, max: 100, value: [20, 80], label: "x" });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 50));
    expect(track.classList.contains(SLIDER_CLASS.IS_PANNING)).toBe(true);
    // A leave mid-drag is not the pointer leaving the segment (the pan holds
    // pointer capture): the panning state must survive until the release.
    track.dispatchEvent(new Event("pointerleave"));
    expect(track.classList.contains(SLIDER_CLASS.IS_PANNING)).toBe(true);
    track.dispatchEvent(pointer("pointermove", 60));
    expect(sliderOf(host)!.value).toEqual([30, 90]);
    track.dispatchEvent(pointer("pointerup", 60));
  });

  it("ignores a second press while a pan is active", () => {
    const { host } = make({ min: 0, max: 100, value: [20, 80], label: "x" });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 50));
    // A second press must not re-anchor the pan: the delta stays measured
    // from the first press, so a move lands where the first press led.
    track.dispatchEvent(pointer("pointerdown", 30));
    track.dispatchEvent(pointer("pointermove", 60));
    expect(sliderOf(host)!.value).toEqual([30, 90]);
    track.dispatchEvent(pointer("pointerup", 60));
  });

  it("does not re-emit when a pan is already pinned at the extent edge", () => {
    const input = vi.fn();
    const { host } = make({
      min: 0,
      max: 100,
      value: [0, 60],
      label: "x",
      input,
    });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 30));
    // Already at the lower clamp: a further push left clamps to the same
    // pair, so no write and no input event may fire.
    track.dispatchEvent(pointer("pointermove", -20));
    expect(sliderOf(host)!.value).toEqual([0, 60]);
    expect(input).not.toHaveBeenCalled();
    track.dispatchEvent(pointer("pointerup", -20));
  });

  it("keeps a thumb draggable when the pair spans the whole extent", () => {
    // A full-extent pair has no rail to grab: the fill swallows the track,
    // so the pan feature must yield and a press still drags the nearer
    // thumb (the filter panel's initial state stays settable).
    const { host } = make({ min: 10, max: 30, value: [10, 30], label: "x" });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 25));
    track.dispatchEvent(pointer("pointermove", 25));
    const [lo, hi] = sliderOf(host)!.value as [number, number];
    // Press x=25 on a 100px rail over 10..30 maps to value 15, nearest the
    // lower thumb; the guard let the press fall through to a thumb drag.
    expect([lo, hi]).toEqual([15, 30]);
    track.dispatchEvent(pointer("pointerup", 25));
  });
  it("shows one live bubble per thumb while panning and clears them on release", async () => {
    const { host } = make({ min: 0, max: 100, value: [20, 80], label: "x" });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 50));
    track.dispatchEvent(pointer("pointermove", 55));
    const live = [...document.querySelectorAll(`.${SLIDER_CLASS.BUBBLE}.is-on`)];
    expect(live).toHaveLength(2);
    expect(live[0]).not.toBe(live[1]);
    expect(live[0].textContent).toBe(thumb(host, 0).getAttribute("aria-valuenow"));
    expect(live[1].textContent).toBe(thumb(host, 1).getAttribute("aria-valuenow"));
    track.dispatchEvent(pointer("pointerup", 55));
    expect(document.querySelectorAll(`.${SLIDER_CLASS.BUBBLE}.is-on`)).toHaveLength(0);
  });

  it("keeps both bubbles following their thumbs through a pan", async () => {
    const { host } = make({ min: 0, max: 100, value: [20, 80], label: "x" });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 50));
    track.dispatchEvent(pointer("pointermove", 55));
    // One frame later both bubbles have moved to their thumbs' new positions.
    await new Promise(resolve => window.setTimeout(resolve, 20));
    const live = [...document.querySelectorAll(`.${SLIDER_CLASS.BUBBLE}.is-on`)];
    expect(live).toHaveLength(2);
    expect(live[0].textContent).toBe(thumb(host, 0).getAttribute("aria-valuenow"));
    expect(live[1].textContent).toBe(thumb(host, 1).getAttribute("aria-valuenow"));
    track.dispatchEvent(pointer("pointerup", 55));
  });
});

describe("Slider teardown and keyboard edges", () => {
  it("finishes every slider inside a removed root", () => {
    // finishSlidersIn walks a container and calls finish on each slider
    // host found there; a slider removed from the document must not be
    // left holding a live pointer capture or a stale bubble.
    const { host } = make({ min: 0, max: 100, value: 42, label: "x" });
    const before = sliderOf(host)!.value;
    // finishSlidersIn queries descendants for the root class, so hand it a
    // container that holds the slider host rather than the host itself.
    const container = document.createElement("div");
    container.appendChild(host);
    finishSlidersIn(container);
    expect(sliderOf(host)!.value).toBe(before);
  });

  it("moves the value down in RTL with the Down key, mirroring the visual", () => {
    const host = document.createElement("div");
    host.style.direction = "rtl";
    document.body.appendChild(host);
    hosts.push(host);
    new Slider(host, { min: 0, max: 100, value: 40, label: "x" });
    // Vertical keys keep value semantics (down subtracts) even in a
    // mirrored row; only the horizontal keys follow the visual direction.
    press(thumb(host), "ArrowDown");
    expect(sliderOf(host)!.value).toBe(39);
  });
});

describe("Slider width-adaptive end numbers", () => {
  const stubRow = (host: HTMLElement, width: number): HTMLElement => {
    const row = host.querySelector(`.${SLIDER_CLASS.VALUES}`) as HTMLElement;
    Object.defineProperty(row, "clientWidth", { value: width, configurable: true });
    return row;
  };

  const stubLabel = (el: HTMLElement, intrinsic: number): void => {
    Object.defineProperty(el, "scrollWidth", { value: intrinsic, configurable: true });
  };

  const endNumbers = (host: HTMLElement): [HTMLElement, HTMLElement] => [
    host.querySelector(`.${SLIDER_CLASS.VALUE_MIN}`) as HTMLElement,
    host.querySelector(`.${SLIDER_CLASS.VALUE_MAX}`) as HTMLElement,
  ];

  const measure = (slider: Slider): void =>
    (slider as unknown as { measureValuesFit: () => void }).measureValuesFit();

  it("keeps an end number that fits on its half out of the clamp state", () => {
    const { host } = make({
      min: 0,
      max: 100,
      value: 40,
      label: "x",
      values: { min: "0", max: "100" },
    });
    stubRow(host, 160);
    const [minEl, maxEl] = endNumbers(host);
    stubLabel(minEl, 10);
    stubLabel(maxEl, 20);
    measure(sliderOf(host)!);
    expect(minEl.classList.contains(SLIDER_CLASS.VALUE_CLAMP)).toBe(false);
    expect(maxEl.classList.contains(SLIDER_CLASS.VALUE_CLAMP)).toBe(false);
  });

  it("clamps the end number that no longer fits on its half", () => {
    const { host } = make({
      min: 0,
      max: 100,
      value: 40,
      label: "x",
      values: { min: "0", max: "a very long upper bound" },
    });
    stubRow(host, 160);
    const [minEl, maxEl] = endNumbers(host);
    stubLabel(minEl, 10);
    stubLabel(maxEl, 90);
    measure(sliderOf(host)!);
    // The same width that fit the short half does not fit the long one,
    // so the two halves are measured independently.
    expect(minEl.classList.contains(SLIDER_CLASS.VALUE_CLAMP)).toBe(false);
    expect(maxEl.classList.contains(SLIDER_CLASS.VALUE_CLAMP)).toBe(true);
  });

  it("re-measures when the row's width changes, both ways", () => {
    const { host } = make({
      min: 0,
      max: 100,
      value: 40,
      label: "x",
      values: { min: "0", max: "100" },
    });
    stubRow(host, 160);
    const [minEl, maxEl] = endNumbers(host);
    stubLabel(minEl, 10);
    stubLabel(maxEl, 60);
    measure(sliderOf(host)!);
    expect(minEl.classList.contains(SLIDER_CLASS.VALUE_CLAMP)).toBe(false);
    expect(maxEl.classList.contains(SLIDER_CLASS.VALUE_CLAMP)).toBe(false);
    stubRow(host, 40);
    measure(sliderOf(host)!);
    expect(minEl.classList.contains(SLIDER_CLASS.VALUE_CLAMP)).toBe(false);
    expect(maxEl.classList.contains(SLIDER_CLASS.VALUE_CLAMP)).toBe(true);
    stubRow(host, 240);
    measure(sliderOf(host)!);
    expect(maxEl.classList.contains(SLIDER_CLASS.VALUE_CLAMP)).toBe(false);
  });
});

describe("Slider width-adaptive current label", () => {
  const stubRow = (host: HTMLElement, width: number): HTMLElement => {
    const row = host.querySelector(`.${SLIDER_CLASS.VALUES}`) as HTMLElement;
    Object.defineProperty(row, "clientWidth", { value: width, configurable: true });
    row.getBoundingClientRect = () => fakeRect({ left: 0, top: 0, width, height: 14 });
    return row;
  };
  const stubLabel = (el: HTMLElement, intrinsic: number): void => {
    Object.defineProperty(el, "scrollWidth", { value: intrinsic, configurable: true });
  };
  const stubDot = (host: HTMLElement, cx: number): void => {
    const dot = host.querySelector(`.${SLIDER_CLASS.DOT_CURRENT}`) as HTMLElement;
    if (dot) {
      dot.getBoundingClientRect = () =>
        fakeRect({ left: cx - 5, top: 0, width: 10, height: 10 });
    }
  };
  const makeCurrent = (over: Partial<SliderOptions> = {}) =>
    make({
      min: 0,
      max: 100,
      value: 40,
      label: "x",
      values: { min: "0", max: "100" },
      current: { at: 40, text: "40" },
      marks: [
        { at: 0, tone: "limit" },
        { at: 40, tone: "current" },
        { at: 100, tone: "limit" },
      ],
      ...over,
    });
  const stubEndLabels = (host: HTMLElement, width: number): void => {
    // The end numbers are dot-centred at the row edges; give them real inner
    // edges so the current label has a finite room between them (jsdom rects
    // are 0x0 otherwise, which makes the right bound negative).
    const minEl = host.querySelector(`.${SLIDER_CLASS.VALUE_MIN}`) as HTMLElement;
    const maxEl = host.querySelector(`.${SLIDER_CLASS.VALUE_MAX}`) as HTMLElement;
    if (minEl) {
      minEl.getBoundingClientRect = () =>
        fakeRect({ left: 0, top: 0, width: 20, height: 14 });
    }
    if (maxEl) {
      maxEl.getBoundingClientRect = () =>
        fakeRect({ left: width - 20, top: 0, width: 20, height: 14 });
    }
  };
  const currentEl = (host: HTMLElement) =>
    host.querySelector(`.${SLIDER_CLASS.VALUE_CURRENT}`) as HTMLElement;
  const measure = (slider: Slider): void =>
    (slider as unknown as { measureValuesFit: () => void }).measureValuesFit();
  const positionCurrent = (slider: Slider): void =>
    (slider as unknown as { positionCurrent: () => void }).positionCurrent();
  const dotCentre = (slider: Slider): number | null =>
    (slider as unknown as { currentDotCentre: () => number | null }).currentDotCentre();
  const measureCurrent = (slider: Slider): void =>
    (slider as unknown as { measureCurrentFit: () => void }).measureCurrentFit();

  it("keeps a current number that fits between the ends unclamped", () => {
    const { host } = makeCurrent();
    stubRow(host, 160);
    stubDot(host, 80);
    stubEndLabels(host, 160);
    const cur = currentEl(host);
    stubLabel(cur, 20);
    // The min/max labels are dot-centred, so their boxes are the stubs' rects
    // (0x0 unless stubbed); the current label fits, so no clamp.
    measure(sliderOf(host)!);
    expect(cur.classList.contains(SLIDER_CLASS.VALUE_CLAMP)).toBe(false);
    expect(cur.style.maxWidth).toBe("");
  });

  it("clamps a current number that no longer fits between the ends", () => {
    const { host } = makeCurrent();
    stubRow(host, 160);
    stubDot(host, 80);
    stubEndLabels(host, 160);
    const cur = currentEl(host);
    stubLabel(cur, 200);
    measure(sliderOf(host)!);
    expect(cur.classList.contains(SLIDER_CLASS.VALUE_CLAMP)).toBe(false);
    expect(cur.style.maxWidth).not.toBe("");
    expect(parseFloat(cur.style.maxWidth)).toBeGreaterThan(0);
  });

  it("does not clamp when the row has no laid-out width", () => {
    const { host } = makeCurrent();
    stubRow(host, 0);
    const cur = currentEl(host);
    stubLabel(cur, 200);
    measure(sliderOf(host)!);
    expect(cur.classList.contains(SLIDER_CLASS.VALUE_CLAMP)).toBe(false);
  });
  it("defers the current label while its dot has no laid-out box", () => {
    const { host } = makeCurrent();
    const cur = currentEl(host);
    // The constructor sync runs before the panel has laid the row out, so
    // both the row and the dot report zero width. The label must keep the
    // CSS row-centre default rather than pinning to a fabricated 0.
    expect(dotCentre(sliderOf(host)!)).toBeNull();
    positionCurrent(sliderOf(host)!);
    expect(cur.style.left).toBe("");
    // Once the row reports real geometry the same label lands on its dot.
    stubRow(host, 160);
    stubDot(host, 80);
    expect(dotCentre(sliderOf(host)!)).toBe(80);
    positionCurrent(sliderOf(host)!);
    expect(cur.style.left).toBe("80px");
  });

  it("caps the current label to the room left of its dot", () => {
    const { host } = makeCurrent();
    stubRow(host, 160);
    stubDot(host, 80);
    stubEndLabels(host, 160);
    const cur = currentEl(host);
    stubLabel(cur, 200);
    measureCurrent(sliderOf(host)!);
    // The nearer end number sits 56px away from the dot, and a dot-
    // centred label may grow that far on either side of the dot: 2 * 56.
    expect(cur.style.maxWidth).toBe("112px");
  });

  it("skips the current fit while the dot has no box", () => {
    const { host } = makeCurrent();
    stubRow(host, 160);
    const cur = currentEl(host);
    stubLabel(cur, 200);
    // The row is laid out but its dot is not (jsdom reports a 0x0 box), so
    // there is no centre to measure against and the cap stays off.
    measureCurrent(sliderOf(host)!);
    expect(cur.style.maxWidth).toBe("");
  });

  it("keeps the fit deferred across a re-render of the current label", async () => {
    const { host } = makeCurrent();
    stubRow(host, 160);
    stubDot(host, 80);
    stubEndLabels(host, 160);
    // A new level rebuilds the label node and schedules the re-measure a
    // frame later: a synchronous read at that point would still see zero
    // boxes and pin the label to the row edge instead of its dot.
    sliderOf(host)!.setCurrent({ at: 60, text: "60" });
    const cur = currentEl(host);
    stubLabel(cur, 200);
    await new Promise(resolve => window.setTimeout(resolve, 40));
    expect(cur.style.left).toBe("80px");
    expect(cur.style.maxWidth).toBe("112px");
  });

  it("re-measures the end numbers when the row resizes", async () => {
    const callbacks: Array<(entries: unknown[], observer: unknown) => void> = [];

    class StubObserver {
      constructor(cb: (entries: unknown[], observer: unknown) => void) {
        callbacks.push(cb);
      }
      observe = (): void => {};
      disconnect = (): void => {};
      unobserve = (): void => {};
    }
    vi.stubGlobal("ResizeObserver", StubObserver);
    const { host } = makeCurrent();
    stubRow(host, 160);
    stubDot(host, 80);
    stubEndLabels(host, 160);
    const cur = currentEl(host);
    stubLabel(cur, 200);
    await new Promise(resolve => window.setTimeout(resolve, 40));
    expect(callbacks.length).toBeGreaterThan(0);
    // The resize callback is the only path that re-measures after the
    // first frame, so it must run the same fit pass as a render.
    for (const cb of callbacks) cb([], null);
    expect(cur.style.maxWidth).toBe("112px");
    vi.unstubAllGlobals();
  });
  it("skips the current fit when the row has no laid-out width", () => {
    const { host } = makeCurrent();
    stubRow(host, 160);
    stubDot(host, 80);
    stubEndLabels(host, 160);
    const cur = currentEl(host);
    stubLabel(cur, 200);
    // The row reports geometry but then loses it (the panel collapses):
    // there is no space to measure against, so the cap must stay off
    // rather than cap to the room of a row that no longer exists.
    const row = host.querySelector(`.${SLIDER_CLASS.VALUES}`) as HTMLElement;
    row.getBoundingClientRect = () =>
      fakeRect({ left: 0, top: 0, width: 0, height: 14 });
    measureCurrent(sliderOf(host)!);
    expect(cur.style.maxWidth).toBe("");
  });

  it("caps the current label when one end number is not in the document", () => {
    const { host } = makeCurrent();
    stubRow(host, 160);
    stubDot(host, 80);
    stubEndLabels(host, 160);
    const cur = currentEl(host);
    stubLabel(cur, 200);
    // The end numbers own the row's two edges; when an end number is not
    // in the document its edge is unknown, so the boundary falls back to the
    // row's own edge instead of pinning the label to an overhang.
    const [minEl, maxEl] = [
      host.querySelector(`.${SLIDER_CLASS.VALUE_MIN}`),
      host.querySelector(`.${SLIDER_CLASS.VALUE_MAX}`),
    ];
    minEl!.getBoundingClientRect = () => null as unknown as DOMRect;
    maxEl!.getBoundingClientRect = () => null as unknown as DOMRect;
    measureCurrent(sliderOf(host)!);
    // Left bound falls back to the gap, right bound to the row's edge: the
    // dot sits 80px in, so the cap is 2 * min(76, 76) = 152px. A fallback
    // that collapsed to 0 would cap the label to nothing.
    expect(cur.style.maxWidth).toBe("152px");
  });
});
