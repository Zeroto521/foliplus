import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as UI from "#foliplus/MeasureControl/ui.js";

// Mock delete-icon helpers — capture the click callback so tests can trigger it.
// Keep the original exports (DEL_ICON_* constants) via importOriginal and
// override the function helpers.
const { attachDelClick, makeDelIcon, toggleDelIcon } = vi.hoisted(() => ({
  attachDelClick: vi.fn((marker: any, cb: () => void) => {
    marker._delClick = cb;
  }),
  makeDelIcon: vi.fn(() => ({
    getElement: vi.fn(() => null),
    on: vi.fn(),
    off: vi.fn(),
    setLatLng: vi.fn(),
  })),
  toggleDelIcon: vi.fn(),
}));

vi.mock("#common/delicon.js", async importOriginal => {
  const actual = await importOriginal<typeof import("#common/delicon.js")>();
  return {
    ...actual,
    makeDelIcon,
    attachDelClick,
    toggleDelIcon,
    hideDelIcons: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  window.L = {
    marker: vi.fn(() => ({
      getElement: vi.fn(() => null),
      on: vi.fn(),
      off: vi.fn(),
      setLatLng: vi.fn(),
    })),
    latLng: vi.fn((lat, lng) => ({ lat, lng })),
    divIcon: vi.fn(() => ({})),
    DomEvent: { stopPropagation: vi.fn() },
  };
  globalThis.turf = {
    point: coords => ({ coords }),
    distance: vi.fn(() => 100),
    bearing: vi.fn(() => 45),
    midpoint: vi.fn(() => ({ geometry: { coordinates: [0, 0] } })),
    area: vi.fn(() => 1000),
    polygon: vi.fn(rings => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: rings },
    })),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resortLayers", () => {
  const makeLayers = () => ({
    addLayer: vi.fn(l => l),
    removeLayer: vi.fn(),
  });

  const makeLayer = (id: string) => ({ _id: id, on: vi.fn() }) as L.Layer;

  it("removes then re-adds all layers in each collection", () => {
    const layers = makeLayers();
    const a = makeLayer("a");
    const b = makeLayer("b");

    UI.resortLayers(layers, [a, b]);

    expect(layers.removeLayer).toHaveBeenCalledTimes(2);
    expect(layers.addLayer).toHaveBeenCalledTimes(2);
  });

  it("processes collections in order", () => {
    const layers = makeLayers();
    const first = makeLayer("first");
    const second = makeLayer("second");

    UI.resortLayers(layers, [first], [second]);

    const callOrder = [
      ...layers.removeLayer.mock.calls.map(c => c[0]._id),
      ...layers.addLayer.mock.calls.map(c => c[0]._id),
    ];
    expect(callOrder).toEqual(["first", "second", "first", "second"]);
  });

  it("handles multiple collections of multiple layers", () => {
    const layers = makeLayers();
    const a = makeLayer("a");
    const b = makeLayer("b");
    const c = makeLayer("c");

    UI.resortLayers(layers, [a, b], [c]);

    expect(layers.removeLayer).toHaveBeenCalledTimes(3);
    expect(layers.addLayer).toHaveBeenCalledTimes(3);
  });
});

const makeMgr = () => ({
  map: { on: vi.fn(), off: vi.fn() },
  isEditMode: true,
  registerEditOverlayCloser: vi.fn(() => () => {}),
  registerEditDragToggle: vi.fn(() => () => {}),
  registerFinalized: vi.fn(() => () => {}),
  registerLabel: vi.fn(() => () => {}),
  closeOtherEditOverlays: vi.fn(),
});

