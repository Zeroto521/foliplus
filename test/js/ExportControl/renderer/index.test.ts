// ExportControl renderer/index — marker shadows in the export walk.
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
import L from "leaflet";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportRenderer } from "#foliplus/ExportControl/renderer/index.js";
import * as UTIL from "#foliplus/ExportControl/util.js";
import { LayerController } from "#foliplus/LayerControl/controller.js";

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

const pinBox = <T extends HTMLElement>(
  el: T,
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
    { id: "markers", name: "Markers", group: "overlay", layer: group },
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
