// ui/style/icon.declared — the foliplus icon block as the icon dimension's
// read-time default.
//
// The panel's icon face has two sources of truth: the user's intent and the
// author's face (the drawn folium Icon plus the foliplus={...} declaration).
// A declared glyph is the read-time default the row shows and Reset returns
// to; a user pick always wins. This file pins that chain at the panel/DOM
// level, next to the icon suite it extends.
import { initFixture, makeAuthorIcon } from "../fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#control/LayerControl/const.js";
import { INTENT, getIntent } from "#control/LayerControl/ui/intent.js";
import {
  applyIconToLayer,
  authorGlyphName,
  buildIconRow,
  commitGlyph,
  resetLayerIcon,
} from "#control/LayerControl/ui/style/icon.js";
import { writeIntentKeys } from "#control/LayerControl/ui/style/registry.js";
import { FACE, flushStyleDimApply } from "#control/LayerControl/ui/style/styleBag.js";

// The shared L stub (test/js/setup.ts) defines no Icon key; the core
// markerIcon module reads L.Icon.Default, so provide a minimal default class
// and a real (options-carrying) DivIcon for the derived-icon path.
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
  // jsdom has no FontAwesome stylesheet: stub the ::before content probe so a
  // syntactically valid declared glyph reads as painted.
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

/** A marker layer whose group carries the foliplus={...} declaration. */
const fixtureWithDeclared = (markers: any[], foliplus: Record<string, unknown>) => {
  const layer = makeMarkerGroup(...markers);
  layer.options = { foliplus };
  const fixture = initFixture({
    data: [{ id: "overlay1", name: "CM", role: "overlay", layer }, BASE_LAYER],
  });
  return { ...fixture, layer };
};

const flushIcon = (id: string) => flushStyleDimApply(FACE.ICON, id);

const triggerOf = (row: HTMLElement): HTMLElement =>
  row.querySelector(`.${CONST.CLASSES.STYLE_ICON_TRIGGER}`) as HTMLElement;

describe("declared icon block — panel face", () => {
  it("shows the declared glyph over the author's drawn glyph", () => {
    const author = makeAuthorIcon();
    author.options = { ...author.options, icon: "star" };
    const marker = makeMarker({ type: "school" }, author);
    const { ui } = fixtureWithDeclared([marker], { icon: { glyph: "heart" } });

    expect(authorGlyphName(ui, "overlay1")).toEqual({ name: "heart", valid: true });
    expect(triggerOf(buildIconRow(ui, "overlay1")!).textContent).toContain("heart");
  });

  it("keeps the author's drawn glyph when the block declares none", () => {
    const author = makeAuthorIcon();
    author.options = { ...author.options, icon: "star" };
    const marker = makeMarker({ type: "school" }, author);
    const { ui } = fixtureWithDeclared([marker], { icon: { color: "#ff0000" } });

    expect(authorGlyphName(ui, "overlay1")?.name).toBe("star");
  });
});

describe("declared icon block — reset / derive", () => {
  it("reset returns to the declared glyph", () => {
    const author = makeAuthorIcon();
    const marker = makeMarker({ type: "school" }, author);
    const { ui } = fixtureWithDeclared([marker], { icon: { glyph: "heart" } });

    commitGlyph(ui, "overlay1", "star");
    flushIcon("overlay1");
    expect(marker.options.icon).not.toBe(author);

    resetLayerIcon(ui, "overlay1");
    const derived = marker.options.icon;
    expect(derived).not.toBe(author);
    expect(derived.createIcon().innerHTML).toContain("heart");
  });

  it("a glyph write carries the declared colour and alpha", () => {
    const author = makeAuthorIcon();
    const marker = makeMarker({ type: "school" }, author);
    const { ui } = fixtureWithDeclared([marker], {
      icon: { color: "#ff0000", color_opacity: 50 },
    });

    writeIntentKeys(ui, "overlay1", [
      [INTENT.ICON, { kind: "glyph", value: "star" }],
    ]);
    applyIconToLayer(ui, "overlay1");
    const inner = marker.options.icon.createIcon().querySelector("i") as HTMLElement;
    expect(inner.style.color).toContain("0.5");
  });

  it("a user glyph still wins over the declared glyph", () => {
    const author = makeAuthorIcon();
    const marker = makeMarker({ type: "school" }, author);
    const { ui } = fixtureWithDeclared([marker], { icon: { glyph: "heart" } });

    commitGlyph(ui, "overlay1", "star");
    flushIcon("overlay1");
    expect(getIntent(ui, "overlay1", INTENT.ICON)).toEqual({
      kind: "glyph",
      value: "star",
    });
    expect(marker.options.icon.createIcon().innerHTML).toContain("star");
  });
});
