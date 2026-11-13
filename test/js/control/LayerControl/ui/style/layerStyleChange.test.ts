// control/LayerControl/ui/style — the LAYER_STYLE_CHANGE publish contract.
//
// One user style commit lands as exactly one bus announcement carrying the
// layer id; a reflow that is not a user edit (a content change replaying
// stored intent onto new leaves, or a Reset restoring the author value)
// lands as none. The registry owns the list of dimensions, so this file
// walks its two section orders instead of hand-copying them: a dimension
// added to DIM_ORDER shows up here with its carrier and its verdict.
//
// Deleting the publish in styleBag's runBox turns every style row red;
// deleting the opacity descriptor's publish turns its row red.

import { initFixture, installLeafletGlobals } from "../fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { DIM } from "#core/layer/index.js";
import type { LayerController } from "#control/LayerControl/controller.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";
import { commitBorderColor } from "#control/LayerControl/ui/style/border.js";
import {
  commitFillColor,
  resetLayerFill,
} from "#control/LayerControl/ui/style/fill.js";
import { commitGlyph } from "#control/LayerControl/ui/style/icon.js";
import { commitIconColor } from "#control/LayerControl/ui/style/iconColor.js";
import { commitMarkerColor } from "#control/LayerControl/ui/style/markerColor.js";
import {
  DIM_ORDER,
  LABEL_DIM_ORDER,
  getDimension,
} from "#control/LayerControl/ui/style/registry.js";
import { commitSize } from "#control/LayerControl/ui/style/size.js";
import {
  FACE,
  flushStyleDimApply,
  scheduleStyleDimApply,
} from "#control/LayerControl/ui/style/styleBag.js";
import { commitZoomRange } from "#control/LayerControl/ui/style/zoomRange.js";

// ────────────────────────────────────────────────────────────────────────
// One carrier per capability family: a dimension only passes its gate on the
// family it owns, so each family registers its own layer.
// ────────────────────────────────────────────────────────────────────────

/** A polygon leaf with its own setStyle spy, so the fill and border walks
 *  have a real target. The parent dispatches to each child, the shape
 *  Leaflet's LayerGroup.setStyle walks. */
const makeFillableLayer = () => {
  const leaf = new L.Polygon() as L.Polygon & {
    setStyle: ReturnType<typeof vi.fn>;
  };
  leaf.options = { fillColor: "#aabbcc", fillOpacity: 0.5, fill: true };
  leaf.setStyle = vi.fn();
  return {
    options: {},
    eachLayer: vi.fn((fn: (child: unknown) => void) => fn(leaf)),
    leaf,
  } as unknown as L.Layer & { leaf: typeof leaf };
};

/** A pixel-radius leaf: Leaflet's CircleMarker writes through setRadius. */
const makeRadiusLeaf = (radius = 10): any => {
  const leaf: any = {
    options: { radius, color: "#000000", weight: 2 },
    _radius: radius,
    setStyle: vi.fn(),
  };
  leaf.getRadius = () => leaf._radius;
  leaf.setRadius = vi.fn((px: number) => {
    leaf._radius = px;
    leaf.options.radius = px;
    return leaf;
  });
  return leaf;
};

/** A marker leaf: the icon family writes options.icon through setIcon. */
const makeMarker = (icon?: unknown): any => {
  const leaf: any = {
    feature: { properties: {} },
    options: { icon },
    setIcon: vi.fn((next: unknown) => {
      leaf.options.icon = next;
      return leaf;
    }),
  };
  return leaf;
};

const BASE_LAYER = {
  id: "base1",
  name: "OSM",
  role: "base",
  layer: { options: {}, setZIndex: vi.fn() } as never,
  paneName: "tilePane",
};

const OVERLAY = (layer: unknown) => ({
  id: "overlay1",
  name: "Layer",
  role: "overlay",
  layer,
});

type Family = "vector" | "radius" | "marker";

const familyOf = (dim: string): Family =>
  dim === DIM.SIZE
    ? "radius"
    : dim === DIM.ICON || dim === DIM.ICON_COLOR || dim === DIM.MARKER_COLOR
      ? "marker"
      : "vector";

const boot = (family: Family): { manager: LayerController; ui: LayerUI } => {
  installLeafletGlobals();
  const layer =
    family === "vector"
      ? makeFillableLayer()
      : family === "radius"
        ? makeRadiusLeaf()
        : ({
            options: {},
            eachLayer: vi.fn((fn: (child: unknown) => void) => {
              fn(makeMarker());
            }),
          } as unknown as L.Layer);
  const { manager, ui } = initFixture({ data: [OVERLAY(layer), BASE_LAYER] });
  return { manager, ui };
};

// jsdom has no FontAwesome stylesheet, so glyphAvailable probes every glyph
// unavailable and the icon dimension's apply aborts before its face lands.
// Stub the probe the way icon.test.ts does, one codepoint.
beforeEach(() => {
  (window.L as any).Icon = { Default: class {} };
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    (el: Element, pseudo?: string | null) =>
      ({
        content: pseudo === "::before" ? '"\\\\f00a"' : "none",
      }) as CSSStyleDeclaration,
  );
});

