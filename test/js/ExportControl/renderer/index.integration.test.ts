// ExportControl × LayerController integration — REAL Leaflet, REAL controller.
//
// The unit fixture in `index.test.ts` answers `getLayerPanes` with a hand-built
// list, and that is exactly how the P1 defect stayed invisible: the real
// controller reports the surface's whole pane set, shadow carrier included, so
// subtracting the shadow from that list emptied the shadow group.
// This file runs the production stack instead — `L.map` + `L.marker` +
// `L.layerGroup` over real Leaflet in jsdom, a real `LayerController` owning
// the panes and mounted as `map.foliplus.LayerAPI` — and asserts both halves of
// the contract: the API keeps reporting the shadow pane (focus's lift reads the
// same list), and the export splits it out and paints it before the icon.
import L from "leaflet";
import { ExportRenderer } from "#foliplus/ExportControl/renderer/index.js";
import * as UTIL from "#foliplus/ExportControl/util.js";
import { LayerController } from "#foliplus/LayerControl/controller.js";

// The mock window.L is swapped for the real library for this file only;
// production modules resolve L at call time, so the swap reaches them.
window.L = L as unknown as typeof window.L;

// index.ts binds its translator and logger to CONFIG.name at module-import
// time, so the name has to be set before the import resolves — vi.hoisted runs
// above the imports (setup.ts leaves it at "SearchControl").
vi.hoisted(() => {
  (window as any).CONFIG = { ...(window as any).CONFIG, name: "ExportControl" };
});

// loadImageBitmap is hoisted as a mock: the module exports are getters, so a
// plain vi.spyOn on it throws from inside pooledEach.
vi.mock("#foliplus/ExportControl/util.js", async () => {
  const actual = await vi.importActual<any>("#foliplus/ExportControl/util.js");
  const loadImageBitmap = vi.fn();
  return { ...actual, loadImageBitmap };
});

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  }) as DOMRect;

// Distinct 1x1 transparent PNG data URIs: data URLs survive jsdom unchanged,
// so the paint order can be read straight off the URL the pass loaded.
const ICON = "data:image/png;base64,AAAA";
const SHADOW = "data:image/png;base64,BBBB";

const makeCanvasCtx = () =>
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

interface Stack {
  map: L.Map;
  marker: L.Marker;
  group: L.LayerGroup;
  controller: LayerController;
  container: HTMLDivElement;
  loads: string[];
}

const mountStack = (): Stack => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  container.getBoundingClientRect = () => rect(0, 0, 1000, 1000);

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
    makeCanvasCtx() as any,
  );
  // The export measures elements, so the icon and its shadow need real boxes.
  marker.getElement()!.getBoundingClientRect = () => rect(100, 100, 20, 20);
  (marker as unknown as { _shadow: HTMLElement })._shadow.getBoundingClientRect = () =>
    rect(90, 110, 40, 40);

  // render() resolves panes through the module-scoped `map` free variable.
  Object.defineProperty(globalThis, "map", {
    configurable: true,
    writable: true,
    value: map,
  });
  return { map, marker, group, controller, container, loads };
};

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

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
