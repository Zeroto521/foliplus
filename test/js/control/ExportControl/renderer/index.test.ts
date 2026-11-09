// ExportControl renderer/index — the export walk, end to end.
//
// The module is one: the shadows the walk carries, the tile and marker passes
// it routes, and the progress it reports.  Both the tile geometry and the
// shadow placement are pinned here because they are the same `render()`.
//
// A marker's shadow is the leaf's own `_shadow` element (`layerShadow`).  It can
// be mounted in the layer's per-layer shadow pane (#733), left in Leaflet's
// shared `shadowPane` (no per-layer carrier, or a pin that never ran), or sit
// in a custom pane several layers share — so the leaf, not the pane, is the
// source.  The shadow is drawn BELOW its icon: its pane sits one z-step under
// the content pane (`zFor({ role: "shadow" })` = slot - 1), and the export
// reproduces that with draw order, not with pane iteration.
//
// Two levels, one module (a test file follows the logic script it exercises):
//   - the fixture cases drive `render()` against hand-built panes and leaves,
//     answering `getLayerPanes` the way a surface does (shadow pane included);
//   - the last block runs the production stack — real Leaflet, a real
//     `LayerController` as `map.foliplus.LayerAPI` — because a hand-built list
//     is exactly what hid the P1 defect: the resolver must split the shadow out
//     of the list the controller really returns.
import {
  MockTileLayer,
  captureSources,
  installTileGlobals,
  makeEPSG3857Mock,
  makeMockCtx,
  makeRC,
  makeRenderer,
  makeTileLayer,
  pinBox,
  stubBitmaps,
  tilesNearCenter,
  withPixels,
} from "./fixture.js";
import L from "leaflet";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#control/ExportControl/const.js";
import * as CANVAS from "#control/ExportControl/renderer/canvas.js";
import {
  ExportRenderer,
  isCorsBlocked,
} from "#control/ExportControl/renderer/index.js";
import * as UTIL from "#control/ExportControl/util.js";
import { LayerController } from "#control/LayerControl/controller.js";

// index.ts binds its logger and translator to CONFIG.name at module-import
// time, so the component name has to be set before the import resolves —
// setup.ts leaves it at "SearchControl". vi.hoisted runs above the imports;
// a plain assignment here would land after they were evaluated.
vi.hoisted(() => {
  (window as any).CONFIG = { ...(window as any).CONFIG, name: "ExportControl" };
});

// The shared mock window.L is swapped for the real library for this file; the
// production modules resolve L at call time, so the swap reaches them (same
// arrangement as test/js/core/layer/carrier.test.ts).
window.L = L as unknown as typeof window.L;

