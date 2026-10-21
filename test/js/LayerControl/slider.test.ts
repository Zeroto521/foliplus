import { afterEach, describe, expect, it, vi } from "vitest";
import { Slider, type SliderOptions, sliderOf } from "#foliplus/LayerControl/slider.js";

const hosts: HTMLElement[] = [];

const make = (options: SliderOptions) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const slider = new Slider(host, options);
  return { host, slider };
};

const thumb = (host: HTMLElement, index = 0): HTMLElement =>
  host.querySelectorAll<HTMLElement>(".foliplus-slider-thumb")[index];

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
  host.querySelector(".foliplus-slider-track") as HTMLElement;

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
    expect(single.host.querySelectorAll(".foliplus-slider-thumb")).toHaveLength(1);
    expect(thumb(single.host).getAttribute("aria-valuenow")).toBe("40");

    const range = make({ min: 0, max: 19, value: [4, 8], label: "可见范围" });
    expect(range.host.querySelectorAll(".foliplus-slider-thumb")).toHaveLength(2);
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
    expect(host.classList.contains("is-disabled")).toBe(true);
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
    expect(host.querySelectorAll(".foliplus-slider-dot")).toHaveLength(2);
    slider.setCurrent({ at: 13, text: "13" });
    expect(host.querySelector(".foliplus-slider-value-current")?.textContent).toBe(
      "13",
    );
    slider.setCurrent(null);
    expect(host.querySelector(".foliplus-slider-value-current")).toBeNull();
    slider.setCurrent(null);
    expect(host.querySelector(".foliplus-slider-value-current")).toBeNull();
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
    const bubble = document.querySelector(".foliplus-slider-bubble") as HTMLElement;
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
    const bubble = document.querySelector(".foliplus-slider-bubble") as HTMLElement;
    await new Promise(resolve => window.setTimeout(resolve, 40));
    expect(bubble.textContent).toBe("41");
    thumbEl.dispatchEvent(new Event("blur"));
    await new Promise(resolve => window.setTimeout(resolve, 200));
    expect(bubble.hidden).toBe(true);
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
    expect(host.querySelectorAll(".foliplus-slider-dot")).toHaveLength(2);
    slider.setCurrent({ at: 13, text: "13" });
    expect(host.querySelector(".foliplus-slider-value-current")?.textContent).toBe(
      "13",
    );
    slider.setCurrent(null);
    expect(host.querySelector(".foliplus-slider-value-current")).toBeNull();
    slider.setCurrent(null);
    expect(host.querySelector(".foliplus-slider-value-current")).toBeNull();
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
    const bubble = document.querySelector(".foliplus-slider-bubble") as HTMLElement;
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
    const bubble = document.querySelector(".foliplus-slider-bubble") as HTMLElement;
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

  it("slides a collapsed pair with a pointer and separates on the open side", () => {
    const { host } = make({ min: 0, max: 100, value: [50, 50], label: "x" });
    const track = stubTrack(host);
    // Left half of the stack takes the lower thumb; moving right slides both.
    track.dispatchEvent(pointer("pointerdown", 48));
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
    const bubble = document.querySelector(".foliplus-slider-bubble") as HTMLElement;
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
    const bubble = document.querySelector(".foliplus-slider-bubble") as HTMLElement;
    expect(bubble.textContent).toBe("41");
  });

  it("flips the bubble below when there is no room above", () => {
    const { host } = make({ min: 0, max: 100, value: 42, label: "x" });
    const thumbEl = thumb(host);
    thumbEl.getBoundingClientRect = () =>
      fakeRect({ left: 100, top: 2, width: 14, height: 14 });
    const bubble = document.querySelector(".foliplus-slider-bubble") as HTMLElement;
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
    const dot = host.querySelector(".foliplus-slider-dot");
    const label = host.querySelector(".foliplus-slider-value-current");
    slider.setMarks([
      { at: 0, tone: "limit" },
      { at: 19, tone: "limit" },
    ]);
    slider.setCurrent({ at: 12, text: "12" });
    expect(host.querySelector(".foliplus-slider-dot")).toBe(dot);
    expect(host.querySelector(".foliplus-slider-value-current")).toBe(label);
  });

  it("tears down the instance and its DOM", () => {
    const { host, slider } = make({ min: 0, max: 10, value: 2, label: "x" });
    slider.destroy();
    expect(sliderOf(host)).toBeUndefined();
    expect(host.children).toHaveLength(0);
    expect(host.classList.contains("foliplus-slider")).toBe(false);
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
});