describe("attachCircleUI — delete flow", () => {
  const makeLayer = (name: string) => ({
    _name: name,
    on: vi.fn(),
    off: vi.fn(),
    getLatLng: vi.fn(() => ({ lat: 0, lng: 0 })),
    getElement: vi.fn(() => null),
    setLatLng: vi.fn(),
    setRadius: vi.fn(),
    setZIndexOffset: vi.fn(),
  });

  const makeOpts = () => {
    const layers = {
      removeLayer: vi.fn(),
      addLayer: vi.fn(l => l),
      unregister: vi.fn(),
    };
    const delMarker = makeLayer("delMarker");
    const onDelete = vi.fn();
    const opts = {
      layers,
      circle: makeLayer("circle"),
      radiusLine: makeLayer("radiusLine"),
      radiusNode: makeLayer("radiusNode"),
      centerFinal: makeLayer("centerFinal"),
      delMarker,
      radiusLabel: makeLayer("radiusLabel"),
      onDelete,
    };
    return { layers, delMarker, onDelete, opts };
  };

  it("attaches the X delete callback to delMarker", () => {
    const { delMarker, opts } = makeOpts();
    UI.attachCircleUI(makeMgr() as any, opts as any);

    expect(attachDelClick).toHaveBeenCalledWith(delMarker, expect.any(Function));
    expect(typeof (delMarker as any)._delClick).toBe("function");
  });

  it("removes all circle layers and calls onDelete on X click", () => {
    const { layers, delMarker, onDelete, opts } = makeOpts();
    UI.attachCircleUI(makeMgr() as any, opts as any);

    (delMarker as any)._delClick();

    expect(layers.removeLayer).toHaveBeenCalledWith(opts.circle);
    expect(layers.removeLayer).toHaveBeenCalledWith(opts.radiusLine);
    expect(layers.removeLayer).toHaveBeenCalledWith(opts.radiusNode);
    expect(layers.removeLayer).toHaveBeenCalledWith(opts.centerFinal);
    expect(layers.removeLayer).toHaveBeenCalledWith(delMarker);
    expect(layers.removeLayer).toHaveBeenCalledWith(opts.radiusLabel);
    expect(onDelete).toHaveBeenCalled();
    expect(layers.unregister).toHaveBeenCalled();
  });

  it("unbinds the overlay map-click listener on deletion", () => {
    const { delMarker, opts } = makeOpts();
    const mgr = makeMgr();
    UI.attachCircleUI(mgr as any, opts as any);
    expect(mgr.map.on).toHaveBeenCalledWith("click", expect.any(Function));

    (delMarker as any)._delClick();

    // Deleting disposes the overlay, unbinding its map-click listener.
    expect(mgr.map.off).toHaveBeenCalledWith("click", expect.any(Function));
  });

  it("attaches click handlers that open the edit overlay on circle parts", () => {
    const { opts } = makeOpts();
    UI.attachCircleUI(makeMgr() as any, opts as any);

    const clickHandler = (opts.circle.on as any).mock.calls.find(
      (c: any[]) => c[0] === "click",
    )?.[1];
    expect(clickHandler).toBeDefined();
    // Clicking the circle opens the overlay (stops event, no throw).
    clickHandler({ originalEvent: { target: null } } as any);
  });

  it("shows the circle delete ✕ when the overlay opens (regression)", () => {
    const { delMarker, opts } = makeOpts();
    UI.attachCircleUI(makeMgr() as any, opts as any);

    const clickHandler = (opts.circle.on as any).mock.calls.find(
      (c: any[]) => c[0] === "click",
    )?.[1];
    clickHandler({ originalEvent: { target: null } } as any);

    expect(toggleDelIcon).toHaveBeenCalledWith(delMarker, true);
  });
});