// ────────────────────────────────────────────────────────────────────────

/** One real commit for one dimension key — the same entry point the panel
 *  row takes, then a flush for the frame-coalesced faces. */
const commit = (ui: LayerUI, dim: string): void => {
  const id = "overlay1";
  switch (dim) {
    case DIM.FILL:
      commitFillColor(ui, id, "#ff0000");
      flushStyleDimApply(FACE.FILL, id);
      return;
    case DIM.BORDER:
      commitBorderColor(ui, id, "#00ff00");
      flushStyleDimApply(FACE.STROKE, id);
      return;
    case DIM.SIZE:
      commitSize(ui, id, 30);
      flushStyleDimApply(FACE.SIZE, id);
      return;
    case DIM.ICON:
      commitGlyph(ui, id, "school");
      flushStyleDimApply(FACE.ICON, id);
      return;
    case DIM.ICON_COLOR:
      commitIconColor(ui, id, "#123456");
      flushStyleDimApply(FACE.ICON_COLOR, id);
      return;
    case DIM.MARKER_COLOR:
      commitMarkerColor(ui, id, "#654321");
      flushStyleDimApply(FACE.MARKER_COLOR, id);
      return;
    default:
      return;
  }
};

describe("LAYER_STYLE_CHANGE — one user commit, one announcement", () => {
  let manager: LayerController;

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Every dimension the panel writes as a style intent. Derived from the
   *  registry order, not a hand-copied list. */
  const styleDims = DIM_ORDER.filter(
    dim =>
      dim === DIM.FILL ||
      dim === DIM.BORDER ||
      dim === DIM.SIZE ||
      dim === DIM.ICON ||
      dim === DIM.ICON_COLOR ||
      dim === DIM.MARKER_COLOR,
  );

  for (const dim of styleDims) {
    it(dim + ": a user commit announces once with the layer id", () => {
      const fixture = boot(familyOf(dim));
      manager = fixture.manager;
      const seen: Array<{ id: string }> = [];
      fixture.ui.events.on(EVENTS.LAYER_STYLE_CHANGE, payload => {
        seen.push(payload as { id: string });
      });

      commit(fixture.ui, dim);

      expect(seen).toHaveLength(1, "expected exactly one announcement");
      expect(seen[0]).toEqual({ id: "overlay1" });
    });
  }

  it("opacity: a user edit publishes through the projection path", () => {
    const fixture = boot("vector");
    manager = fixture.manager;
    const ui = fixture.ui;
    const seen: Array<{ id: string }> = [];
    ui.events.on(EVENTS.LAYER_STYLE_CHANGE, payload => {
      seen.push(payload as { id: string });
    });

    getDimension<number>(DIM.OPACITY)!.write!(ui, "overlay1", 0.5);

    expect(seen).toEqual([{ id: "overlay1" }]);
  });

  it("zoom range: no announcement (a map-membership concern, not style)", () => {
    const fixture = boot("vector");
    manager = fixture.manager;
    const ui = fixture.ui;
    const seen: Array<{ id: string }> = [];
    ui.events.on(EVENTS.LAYER_STYLE_CHANGE, payload => {
      seen.push(payload as { id: string });
    });

    commitZoomRange(ui, "overlay1", { min: 3, max: 9 });

    expect(seen).toHaveLength(0);
  });

  it("label: no user write at all — the dimension rides its content replay", () => {
    for (const dim of LABEL_DIM_ORDER) {
      expect(getDimension(dim).write).toBeUndefined();
    }
  });
});

describe("LAYER_STYLE_CHANGE — a reflow that is not a user edit stays silent", () => {
  let manager: LayerController;

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("a content-change replay (LAYER_ITEM_COUNT_CHANGE source) publishes none", () => {
    const fixture = boot("vector");
    manager = fixture.manager;
    const ui = fixture.ui;
    const seen: Array<{ id: string }> = [];
    ui.events.on(EVENTS.LAYER_STYLE_CHANGE, payload => {
      seen.push(payload as { id: string });
    });

    // The lifecycle path: new leaves arrive and stored intent re-applies.
    // The source names the reflow, so the box must not announce a change
    // nobody made.
    scheduleStyleDimApply(FACE.FILL, "overlay1", () => undefined, {
      source: EVENTS.LAYER_ITEM_COUNT_CHANGE,
      owner: ui,
    });
    flushStyleDimApply(FACE.FILL, "overlay1");

    expect(seen).toHaveLength(0);
  });

  it("a reset restoring the author value publishes none", () => {
    const fixture = boot("vector");
    manager = fixture.manager;
    const ui = fixture.ui;
    // Establish a user intent first so the reset has something to clear.
    commitFillColor(ui, "overlay1", "#ff0000");
    flushStyleDimApply(FACE.FILL, "overlay1");
    const seen: Array<{ id: string }> = [];
    ui.events.on(EVENTS.LAYER_STYLE_CHANGE, payload => {
      seen.push(payload as { id: string });
    });

    // Reset walks the leaves directly (no scheduled box), so it cannot
    // manufacture an announcement.
    resetLayerFill(ui, "overlay1");

    expect(seen).toHaveLength(0);
  });
});
