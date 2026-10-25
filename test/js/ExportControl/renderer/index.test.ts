// ExportControl — the per-layer marker-shadow pane in the export walk.
//
// A marker's shadow lives in the pane its leaf names in `options.shadowPane`.
// Since #733 a marker layer gets its own shadow pane, and the option points at
// it; before that every shadow sat in Leaflet's shared `shadowPane`, which pane
// discovery excludes (it only enumerates `options.pane`), so the export has
// never drawn a shadow at all.  This file pins the two properties that make the
// gap closed rather than merely different: the shadow is drawn, and it is drawn
// BELOW its icon — the layer's shadow pane is one z-step under its content
// (`zFor({ role: "shadow" })` = slot - 1), and the export must reproduce that
// with draw order, not with pane iteration.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportRenderer } from "#foliplus/ExportControl/renderer/index.js";
import * as UTIL from "#foliplus/ExportControl/util.js";

// index.ts binds its logger and translator to CONFIG.name at module-import
// time, so the component name has to be set before the import resolves —
// setup.ts leaves it at "SearchControl".  Must run before the import, not in
// beforeEach (same pattern as renderer.test.ts).
window.CONFIG = { ...window.CONFIG, name: "ExportControl" };

// renderMarkers loads its sprites through the hoisted factory: the module
// exports are getters, so a plain vi.spyOn on it throws from inside pooledEach.
vi.mock("#foliplus/ExportControl/util.js", async () => {
  const actual = await vi.importActual<any>("#foliplus/ExportControl/util.js");
  const loadImageBitmap = vi.fn();
  return { ...actual, loadImageBitmap };
});

const containerRect = (): DOMRect =>
  ({
    left: 0,
    top: 0,
    width: 1000,
    height: 1000,
    right: 1000,
    bottom: 1000,
  }) as DOMRect;

const pinBox = (
  el: HTMLElement,
  left: number,
  top: number,
  width: number,
  height: number,
) => {
  el.getBoundingClientRect = () =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
    }) as DOMRect;
  return el;
};

/** Leaflet's shared panes, as the console would list them.  The export reads
 *  this set off the pane host instead of restating it; the fixture hands over
 *  the same seven names a real `PaneManager` seeds so the default-pane branch
 *  is exercised for real. */
const LEAFLET_SHARED_PANES = [
  "overlayPane",
  "markerPane",
  "tilePane",
  "shadowPane",
  "mapPane",
  "tooltipPane",
  "popupPane",
];

/** The shape #733 produces for one marker layer: a content pane, a per-layer
 *  shadow pane, and leaves whose `options.pane` / `options.shadowPane` name
 *  them. */
interface FixtureOpts {
  /** `options.shadowPane` of the marker leaf.  Undefined uses the per-layer
   *  pane; pass Leaflet's shared name for the no-per-layer-carrier case. */
  shadowPane?: string;
  /** Mount a canvas in the content pane, to pin the shadow's place relative to
   *  the layer's non-marker content. */
  contentCanvas?: boolean;
  /** Mark the shadow with the export opt-out, to pin the admission filter. */
  shadowExcluded?: boolean;
}

interface Fixture {
  map: any;
  layer: any;
  renderer: ExportRenderer;
  loads: string[];
  contentCanvas: HTMLCanvasElement | null;
  shadowRoot: HTMLElement;
}

