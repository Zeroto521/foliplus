import { afterEach, describe, expect, it, vi } from "vitest";
import { placeSurface } from "#ui/index.js";

const surfaces: HTMLElement[] = [];

const makeSurface = (width: number, height: number): HTMLElement => {
  const el = document.createElement("div");
  Object.defineProperty(el, "offsetWidth", { value: width });
  Object.defineProperty(el, "offsetHeight", { value: height });
  document.body.appendChild(el);
  surfaces.push(el);
  return el;
};

const rect = (top: number, right: number, bottom: number, left: number) => ({
  top,
  right,
  bottom,
  left,
});

afterEach(() => {
  while (surfaces.length > 0) surfaces.pop()?.remove();
  document.body.innerHTML = "";
});

describe("placeSurface", () => {
  it("writes the box edges with the viewport and the border box by default", () => {
    const surface = makeSurface(160, 40);
    const placement = placeSurface(surface, {
      anchor: rect(100, 220, 130, 120),
      gap: 4,
    });

    // Right-aligned to the anchor and below it, with no centre conversion.
    expect(surface.style.left).toBe("60px");
    expect(surface.style.top).toBe("134px");
    expect(surface.dataset.side).toBeUndefined();
    expect(placement).toMatchObject({ left: 60, top: 134, side: "below" });
  });

  it("writes the centre coordinate when origin is center", () => {
    const surface = makeSurface(160, 40);
    placeSurface(surface, {
      anchor: rect(100, 200, 130, 100),
      align: "center",
      origin: "center",
    });

    // align:center puts the box at 70..230; the inline left is its centre.
    expect(surface.style.left).toBe("150px");
  });

  it("uses an explicit size and bounds instead of the measured box", () => {
    const surface = makeSurface(999, 999);
    placeSurface(surface, {
      anchor: rect(10, 120, 40, 20),
      bounds: rect(0, 300, 300, 0),
      size: { width: 200, height: 50 },
    });

    // natural width 200 in a 300px frame -> left clamps to 0; below the anchor.
    expect(surface.style.left).toBe("0px");
    expect(surface.style.top).toBe("40px");
  });

  it("writes data-side and calls onSide with the resolved side", () => {
    const surface = makeSurface(100, 40);
    const onSide = vi.fn();
    placeSurface(surface, {
      anchor: rect(740, 200, 770, 100),
      bounds: rect(0, 300, 800, 0),
      sideAttribute: "side",
      onSide,
    });

    // No room below, room above: the side is above and both markers agree.
    expect(surface.dataset.side).toBe("above");
    expect(onSide).toHaveBeenCalledWith("above");
  });
});
