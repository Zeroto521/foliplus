import { afterEach, describe, expect, it, vi } from "vitest";
import { Slider, type SliderOptions, sliderOf } from "#common/slider.js";

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
});
