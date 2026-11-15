import { afterEach, describe, expect, it, vi } from "vitest";
import { applyPlacement, placeSurface, viewportBounds } from "#ui/index.js";

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
describe("applyPlacement", () => {
  const placement = {
    top: 100,
    left: 40,
    side: "above" as const,
    maxWidth: 160,
    maxHeight: 80,
  };

  it("writes an existing placement's edges", () => {
    const surface = makeSurface(160, 40);
    applyPlacement(surface, placement);

    expect(surface.style.left).toBe("40px");
    expect(surface.style.top).toBe("100px");
    expect(surface.style.bottom).toBe("");
  });

  it("anchors an above-flipped box by its bottom edge", () => {
    const surface = makeSurface(160, 40);
    applyPlacement(surface, placement, {
      bottomWhenAbove: true,
      bounds: rect(0, 300, 800, 0),
      size: { width: 160, height: 40 },
    });

    // 800 - 100 - min(40, 80) = 660.
    expect(surface.style.top).toBe("");
    expect(surface.style.bottom).toBe("660px");
  });

  it("keeps the top anchor when the side is below", () => {
    const surface = makeSurface(160, 40);
    applyPlacement(
      surface,
      { ...placement, side: "below" },
      {
        bottomWhenAbove: true,
      },
    );

    expect(surface.style.top).toBe("100px");
    expect(surface.style.bottom).toBe("");
  });

  it("defaults the bottom offset to the border box and the viewport", () => {
    const surface = makeSurface(160, 40);
    applyPlacement(surface, placement, { bottomWhenAbove: true });

    // jsdom viewport height 768 - 100 - 40.
    expect(surface.style.bottom).toBe("628px");
  });

  it("clamps the written top with minTop", () => {
    const surface = makeSurface(160, 40);
    applyPlacement(surface, placement, { minTop: 120 });

    expect(surface.style.top).toBe("120px");
  });

  it("skips the vertical write with writeTop: false", () => {
    const surface = makeSurface(160, 40);
    surface.style.top = "7px";
    applyPlacement(surface, placement, { writeTop: false });

    expect(surface.style.left).toBe("40px");
    expect(surface.style.top).toBe("7px");
  });

  it("writes the centre and the side markers", () => {
    const surface = makeSurface(160, 40);
    const onSide = vi.fn();
    applyPlacement(surface, placement, {
      origin: "center",
      sideAttribute: "side",
      onSide,
    });

    expect(surface.style.left).toBe("120px");
    expect(surface.dataset.side).toBe("above");
    expect(onSide).toHaveBeenCalledWith("above");
  });
});

describe("viewportBounds", () => {
  it("is the viewport box", () => {
    expect(viewportBounds()).toEqual({
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
    });
  });
});
