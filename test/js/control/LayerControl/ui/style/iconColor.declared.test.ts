// ui/style/iconColor.declared — the foliplus icon block as the icon-colour
// dimension's read-time default.
//
// The declared glyph colour / alpha is the value the row starts at and Reset
// returns to; the glyph is orthogonal and a declared glyph rides every colour
// re-derivation. This file pins that chain next to the icon-colour suite.
import { initFixture, makeAuthorIcon } from "../fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INTENT, getIntent } from "#control/LayerControl/ui/intent.js";
import {
  buildIconColorRow,
  commitIconColor,
  commitIconColorOpacity,
  resetLayerIconColor,
} from "#control/LayerControl/ui/style/iconColor.js";
import { FACE, flushStyleDimApply } from "#control/LayerControl/ui/style/styleBag.js";

class TestDivIcon {
  options: any;
  constructor(options: any) {
    this.options = options;
  }
}
beforeEach(() => {
  (window.L as any).Icon = { Default: class {} };
  (window.L as any).DivIcon = TestDivIcon;
  (window.L as any).divIcon = vi.fn((options: any) => new TestDivIcon(options));
  (window as any).__glyphProbePainted = true;
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    (el: Element, pseudo?: string | null) =>
      ({
        content:
          (window as any).__glyphProbePainted && pseudo === "::before"
            ? '"\\f00a"'
            : "none",
      }) as CSSStyleDeclaration,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  (window as any).__glyphProbePainted = true;
});

const makeMarker = (props: Record<string, unknown> = {}, icon?: unknown): any => {
  const leaf: any = {
    feature: { properties: props },
    options: { icon },
    setIcon: vi.fn((next: unknown) => {
      leaf.options.icon = next;
      return leaf;
    }),
  };
  return leaf;
};

const makeMarkerGroup = (...markers: any[]): any => ({
  options: {},
  eachLayer: vi.fn((fn: (child: unknown) => void) => {
    for (const marker of markers) fn(marker);
  }),
});

const BASE_LAYER = {
  id: "base1",
  name: "OSM",
  role: "base",
  layer: { options: {}, setZIndex: vi.fn() } as never,
  paneName: "tilePane",
};

const fixtureWithDeclared = (markers: any[], foliplus: Record<string, unknown>) => {
  const layer = makeMarkerGroup(...markers);
  layer.options = { foliplus };
  const fixture = initFixture({
    data: [{ id: "overlay1", name: "CM", role: "overlay", layer }, BASE_LAYER],
  });
  return { ...fixture, layer };
};

const flushIconColor = (id: string) => flushStyleDimApply(FACE.ICON_COLOR, id);

describe("declared icon block — colour row", () => {
  it("shows the declared colour over the author's drawn one", () => {
    const author = makeAuthorIcon({ iconColor: "#3366ff" });
    const marker = makeMarker({ type: "school" }, author);
    const { ui } = fixtureWithDeclared([marker], { icon: { color: "#00ff00" } });

    const row = buildIconColorRow(ui, "overlay1")!;
    const input = row.querySelector("input[type=color]") as HTMLInputElement;
    expect(input.value).toBe("#00ff00");
  });

  it("shows the declared alpha as the opacity default", () => {
    const author = makeAuthorIcon({ iconColor: "#3366ff" });
    const marker = makeMarker({ type: "school" }, author);
    const { ui } = fixtureWithDeclared([marker], { icon: { color_opacity: 40 } });

    const row = buildIconColorRow(ui, "overlay1")!;
    const input = row.querySelector("input[type=number]") as HTMLInputElement;
    expect((input as HTMLInputElement).value).toBe("40");
  });

  it("a user colour still wins over the declared colour", () => {
    const author = makeAuthorIcon({ iconColor: "#3366ff" });
    const marker = makeMarker({ type: "school" }, author);
    const { ui } = fixtureWithDeclared([marker], { icon: { color: "#00ff00" } });
    commitIconColor(ui, "overlay1", "#ff0000");
    flushIconColor("overlay1");

    const row = buildIconColorRow(ui, "overlay1")!;
    const input = row.querySelector("input[type=color]") as HTMLInputElement;
    expect(input.value).toBe("#ff0000");
    expect(getIntent(ui, "overlay1", INTENT.ICON_COLOR)).toBe("#ff0000");
  });
});

describe("declared icon block — colour reset / derive", () => {
  it("reset returns to the declared colour", () => {
    const author = makeAuthorIcon({ iconColor: "#3366ff" });
    const marker = makeMarker({ type: "school" }, author);
    const { ui } = fixtureWithDeclared([marker], { icon: { color: "#00ff00" } });

    commitIconColor(ui, "overlay1", "#ff0000");
    flushIconColor("overlay1");
    resetLayerIconColor(ui, "overlay1");

    const inner = marker.options.icon.createIcon().querySelector("i") as HTMLElement;
    expect(inner.style.color).toBe("rgb(0, 255, 0)");
  });

  it("reset returns to the declared alpha", () => {
    const author = makeAuthorIcon({ iconColor: "#3366ff" });
    const marker = makeMarker({ type: "school" }, author);
    const { ui } = fixtureWithDeclared([marker], { icon: { color_opacity: 40 } });

    commitIconColorOpacity(ui, "overlay1", 90);
    flushIconColor("overlay1");
    resetLayerIconColor(ui, "overlay1");

    const inner = marker.options.icon.createIcon().querySelector("i") as HTMLElement;
    expect(inner.style.color).toContain("0.4");
  });

  it("a colour-only write keeps the declared glyph", () => {
    const author = makeAuthorIcon({ iconColor: "#3366ff" });
    author.options = { ...author.options, icon: "star" };
    const marker = makeMarker({ type: "school" }, author);
    const { ui } = fixtureWithDeclared([marker], {
      icon: { glyph: "heart", color: "#ff0000" },
    });

    commitIconColor(ui, "overlay1", "#0000ff");
    flushIconColor("overlay1");
    expect(marker.options.icon.createIcon().innerHTML).toContain("heart");
  });
});
