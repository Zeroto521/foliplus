import { afterEach, describe, expect, it, vi } from "vitest";
import { Slider, type SliderOptions, sliderOf } from "#foliplus/LayerControl/slider.js";
import { SLIDER } from "#common/sliderVocabulary.js";

const hosts: HTMLElement[] = [];

const make = (options: SliderOptions) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const slider = new Slider(host, options);
  return { host, slider };
};

const thumb = (host: HTMLElement, index = 0): HTMLElement =>
  host.querySelectorAll<HTMLElement>(`.${SLIDER.THUMB}`)[index];

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
  host.querySelector(`.${SLIDER.TRACK}`) as HTMLElement;

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
    expect(single.host.querySelectorAll(`.${SLIDER.THUMB}`)).toHaveLength(1);
    expect(thumb(single.host).getAttribute("aria-valuenow")).toBe("40");

    const range = make({ min: 0, max: 19, value: [4, 8], label: "可见范围" });
    expect(range.host.querySelectorAll(`.${SLIDER.THUMB}`)).toHaveLength(2);
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
    expect(host.classList.contains(SLIDER.DISABLED)).toBe(true);
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
    expect(host.querySelectorAll(`.${SLIDER.DOT}`)).toHaveLength(2);
    slider.setCurrent({ at: 13, text: "13" });
    expect(host.querySelector(`.${SLIDER.VALUE_CURRENT}`)?.textContent).toBe("13");
    slider.setCurrent(null);
    expect(host.querySelector(`.${SLIDER.VALUE_CURRENT}`)).toBeNull();
    slider.setCurrent(null);
    expect(host.querySelector(`.${SLIDER.VALUE_CURRENT}`)).toBeNull();
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
    const bubble = document.querySelector(`.${SLIDER.BUBBLE}`) as HTMLElement;
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
    track.dispatchEvent(pointer("pointerdown", 25));
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
    const bubble = document.querySelector(`.${SLIDER.BUBBLE}`) as HTMLElement;
    await new Promise(resolve => window.setTimeout(resolve, 40));
    expect(bubble.textContent).toBe("41");
    thumbEl.dispatchEvent(new Event("blur"));
    await new Promise(resolve => window.setTimeout(resolve, 200));
    expect(bubble.hidden).toBe(true);
  });

  it("clamps a normal range at the neighbour through the pointer path", () => {
    const { host } = make({ min: 0, max: 100, value: [20, 80], label: "x" });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 25));
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
    const bubble = document.querySelector(`.${SLIDER.BUBBLE}`) as HTMLElement;
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
    track.dispatchEvent(pointer("pointerdown", 70));
    expect(sliderOf(host)!.value).toEqual([20, 70]);
    track.dispatchEvent(pointer("pointerup", 70));
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
    const bubble = document.querySelector(`.${SLIDER.BUBBLE}`) as HTMLElement;
    expect(bubble).not.toBeNull();
    expect(bubble.textContent).toBe("42");
    expect(bubble.classList.contains("is-on")).toBe(true);
    thumbEl.dispatchEvent(new Event("blur"));
    expect(bubble.classList.contains("is-on")).toBe(false);
  });

  it("keeps the bubble text in step with keyboard steps", () => {
    const { host } = make({ min: 0, max: 100, value: 40, label: "x" });
    const thumbEl = thumb(host);
    thumbEl.dispatchEvent(new Event("focus"));
    press(thumbEl, "ArrowRight");
    const bubble = document.querySelector(`.${SLIDER.BUBBLE}`) as HTMLElement;
    expect(bubble.textContent).toBe("41");
  });

  it("flips the bubble below when there is no room above", () => {
    const { host } = make({ min: 0, max: 100, value: 42, label: "x" });
    const thumbEl = thumb(host);
    thumbEl.getBoundingClientRect = () =>
      fakeRect({ left: 100, top: 2, width: 14, height: 14 });
    const bubble = document.querySelector(`.${SLIDER.BUBBLE}`) as HTMLElement;
    bubble.getBoundingClientRect = () =>
      fakeRect({ left: 0, top: 0, width: 40, height: 30 });
    thumbEl.dispatchEvent(new Event("focus"));
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
    const dot = host.querySelector(`.${SLIDER.DOT}`);
    const label = host.querySelector(`.${SLIDER.VALUE_CURRENT}`);
    slider.setMarks([
      { at: 0, tone: "limit" },
      { at: 19, tone: "limit" },
    ]);
    slider.setCurrent({ at: 12, text: "12" });
    expect(host.querySelector(`.${SLIDER.DOT}`)).toBe(dot);
    expect(host.querySelector(`.${SLIDER.VALUE_CURRENT}`)).toBe(label);
  });

  it("tears down the instance and its DOM", () => {
    const { host, slider } = make({ min: 0, max: 10, value: 2, label: "x" });
    slider.destroy();
    expect(sliderOf(host)).toBeUndefined();
    expect(host.children).toHaveLength(0);
    expect(host.classList.contains(SLIDER.ROOT)).toBe(false);
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
    const bubble = document.querySelector(`.${SLIDER.BUBBLE}`) as HTMLElement;
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
    expect(host.querySelectorAll(`.${SLIDER.DOT}`)).toHaveLength(2);
    // The same data again compares equal through the tone fallback.
    slider.setMarks([{ at: 0 }, { at: 100 }]);
    expect(host.querySelectorAll(`.${SLIDER.DOT}`)).toHaveLength(2);
  });

  it("clamps the upper thumb when it is dragged below the lower one", () => {
    const { host } = make({ min: 0, max: 100, value: [20, 80], label: "x" });
    const track = stubTrack(host);
    track.dispatchEvent(pointer("pointerdown", 75)); // picks the upper thumb
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
      host.querySelector(`.${SLIDER.THUMB}`)?.classList.contains(SLIDER.DRAGGING),
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
    const bubble = document.querySelector(`.${SLIDER.BUBBLE}`) as HTMLElement;
    expect(bubble.textContent).toBe("60");
  });

  it("keeps the bubble when it is reshown before the hide delay", async () => {
    const { host } = make({ min: 0, max: 100, value: 42, label: "x" });
    const thumbEl = thumb(host);
    thumbEl.dispatchEvent(new Event("focus"));
    thumbEl.dispatchEvent(new Event("blur"));
    thumbEl.dispatchEvent(new Event("focus"));
    await new Promise(resolve => window.setTimeout(resolve, 200));
    const bubble = document.querySelector(`.${SLIDER.BUBBLE}`) as HTMLElement;
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
        .querySelector(`.${SLIDER.DOT}`)!
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
        .querySelector(`.${SLIDER.VALUE_CURRENT}`)!
        .classList.contains(SLIDER.LABEL_HIDDEN),
    ).toBe(true);
    sliderOf(host)!.setCurrent({ at: 50, text: "50", hideGapPct: 10 });
    expect(
      host
        .querySelector(`.${SLIDER.VALUE_CURRENT}`)!
        .classList.contains(SLIDER.LABEL_HIDDEN),
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
    const bubble = document.querySelector(`.${SLIDER.BUBBLE}`) as HTMLElement;
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
    const first = pointer("pointerdown", 25);
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
      host.querySelector(`.${SLIDER.THUMB}`)?.classList.contains(SLIDER.DRAGGING),
    ).toBe(false);
  });

  it("mounts the bubble on the fullscreen element", () => {
    const { host } = make({ min: 0, max: 100, value: 42, label: "x" });
    thumb(host).dispatchEvent(new Event("focus"));
    const bubble = document.querySelector(`.${SLIDER.BUBBLE}`) as HTMLElement;
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
    expect(host.querySelector<HTMLElement>(`.${SLIDER.THUMB}`)!.style.left).toBe("25%");
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
    const thumbEl = () => host.querySelector<HTMLElement>(`.${SLIDER.THUMB}`)!;
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
    const thumbEl = host.querySelector<HTMLElement>("." + SLIDER.THUMB)!;
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
