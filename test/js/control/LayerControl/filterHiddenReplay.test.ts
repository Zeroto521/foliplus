import { initFixture, makeAuthorIcon } from "./ui/fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FILTER_SOURCE, type LayerFilterFeatures } from "#core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import type { LayerController } from "#control/LayerControl/controller.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";
import { commitGlyph } from "#control/LayerControl/ui/style/icon.js";
import { FACE, flushStyleDimApply } from "#control/LayerControl/ui/style/styleBag.js";

// The shared L stub (test/js/setup.ts) defines no Icon key. The default-icon
// fallback in buildMarkerIcon reads L.Icon.Default; provide a minimal class so
// the derive path does not throw. Same as the icon suite.
class TestDivIcon {
  options: any;
  constructor(options: any) {
    this.options = options;
  }
}
(window.L as any).Icon = { Default: class {} };
(window.L as any).DivIcon = TestDivIcon;
(window.L as any).divIcon = vi.fn((options: any) => new TestDivIcon(options));

// A marker leaf whose setIcon mirrors real Leaflet: it swaps options.icon and
// materialises a NEW element via the derived icon's createIcon, so a glyph
// change genuinely rebuilds the DOM node (the mechanism the hidden-class
// drift is about). getElement() returns the CURRENT element, exactly what
// visibleDomOf (core/layer/carrier.ts:91) enumerates in applyFilterClass.
const makeRebuildMarker = (authorIcon: unknown): any => {
  let iconEl: HTMLElement | null = null;
  const leaf: any = {
    options: { icon: authorIcon },
    feature: { properties: { value: 1 } },
    getElement: () => iconEl,
    setIcon: vi.fn((next: unknown) => {
      leaf.options.icon = next;
      iconEl =
        typeof (next as { createIcon?: unknown })?.createIcon === "function"
          ? (next as { createIcon: () => HTMLElement }).createIcon()
          : document.createElement("div");
      return leaf;
    }),
  };
  leaf.setIcon(authorIcon);
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

const between = (field: string, range: readonly [number, number]) => ({
  kind: "atom" as const,
  field,
  op: "between" as const,
  range,
});

describe("filter hidden-class survives a glyph rebuild (kill-test)", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let marker: any;
  let authorIcon: any;

  beforeEach(() => {
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (el: Element, pseudo?: string | null) =>
        ({
          content:
            (window as any).__glyphProbePainted !== false && pseudo === "::before"
              ? '"\\f00a"'
              : "none",
        }) as CSSStyleDeclaration,
    );
    (window as any).__glyphProbePainted = true;
    authorIcon = makeAuthorIcon();
    marker = makeRebuildMarker(authorIcon);
    const layer = makeMarkerGroup(marker);
    ({ manager, ui } = initFixture({
      data: [{ id: "flt1", name: "Flt", role: "overlay", layer }, BASE_LAYER],
    }));
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.restoreAllMocks();
    (window as any).__glyphProbePainted = true;
  });

  const featuresOf = (leaf: unknown): LayerFilterFeatures => ({
    features: [{ leaf: leaf as any, fields: { value: 1 } }],
    total: 1,
    numericFields: ["value"],
    ranges: { value: [1, 1] },
    enumFields: [],
    enumValues: {},
  });

  const hasHiddenClass = (el: HTMLElement | null) =>
    !!el?.classList.contains(CONST.CLASSES.FILTER_HIDDEN);

  it("a glyph change that rebuilds the icon must not drop the hidden class", () => {
    ui.runtimeStore.setFilterFeatures("flt1", featuresOf(marker));
    manager.setLayerFilter("flt1", between("value", [2, 5]));
    const firstEl = marker.getElement();
    expect(hasHiddenClass(firstEl)).toBe(true);
    expect(manager.hiddenSets.get("flt1")?.has(marker)).toBe(true);

    const elementBefore = marker.getElement();
    commitGlyph(ui, "flt1", "star");
    flushStyleDimApply(FACE.ICON, "flt1");
    const elementAfter = marker.getElement();
    expect(elementAfter).not.toBe(elementBefore);
    expect(marker.setIcon).toHaveBeenCalled();

    const labelWillSkip = manager.hiddenSets.get("flt1")?.has(marker) ?? false;
    const domHidden = hasHiddenClass(elementAfter);
    expect(domHidden).toBe(labelWillSkip);
    expect(domHidden).toBe(true);
  });

  it("a layer with no committed filter keeps its rebuilt element unclassed", () => {
    ui.runtimeStore.setFilterFeatures("flt1", featuresOf(marker));
    expect(
      manager.filterStore.getFilter("flt1", FILTER_SOURCE.GENERIC),
    ).toBeUndefined();
    expect(hasHiddenClass(marker.getElement())).toBe(false);

    commitGlyph(ui, "flt1", "star");
    flushStyleDimApply(FACE.ICON, "flt1");

    expect(marker.setIcon).toHaveBeenCalled();
    expect(hasHiddenClass(marker.getElement())).toBe(false);
    expect(manager.hiddenSets.get("flt1")).toBeUndefined();
  });
});