// renderMarkers loads its sprites through the hoisted factory: the module
// exports are getters, so a plain vi.spyOn on it throws from inside pooledEach.
vi.mock("#control/ExportControl/util.js", async () => {
  const actual = await vi.importActual<any>("#control/ExportControl/util.js");
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

/** The no-op 2D context both levels hand to the draw passes: jsdom has no
 *  canvas backend, so the shape (not the pixels) is what the passes need. */
const makeExportCtx = () =>
  ({
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
  }) as unknown as CanvasRenderingContext2D & {
    drawImage: { mock: { calls: any[][] } };
  };

const img = (src: string) => {
  const el = document.createElement("img");
  el.src = src;
  return el;
};

/** The shapes a marker shadow can be mounted in, one layer each:
 *  - a per-layer shadow pane (#733's carrier);
 *  - Leaflet's shared `shadowPane` (no per-layer carrier);
 *  - the per-layer pane reported but empty, with the shadow still in the shared
 *    one (a pin that never ran);
 *  - a shared custom pane (built inline by the dedupe case).
 *
 *  `_shadow` on the leaf is what the channel reads; the pane only says where
 *  the element currently lives. */
interface FixtureOpts {
  /** The leaf keeps Leaflet's shared shadow pane. */
  sharedLeafletPane?: boolean;
  /** Mount the shadow in the shared pane while the per-layer pane is reported
   *  and stays empty. */
  shadowInSharedPane?: boolean;
  /** Keep the per-layer shadow pane out of the API's pane list. */
  hideShadowPane?: boolean;
  /** No per-layer shadow pane at all (the leaf names the shared one). */
  noShadowPane?: boolean;
  contentCanvas?: boolean;
  shadowExcluded?: boolean;
  displayNoneShadow?: boolean;
  /** Declare a CONTENT pane name as the leaf's shadowPane while the shadow
   *  element actually rides in the per-layer shadow pane. */
  misnamedShadowPane?: boolean;
  /** LayerAPI exists but carries no `panes` host (the lightweight stub). */
  withoutPaneHost?: boolean;
  /** No LayerAPI at all. */
  withoutLayerApi?: boolean;
  /** Extra pane names the API reports (a pane another layer owns). */
  extraPanes?: string[];
}

interface Fixture {
  map: any;
  layer: any;
  renderer: ExportRenderer;
  loads: string[];
  ctx: ReturnType<typeof makeExportCtx>;
  shadowSrc: string;
  iconSrc: string;
}

function makeFixture(opts: FixtureOpts = {}): Fixture {
  const container = document.createElement("div");
  container.getBoundingClientRect = containerRect;

  const contentPane = document.createElement("div");
  const shadowPane = document.createElement("div"); // per-layer
  const sharedPane = document.createElement("div"); // Leaflet's shared one

  const icon = pinBox(img("icon.png"), 100, 100, 20, 20);
  contentPane.appendChild(icon);

  if (opts.contentCanvas) {
    const contentCanvas = document.createElement("canvas");
    contentCanvas.toDataURL = () => "data:image/png;base64,AAAA";
    pinBox(contentCanvas, 0, 0, 200, 200);
    contentPane.appendChild(contentCanvas);
  }

  const shadow = pinBox(img("shadow.png"), 90, 110, 40, 40);
  if (opts.shadowExcluded) shadow.setAttribute("data-foliplus-export", "exclude");
  if (opts.displayNoneShadow) shadow.style.display = "none";

  const noPerLayerPane = opts.sharedLeafletPane === true || opts.noShadowPane === true;
  const shadowPaneName = noPerLayerPane ? "shadowPane" : "layer-content-shadow";
  (noPerLayerPane || opts.shadowInSharedPane ? sharedPane : shadowPane).appendChild(
    shadow,
  );

  const layer = {
    options: {
      pane: "layer-content",
      shadowPane: opts.misnamedShadowPane ? "layer-content" : shadowPaneName,
    },
    _shadow: shadow,
  };

  const panes: Record<string, HTMLElement> = {
    "layer-content": contentPane,
    "layer-content-shadow": shadowPane,
    shadowPane: sharedPane,
  };
  // The API reports the surface's whole pane set — the shadow carrier
  // included; the export subtracts it.  A leaf with no per-layer carrier has
  // no such pane to report (discovery excludes Leaflet's shared names).
  const reportShadowPane = !noPerLayerPane && !opts.hideShadowPane;
  const apiPanes = [
    ...(reportShadowPane ? ["layer-content", shadowPaneName] : ["layer-content"]),
    ...(opts.extraPanes ?? []),
  ];

  const ctx = makeExportCtx();
  const loads: string[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as any);
  vi.spyOn(UTIL, "loadImage").mockImplementation((async (src: string) => {
    loads.push(src);
    return { src } as unknown as HTMLImageElement;
  }) as any);

  const api: any = {
    layers: [{ id: "markers", visible: true, layer }],
    intentVisible: () => true,
    getLayerPanes: () => apiPanes,
  };
  if (!opts.withoutPaneHost) api.panes = { defaultPanes: new Set<string>() };

  const map: any = {
    options: { crs: {} },
    getContainer: () => container,
    getZoom: () => 2,
    getCenter: () => ({ lat: 0, lng: 0 }),
    getPane: (name: string) => panes[name] ?? null,
    getPanes: () => panes,
    foliplus: opts.withoutLayerApi ? {} : { LayerAPI: api },
  };

  return {
    map,
    layer,
    renderer: new ExportRenderer(map),
    loads,
    ctx,
    shadowSrc: shadow.src,
    iconSrc: icon.src,
  };
}

let savedMapDesc: PropertyDescriptor | undefined;

beforeEach(() => {
  savedMapDesc = Object.getOwnPropertyDescriptor(globalThis, "map");
});

afterEach(() => {
  if (savedMapDesc) Object.defineProperty(globalThis, "map", savedMapDesc);
  vi.restoreAllMocks();
  // The real-Leaflet block mounts its map in the document; the fixture cases
  // build detached elements, so clearing here only reaches that block.
  document.body.innerHTML = "";
});

/** render()/resolveExportPanes resolve panes through the module-scoped `map`
 *  free variable — retarget it so the renderer's own map is that one. */
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

/** The `drawImage` call that painted the image loaded from `needle`. */
const drawOf = (fixture: Fixture, needle: string) =>
  fixture.ctx.drawImage.mock.calls.find(call =>
    String((call[0] as { src?: string })?.src ?? "").includes(needle),
  );

describe("resolveExportPanes", () => {
  it("keeps every shadow pane out of a layer's content panes", () => {
    const fixture = makeFixture();
    install(fixture);
    expect(
      fixture.renderer.resolveExportPanes(
        fixture.layer,
        new Set(["layer-content-shadow"]),
      ),
    ).toEqual(["layer-content"]);
  });

  it("subtracts names a different layer recorded", () => {
    // The exclusion set is built across every layer: a pane layer B names as
    // its shadow is removed from layer A's content too, even though A's own
    // shadow lives elsewhere.
    const fixture = makeFixture({ extraPanes: ["another-layers-shadow"] });
    install(fixture);
    expect(
      fixture.renderer.resolveExportPanes(
        fixture.layer,
        new Set(["another-layers-shadow"]),
      ),
    ).toEqual(["layer-content", "layer-content-shadow"]);
  });

  it("answers no panes when the map has no LayerAPI", () => {
    const fixture = makeFixture({ withoutLayerApi: true });
    install(fixture);
    expect(fixture.renderer.resolveExportPanes(fixture.layer, new Set())).toEqual([]);
  });
});

describe("collectLayerShadows", () => {
  it("reads the leaf's shadow, not the pane it lives in", () => {
    // Shared Leaflet pane: the discovery list never names it, yet the layer's
    // own shadow must still be exported.
    const fixture = makeFixture({ sharedLeafletPane: true });
    install(fixture);
    const paneNames = new Set<string>();
    const roots = fixture.renderer.collectLayerShadows(fixture.layer, paneNames);
    expect(roots).toEqual([fixture.layer._shadow]);
    expect([...paneNames]).toEqual(["shadowPane"]);
  });

  it("does not record an excluded shadow's pane", () => {
    // An excluded shadow cannot be painted as content either — the content
    // sweep runs the same admission — so naming its pane would only risk
    // subtracting a pane that carries real content.
    const fixture = makeFixture({ shadowExcluded: true });
    install(fixture);
    const paneNames = new Set<string>();
    expect(fixture.renderer.collectLayerShadows(fixture.layer, paneNames)).toEqual([]);
    expect([...paneNames]).toEqual([]);
  });

  it("skips a hidden shadow", () => {
    const fixture = makeFixture({ displayNoneShadow: true });
    install(fixture);
    expect(fixture.renderer.collectLayerShadows(fixture.layer, new Set())).toEqual([]);
  });

  it("ignores a leaf with no shadow and a leaf with no options", () => {
    const fixture = makeFixture();
    install(fixture);
    const group = {
      _layers: { none: {}, blank: { options: { shadowPane: "" } } } as Record<
        string,
        any
      >,
      options: {},
    };
    const paneNames = new Set<string>();
    expect(fixture.renderer.collectLayerShadows(group, paneNames)).toEqual([]);
    expect([...paneNames]).toEqual([]);
  });

  it("excludes the pane a shadow actually rides in, not the declared name", () => {
    // The leaf declares the CONTENT pane as its shadowPane while the element
    // rides in the per-layer shadow pane.  Naming the declaration would drop
    // the content pane from every layer and lose the icon; the element's real
    // parent is the only fact the exclusion set may use.
    const fixture = makeFixture({ misnamedShadowPane: true });
    install(fixture);
    const paneNames = new Set<string>();
    const roots = fixture.renderer.collectLayerShadows(fixture.layer, paneNames);
    expect(roots).toEqual([fixture.layer._shadow]);
    expect([...paneNames]).toEqual(["layer-content-shadow"]);
    expect(fixture.renderer.resolveExportPanes(fixture.layer, paneNames)).toEqual([
      "layer-content",
    ]);
  });

  it("records no pane for a shadow detached from every pane", () => {
    // Defensive branch: a shadow outside the pane tree is still drawn (its leaf
    // owns it), but no pane can be excluded for it.
    const fixture = makeFixture();
    fixture.layer._shadow.remove();
    install(fixture);
    const paneNames = new Set<string>();
    const roots = fixture.renderer.collectLayerShadows(fixture.layer, paneNames);
    expect(roots).toEqual([fixture.layer._shadow]);
    expect([...paneNames]).toEqual([]);
  });
});

describe("render — marker shadows", () => {
  it("draws a per-layer shadow below its icon, at its own size", async () => {
    const fixture = makeFixture();
    install(fixture);

    await runRender(fixture);

    const shadowIdx = fixture.loads.findIndex(src => src.includes("shadow.png"));
    const iconIdx = fixture.loads.findIndex(src => src.includes("icon.png"));
    expect(shadowIdx).toBeGreaterThanOrEqual(0);
    expect(iconIdx).toBeGreaterThanOrEqual(0);
    expect(shadowIdx).toBeLessThan(iconIdx);

    // Not just ordered: the shadow really was rasterised at its box, not
    // skipped by a zero-size guard.
    const call = drawOf(fixture, "shadow.png")!;
    expect(call).toBeTruthy();
    expect(call[3]).toBe(40);
    expect(call[4]).toBe(40);
    // And at its real position (canvas px): the icon's box is (100,100) and
    // its shadow sits 10px left / 10px down of it.  Asserting only the size is
    // what let the stale-rect P1 hide in this suite.
    expect(call[1]).toBe(90);
    expect(call[2]).toBe(110);
  });

  it("draws a shadow that stayed in Leaflet's shared shadowPane", async () => {
    // The user-visible regression: a marker without a per-layer carrier still
    // has a shadow, and the export has to draw it.
    const fixture = makeFixture({ sharedLeafletPane: true });
    install(fixture);

    await runRender(fixture);

    expect(fixture.loads.some(src => src.includes("shadow.png"))).toBe(true);
    const call = drawOf(fixture, "shadow.png")!;
    expect(call[3]).toBeGreaterThan(0);
    expect(call[4]).toBeGreaterThan(0);
    expect(fixture.loads.indexOf(fixture.shadowSrc)).toBeLessThan(
      fixture.loads.indexOf(fixture.iconSrc),
    );
  });

  it("draws a shadow whose per-layer pane is empty", async () => {
    // The pin never moved the element (or the pane was rebuilt empty): the
    // leaf still owns the shadow, so it is still exported.
    const fixture = makeFixture({ shadowInSharedPane: true });
    install(fixture);

    await runRender(fixture);

    expect(fixture.loads.some(src => src.includes("shadow.png"))).toBe(true);
  });

  it("draws a shadow when the API carries no pane host", async () => {
    // The lightweight stub has no PaneManager — irrelevant now that the
    // channel reads leaves.
    const fixture = makeFixture({ withoutPaneHost: true });
    install(fixture);

    await runRender(fixture);

    expect(fixture.loads.some(src => src.includes("shadow.png"))).toBe(true);
  });

  it("draws the layer's content between its shadow and its icon", async () => {
    const fixture = makeFixture({ contentCanvas: true });
    install(fixture);

    await runRender(fixture);

    const shadowIdx = fixture.loads.findIndex(src => src.includes("shadow.png"));
    const contentIdx = fixture.loads.findIndex(src => src.startsWith("data:image/png"));
    const iconIdx = fixture.loads.findIndex(src => src.includes("icon.png"));
    expect(shadowIdx).toBeGreaterThanOrEqual(0);
    expect(contentIdx).toBeGreaterThan(shadowIdx);
    expect(iconIdx).toBeGreaterThan(contentIdx);
  });

  it("keeps the export opt-out on a shadow", async () => {
    const fixture = makeFixture({ shadowExcluded: true });
    install(fixture);

    await runRender(fixture);

    expect(fixture.loads.some(src => src.includes("shadow.png"))).toBe(false);
    expect(fixture.loads.some(src => src.includes("icon.png"))).toBe(true);
  });

  it("reports a shadow the canvas cannot read back", async () => {
    // A cross-origin shadow without CORS headers cannot be rasterised; the
    // export leaves it out and says so instead of silently missing it.
    const fixture = makeFixture();
    install(fixture);
    (UTIL.loadImage as any).mockImplementation(async (src: string) => {
      fixture.loads.push(src);
      if (src.includes("shadow.png")) throw new Error("tainted canvas");
      return { src };
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await runRender(fixture);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("marker shadow left out of the export"),
      expect.any(Error),
    );
    expect(fixture.loads.some(src => src.includes("icon.png"))).toBe(true);
  });

  it("paints a shared shadow pane's shadows once each, never as content", async () => {
    // Two layers naming one custom shadow pane, and layer one's API answer
    // still lists that pane (its surface adopted it). Without the export-wide
    // subtraction the pane would be walked as content and every shadow would
    // paint twice — once below the icon, once as a marker root above it.
    const container = document.createElement("div");
    container.getBoundingClientRect = containerRect;
    const contentA = document.createElement("div");
    const contentB = document.createElement("div");
    const sharedShadow = document.createElement("div");
    const iconA = pinBox(img("icon-a.png"), 100, 100, 20, 20);
    const iconB = pinBox(img("icon-b.png"), 300, 300, 20, 20);
    const shadowA = pinBox(img("shadow-a.png"), 90, 110, 40, 40);
    const shadowB = pinBox(img("shadow-b.png"), 290, 310, 40, 40);
    contentA.appendChild(iconA);
    contentB.appendChild(iconB);
    sharedShadow.append(shadowA, shadowB);

    const layerA = {
      options: { pane: "a", shadowPane: "shared-shadow" },
      _shadow: shadowA,
    };
    const layerB = {
      options: { pane: "b", shadowPane: "shared-shadow" },
      _shadow: shadowB,
    };
    const panes: Record<string, HTMLElement> = {
      a: contentA,
      b: contentB,
      "shared-shadow": sharedShadow,
    };
    const map: any = {
      options: { crs: {} },
      getContainer: () => container,
      getZoom: () => 2,
      getCenter: () => ({ lat: 0, lng: 0 }),
      getPane: (name: string) => panes[name] ?? null,
      getPanes: () => panes,
      foliplus: {
        LayerAPI: {
          layers: [
            { id: "a", visible: true, layer: layerA },
            { id: "b", visible: true, layer: layerB },
          ],
          intentVisible: () => true,
          getLayerPanes: (l: any) => (l === layerA ? ["a", "shared-shadow"] : ["b"]),
        },
      },
    };
    const ctx = makeExportCtx();
    const loads: string[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as any);
    vi.spyOn(UTIL, "loadImage").mockImplementation((async (src: string) => {
      loads.push(src);
      return { src } as unknown as HTMLImageElement;
    }) as any);
    Object.defineProperty(globalThis, "map", {
      configurable: true,
      writable: true,
      value: map,
    });

    await new ExportRenderer(map).render(
      { left: 0, top: 0, width: 1000, height: 1000 },
      1,
      undefined,
      undefined,
    );

    expect(loads.filter(src => src.includes("shadow-a.png"))).toHaveLength(1);
    expect(loads.filter(src => src.includes("shadow-b.png"))).toHaveLength(1);
    expect(loads.filter(src => src.includes("icon-a.png"))).toHaveLength(1);
    expect(loads.filter(src => src.includes("icon-b.png"))).toHaveLength(1);
  });

  it("measures a shadow after its image loads, not before", async () => {
    // The export hides the chrome and forces a reflow in the same task that
    // starts the render, so the first rect read can be a transient one; the
    // old code froze that stale box into dx/dy BEFORE awaiting the image.  The
    // layout settles while the image is in flight, so the draw must use the
    // box measured after the await.
    const fixture = makeFixture();
    install(fixture);
    const shadow = fixture.layer._shadow as HTMLElement;
    let settled = false;
    const box = (left: number, top: number) => ({
      left,
      top,
      width: 40,
      height: 40,
      right: left + 40,
      bottom: top + 40,
    });
    shadow.getBoundingClientRect = () =>
      (settled ? box(90, 110) : box(500, 247)) as DOMRect;
    (UTIL.loadImage as any).mockImplementation(async (src: string) => {
      fixture.loads.push(src);
      if (src.includes("shadow.png")) settled = true;
      return { src } as unknown as HTMLImageElement;
    });

    await runRender(fixture);

    const shadowCall = drawOf(fixture, "shadow.png")!;
    const iconCall = drawOf(fixture, "icon.png")!;
    // The stale (500,247) box is what the pre-fix code painted; the settled box
    // (90,110) is the icon's own shadow, 10px off the icon at (100,100).
    expect(shadowCall[1]).toBe(90);
    expect(shadowCall[2]).toBe(110);
    expect(Math.abs(shadowCall[1] - iconCall[1])).toBeLessThanOrEqual(10);
    expect(Math.abs(shadowCall[2] - iconCall[2])).toBeLessThanOrEqual(10);
  });

  it("keeps the icon when the declared shadowPane names the content pane", async () => {
    // Before the exclusion set followed the DOM, this declaration subtracted
    // the content pane and exported a map without its icons.
    const fixture = makeFixture({ misnamedShadowPane: true });
    install(fixture);
    await runRender(fixture);
    expect(fixture.loads.filter(src => src.includes("icon.png"))).toHaveLength(1);
    expect(fixture.loads.filter(src => src.includes("shadow.png"))).toHaveLength(1);
  });
});

// ── Real Leaflet + real LayerController ──────────────────────────────
// The fixture cases above decide what the export does with the DOM it is
// handed. This block decides whether that DOM is the DOM production produces:
// `getLayerPanes` answers with the surface's whole pane set (shadow carrier
// included — focus's lift and the browser probe suite read the same list), and
// the marker's `_shadow` is a real Leaflet element in the layer's pane.

// Distinct 1x1 transparent PNG data URIs: data URLs survive jsdom unchanged,
// so the paint order can be read straight off the URL the pass loaded.
const ICON = "data:image/png;base64,AAAA";
const SHADOW = "data:image/png;base64,BBBB";

interface Stack {
  map: L.Map;
  group: L.LayerGroup;
  controller: LayerController;
  loads: string[];
}

/** Mount one marker layer through the production registration path. */
const mountStack = (): Stack => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  container.getBoundingClientRect = containerRect;

  const map = L.map(container, { center: [26.08, 119.3], zoom: 12 });
  const marker = L.marker([26.08, 119.3], {
    icon: L.icon({ iconUrl: ICON, shadowUrl: SHADOW }),
  });
  const group = L.layerGroup([marker]);
  map.addLayer(group);
  const controller = new LayerController(map, [
    { id: "markers", name: "Markers", role: "overlay", layer: group },
  ]);

  const loads: string[] = [];
  vi.spyOn(UTIL, "loadImage").mockImplementation((async (src: string) => {
    loads.push(src);
    return { src } as unknown as HTMLImageElement;
  }) as any);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    makeExportCtx() as any,
  );
  // The export measures elements, so the icon and its shadow need real boxes.
  pinBox(marker.getElement()!, 100, 100, 20, 20);
  pinBox((marker as unknown as { _shadow: HTMLElement })._shadow, 90, 110, 40, 40);

  // render() resolves panes through the module-scoped `map` free variable.
  Object.defineProperty(globalThis, "map", {
    configurable: true,
    writable: true,
    value: map,
  });
  return { map, group, controller, loads };
};

describe("export panes over a real LayerController", () => {
  it("splits the panes a real controller reports by role", () => {
    const { map, group, controller } = mountStack();
    try {
      expect(map.foliplus!.LayerAPI).toBe(controller);

      // Pane coverage is unchanged: the controller reports the whole surface,
      // shadow carrier included.
      const raw = controller.getLayerPanes(group);
      expect(raw).toHaveLength(2);
      const shadowPane = `${raw[0]}-shadow`;
      expect(raw[1]).toBe(shadowPane);

      // The shadow roots come from the leaf, and that name leaves the content
      // walk — the P1 shape, end to end.
      const renderer = new ExportRenderer(map as any);
      const shadowPanes = new Set<string>();
      const roots = renderer.collectLayerShadows(group, shadowPanes);
      expect(roots).toHaveLength(1);
      expect(shadowPanes.has(shadowPane)).toBe(true);
      expect(renderer.resolveExportPanes(group, shadowPanes)).toEqual([raw[0]]);
    } finally {
      map.remove();
    }
  });

  it("paints the marker's shadow before its icon", async () => {
    const { map, loads } = mountStack();
    try {
      await new ExportRenderer(map as any).render(
        { left: 0, top: 0, width: 1000, height: 1000 },
        1,
        undefined,
        undefined,
      );

      const shadowIdx = loads.indexOf(SHADOW);
      const iconIdx = loads.indexOf(ICON);
      expect(shadowIdx).toBeGreaterThanOrEqual(0);
      expect(iconIdx).toBeGreaterThanOrEqual(0);
      expect(shadowIdx).toBeLessThan(iconIdx);
    } finally {
      map.remove();
    }
  });
});

/** Wrap layer entries in a LayerAPI mock with intentVisible derived from
 *  each entry's `visible` field (defaulting to true). */
function withApi(
  layers: Array<{ id: string; visible?: boolean; layer?: unknown; canvas?: unknown }>,
  getLayerPanes: (layer: unknown) => string[] = () => [],
) {
  return {
    layers,
    getLayerPanes,
    intentVisible: (id: string) => {
      const entry = layers.find(l => l.id === id);
      return entry?.visible ?? true;
    },
  };
}

/** renderTileLayer takes the clipped list, not the layer: build the input it
 *  draws by running the real viewport filter over `tilesNearCenter`.  The
 *  filter is what decides the count, so the drawing tests exercise it for
 *  real instead of feeding a hand-built survivor list. */
const rcTiles = (rc: ReturnType<typeof makeRC>, n: number) => {
  const map: any = {
    options: { crs: makeEPSG3857Mock() },
    getZoom: () => 2,
    getCenter: () => ({ lat: 26.08, lng: 119.3 }),
    getContainer: () => document.createElement("div"),
    foliplus: { LayerAPI: withApi([]) },
  };
  return new ExportRenderer(map).tilePositions(
    rc,
    withPixels(tilesNearCenter(n)),
  ) as any[];
};

// ── Render passes ─────────────────────────────────────────────────────
//
// The tile/marker pass orchestration: which tiles survive the viewport
// filter, how onProgress counts, how the layer passes route, and the
// fallbacks when a tile or sprite cannot be decoded.  Scoped in its own
// describe because it swaps L.CRS/L.TileLayer for the whole suite; the
// shadow blocks above run against the real library.
describe("ExportRenderer — render passes", () => {
  // Tile geometry: a Web-Mercator CRS stub and a TileLayer stand-in, so
  // tilePositions can run without a browser map.
  beforeEach(installTileGlobals);
  describe("ExportRenderer.render — canvas creation", () => {
    let renderer: ExportRenderer;
    let container: HTMLDivElement;
    beforeEach(() => {
      container = document.createElement("div");
      container.id = "test";
      container.getBoundingClientRect = () =>
        ({
          left: 0,
          top: 0,
          width: 800,
          height: 600,
          right: 800,
          bottom: 600,
        }) as DOMRect;
      const map = {
        options: { crs: makeEPSG3857Mock() },
        getContainer: () => container,
        foliplus: {
          LayerAPI: { layers: [], getLayerPanes: () => [] },
        },
      };
      renderer = new ExportRenderer(map as any);
    });

    it("throws when scaled width < 1", async () => {
      await expect(
        renderer.render(
          { left: 0, top: 0, width: 0, height: 100 },
          1,
          undefined,
          undefined,
        ),
      ).rejects.toThrow();
    });

    it("throws when scaled height < 1", async () => {
      await expect(
        renderer.render(
          { left: 0, top: 0, width: 100, height: 0 },
          1,
          undefined,
          undefined,
        ),
      ).rejects.toThrow();
    });

    it("succeeds with a valid rect and scale (no layers)", async () => {
      const canvas = await renderer.render(
        { left: 0, top: 0, width: 200, height: 150 },
        1,
        undefined,
        undefined,
      );
      expect(canvas).toBeInstanceOf(HTMLCanvasElement);
      expect(canvas.width).toBe(200);
      expect(canvas.height).toBe(150);
    });

    it("rounds scaled dimensions to integers", async () => {
      const canvas = await renderer.render(
        { left: 0, top: 0, width: 100.4, height: 80.9 },
        2,
        undefined,
        undefined,
      );
      // 100.4 * 2 = 200.8 → 201; 80.9 * 2 = 161.8 → 162
      expect(canvas.width).toBe(201);
      expect(canvas.height).toBe(162);
    });

    it("does not iterate layers when LayerAPI is undefined", async () => {
      const map = {
        options: { crs: makeEPSG3857Mock() },
        getContainer: () => container,
        foliplus: {},
      };
      const r = new ExportRenderer(map as any);
      const canvas = await r.render(
        { left: 0, top: 0, width: 100, height: 100 },
        1,
        undefined,
        undefined,
      );
      expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    });
  });
  //===========================================================================
  //  ExportRenderer.renderTileLayer — onProgress callback.
  //  The renderer reports a percentage after each tile batch; it does not
  // interpret or format the value, so no locale dependency lands here.
  //===========================================================================

  describe("ExportRenderer.renderTileLayer — onProgress", () => {
    const mockLayer = { options: { opacity: 1 } } as L.TileLayer;

    it("reports the cumulative tiles drawn after each batch", async () => {
      const total = CONST.TILE_CONCURRENCY * 2;
      stubBitmaps();
      const rc = makeRC(4096, 4096);
      const onProgress = vi.fn();

      await makeRenderer().renderTileLayer(
        rc,
        rcTiles(rc, total),
        mockLayer,
        onProgress,
      );

      // One report per batch, counting the tiles actually painted so far —
      // never the batch index, which would credit tiles that were still loading.
      expect(onProgress.mock.calls.map(c => c[0])).toEqual([
        CONST.TILE_CONCURRENCY,
        total,
      ]);
    });

    it("never calls onProgress when no tiles survive the viewport clip", async () => {
      // render() does the clipping before calling, so an empty list is the only
      // way this pass starts.  The early return must not report anything.
      const onProgress = vi.fn();
      await makeRenderer().renderTileLayer(makeRC(100, 100), [], mockLayer, onProgress);
      expect(onProgress).not.toHaveBeenCalled();
    });

    it("drops tiles that fall outside the crop rect, so the count tracks what is drawn", async () => {
      // 7 tiles enumerated, one sits off the 1536x512 crop: the batch splits and
      // the final report is the surviving count, not the concurrency cap.
      const survivors = rcTiles(makeRC(1536, 512), CONST.TILE_CONCURRENCY + 1);
      stubBitmaps();

      const onProgress = vi.fn();
      await makeRenderer().renderTileLayer(
        makeRC(1536, 512),
        survivors,
        mockLayer,
        onProgress,
      );
      expect(onProgress.mock.calls.map(c => c[0])).toEqual([
        CONST.TILE_CONCURRENCY,
        survivors.length,
      ]);
    });

    it("returns without drawing when a tile's drawImage throws", async () => {
      // drawImage is wrapped in a try/catch so one bad tile cannot abort the
      // whole layer: it is simply left out of the count and the rest is drawn.
      stubBitmaps();
      const ctx = makeMockCtx();
      (ctx.drawImage as any).mockImplementation((src?: unknown) => {
        if (src && typeof src === "object" && (src as { _bad?: boolean })._bad) {
          throw new Error("draw failed");
        }
      });
      (UTIL.loadImageBitmap as any)
        .mockImplementationOnce(() =>
          Promise.resolve({ _bad: true, close: () => {} } as any),
        )
        .mockResolvedValue({ close: () => {} });

      const onProgress = vi.fn();
      await makeRenderer().renderTileLayer(
        makeRC(4096, 4096, ctx),
        rcTiles(makeRC(4096, 4096, ctx), 2),
        mockLayer,
        onProgress,
      );

      // Only the second tile was painted, so it is the only one that counts.
      expect(onProgress.mock.calls.map(c => c[0])).toEqual([1]);
    });

    it("caps the final batch at the tile count when it is not a multiple of the concurrency", async () => {
      const total = CONST.TILE_CONCURRENCY + 1;
      stubBitmaps();

      const onProgress = vi.fn();
      await makeRenderer().renderTileLayer(
        makeRC(4096, 4096),
        rcTiles(makeRC(4096, 4096), total),
        mockLayer,
        onProgress,
      );
      // Two batches: a full one, then the single leftover tile — the last report
      // is the tile count, never the concurrency plus one.
      expect(onProgress.mock.calls.map(c => c[0])).toEqual([
        CONST.TILE_CONCURRENCY,
        total,
      ]);
    });

    it("does not count a tile whose bitmap failed to load", async () => {
      (UTIL.loadImageBitmap as any).mockResolvedValue(null);

      const onProgress = vi.fn();
      await makeRenderer().renderTileLayer(
        makeRC(4096, 4096),
        rcTiles(makeRC(4096, 4096), CONST.TILE_CONCURRENCY),
        mockLayer,
        onProgress,
      );
      // The tile was fetched and enumerated but nothing reached the canvas, so it
      // earns no progress: counting it would say the map is more done than it is.
      expect(onProgress.mock.calls.map(c => c[0])).toEqual([0]);
    });

    it("falls back to the 1x tile when the retina fetch fails", async () => {
      // A source without retina tiles 404s every {r} URL; the draw pass must
      // retry the recorded 1x fallback instead of blanking the whole layer —
      // otherwise a scale>1 export loses the layer and misreports it as CORS
      // blocking.
      (UTIL.loadImageBitmap as any).mockClear();
      (UTIL.loadImageBitmap as any)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ width: 64, height: 64, close: () => {} });
      const rc = makeRC(4096, 4096);
      const renderer = makeRenderer();
      const tiles = withPixels([
        {
          x: 1,
          y: 1,
          z: 2,
          url: "tile@2x",
          fallback: "tile",
          left: 256,
          top: 512,
          size: 256,
        },
      ]);

      await renderer.renderTileLayer(rc, tiles, mockLayer);

      expect(UTIL.loadImageBitmap).toHaveBeenNthCalledWith(1, "tile@2x");
      expect(UTIL.loadImageBitmap).toHaveBeenNthCalledWith(2, "tile");
      expect(renderer.tileFailures).toEqual([{ total: 1, failed: 0 }]);
    });

    it("still draws every tile when no onProgress callback is passed", async () => {
      // render() always forwards its own callback, but renderTileLayer is also
      // reachable on its own, so the report has to stay optional.
      const ctx = makeMockCtx();
      (UTIL.loadImageBitmap as any).mockClear();
      stubBitmaps();

      await makeRenderer().renderTileLayer(
        makeRC(4096, 4096, ctx),
        rcTiles(makeRC(4096, 4096, ctx), CONST.TILE_CONCURRENCY),
        mockLayer,
      );

      expect(ctx.drawImage).toHaveBeenCalledTimes(CONST.TILE_CONCURRENCY);
    });
  });

  //===========================================================================
  //  tileFailures / isCorsBlocked — per-layer failure stats behind the
  //  post-export CORS warning.  renderTileLayer records what each tile layer's
  //  fetch achieved; the manager turns a predominantly-failed layer into a
  //  warning instead of a bare success.
  //===========================================================================

  describe("ExportRenderer.tileFailures", () => {
    const mockLayer = { options: { opacity: 1 } } as L.TileLayer;

    it("records one entry per rendered layer, split into drawn and failed", async () => {
      stubBitmaps();
      const rc = makeRC(4096, 4096);
      const renderer = makeRenderer();
      await renderer.renderTileLayer(
        rc,
        rcTiles(rc, CONST.TILE_CONCURRENCY),
        mockLayer,
      );
      expect(renderer.tileFailures).toEqual([
        { total: CONST.TILE_CONCURRENCY, failed: 0 },
      ]);
    });

    it("counts failed loads as failed tiles — the CORS-blocked profile", async () => {
      (UTIL.loadImageBitmap as any).mockClear();
      (UTIL.loadImageBitmap as any).mockResolvedValue(null);
      const rc = makeRC(4096, 4096);
      const renderer = makeRenderer();
      await renderer.renderTileLayer(
        rc,
        rcTiles(rc, CONST.TILE_CONCURRENCY),
        mockLayer,
      );
      expect(renderer.tileFailures).toEqual([
        { total: CONST.TILE_CONCURRENCY, failed: CONST.TILE_CONCURRENCY },
      ]);
      expect(renderer.tileFailures.some(isCorsBlocked)).toBe(true);
    });

    it("does not record a layer with no tiles to draw", async () => {
      const renderer = makeRenderer();
      await renderer.renderTileLayer(makeRC(100, 100), [], mockLayer);
      expect(renderer.tileFailures).toEqual([]);
    });
  });

  describe("ExportRenderer.render — onProgress across tile layers", () => {
    let renderer: ExportRenderer;
    let savedMapDesc: PropertyDescriptor | undefined;
    let savedLDesc: PropertyDescriptor | undefined;
    beforeEach(() => {
      // render() reads the module-scoped IIFE free variables `map` and `L`.
      // Redefining the globals retargets them, so the renderer's own map doubles
      // as the module's map and L gains a TileLayer constructor for instanceof.
      renderer = makeRenderer();
      (renderer.map as any).getZoom = () => 2;
      (renderer.map as any).getCenter = () => ({ lat: 26.08, lng: 119.3 });
      (renderer.map as any).getPane = () => null;
      savedMapDesc = Object.getOwnPropertyDescriptor(globalThis, "map")!;
      savedLDesc = Object.getOwnPropertyDescriptor(globalThis, "L")!;
      Object.defineProperty(globalThis, "map", {
        configurable: true,
        writable: true,
        value: renderer.map,
      });
      Object.defineProperty(globalThis, "L", {
        configurable: true,
        writable: true,
        value: { ...L, TileLayer: MockTileLayer },
      });
    });
    afterEach(() => {
      if (savedMapDesc) Object.defineProperty(globalThis, "map", savedMapDesc);
      if (savedLDesc) Object.defineProperty(globalThis, "L", savedLDesc);
    });
    const bigCenter = () => {
      (renderer.map.getContainer() as any).getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        width: 1000,
        height: 1000,
        right: 1000,
        bottom: 1000,
      });
      renderer.map.getCenter = () => ({ lat: 26.08, lng: 119.3 });
    };
    const runRender = (onProgress: (percent: number) => void) =>
      renderer.render(
        { left: 0, top: 0, width: 1000, height: 1000 },
        1,
        undefined,
        { nw: { lat: 26.1, lng: 119.2 }, se: { lat: 26.0, lng: 119.4 } },
        onProgress,
      );

    const stubCanvas = (ctx: CanvasRenderingContext2D = makeMockCtx()) => {
      // render() builds its own canvas and reads getContext on it; point that at
      // the stub so the drawing passes complete in jsdom.
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
      return ctx;
    };

    it("fills the canvas background when a bg color is passed", async () => {
      const ctx = stubCanvas();
      await renderer.render(
        { left: 0, top: 0, width: 100, height: 100 },
        1,
        "#ff0000",
        undefined,
        vi.fn(),
      );
      expect(ctx.fillStyle).toBe("#ff0000");
      expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 100, 100);
    });

    it("climbs monotonically across layers and stops short of 100", async () => {
      bigCenter();
      const c = CONST.TILE_CONCURRENCY;
      // The bottom layer has the fewest tiles, so a per-layer denominator would
      // restart the bar at 0 halfway through — the exact regression here.
      stubBitmaps();
      stubCanvas();
      const bottomLayer = makeTileLayer();
      const topLayer = makeTileLayer();
      const counts = new Map<unknown, number>([
        [topLayer, c * 3],
        [bottomLayer, c],
      ]);
      vi.spyOn(renderer, "calcTiles").mockImplementation((tileLayer: unknown) =>
        tilesNearCenter(counts.get(tileLayer) ?? 0),
      );
      // A vector layer, so the layer range is consumed too: it is what lifts the
      // bar from the top of the tile range to the end of render()'s budget.
      const vector = { options: {} };
      renderer.map.foliplus = {
        LayerAPI: withApi([
          { id: "bottom", visible: true, layer: bottomLayer },
          { id: "top", visible: true, layer: topLayer },
          { id: "vector", visible: true, layer: vector },
        ]),
      };

      const onProgress = vi.fn();
      await runRender(onProgress);

      const got = onProgress.mock.calls.map(call => call[0]);
      // 4 batches across 2 layers, each one a share of all 24 tiles: the bar
      // never resets when the second layer starts.  It caps at 90 rather than
      // 100 — the canvas still has to be encoded, and that is the manager's.
      expect(got[got.length - 1]).toBe(90);
      expect(got).toEqual([...got].sort((a, b) => a - b));
      expect(Math.min(...got)).toBeGreaterThan(0);
    });

    it("skips invisible and non-tile layers when sizing the denominator", async () => {
      bigCenter();
      const visible = makeTileLayer();
      const hidden = makeTileLayer();
      const calcTiles = vi
        .spyOn(renderer, "calcTiles")
        .mockReturnValue(tilesNearCenter(CONST.TILE_CONCURRENCY));
      stubBitmaps();
      stubCanvas();
      renderer.map.foliplus = {
        LayerAPI: withApi([
          { id: "hidden", visible: false, layer: hidden },
          { id: "empty", visible: true, layer: {} },
          { id: "visible", visible: true, layer: visible },
        ]),
      };

      const onProgress = vi.fn();
      await runRender(onProgress);

      // Only the visible TileLayer is sized: the hidden one and the non-tile
      // entry are filtered out before the denominator is summed.  One call —
      // the extent is enumerated once per export and threaded into the draw
      // pass, which is what keeps numerator and denominator in agreement.
      expect(calcTiles).toHaveBeenCalledTimes(1);
      expect(calcTiles.mock.calls[0][0]).toBe(visible);

      const got = onProgress.mock.calls.map(call => call[0]);
      // Tiles take the tile range, then the non-tile entries take the layer
      // range: the bar ends at 90 and never claims 100 inside render().
      expect(got[got.length - 1]).toBe(90);
      expect(Math.max(...got)).toBeLessThan(100);
    });

    it("keeps a positive progress when every tile layer is clipped out of view", async () => {
      (renderer.map.getContainer() as any).getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        width: 100,
        height: 100,
        right: 100,
        bottom: 100,
      });
      renderer.map.getCenter = () => ({ lat: 26.08, lng: 119.3 });
      stubCanvas();
      const layer = makeTileLayer();
      // All tiles sit far outside the 100x100 crop, so the sized denominator is
      // zero and this layer never reaches the draw pass.
      vi.spyOn(renderer, "calcTiles").mockReturnValue([
        { x: 99, y: 99, z: 2, url: "far", left: 99999, top: 99999, size: 256 },
      ]);
      const renderTileLayer = vi.spyOn(renderer, "renderTileLayer");
      // A vector entry completes the layer range: with no tile layer left, the
      // bar must still leave the 0-70 range rather than sit at 0.
      const vector = { options: {} };
      renderer.map.foliplus = {
        LayerAPI: withApi([
          { id: "a", visible: true, layer },
          { id: "vector", visible: true, layer: vector },
        ]),
      };

      const onProgress = vi.fn();
      await renderer.render(
        { left: 0, top: 0, width: 100, height: 100 },
        1,
        undefined,
        { nw: { lat: 26.1, lng: 119.2 }, se: { lat: 26.0, lng: 119.4 } },
        onProgress,
      );

      // A zero denominator must not divide by zero: there is still a vector pass
      // to report, so the bar starts at the layer range instead of staying at 0.
      expect(onProgress.mock.calls.map(call => call[0])).toEqual([71, 90]);
      expect(renderTileLayer).not.toHaveBeenCalled();
    });

    it("excludes a tile layer with no visible tiles from the denominator", async () => {
      bigCenter();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      stubCanvas();
      const emptyLayer = makeTileLayer();
      const realLayer = makeTileLayer();
      vi.spyOn(renderer, "calcTiles").mockImplementation((tileLayer: unknown) =>
        tileLayer === emptyLayer ? [] : tilesNearCenter(CONST.TILE_CONCURRENCY),
      );
      stubBitmaps();
      const renderTileLayer = vi.spyOn(renderer, "renderTileLayer");
      renderer.map.foliplus = {
        LayerAPI: withApi([
          { id: "empty", visible: true, layer: emptyLayer },
          { id: "real", visible: true, layer: realLayer },
        ]),
      };

      const onProgress = vi.fn();
      await runRender(onProgress);

      const got = onProgress.mock.calls.map(call => call[0]);
      // The empty layer is dropped before the sum, so the denominator is the real
      // layer's tiles only — without that the bar could never reach the top of
      // the tile range, since the empty layer contributes no draws to the total.
      expect(got[got.length - 1]).toBe(70);
      expect(got).toEqual([...got].sort((a, b) => a - b));
      // renderTileLayer is entered only for the layer that has tiles.
      expect(renderTileLayer.mock.calls.map(c => c[1])).toHaveLength(1);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("reports the layer range instead of tiles when no tile layers are visible", async () => {
      bigCenter();
      stubCanvas();
      const renderTileLayer = vi.spyOn(renderer, "renderTileLayer");
      const calcTiles = vi.spyOn(renderer, "calcTiles");
      // A vector layer, not a TileLayer instance: a makeTileLayer() fixture would
      // pass the `instanceof L.TileLayer` gate and be sized as a tile layer.
      renderer.map.foliplus = {
        LayerAPI: withApi([{ id: "vec", visible: true, layer: { options: {} } }]),
      };

      const onProgress = vi.fn();
      await runRender(onProgress);

      // No visible tile layer: the tile range is handed straight to the caller
      // rather than reported as 0/0, and the single vector layer consumes the
      // layer range to reach 90.
      expect(calcTiles).not.toHaveBeenCalled();
      expect(renderTileLayer).not.toHaveBeenCalled();
      expect(onProgress.mock.calls.map(call => call[0])).toEqual([71, 90]);
    });

    it("records failing tiles end-to-end and resets stats between renders", async () => {
      bigCenter();
      // Every tile of the single visible layer fails: the CORS-blocked profile
      // through the real render() → renderTileLayer pipeline.
      (UTIL.loadImageBitmap as any).mockResolvedValue(null);
      stubCanvas();
      const layer = makeTileLayer();
      vi.spyOn(renderer, "calcTiles").mockReturnValue(
        tilesNearCenter(CONST.TILE_CONCURRENCY),
      );
      renderer.map.foliplus = {
        LayerAPI: withApi([{ id: "a", visible: true, layer }]),
      };

      await runRender(() => {});
      expect(renderer.tileFailures).toEqual([
        { total: CONST.TILE_CONCURRENCY, failed: CONST.TILE_CONCURRENCY },
      ]);
      expect(renderer.tileFailures.some(isCorsBlocked)).toBe(true);

      // A second render starts from a clean slate — the previous export's
      // failures must not be carried into the next one.
      await runRender(() => {});
      expect(renderer.tileFailures).toEqual([
        { total: CONST.TILE_CONCURRENCY, failed: CONST.TILE_CONCURRENCY },
      ]);
      expect(renderer.tileFailures).toHaveLength(1);
    });

    it("skips a layer when LayerControl's intent says hidden", async () => {
      // intentVisible (from LayerControl) returns false even though the layer
      // is still on the map — the layer should be skipped, no tiles drawn.
      bigCenter();
      stubCanvas();
      const hidden = makeTileLayer();
      const calcTiles = vi.spyOn(renderer, "calcTiles");
      renderer.map.foliplus = {
        LayerAPI: {
          layers: [{ id: "hidden", layer: hidden }],
          getLayerPanes: () => [],
          intentVisible: () => false,
        },
      };
      const renderTileLayer = vi.spyOn(renderer, "renderTileLayer");
      await runRender(vi.fn());
      expect(calcTiles).not.toHaveBeenCalled();
      expect(renderTileLayer).not.toHaveBeenCalled();
    });

    it("renders a tile layer when no LayerControl is present (fallback to true)", async () => {
      // No LayerControl on the map → api.intentVisible is undefined → the
      // `?? true` fallback applies, so a tile layer with a URL is sized and
      // handed to renderTileLayer.
      bigCenter();
      stubCanvas();
      stubBitmaps();
      const layer = makeTileLayer();
      const calcTiles = vi
        .spyOn(renderer, "calcTiles")
        .mockReturnValue(tilesNearCenter(CONST.TILE_CONCURRENCY));
      renderer.map.foliplus = {
        LayerAPI: {
          layers: [{ id: "tile", layer }],
          getLayerPanes: () => [],
        },
      };
      const renderTileLayer = vi.spyOn(renderer, "renderTileLayer");
      await runRender(vi.fn());
      expect(calcTiles).toHaveBeenCalledTimes(1);
      expect(calcTiles.mock.calls[0][0]).toBe(layer);
      expect(renderTileLayer).toHaveBeenCalled();
    });
  });

  describe("ExportRenderer.render — layer pass routing", () => {
    let savedMapDesc: PropertyDescriptor | undefined;
    let savedLDesc: PropertyDescriptor | undefined;

    beforeEach(() => {
      // render() reads the module-scoped IIFE free variables `map` and `L`.
      // Retargeting them gives this block a renderer whose own map is also the
      // module map, so calcTiles runs unstubbed and the sizing pass works.
      const container = document.createElement("div");
      container.getBoundingClientRect = () =>
        ({
          left: 0,
          top: 0,
          width: 1000,
          height: 1000,
          right: 1000,
          bottom: 1000,
        }) as DOMRect;
      const map = {
        options: { crs: makeEPSG3857Mock() },
        getContainer: () => container,
        getZoom: () => 2,
        getCenter: () => ({ lat: 26.08, lng: 119.3 }),
        foliplus: { LayerAPI: withApi([]) },
      };
      savedMapDesc = Object.getOwnPropertyDescriptor(globalThis, "map");
      savedLDesc = Object.getOwnPropertyDescriptor(globalThis, "L");
      Object.defineProperty(globalThis, "map", {
        configurable: true,
        writable: true,
        value: map,
      });
      Object.defineProperty(globalThis, "L", {
        configurable: true,
        writable: true,
        value: { ...L, TileLayer: MockTileLayer },
      });
    });
    afterEach(() => {
      if (savedMapDesc) Object.defineProperty(globalThis, "map", savedMapDesc);
      if (savedLDesc) Object.defineProperty(globalThis, "L", savedLDesc);
    });

    const runRender = (onProgress: (percent: number) => void) =>
      new ExportRenderer((globalThis as any).map).render(
        { left: 0, top: 0, width: 1000, height: 1000 },
        1,
        undefined,
        { nw: { lat: 26.1, lng: 119.2 }, se: { lat: 26.0, lng: 119.4 } },
        onProgress,
      );

    it("runs the canvas, pane and marker passes for their layer entries", async () => {
      // LayerAPI order is bottom-to-top, so the canvas layer is drawn first: with
      // two layer entries the bar reads 50 then 100 of the layer range.  Each
      // entry is asserted through the pass it exercises, so the routing itself is
      // what the test pins down rather than just the percentages.
      // render() builds its own canvas; point its getContext at a real no-op ctx
      // so the draw passes complete in jsdom.
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
        makeMockCtx() as any,
      );
      const canvasLayer = document.createElement("canvas");
      canvasLayer.toDataURL = () => "data:image/png;base64,AAEC";
      vi.spyOn(UTIL, "loadImage").mockResolvedValue({} as any);
      canvasLayer.getBoundingClientRect = () =>
        ({
          left: 0,
          top: 0,
          width: 200,
          height: 200,
          right: 200,
          bottom: 200,
        }) as DOMRect;

      const paneSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      paneSvg.getBoundingClientRect = () =>
        ({
          left: 0,
          top: 0,
          width: 100,
          height: 100,
          right: 100,
          bottom: 100,
        }) as DOMRect;
      paneSvg.appendChild(
        document.createElementNS("http://www.w3.org/2000/svg", "circle"),
      );
      const roots = document.createElement("div");
      roots.appendChild(paneSvg);

      const vector = { options: {} };
      const getLayerPanes = vi.fn(() => ["vector-pane"]);
      const map = (globalThis as any).map;
      map.foliplus = {
        LayerAPI: withApi(
          [
            { id: "canvas", visible: true, canvas: canvasLayer },
            { id: "tile", visible: true, layer: makeTileLayer() },
            { id: "vector", visible: true, layer: vector },
          ],
          getLayerPanes,
        ),
      };
      map.getPane = (name: string) => (name === "vector-pane" ? roots : null);

      // Prototype spies so the calls survive the instance being built per test,
      // and so the tile passes can be stubbed without re-implementing them.
      const proto = ExportRenderer.prototype as any;
      const spy = (name: string) => vi.spyOn(proto, name);
      const canvas = spy("renderCanvasElement");
      const paneSVG = spy("renderPaneSVG");
      const paneCanvas = spy("renderPaneCanvas");
      const tileLayer = spy("renderTileLayer");
      // The draw pass reports one step per batch, so the callback is what puts a
      // number on the bar at all.
      tileLayer.mockImplementation(
        async (_rc: any, _tiles: any, _layer: any, cb: any) => {
          cb(1);
        },
      );
      const markers = spy("collectPaneRoots");
      // render() reads the sweep's return value to decide whether the marker
      // passes run, so an empty stub keeps them out of this test's scope.
      markers.mockReturnValue([] as any);
      const markerPasses = spy("renderMarkers");
      const iconPasses = spy("renderFontAwesome");
      const textPasses = spy("renderTextLabels");
      const remainingPasses = spy("renderRemaining");

      const onProgress = vi.fn();
      await runRender(onProgress);

      expect(canvas).toHaveBeenCalledWith(expect.anything(), canvasLayer);
      expect(paneSVG).toHaveBeenCalledWith(expect.anything(), roots);
      expect(paneCanvas).toHaveBeenCalledWith(expect.anything(), roots);
      expect(getLayerPanes).toHaveBeenCalledWith(vector);
      // The sweep runs over the resolved content panes, not the raw API list.
      expect(markers).toHaveBeenCalledWith(["vector-pane"]);
      expect(markerPasses).not.toHaveBeenCalled();
      expect(iconPasses).not.toHaveBeenCalled();
      expect(textPasses).not.toHaveBeenCalled();
      expect(remainingPasses).not.toHaveBeenCalled();
      // One full-size tile is the whole extent, so the tile phase closes at 70
      // rather than stepping partway; the three layer entries then walk the
      // layer range to its top at 90.
      expect(onProgress.mock.calls.map(call => call[0])).toEqual([70, 81, 90]);
    });

    it("renders a layer's label labels right after its content", async () => {
      // Each layer's label canvas mounts in its own pane (map.createPane), a
      // sibling of the content panes the walk visits. render() draws it right
      // after the layer's content — before the next layer up covers it — so the
      // exported stack order matches the map's.
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
        makeMockCtx() as any,
      );
      const map = (globalThis as any).map;
      const labelPane = document.createElement("div");
      labelPane.className = "foliplus-label-pane";
      const annCanvas = document.createElement("canvas");
      annCanvas.className = "foliplus-label-canvas";
      labelPane.appendChild(annCanvas);
      map.getPane = (name: string) =>
        name === `${CONST.LABEL_PANE_PREFIX}vec` ? labelPane : null;
      map.foliplus = {
        LayerAPI: withApi([{ id: "vec", visible: true, layer: { options: {} } }]),
      };

      // The label pass no longer reads the live canvas at pass time: render()
      // snapshots the pane's canvases at export start and draws the frozen pixels
      // after the layer's content. Spy on the canvas module to assert both halves.
      // The pane holds one canvas, so the snapshot returns one entry.
      const snap = vi.spyOn(CANVAS, "snapshotPaneCanvases").mockReturnValue({
        snaps: [
          {
            dataUrl: "data:image/png;base64,PAINTED",
            dx: 0,
            dy: 0,
            dw: 80,
            dh: 40,
            opacity: 1,
          },
        ],
        held: 1,
      });
      const draw = vi
        .spyOn(CANVAS, "renderCanvasSnapshot")
        .mockResolvedValue(undefined);

      await runRender(vi.fn());

      // The pane is snapshotted once, with the label selector, at export
      // start (before the first await), right after the layer's content walk.
      expect(snap).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        labelPane,
        CONST.SEL.LABEL_CANVAS,
      );
      // And the frozen pixels are drawn in the label pass.
      expect(draw).toHaveBeenCalled();
    });

    it("draws a layer's label labels from a snapshot taken at export start, not the live canvas", async () => {
      // Negative control for the silent-loss race: between render()'s synchronous
      // snapshot (before the first await) and the label pass there is an async
      // window (the tile wait and the nextFrame). If an label refresh
      // clears the label canvas in that window, the export must still draw the
      // pixels the user saw when they pressed Export — the snapshot — and not
      // the cleared canvas. Before the fix the label pass re-reads the live
      // canvas via toDataURL at pass time, so it draws the cleared pixels.
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
        makeMockCtx() as any,
      );
      const map = (globalThis as any).map;
      // The SEL.LABEL_CANVAS selector is ".leaflet-map-pane canvas.foliplus-label-canvas",
      // so the label pane must sit inside a .leaflet-map-pane ancestor to match.
      const mapPane = document.createElement("div");
      mapPane.className = "leaflet-map-pane";
      const labelPane = document.createElement("div");
      labelPane.className = "foliplus-label-pane";
      mapPane.appendChild(labelPane);
      const annCanvas = document.createElement("canvas");
      annCanvas.className = "foliplus-label-canvas";
      labelPane.appendChild(annCanvas);
      map.getPane = (name: string) =>
        name === `${CONST.LABEL_PANE_PREFIX}vec` ? labelPane : null;
      map.foliplus = {
        LayerAPI: withApi([{ id: "vec", visible: true, layer: { options: {} } }]),
      };

      // The label canvas reports PAINTED pixels at export start.
      const PAINTED = "data:image/png;base64,PAINTED";
      const CLEARED = "data:image/png;base64,CLEARED";
      let current = PAINTED;
      annCanvas.toDataURL = () => current;
      // Label geometry inside the crop.
      annCanvas.getBoundingClientRect = () =>
        ({
          left: 100,
          top: 100,
          width: 80,
          height: 40,
          right: 180,
          bottom: 140,
        }) as DOMRect;

      // Capture what the label pass asked the image loader for.
      const loaded: string[] = [];
      vi.spyOn(UTIL, "loadImage").mockImplementation((src: string) => {
        loaded.push(src);
        return Promise.resolve({ src } as any);
      });

      // Inject an label refresh at the nextFrame point — after the snapshot,
      // before the label pass: the canvas is cleared in exactly the async window
      // that used to lose the labels silently.
      vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(cb => {
        // Clear the label canvas (simulate refresh) before the frame resolves.
        current = CLEARED;
        cb(0);
        return 0;
      });

      await runRender(vi.fn());

      // The export must have drawn the PAINTED snapshot, not the CLEARED live
      // canvas. On the old (gamma-only) code this reads the live canvas at pass
      // time and draws CLEARED — the assertion fails (red), proving the race.
      expect(loaded).toContain(PAINTED);
      expect(loaded).not.toContain(CLEARED);
    });

    it("snapshots the label pane at the enlarged geometry when the map was grown before the export", async () => {
      // Design test-plan item 4 (enlarged path): the map container is grown and
      // setView happens before the export, so the crop is larger than the
      // default 1000x1000. The snapshot must be taken with the CURRENT (enlarged)
      // geometry, not a stale one captured earlier — otherwise labels in the
      // grown band would fall outside the crop and be dropped.
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
        makeMockCtx() as any,
      );
      const map = (globalThis as any).map;
      const labelPane = document.createElement("div");
      labelPane.className = "foliplus-label-pane";
      const annCanvas = document.createElement("canvas");
      annCanvas.className = "foliplus-label-canvas";
      // The label sits in the grown band: beyond the old 1000x1000 crop.
      pinBox(annCanvas, 1200, 1200, 80, 40);
      labelPane.appendChild(annCanvas);
      map.getPane = (name: string) =>
        name === `${CONST.LABEL_PANE_PREFIX}vec` ? labelPane : null;
      map.foliplus = {
        LayerAPI: withApi([{ id: "vec", visible: true, layer: { options: {} } }]),
      };
      // Grow the container before the export (the enlarge+setView path).
      const container = map.getContainer();
      container.getBoundingClientRect = () =>
        ({
          left: 0,
          top: 0,
          width: 2000,
          height: 2000,
          right: 2000,
          bottom: 2000,
        }) as DOMRect;
      const renderer = new ExportRenderer(map);

      const snap = vi.spyOn(CANVAS, "snapshotPaneCanvases").mockReturnValue({
        snaps: [
          {
            dataUrl: "data:image/png;base64,PAINTED",
            dx: 1200,
            dy: 1200,
            dw: 80,
            dh: 40,
            opacity: 1,
          },
        ],
        held: 1,
      });
      const draw = vi
        .spyOn(CANVAS, "renderCanvasSnapshot")
        .mockResolvedValue(undefined);

      await renderer.render(
        { left: 0, top: 0, width: 2000, height: 2000 },
        1,
        undefined,
        { nw: { lat: 26.1, lng: 119.2 }, se: { lat: 26.0, lng: 119.4 } },
        vi.fn(),
      );

      // The snapshot was taken at the enlarged crop and its geometry is what the
      // label pass draws (the frozen dx/dy from the enlarged rect).
      expect(snap).toHaveBeenCalled();
      expect(draw).toHaveBeenCalled();
      expect(draw.mock.calls[0][1]).toMatchObject({ dx: 1200, dy: 1200 });
    });

    it("runs the four marker passes when the layer's panes hold markers", async () => {
      // The pane passes do not own marker DOM: the sweep strips canvas and svg
      // from the pane and the four marker passes draw whatever is left.
      // Leaving it empty would silently skip all four, so the assertion is that
      // the panes are scanned and the markers survive the sweep.
      const paneSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      paneSvg.getBoundingClientRect = () =>
        ({
          left: 0,
          top: 0,
          width: 100,
          height: 100,
          right: 100,
          bottom: 100,
        }) as DOMRect;
      paneSvg.appendChild(
        document.createElementNS("http://www.w3.org/2000/svg", "circle"),
      );
      const markerEl = document.createElement("img");
      markerEl.src = "data:image/png;base64,AAAA";
      const roots = document.createElement("div");
      roots.appendChild(paneSvg);
      roots.appendChild(markerEl);
      // The sweep strips svg by namespace; the opt-out is a second, independent
      // exclusion carrier, so the root must stay out whichever path runs.
      paneSvg.setAttribute("data-foliplus-export", "exclude");

      const vector = { options: {} };
      const map = (globalThis as any).map;
      map.foliplus = {
        LayerAPI: withApi([{ id: "vec", visible: true, layer: vector }], () => [
          "vector-pane",
        ]),
      };
      // Only the layer's content pane is `roots`; label panes and everything
      // else are absent, so the label snapshot sees no pane and reports nothing.
      map.getPane = (name: string) => (name === "vector-pane" ? roots : null);

      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
        makeMockCtx() as any,
      );

      const proto = ExportRenderer.prototype as any;
      // The real sweep is used on purpose: it is the filter that decides these
      // passes run at all.  Everything it feeds is stubbed, so the panes are
      // scanned without fetching or drawing in jsdom.
      vi.spyOn(proto, "renderPaneSVG").mockResolvedValue(undefined);
      vi.spyOn(proto, "renderPaneCanvas").mockResolvedValue(undefined);
      const markers = vi.spyOn(proto, "collectPaneRoots");
      const markerPasses = vi
        .spyOn(proto, "renderMarkers")
        .mockResolvedValue(undefined);
      const iconPasses = vi
        .spyOn(proto, "renderFontAwesome")
        .mockResolvedValue(undefined);
      const textPasses = vi
        .spyOn(proto, "renderTextLabels")
        .mockResolvedValue(undefined);
      const remainingPasses = vi
        .spyOn(proto, "renderRemaining")
        .mockResolvedValue(undefined);

      const onProgress = vi.fn();
      await runRender(onProgress);

      expect(markerPasses).toHaveBeenCalledTimes(1);
      expect(iconPasses).toHaveBeenCalledTimes(1);
      expect(textPasses).toHaveBeenCalledTimes(1);
      expect(remainingPasses).toHaveBeenCalledTimes(1);
      // Same single argument across the chain: the roots the sweep produced.
      const rootsArg: HTMLElement[] = markerPasses.mock.calls[0][1] as HTMLElement[];
      expect(rootsArg).toHaveLength(1);
      expect(rootsArg[0]).toBe(markerEl);
      expect(iconPasses.mock.calls[0][1]).toBe(rootsArg);
      expect(textPasses.mock.calls[0][1]).toBe(rootsArg);
      expect(remainingPasses.mock.calls[0][1]).toBe(rootsArg);
      // The collected element is the one that is NOT the svg pane: the sweep
      // skipped the svg even though it sits first in the pane. The shadow sweep
      // runs first and finds nothing here, so the marker sweep is the last call.
      expect(markers.mock.results.at(-1)!.value).toHaveLength(1);
      // No tile layer, so the range opens at 71 and the one entry closes it.
      expect(onProgress.mock.calls.map(call => call[0])).toEqual([71, 90]);
    });

    it("counts a missing pane as drawn and keeps reporting progress", async () => {
      // map.getPane can return null for a pane name the API still reports, so the
      // guard skips the pane passes — but the layer still consumes its unit of
      // the layer range, otherwise the bar stops short of the top.
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
        makeMockCtx() as any,
      );
      const vector = { options: {} };
      const map = (globalThis as any).map;
      map.foliplus = {
        LayerAPI: withApi([{ id: "vec", visible: true, layer: vector }], () => [
          "gone-pane",
        ]),
      };
      map.getPane = () => null;

      const proto = ExportRenderer.prototype as any;
      const paneSVG = vi.spyOn(proto, "renderPaneSVG");
      const paneCanvas = vi.spyOn(proto, "renderPaneCanvas");
      const markers = vi.spyOn(proto, "collectPaneRoots");
      vi.spyOn(proto, "renderTileLayer").mockResolvedValue(undefined);

      const onProgress = vi.fn();
      await runRender(onProgress);

      expect(paneSVG).not.toHaveBeenCalled();
      expect(paneCanvas).not.toHaveBeenCalled();
      expect(markers).toHaveBeenCalledWith(["gone-pane"]);
      // No visible tile layer: 71 opens the layer range, and the single entry
      // closes it at 90 even though its pane was missing.
      expect(onProgress.mock.calls.map(call => call[0])).toEqual([71, 90]);
    });

    it("resolves each entry once and draws the carrier it snapshotted", async () => {
      // The export resolves its layer list once, when it starts, and every pass
      // reads that record. This entry tears itself down as soon as it is read:
      // re-resolving later (the old tile/filter/loop reads) dropped it from the
      // image without a word. The snapshot's carrier is what gets drawn.
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
        makeMockCtx() as any,
      );
      const fakeLayer = { options: {} };
      let reads = 0;
      const map = (globalThis as any).map;
      const previous = map.foliplus;
      const previousGetPane = map.getPane;
      try {
        map.getPane = () => null;
        map.foliplus = {
          LayerAPI: withApi([
            {
              id: "torn",
              visible: true,
              get layer() {
                reads++;
                return reads === 1 ? fakeLayer : null;
              },
            },
          ]),
        };

        const proto = ExportRenderer.prototype as any;
        const panes = vi.spyOn(proto, "resolveExportPanes").mockReturnValue([]);
        vi.spyOn(proto, "renderTileLayer").mockResolvedValue(undefined);

        const onProgress = vi.fn();
        await runRender(onProgress);

        // One resolution, at the snapshot; nothing re-reads the live entry.
        expect(reads).toBe(1);
        // The snapshotted carrier is the one the layer pass walks, and the single
        // unit still closes the range.
        expect(panes).toHaveBeenCalledWith(fakeLayer, expect.anything());
        expect(onProgress.mock.calls.map(call => call[0])).toEqual([71, 90]);
      } finally {
        map.foliplus = previous;
        map.getPane = previousGetPane;
      }
    });

    it("reports label canvases it saw but could not serialize, once, by id", async () => {
      // A label pane that holds a canvas the snapshot could not serialize (here
      // toDataURL throws) is a real loss: the user saw labels that the export
      // will not carry. The export used to omit them silently; one aggregated
      // line names them all. A pane that declares labels but never had a canvas
      // (labels off) is NOT a loss — see the next test.
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
        makeMockCtx() as any,
      );
      const map = (globalThis as any).map;
      const previous = map.foliplus;
      const previousGetPane = map.getPane;
      try {
        const mapPane = document.createElement("div");
        mapPane.className = "leaflet-map-pane";
        const labelPane = document.createElement("div");
        labelPane.className = "foliplus-label-pane";
        mapPane.appendChild(labelPane);
        // One canvas that the snapshot walks but whose serialization fails.
        const annCanvas = document.createElement("canvas");
        annCanvas.className = "foliplus-label-canvas";
        annCanvas.getBoundingClientRect = () =>
          ({
            left: 0,
            top: 0,
            width: 80,
            height: 40,
            right: 80,
            bottom: 40,
          }) as DOMRect;
        annCanvas.toDataURL = () => {
          throw new Error("boom");
        };
        labelPane.appendChild(annCanvas);
        map.getPane = (name: string) =>
          name.startsWith(CONST.LABEL_PANE_PREFIX) ? labelPane : null;
        map.foliplus = {
          LayerAPI: withApi([
            { id: "first", visible: true, layer: { options: {} } },
            { id: "second", visible: true, layer: { options: {} } },
          ]),
        };

        const proto = ExportRenderer.prototype as any;
        vi.spyOn(proto, "resolveExportPanes").mockReturnValue([]);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

        await runRender(vi.fn());

        const lines = warn.mock.calls
          .map(call => String(call[0]))
          .filter(line => line.includes("label canvas missing"));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain("first");
        expect(lines[0]).toContain("second");
      } finally {
        map.foliplus = previous;
        map.getPane = previousGetPane;
      }
    });

    it("does not report a label pane that declares labels but holds no canvas", async () => {
      // A layer with the label capability but labels off (show=false) has a pane
      // but no canvas. That is "no labels in this export", not a loss: reporting
      // it would warn on every such export. The loss criterion is held >
      // snaps.length, and an empty pane holds 0 canvases.
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
        makeMockCtx() as any,
      );
      const map = (globalThis as any).map;
      const previous = map.foliplus;
      const previousGetPane = map.getPane;
      try {
        const labelPane = document.createElement("div");
        labelPane.className = "foliplus-label-pane";
        map.getPane = (name: string) =>
          name.startsWith(CONST.LABEL_PANE_PREFIX) ? labelPane : null;
        map.foliplus = {
          LayerAPI: withApi([{ id: "quiet", visible: true, layer: { options: {} } }]),
        };

        const proto = ExportRenderer.prototype as any;
        vi.spyOn(proto, "resolveExportPanes").mockReturnValue([]);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

        await runRender(vi.fn());

        const lines = warn.mock.calls
          .map(call => String(call[0]))
          .filter(line => line.includes("label canvas missing"));
        expect(lines).toHaveLength(0);
      } finally {
        map.foliplus = previous;
        map.getPane = previousGetPane;
      }
    });
  });

  describe("ExportRenderer — marker pass wrappers delegate without throwing", () => {
    it("runs each marker pass wrapper with an empty root list", async () => {
      const renderer = makeRenderer();
      const rc = makeRC(100, 100);

      // These four wrappers delegate to module functions. Calling them with an
      // empty markerRoots list exercises the method body (the delegation itself)
      // without needing marker fixtures; the delegated functions return
      // undefined for an empty list, so the assertion is "does not throw".
      await expect(renderer.renderMarkers(rc, [])).resolves.not.toThrow();
      await expect(renderer.renderFontAwesome(rc, [])).resolves.not.toThrow();
      await expect(renderer.renderTextLabels(rc, [])).resolves.not.toThrow();
      await expect(renderer.renderRemaining(rc, [])).resolves.not.toThrow();
    });
  });

  describe("ExportRenderer — renderFontAwesome glyph decoding", () => {
    it("decodes the doubled-backslash \\\\fXXXX content form", async () => {
      // FontAwesome's computed ::before content sometimes arrives as the
      // escaped `\\f2b9` form rather than a single `\f2b9`. Both must decode to
      // the same code point, so this pins the second branch.
      const root = document.createElement("div");
      const icon = document.createElement("i");
      root.appendChild(icon);
      document.body.appendChild(root);
      const box = { left: 10, top: 10, width: 20, height: 20 } as DOMRect;
      vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
        ...box,
        right: 30,
        bottom: 30,
        x: 10,
        y: 10,
        toJSON: () => box,
      } as DOMRect);
      vi.spyOn(icon, "getBoundingClientRect").mockReturnValue({
        ...box,
        right: 30,
        bottom: 30,
        x: 10,
        y: 10,
        toJSON: () => box,
      } as DOMRect);
      const computed = {
        content: '"\\\\f2b9"',
        fontWeight: "900",
        fontSize: "14px",
        fontFamily: "FontAwesome",
        color: "#fff",
        opacity: "",
      } as unknown as CSSStyleDeclaration;
      vi.spyOn(window, "getComputedStyle").mockReturnValue(computed);
      const previousFonts = Object.getOwnPropertyDescriptor(document, "fonts");
      Object.defineProperty(document, "fonts", {
        configurable: true,
        value: {
          load: vi.fn().mockResolvedValue([]),
          check: vi.fn().mockReturnValue(true),
          ready: Promise.resolve(),
        },
      });

      const ctx = makeMockCtx();
      const rc = makeRC(100, 100, ctx);
      rc.contRect = { left: 0, top: 0, width: 100, height: 100 } as DOMRect;

      try {
        await makeRenderer().renderFontAwesome(rc, [root]);
        expect(ctx.fillText).toHaveBeenCalledWith(
          "\uf2b9",
          expect.any(Number),
          expect.any(Number),
        );
      } finally {
        root.remove();
        if (previousFonts) Object.defineProperty(document, "fonts", previousFonts);
        else Reflect.deleteProperty(document, "fonts");
      }
    });
  });

  //===========================================================================
  //  tile.ts fallbacks — layerUrl() ?? "" and map.options.crs ?? EPSG3857.
  //  A registry can hold tile entries whose _url was never populated (the basemap
  //  is a var that resolves after the render pass captured its ref), and a
  //  caller can hand a map whose options object has no crs field — both paths
  //  must not throw and must degrade to the documented default.
  //===========================================================================

  describe("tile fallbacks", () => {
    it("calcTiles returns empty URLs when a tile layer carries no _url", async () => {
      // MockTileLayer always sets _url, but a registry entry may hold a layer
      // whose URL was never populated (late-binding basemap, canvas-only entry
      // reused as a tile, etc). The renderer must not choke and must produce
      // the empty-string URL the tile build documents as its fallback.
      const layer = {
        options: { tileSize: 256, subdomains: "abc" },
      } as any;
      const tiles = makeRenderer().calcTiles(
        layer,
        { nw: { lat: 26.1, lng: 119.2 }, se: { lat: 26.0, lng: 119.4 } },
        2,
        1,
      );

      expect(tiles).toHaveLength(1);
      expect(tiles[0].url).toBe("");
      // No retina placeholder in the empty template means no fallback URL is
      // recorded either — a fallback that only exists to differ from the
      // primary would otherwise be a duplicate.
      expect(tiles[0]).not.toHaveProperty("fallback");
    });

    it("tilePositions falls back to L.CRS.EPSG3857 when map.options.crs is undefined", async () => {
      // Some callers construct the renderer with a map whose options object has
      // no crs field at all (rather than an explicit crs). The fallback must
      // kick in — a hard-coded EPSG3857 reference would not be observable as
      // distinct, so spy on L.CRS.EPSG3857 and assert it is the crs that
      // actually performed the projection.
      const epsg = {
        ...makeEPSG3857Mock(),
        latLngToPoint: vi.fn().mockReturnValue({ x: 256, y: 256 }),
      };
      (L as any).CRS = { EPSG3857: epsg };
      const map = {
        options: {},
        getZoom: () => 2,
        getCenter: () => ({ lat: 26.08, lng: 119.3 }),
        getContainer: () => document.createElement("div"),
        foliplus: { LayerAPI: withApi([]) },
      } as any;

      const rc = makeRC(4096, 4096);
      const tiles = withPixels(tilesNearCenter(CONST.TILE_CONCURRENCY));
      const out = new ExportRenderer(map).tilePositions(rc, tiles as any[]);

      expect(epsg.latLngToPoint).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
      );
      expect(out).toHaveLength(tiles.length);
    });
  });

  //===========================================================================
  //  marker.ts renderRemaining SVG branch — zero-bbox fallback (width || 24,
  //  height || 24) and the colorParent conditional (with vs without a parent).
  //  Both branches sit inside the inline-SVG path, so exercise them by letting
  //  renderRemaining reach the SVG element and capturing the serialized XML
  //  that feeds loadImage; the width/height attributes on the clone reflect
  //  which side of each `||` was taken.
  //===========================================================================

  describe("renderRemaining — inline SVG fallbacks", () => {
    it("falls back to 24 for a zero-width bbox and inherits the parent's color", async () => {
      // A divIcon SVG with no layout has a zero-size bounding rect; without the
      // `|| 24` fallback the clone would be serialized as width="0" and the
      // exported marker would vanish. When the SVG is nested in a container
      // (the normal divIcon shape), the clone picks up the container's color.
      const ctx = makeMockCtx();
      const renderer = makeRenderer();
      const container = renderer.container;
      pinBox(container, 0, 0, 200, 200);

      const wrapper = document.createElement("div");
      pinBox(wrapper, 0, 0, 24, 24);
      const svg = document.createElementNS(CONST.SVG_NS, "svg");
      pinBox(svg, 0, 0, 0, 0);
      wrapper.appendChild(svg);

      vi.spyOn(window, "getComputedStyle").mockReturnValue({
        color: "rgb(255, 0, 0)",
      } as CSSStyleDeclaration);
      vi.spyOn(UTIL, "loadImage").mockResolvedValue({} as any);
      const sources = captureSources();

      await renderer.renderRemaining(makeRC(200, 200, ctx), [wrapper]);

      expect(sources[0]).toContain('width="24"');
      expect(sources[0]).toContain('height="24"');
      expect(sources[0]).toContain('color="rgb(255, 0, 0)"');
    });

    it("omits the color attribute when the svg has no parent and preserves non-zero dimensions", async () => {
      // A root-level SVG (no parent) must not get a color attribute stamped on
      // the clone — the parent is where the color lives, so without it the
      // clone keeps its own inline color. The non-zero width also has to
      // survive untouched; only the zero height takes the 24 fallback.
      const ctx = makeMockCtx();
      const renderer = makeRenderer();
      const container = renderer.container;
      pinBox(container, 0, 0, 200, 200);

      const wrapper = document.createElement("div");
      pinBox(wrapper, 0, 0, 88, 8);
      const svg = document.createElementNS(CONST.SVG_NS, "svg");
      // The svg must be inside the wrapper so root.querySelector("svg")
      // locates it, but its own parentElement must read null to exercise the
      // false side of `colorParent ? … : ""`.
      pinBox(svg, 0, 0, 88, 0);
      wrapper.appendChild(svg);
      vi.spyOn(svg, "parentElement", "get").mockReturnValue(null);

      vi.spyOn(UTIL, "loadImage").mockResolvedValue({} as any);
      const sources = captureSources();

      await renderer.renderRemaining(makeRC(200, 200, ctx), [wrapper]);

      expect(sources[0]).toContain('width="88"');
      expect(sources[0]).toContain('height="24"');
      expect(sources[0]).not.toContain("color=");
    });

    it("skips img path when img element has no src", async () => {
      // An img element with no src attribute is falsy on the `?.src` check —
      // the renderer must not attempt to load a missing image.
      const ctx = makeMockCtx();
      const renderer = makeRenderer();
      const container = renderer.container;
      pinBox(container, 0, 0, 200, 200);

      const wrapper = document.createElement("div");
      pinBox(wrapper, 0, 0, 24, 24);
      const img = document.createElement("img");
      wrapper.appendChild(img);

      vi.spyOn(UTIL, "loadImage").mockResolvedValue({} as any);
      const sources = captureSources();

      await renderer.renderRemaining(makeRC(200, 200, ctx), [wrapper]);

      expect(sources).toHaveLength(0);
    });

    it("takes img path when img element has a src", async () => {
      // When the img element has a non-empty src, the renderer attempts to
      // load and draw it. Mock loadImage to return a mock image and verify
      // drawImage is called.
      const ctx = makeMockCtx();
      const renderer = makeRenderer();
      const container = renderer.container;
      pinBox(container, 0, 0, 200, 200);

      const wrapper = document.createElement("div");
      pinBox(wrapper, 0, 0, 24, 24);
      const img = document.createElement("img");
      img.src = "data:image/png;base64,AAAA";
      wrapper.appendChild(img);

      const loadImageSpy = vi
        .spyOn(UTIL, "loadImage")
        .mockResolvedValue({} as HTMLImageElement);
      const drawImageSpy = vi.spyOn(ctx, "drawImage");

      await renderer.renderRemaining(makeRC(200, 200, ctx), [wrapper]);

      expect(loadImageSpy).toHaveBeenCalledWith(
        "data:image/png;base64,AAAA",
        "anonymous",
      );
      expect(drawImageSpy).toHaveBeenCalled();
    });
  });
});