function makeFixture(opts: FixtureOpts = {}): Fixture {
  const container = document.createElement("div");
  container.id = "export-shadow";
  container.getBoundingClientRect = containerRect;

  const contentPane = document.createElement("div");
  const shadowPane = document.createElement("div");

  const icon = document.createElement("img");
  icon.src = "icon.png";
  pinBox(icon, 100, 100, 20, 20);
  contentPane.appendChild(icon);

  let contentCanvas: HTMLCanvasElement | null = null;
  if (opts.contentCanvas) {
    contentCanvas = document.createElement("canvas");
    contentCanvas.toDataURL = () => "data:image/png;base64,AAAA";
    pinBox(contentCanvas, 0, 0, 200, 200);
    contentPane.appendChild(contentCanvas);
  }

  const shadow = document.createElement("img");
  shadow.src = "shadow.png";
  pinBox(shadow, 90, 110, 40, 40);
  if (opts.shadowExcluded) shadow.setAttribute("data-foliplus-export", "exclude");
  shadowPane.appendChild(shadow);

  const shadowName = opts.shadowPane ?? "layer-content-shadow";
  const layer = {
    options: { pane: "layer-content", shadowPane: shadowName },
  };

  const panes: Record<string, HTMLElement> = {
    "layer-content": contentPane,
    "layer-content-shadow": shadowPane,
  };
  const map = {
    options: { crs: {} },
    getContainer: () => container,
    getZoom: () => 2,
    getCenter: () => ({ lat: 0, lng: 0 }),
    getPane: (name: string) => panes[name] ?? null,
    foliplus: {
      LayerAPI: {
        layers: [{ id: "markers", visible: true, layer }],
        intentVisible: () => true,
        getLayerPanes: () => ["layer-content"],
        // The live `PaneManager` the renderer reads its shared-pane set
        // from.  Only `defaultPanes` is consulted.
        panes: { defaultPanes: new Set(LEAFLET_SHARED_PANES) },
      },
    },
  };

  // Every image the marker passes load, in draw order: loadImage resolves
  // before the matching drawImage, so the list is the paint order.
  const loads: string[] = [];
  const ctx = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    roundRect: vi.fn(),
    fillText: vi.fn(),
    globalAlpha: 1,
    fillStyle: "",
    strokeStyle: "",
    font: "",
    textAlign: "",
    textBaseline: "",
    lineWidth: 0,
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
  vi.spyOn(UTIL, "loadImage").mockImplementation((async (src: string) => {
    loads.push(src);
    return { src } as unknown as HTMLImageElement;
  }) as any);

  return {
    map,
    layer,
    renderer: new ExportRenderer(map as any),
    loads,
    contentCanvas,
    shadowRoot: shadow,
  };
}

let savedMapDesc: PropertyDescriptor | undefined;

beforeEach(() => {
  savedMapDesc = Object.getOwnPropertyDescriptor(globalThis, "map");
});

afterEach(() => {
  if (savedMapDesc) Object.defineProperty(globalThis, "map", savedMapDesc);
  vi.restoreAllMocks();
});

/** render() resolves panes through the module-scoped `map` free variable —
 *  retarget it so the renderer's own map is that one. */
function install(fixture: Fixture): void {
  Object.defineProperty(globalThis, "map", {
    configurable: true,
    writable: true,
    value: fixture.map,
  });
}

const runRender = (fixture: Fixture) =>
  fixture.renderer.render(
    { left: 0, top: 0, width: 1000, height: 1000 },
    1,
    undefined,
    undefined,
  );

describe("resolveExportPanes", () => {
  it("reports content panes and the per-layer shadow pane separately", () => {
    const fixture = makeFixture();
    install(fixture);
    expect(fixture.renderer.resolveExportPanes(fixture.layer)).toEqual({
      content: ["layer-content"],
      shadows: ["layer-content-shadow"],
    });
  });

  it("keeps Leaflet's shared shadowPane out of the shadow list", () => {
    // No per-layer carrier (the pre-#733 shape): the leaf still names
    // Leaflet's shared pane, which belongs to no layer — collecting it would
    // redraw every other marker layer's shadows.
    const fixture = makeFixture({ shadowPane: "shadowPane" });
    install(fixture);
    expect(fixture.renderer.resolveExportPanes(fixture.layer).shadows).toEqual([]);
  });

  it("names a shadow pane once, however many leaves point at it", () => {
    const fixture = makeFixture();
    install(fixture);
    const second = {
      options: { pane: "layer-content", shadowPane: "layer-content-shadow" },
    };
    const group = {
      _layers: { a: fixture.layer, b: second } as Record<string, any>,
      options: {},
    };
    expect(fixture.renderer.resolveExportPanes(group as any).shadows).toEqual([
      "layer-content-shadow",
    ]);
  });

  it("does not list a shadow pane that is already a content pane", () => {
    // A leaf can point its shadow at its own content pane; listing it in both
    // groups would paint the same DOM twice.
    const fixture = makeFixture({ shadowPane: "layer-content" });
    install(fixture);
    expect(fixture.renderer.resolveExportPanes(fixture.layer).shadows).toEqual([]);
  });

  it("collects no shadows when the API carries no pane host", () => {
    // The lightweight LayerAPI stub has no PaneManager to ask, so it cannot
    // tell a per-layer shadow pane from Leaflet's shared one. Answering "no
    // shadows" keeps such a map at the export's pre-#733 shape: the pane walk
    // is content-only and nothing new is drawn.
    const fixture = makeFixture();
    (fixture.map.foliplus.LayerAPI as { panes?: unknown }).panes = undefined;
    install(fixture);
    expect(fixture.renderer.resolveExportPanes(fixture.layer)).toEqual({
      content: ["layer-content"],
      shadows: [],
    });
  });

  it("answers no panes at all when the map has no LayerAPI", () => {
    // A map outside LayerControl (and outside ensureLayerAPI's stub) has no
    // pane source whatsoever — the resolver reports empty groups rather than
    // inventing panes the layer never named.
    const fixture = makeFixture();
    fixture.map.foliplus = undefined;
    install(fixture);
    expect(fixture.renderer.resolveExportPanes(fixture.layer)).toEqual({
      content: [],
      shadows: [],
    });
  });

  it("ignores a leaf that names no shadow pane", () => {
    // Vector layers, and markers that kept Leaflet's own default, carry no
    // per-layer shadow carrier. The walk must skip them — including the empty
    // string a caller can leave behind — instead of inventing a pane name.
    const fixture = makeFixture();
    const group = {
      _layers: {
        none: { options: { pane: "layer-content" } },
        blank: { options: { pane: "layer-content", shadowPane: "" } },
      } as Record<string, any>,
      options: {},
    };
    install(fixture);
    expect(fixture.renderer.resolveExportPanes(group as any).shadows).toEqual([]);
  });
});