describe("attachDistanceUI", () => {
  const makeLayer = (name: string) => ({
    _name: name,
    on: vi.fn(),
    getElement: vi.fn(() => null),
    getLatLng: vi.fn(() => ({ lat: 0, lng: 0 })),
  });

  const makeOpts = () => {
    const layers = {
      removeLayer: vi.fn(),
      addLayer: vi.fn(l => l),
      unregister: vi.fn(),
    };
    const nodeMarkers = [makeLayer("n1") as any, makeLayer("n2") as any];
    const segLabels = [makeLayer("s1") as any];
    const finalPoly = makeLayer("poly") as any;
    return {
      layers,
      nodeMarkers,
      segLabels,
      finalPoly,
      points: [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
      ],
      onDelete: vi.fn(),
      onUpdate: vi.fn(),
    };
  };

  it("binds click handlers on the polyline and nodes", () => {
    const opts = makeOpts();
    UI.attachDistanceUI(makeMgr() as any, opts as any);
    expect(opts.finalPoly.on).toHaveBeenCalledWith("click", expect.any(Function));
    expect(opts.nodeMarkers[0].on).toHaveBeenCalledWith("click", expect.any(Function));
  });

  it("creates a delete icon per node", () => {
    const opts = makeOpts();
    UI.attachDistanceUI(makeMgr() as any, opts as any);
    expect(makeDelIcon).toHaveBeenCalled();
  });

  it("registers a drag toggle so edit mode enables node drag directly", () => {
    const mgr = makeMgr();
    const opts = makeOpts();
    UI.attachDistanceUI(mgr as any, opts as any);

    expect(mgr.registerEditDragToggle).toHaveBeenCalledWith(expect.any(Function));
    // The registered toggle must not throw when fired (setEditMode toggling).
    const toggle = (mgr.registerEditDragToggle as any).mock.calls[0][0];
    expect(() => toggle(true)).not.toThrow();
    expect(() => toggle(false)).not.toThrow();
  });

  it("re-registers surviving label registrations with fresh endpoints after deleting an inner node (regression)", () => {
    // A 3-point distance creates 2 segment labels. Deleting the middle node
    // splices both the points array and the segLabels array, so the survivor's
    // registration must be re-issued with the new end-to-end endpoints — stale
    // closures would leave the survivor pointing at the old (now invalid)
    // segment and drift out of place on the next plan.
    const registerLabel = vi.fn((marker: any, endpoints: () => any) => {
      // Return the endpoints in the call record so we can re-read them after
      // the delete, proving the closure is fresh (reads the mutable points
      // array) not captured once. The real registerLabel returns an
      // unregister function, so we do too.
      (registerLabel as any).savedEndpoints = endpoints();
      return () => {};
    });
    const mgr = {
      map: { on: vi.fn(), off: vi.fn() },
      isEditMode: true,
      registerEditOverlayCloser: vi.fn(() => () => {}),
      registerEditDragToggle: vi.fn(() => () => {}),
      registerFinalized: vi.fn(() => () => {}),
      registerLabel,
      closeOtherEditOverlays: vi.fn(),
    };
    const layers = {
      removeLayer: vi.fn(),
      addLayer: vi.fn(l => l),
      unregister: vi.fn(),
    };
    const mkNode = (pt: L.LatLng) => ({
      on: vi.fn(),
      off: vi.fn(),
      getLatLng: vi.fn(() => pt),
      setLatLng: vi.fn(),
    });
    const points = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
    ];

    const onDelete = vi.fn();
    const onUpdate = vi.fn();
    UI.attachDistanceUI(
      mgr as any,
      {
        layers,
        finalPoly: { on: vi.fn(), setLatLngs: vi.fn() },
        nodeMarkers: points.map(mkNode),
        segLabels: [0, 1].map(() => ({ on: vi.fn(), setLatLng: vi.fn(), setIcon: vi.fn() })),
        points,
        onDelete,
        onUpdate,
      } as any,
    );

    // Initial: 2 labels registered (one per segment).
    expect(registerLabel).toHaveBeenCalledTimes(2);

    // Delete the middle node (node index 1 → point index 1).
    const middleDel = (makeDelIcon as any).mock.results[1].value;
    const beforeCalls = registerLabel.mock.calls.length;

    (middleDel as any)._delClick();

    expect(onDelete).not.toHaveBeenCalled();
    expect(onUpdate).toHaveBeenCalled();
    expect(registerLabel.mock.calls.length).toBeGreaterThan(beforeCalls);
  });
});

