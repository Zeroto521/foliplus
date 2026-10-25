// ExportControl renderer/index — the per-layer marker-shadow pane in the
// export walk.
//
// A marker's shadow lives in the pane its leaf names in `options.shadowPane`.
// Since #733 a marker layer gets its own shadow pane, and the option points at
// it; before that every shadow sat in Leaflet's shared `shadowPane`, which pane
// discovery excludes (it only enumerates `options.pane`), so the export has
// never drawn a shadow at all.  The file pins the two properties that make the
// gap closed rather than merely different: the shadow is drawn, and it is drawn
// BELOW its icon — the layer's shadow pane is one z-step under its content
// (`zFor({ role: "shadow" })` = slot - 1), and the export must reproduce that
// with draw order, not with pane iteration.
//
// Two levels, one module:
//   - the fixture-driven cases drive `render()` against hand-built panes, and
//     answer `getLayerPanes` with the shape a surface reports (shadow pane
//     included), which is what the real controller does;
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
  }) as unknown as CanvasRenderingContext2D;

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
 *  them. `getLayerPanes` answers with the surface's WHOLE pane set — shadow
 *  carrier included — because that is what the real `LayerController` reports
 *  (`resolveLayerPanes` → `surface.panes`); a fixture that pre-filtered the
 *  shadow is exactly what hid P1, where the export read the shadow back as
 *  content and emptied its own shadow group. */
interface FixtureOpts {
  /** `options.shadowPane` of the marker leaf.  Undefined uses the per-layer
   *  pane; pass Leaflet's shared name for the no-per-layer-carrier case. */
  shadowPane?: string;
  /** Mount a canvas in the content pane, to pin the shadow's place relative to
   *  the layer's non-marker content. */
  contentCanvas?: boolean;
  /** Mark the shadow with the export opt-out, to pin the admission filter. */
  shadowExcluded?: boolean;
  /** Add a second marker layer whose leaf names the SAME shadow pane — the
   *  shared-carrier case one export must paint once. */
  secondLayerSharingShadow?: boolean;
}

interface Fixture {
  map: any;
  layer: any;
  renderer: ExportRenderer;
  loads: string[];
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