describe("ExportRenderer.render — marker shadows", () => {
  it("draws a marker's shadow, below its icon", async () => {
    // THE case this task exists for.  Before the fix the shadow list was empty
    // and nothing but the icon reached the canvas.
    const fixture = makeFixture();
    install(fixture);

    await runRender(fixture);

    const shadowIdx = fixture.loads.findIndex(src => src.includes("shadow.png"));
    const iconIdx = fixture.loads.findIndex(src => src.includes("icon.png"));
    expect(shadowIdx).toBeGreaterThanOrEqual(0);
    expect(iconIdx).toBeGreaterThanOrEqual(0);
    expect(shadowIdx).toBeLessThan(iconIdx);
  });

  it("draws the layer's content between its shadow and its icon", async () => {
    // The shadow pane is one z-step BELOW the content pane, so the full
    // painter's order for one layer is shadow → content → icon.  Pane
    // iteration alone would put the content first, which is why the shadow
    // pass runs before the content walk and not from it.
    const fixture = makeFixture({ contentCanvas: true });
    install(fixture);

    await runRender(fixture);

    const [shadowIdx, contentIdx, iconIdx] = [
      fixture.loads.findIndex(src => src.includes("shadow.png")),
      fixture.loads.findIndex(src => src.startsWith("data:image/png")),
      fixture.loads.findIndex(src => src.includes("icon.png")),
    ];
    expect(shadowIdx).toBeGreaterThanOrEqual(0);
    expect(contentIdx).toBeGreaterThan(shadowIdx);
    expect(iconIdx).toBeGreaterThan(contentIdx);
  });

  it("a layer with no per-layer shadow pane renders exactly as before", async () => {
    // The baseline: Leaflet's shared shadowPane is not the layer's carrier, so
    // the shadow pass collects nothing and the icon is the only thing drawn.
    // Same public path as before the change — no shadow, one image.
    const fixture = makeFixture({ shadowPane: "shadowPane" });
    install(fixture);

    await runRender(fixture);

    expect(fixture.loads).toHaveLength(1);
    expect(fixture.loads[0]).toContain("icon.png");
  });

  it("keeps the export opt-out on a shadow", async () => {
    // The shadow channel reuses the marker admission filter, so SKIP_EXPORT
    // still means "not in the picture" — the new pass must not widen it.
    const fixture = makeFixture({ shadowExcluded: true });
    install(fixture);

    await runRender(fixture);

    expect(fixture.loads.some(src => src.includes("shadow.png"))).toBe(false);
    expect(fixture.loads.some(src => src.includes("icon.png"))).toBe(true);
  });
});
