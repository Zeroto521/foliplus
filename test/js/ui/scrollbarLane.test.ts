import { describe, expect, it, vi } from "vitest";
import {
  SCROLLBAR_LANE_PROPERTY,
  measureScrollbarLane,
  publishScrollbarLane,
} from "#ui/scrollbarLane.js";

const mount = (offsetWidth: number, clientWidth: number): HTMLElement => {
  const el = document.createElement("div");
  // jsdom reports no layout boxes, so the measured widths are pinned here and
  // the real geometry is pinned by the browser tests.
  Object.defineProperty(el, "offsetWidth", {
    configurable: true,
    value: offsetWidth,
  });
  Object.defineProperty(el, "clientWidth", {
    configurable: true,
    value: clientWidth,
  });
  document.body.appendChild(el);
  return el;
};

const withBorders =
  (left: string, right: string) =>
  (el: Element): CSSStyleDeclaration => {
    void el;
    return { borderLeftWidth: left, borderRightWidth: right } as CSSStyleDeclaration;
  };

describe("scrollbarLane", () => {
  it("measures offsetWidth - clientWidth minus the borders", () => {
    const el = mount(280, 268);
    const spy = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation(withBorders("1px", "1px"));
    try {
      expect(measureScrollbarLane(el)).toBe(10);
    } finally {
      spy.mockRestore();
    }
  });

  it("treats a box without borders as measured straight from the widths", () => {
    const el = mount(300, 286);
    const spy = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation(withBorders("", ""));
    try {
      expect(measureScrollbarLane(el)).toBe(14);
    } finally {
      spy.mockRestore();
    }
  });

  it("never reports a negative lane", () => {
    const el = mount(200, 200);
    const spy = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation(withBorders("1px", "2px"));
    try {
      expect(measureScrollbarLane(el)).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("publishes the lane as a px custom property and returns it", () => {
    const el = mount(300, 276);
    const spy = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation(withBorders("1px", "1px"));
    try {
      expect(publishScrollbarLane(el)).toBe(22);
      expect(el.style.getPropertyValue(SCROLLBAR_LANE_PROPERTY)).toBe("22px");
    } finally {
      spy.mockRestore();
    }
  });
});