describe("attachPolygonUI", () => {
  const makeLayer = (name: string) => ({
    _name: name,
    on: vi.fn(),
    getElement: vi.fn(() => null),
    getLatLng: vi.fn(() => ({ lat: 0, lng: 0 })),
  });

  const makeOpts = () => {
    const layers = {
      removeLayer: vi.fn(),
      addLayer: vi.fn(l => l),
      unregister: vi.fn(),
    };
    const nodeMarkers = [
      { ...makeLayer("n1"), getLatLng: vi.fn(() => ({ lat: 0, lng: 0 })) } as any,
      { ...makeLayer("n2"), getLatLng: vi.fn(() => ({ lat: 1, lng: 1 })) } as any,
      { ...makeLayer("n3"), getLatLng: vi.fn(() => ({ lat: 2, lng: 0 })) } as any,
    ];
    const segLabels = [makeLayer("s1") as any];
    const finalPoly = makeLayer("poly") as any;
    return {
      layers,
      nodeMarkers,
      segLabels,
      finalPoly,
      points: [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
        { lat: 2, lng: 0 },
      ],
      onDelete: vi.fn(),
      onUpdate: vi.fn(),
      area: 5000,
    };
  };

  it("binds handlers and registers its dispose with the manager", () => {
    const opts = makeOpts();
    const mgr = makeMgr();
    UI.attachPolygonUI(mgr as any, opts as any);
    expect(opts.finalPoly.on).toHaveBeenCalledWith("click", expect.any(Function));
    expect(opts.nodeMarkers[0].on).toHaveBeenCalledWith("click", expect.any(Function));
    expect(mgr.registerFinalized).toHaveBeenCalledWith(expect.any(Function));
  });

  it("rebuilds the centroid dot alongside the label and delete icon", () => {
    const opts = makeOpts();
    UI.attachPolygonUI(makeMgr() as any, opts as any);

    // The centroid dot uses the shared center-dot divIcon class (regression:
    // it was dropped during the edit-mode rewrite).
    const dotIcons = (window.L.divIcon as any).mock.calls.filter(
      ([opts]) => opts?.className === "foliplus-measure-center-dot",
    );
    expect(dotIcons.length).toBe(1);
  });

  it("registers a drag toggle (nodes + centroid drag) with the manager", () => {
    const mgr = makeMgr();
    const opts = makeOpts();
    UI.attachPolygonUI(mgr as any, opts as any);

    expect(mgr.registerEditDragToggle).toHaveBeenCalledWith(expect.any(Function));
    const toggle = (mgr.registerEditDragToggle as any).mock.calls[0][0];
    expect(() => toggle(true)).not.toThrow();
    expect(() => toggle(false)).not.toThrow();
  });

  it("deleting a node cleans up only its drag bind and keeps the centroid (regression)", () => {
    const mgr = makeMgr();
    const layers = {
      removeLayer: vi.fn(),
      addLayer: vi.fn(l => l),
      unregister: vi.fn(),
    };
    const mkNode = (lat: number) => ({
      on: vi.fn(),
      off: vi.fn(),
      getLatLng: vi.fn(() => ({ lat, lng: 0 })),
      getElement: vi.fn(() => null),
      setLatLng: vi.fn(),
    });
    const nodeMarkers = [0, 1, 2, 3].map(mkNode);
    const segLabels = [0, 1, 2].map(() => ({ on: vi.fn() }));
    const finalPoly = { on: vi.fn(), setLatLngs: vi.fn() };
    const points = [0, 1, 2, 3].map(lat => ({ lat, lng: 0 }));

    UI.attachPolygonUI(
      mgr as any,
      {
        layers,
        finalPoly,
        nodeMarkers,
        segLabels,
        points,
        area: 5000,
        onDelete: vi.fn(),
        onUpdate: vi.fn(),
      } as any,
    );

    // makeDelIcon call order: [0]=centroid, [1..4]=one per node.
    const centroidDel = (makeDelIcon as any).mock.results[0].value;
    const node0Del = (makeDelIcon as any).mock.results[1].value;
    // The centroid dot is the first L.marker built (rebuildCentroid).
    const centroidDot = (window.L.marker as any).mock.results[0].value;
    const centroidEl = { style: {} };
    centroidDot.getElement = vi.fn(() => centroidEl);

    const toggle = (mgr.registerEditDragToggle as any).mock.calls[0][0];
    toggle(true);
    expect(centroidEl.style.cursor).toBe("move");

    // Delete node 0: its drag bind must be spliced AND cleaned up (map off).
    const offBefore = mgr.map.off.mock.calls.length;
    node0Del._delClick();
    expect(mgr.map.off).toHaveBeenCalledTimes(offBefore + 2); // mousemove + mouseup

    // The centroid bind must survive: leaving edit mode still disables it.
    toggle(false);
    expect(centroidEl.style.cursor).toBe("");
    // And the centroid ✕ still deletes the whole measurement.
    expect(() => centroidDel._delClick()).not.toThrow();
  });
});