  if (opts.contentCanvas) {
    const contentCanvas = document.createElement("canvas");
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
  const entries: Array<{ id: string; visible: boolean; layer: unknown }> = [
    { id: "markers", visible: true, layer },
  ];
  const panesByLayer = new Map<unknown, string[]>();
  // A surface only owns a shadow pane when it has a per-layer carrier; a leaf
  // that kept Leaflet's shared `shadowPane` has none to report.
  panesByLayer.set(
    layer,
    Array.from(
      new Set(
        shadowName === "shadowPane" ? ["layer-content"] : ["layer-content", shadowName],
      ),
    ),
  );

  if (opts.secondLayerSharingShadow) {
    const content2 = document.createElement("div");
    const icon2 = document.createElement("img");
    icon2.src = "icon2.png";
    pinBox(icon2, 300, 300, 20, 20);
    content2.appendChild(icon2);
    panes["layer2-content"] = content2;
    const layer2 = { options: { pane: "layer2-content", shadowPane: shadowName } };
    panesByLayer.set(layer2, ["layer2-content"]);
    // The registry is topmost-first and render() paints bottom-up, so the
    // layer added last is the one painted first — the one that claims the
    // shared shadow pane.
    entries.unshift({ id: "markers2", visible: true, layer: layer2 });
  }

  const map = {
    options: { crs: {} },
    getContainer: () => container,
    getZoom: () => 2,
    getCenter: () => ({ lat: 0, lng: 0 }),
    getPane: (name: string) => panes[name] ?? null,
    foliplus: {
      LayerAPI: {
        layers: entries,
        intentVisible: () => true,
        getLayerPanes: (l: unknown) => panesByLayer.get(l) ?? [],
        // The live `PaneManager` the renderer reads its shared-pane set
        // from.  Only `defaultPanes` is consulted.
        panes: { defaultPanes: new Set(LEAFLET_SHARED_PANES) },
      },
    },
  };

  // Every image the marker passes load, in draw order: loadImage resolves
  // before the matching drawImage, so the list is the paint order.
  const loads: string[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(makeExportCtx());
  vi.spyOn(UTIL, "loadImage").mockImplementation((async (src: string) => {
    loads.push(src);
    return { src } as unknown as HTMLImageElement;
  }) as any);

  return {
    map,
    layer,
    renderer: new ExportRenderer(map as any),
    loads,
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
  it("splits a surface's pane set into content and shadow groups", () => {
    // P1 regression gate: getLayerPanes answers with the surface's whole pane
    // set — [content, content-shadow] — so the shadow has to be taken out of
    // the content group rather than read as proof that it is already content.
    // The pre-fix resolver subtracted it from content and lost it entirely.
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

  it("keeps the groups disjoint when a leaf names a content pane as its shadow", () => {
    // A leaf can point its shadow at a pane the API also reports as content.
    // The collection order decides who wins — shadows first, content is what
    // remains — so the pane is painted by one pass, never by both.
    const fixture = makeFixture({ shadowPane: "layer-content" });
    install(fixture);
    const panes = fixture.renderer.resolveExportPanes(fixture.layer);
    expect(panes.shadows).toEqual(["layer-content"]);
    expect(panes.content).not.toContain("layer-content");
  });

  it("collects no shadows when the API carries no pane host", () => {
    // The lightweight LayerAPI stub has no PaneManager to ask, so it cannot
    // tell a per-layer shadow pane from Leaflet's shared one. The walk then
    // collects nothing and the API's list passes through untouched — the
    // export keeps its pre-#733 shape (the stub's own list is empty anyway, so
    // no shadow pane can reach the walk on that path).
    const fixture = makeFixture();
    (fixture.map.foliplus.LayerAPI as { panes?: unknown }).panes = undefined;
    install(fixture);
    expect(fixture.renderer.resolveExportPanes(fixture.layer)).toEqual({
      content: ["layer-content", "layer-content-shadow"],
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

  it("paints a shadow pane shared by two layers once", async () => {
    // Nothing forces a custom shadow pane to be per-layer, and it is one set
    // of DOM nodes: painting it once per naming layer would composite the same
    // shadows twice and deepen their alpha. The first layer painted claims it;
    // every layer's own content still draws.
    const fixture = makeFixture({ secondLayerSharingShadow: true });
    install(fixture);

    await runRender(fixture);

    expect(fixture.loads.filter(src => src.includes("shadow.png"))).toHaveLength(1);
    expect(fixture.loads.filter(src => /icon\d*\.png$/.test(src))).toHaveLength(2);
  });
});

// ── Real Leaflet + real LayerController ──────────────────────────────
// The fixture cases above decide what the export does with a pane list. This
// block decides whether the list they model is the list production produces:
// @@getLayerPanes@@ answers with the surface's whole pane set (shadow carrier
// included — focus's lift and the browser probe suite read the same list), so
// the resolver has to split it, and the render walk has to paint the shadow
// below the icon.

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
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(makeExportCtx());
  // The export measures elements, so the icon and its shadow need real boxes.
  pinBox(marker.getElement()!, 100, 100, 20, 20);
  pinBox((marker as unknown as { _shadow: HTMLElement })._shadow, 90, 110, 40, 40);

  // render() resolves panes through the module-scoped @@map@@ free variable.
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
      // The controller is the map's LayerAPI — the same object the renderer
      // reads its pane host from.
      expect(map.foliplus!.LayerAPI).toBe(controller);

      // Pane coverage is unchanged: the controller reports the whole surface,
      // shadow carrier included — focus's lift (and the browser probe suite)
      // reads that same list.
      const raw = controller.getLayerPanes(group);
      expect(raw).toHaveLength(2);
      const shadowPane = `${raw[0]}-shadow`;
      expect(raw[1]).toBe(shadowPane);

      // The export still has to split them: this is the P1 shape — the API
      // names the shadow next to the content, and the resolver must produce a
      // shadow group instead of reading that name as "already content".
      const panes = new ExportRenderer(map as any).resolveExportPanes(group);
      expect(panes.shadows).toEqual([shadowPane]);
      expect(panes.content).toEqual([raw[0]]);
    } finally {
      map.remove();
    }
  });

  it("paints the marker's shadow before its icon", async () => {
    const { map, group, loads } = mountStack();
    try {
      const panes = new ExportRenderer(map as any).resolveExportPanes(group);
      const shadowPane = panes.shadows[0];
      expect(shadowPane).toBeTruthy();
      // The shadow really lives in that pane (the write #733 introduced).
      expect(map.getPane(shadowPane)!.querySelector("img")).toBeTruthy();

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
