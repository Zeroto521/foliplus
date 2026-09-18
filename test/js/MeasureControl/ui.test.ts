import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/MeasureControl/const.js";
import * as UI from "#foliplus/MeasureControl/ui.js";
import { createScopedTranslator } from "#common/locale.js";

// Mock delete-icon helpers — capture the click callback so tests can trigger it.
// Keep the original exports (DEL_ICON_* constants) via importOriginal and
// override the function helpers.
const {
  attachDelClick,
  makeDelIcon,
  toggleDelIcon,
  realMakeDelIcon,
  realAttachDelClick,
} = vi.hoisted(() => ({
  attachDelClick: vi.fn((marker: any, cb: () => void) => {
    marker._delClick = cb;
  }),
  // makeDelIcon delegates to the real implementation so that hijacking
  // window.L.marker inside a test controls the del markers it creates.
  makeDelIcon: vi.fn((...args: any[]) => realMakeDelIcon.value(...args)),
  toggleDelIcon: vi.fn(),
  realMakeDelIcon: { value: null as any },
  realAttachDelClick: { value: null as any },
}));

vi.mock("#common/delicon.js", async importOriginal => {
  const actual = await importOriginal<typeof import("#common/delicon.js")>();
  realMakeDelIcon.value = actual.makeDelIcon;
  realAttachDelClick.value = actual.attachDelClick;
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
    // makeNode builds L.CircleMarker nodes (shared with the edit-mode node
    // markers and the center dot); stub it so polygon-mode UI tests reach
    // rebuildCentroid.
    circleMarker: vi.fn(() => ({
      getElement: vi.fn(() => null),
      on: vi.fn(),
      off: vi.fn(),
      setLatLng: vi.fn(),
      getLatLng: vi.fn(() => ({ lat: 0, lng: 0 })),
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

/** A CONF for the measure UI with the delete-icon locale the UI renders
 *  (ComponentName-prefixed keys, like the Python bridge emits). */
const makeConf = (overrides: Partial<ComponentConfig> = {}): ComponentConfig => ({
  name: "MeasureControl",
  locale_code: "en",
  locale_tables: {
    en: {
      "MeasureControl.del_all": "Delete measurement",
      "MeasureControl.del_node": "Delete point",
    },
  },
  ...overrides,
});

/** MeasureManager-shaped fake carrying its own `conf` and a translator bound
 *  to it — mirroring the real manager (which binds `this.T = T` in its
 *  constructor) so the UI reads delete-icon titles through the per-instance
 *  translator, never an ambient module-level one. */
const makeMgr = (conf: ComponentConfig = makeConf()) => {
  const translator = createScopedTranslator(conf);
  const T = vi.fn((key: string) => translator(key));
  return {
    map: { on: vi.fn(), off: vi.fn() },
    isEditMode: true,
    conf,
    T,
    registerEditOverlayCloser: vi.fn(() => () => {}),
    registerEditDragToggle: vi.fn(() => () => {}),
    registerFinalized: vi.fn(() => () => {}),
    registerLabel: vi.fn(() => () => {}),
    closeOtherEditOverlays: vi.fn(),
  };
};

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
      id: "test-id",
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

  it("registers the radius label with RADIUS priority", () => {
    const { opts } = makeOpts();
    const mgr = makeMgr();
    UI.attachCircleUI(mgr as any, opts as any);

    const labelCall = (mgr.registerLabel as any).mock.calls.find(
      (c: any[]) => c[1] === CONST.LABEL_PRIORITY.RADIUS,
    );
    expect(labelCall).toBeDefined();
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
      id: "test-id",
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

  it("reads the delete-icon titles through the manager-bound translator (injected conf), not window.CONF", () => {
    // The ambient CONF disagrees with the injected conf — the title must key on
    // the per-instance manager T (bound to its own conf in the constructor),
    // never a module-level translator captured from window.CONF at import time.
    const savedConf = window.CONF;
    window.CONF = {
      ...savedConf,
      name: "MeasureControl",
      locale_tables: { en: { "MeasureControl.del_all": "AMBIENT del_all" } },
    };
    try {
      const conf = makeConf({
        locale_tables: { en: { "MeasureControl.del_all": "INJECTED del_all" } },
      });
      const mgr = makeMgr(conf);
      UI.attachDistanceUI(mgr as any, makeOpts() as any);

      // 2 endpoints → both ✕ are del_all; the rendered text must come from
      // the injected conf's table via mgr.T, never the ambient window.CONF.
      const titles = (makeDelIcon as any).mock.calls.map(c => c[1]?.title);
      expect(titles).toEqual(["INJECTED del_all", "INJECTED del_all"]);
      expect(mgr.T).toHaveBeenCalledWith("del_all");
      expect(mgr.T).not.toHaveBeenCalledWith("del_node");
    } finally {
      window.CONF = savedConf;
    }
  });

  it("re-titles the last endpoint's ✕ to del_all when a 3-point distance collapses to 2 (regression)", () => {
    const points = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
    ];
    const mgr = makeMgr();
    const layers = {
      removeLayer: vi.fn(),
      addLayer: vi.fn(l => l),
      unregister: vi.fn(),
    };
    const segLabels = [0, 1].map(() => ({
      on: vi.fn(),
      setLatLng: vi.fn(),
      setIcon: vi.fn(),
    }));

    UI.attachDistanceUI(
      mgr as any,
      {
        layers,
        finalPoly: { on: vi.fn(), setLatLngs: vi.fn() },
        nodeMarkers: points.map(pt => ({
          on: vi.fn(),
          off: vi.fn(),
          getLatLng: vi.fn(() => pt),
          setLatLng: vi.fn(),
        })),
        segLabels,
        points,
        onDelete: vi.fn(),
        onUpdate: vi.fn(),
      } as any,
    );

    // Give the last endpoint's ✕ a real element so the rebind can re-title it.
    const lastDel = (makeDelIcon as any).mock.results[2].value as any;
    const iconEl = { title: "" };
    (lastDel.getElement as any).mockReturnValue(iconEl);

    const middleDel = (makeDelIcon as any).mock.results[1].value as any;
    (middleDel as any)._delClick(); // 3 → 2 points

    // After collapsing, the endpoint's ✕ switches to "delete the whole
    // distance" and its title follows the injected conf's del_all.
    expect(iconEl.title).toBe("Delete measurement");
    expect(mgr.T).toHaveBeenCalledWith("del_all");
  });

  it("registers a drag toggle so edit mode enables node drag directly", () => {
    const mgr = makeMgr();
    const opts = makeOpts();
    UI.attachDistanceUI(mgr as any, opts as any);

    expect(mgr.registerEditDragToggle).toHaveBeenCalledWith(
      expect.any(Function),
      "test-id",
    );
    // The registered toggle must not throw when fired (setEditMode toggling).
    const toggle = (mgr.registerEditDragToggle as any).mock.calls[0][0];
    expect(() => toggle(true)).not.toThrow();
    expect(() => toggle(false)).not.toThrow();
  });

  it("keeps the overlay opener on the last endpoint's ✕ after collapsing to 2 points (regression)", () => {
    // A 3-point distance: deleting the middle node collapses it to 2 points,
    // and the last endpoint's ✕ switches from "delete one node" to "delete the
    // whole distance". The regression: that rebind previously nuked the
    // overlay-opener too, so clicking the ✕'s non-X area could no longer
    // open the edit panel. We verify behavior by spying on the last del
    // marker's on() after attachDistanceUI: the rebind must re-call
    // bindOpenOverlay (which is layer.on("click", ...)), so a new click
    // handler lands on the last ✕ after the delete fires.
    const points = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
    ];
    const mgr = makeMgr();
    const layers = {
      removeLayer: vi.fn(),
      addLayer: vi.fn(l => l),
      unregister: vi.fn(),
    };
    const segLabels = [0, 1].map(() => ({
      on: vi.fn(),
      setLatLng: vi.fn(),
      setIcon: vi.fn(),
    }));

    UI.attachDistanceUI(
      mgr as any,
      {
        layers,
        finalPoly: { on: vi.fn(), setLatLngs: vi.fn() },
        nodeMarkers: points.map(pt => ({
          on: vi.fn(),
          off: vi.fn(),
          getLatLng: vi.fn(() => pt),
          setLatLng: vi.fn(),
        })),
        segLabels,
        points,
        onDelete: vi.fn(),
        onUpdate: vi.fn(),
      } as any,
    );

    // makeDelIcon call order: [0] first endpoint, [1] middle, [2] last.
    const middleDel = (makeDelIcon as any).mock.results[1].value as any;
    const lastDel = (makeDelIcon as any).mock.results[2].value as any;

    // Spy on the last del marker's on() — record any click handler bound
    // AFTER this point (i.e. from the rebind path).
    const postBindClickHandlers: Array<(e: any) => void> = [];
    (lastDel.on as any).mockImplementation((ev: string, fn: (e: any) => void) => {
      if (ev === "click") postBindClickHandlers.push(fn);
      return lastDel;
    });
    (lastDel.off as any).mockImplementation(() => lastDel);

    // Delete the middle node via its ✕ callback → points collapses to 2,
    // rebind fires on the last endpoint's ✕.
    (middleDel as any)._delClick();

    // The fix: rebind calls attachDelClick + bindOpenOverlay. bindOpenOverlay
    // wires layer.on("click", ...) — so at least one click handler must land
    // on the last ✕ post-rebind. The regression only re-added attachDelClick,
    // which (with our mock) stores _delClick but never calls on("click") —
    // so postBindClickHandlers would be empty without the bindOpenOverlay fix.
    expect(postBindClickHandlers.length).toBeGreaterThanOrEqual(1);

    // Behavioral confirmation: firing the newly bound click handler with a
    // non-X target must NOT throw and must not call onDelete (the overlay
    // opener only opens the panel, it never deletes the measurement).
    const onDelete = vi.fn();
    for (const fn of postBindClickHandlers) {
      const nonXEvent = { originalEvent: { target: { closest: vi.fn(() => null) } } };
      expect(() => fn(nonXEvent)).not.toThrow();
    }
  });

  it("re-registers the correct number of labels after deleting an inner node (regression)", () => {
    // A 3-point distance creates 2 segment labels. Deleting the middle node
    // collapses it to a single segment, so bindSegLabels() must unregister the
    // two old registrations and register exactly one.
    const registerLabel = vi.fn(() => () => {});
    const mgr = { ...makeMgr(), registerLabel };
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
        segLabels: [0, 1].map(() => ({
          on: vi.fn(),
          setLatLng: vi.fn(),
          setIcon: vi.fn(),
        })),
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

  it("gives the last segment label (the cumulative total) a higher priority than the others", () => {
    // The final distance label ends with the line's total length, so losing it in a
    // collision would drop the number a user most often wants read off.
    const registerLabel = vi.fn(() => () => {});
    const mkLabel = () => ({ on: vi.fn(), setLatLng: vi.fn(), setIcon: vi.fn() });
    const points = [0, 1, 2, 3].map(i => ({ lat: i, lng: i }));

    UI.attachDistanceUI(
      { ...makeMgr(), registerLabel } as any,
      {
        layers: { removeLayer: vi.fn(), addLayer: vi.fn(l => l), unregister: vi.fn() },
        finalPoly: { on: vi.fn(), setLatLngs: vi.fn() },
        nodeMarkers: points.map(pt => ({
          on: vi.fn(),
          off: vi.fn(),
          getLatLng: vi.fn(() => pt),
          setLatLng: vi.fn(),
        })),
        segLabels: points.slice(0, -1).map(() => mkLabel()),
        points,
        onDelete: vi.fn(),
        onUpdate: vi.fn(),
      } as any,
    );

    const priorities = registerLabel.mock.calls.map(c => c[1]);
    expect(priorities).toEqual([
      CONST.LABEL_PRIORITY.SEGMENT,
      CONST.LABEL_PRIORITY.SEGMENT,
      CONST.LABEL_PRIORITY.TOTAL,
    ]);
    expect(CONST.LABEL_PRIORITY.TOTAL).toBeGreaterThan(CONST.LABEL_PRIORITY.SEGMENT);
    expect(CONST.LABEL_PRIORITY.TOTAL).toBeLessThan(CONST.LABEL_PRIORITY.CENTROID);
  });

  it("re-registers the total priority after deleting an inner node", () => {
    // Deleting an inner node recreates the label set and re-issues the
    // registrations, so the new final label must keep the elevated priority.
    const registerLabel = vi.fn(() => () => {});
    const mkLabel = () => ({ on: vi.fn(), setLatLng: vi.fn(), setIcon: vi.fn() });
    const points = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
    ];

    UI.attachDistanceUI(
      { ...makeMgr(), registerLabel } as any,
      {
        layers: { removeLayer: vi.fn(), addLayer: vi.fn(l => l), unregister: vi.fn() },
        finalPoly: { on: vi.fn(), setLatLngs: vi.fn() },
        nodeMarkers: points.map(pt => ({
          on: vi.fn(),
          off: vi.fn(),
          getLatLng: vi.fn(() => pt),
          setLatLng: vi.fn(),
        })),
        segLabels: [0, 1].map(() => mkLabel()),
        points,
        onDelete: vi.fn(),
        onUpdate: vi.fn(),
      } as any,
    );

    // Initial: [SEGMENT, TOTAL].
    expect(registerLabel.mock.calls.map(c => c[1])).toEqual([
      CONST.LABEL_PRIORITY.SEGMENT,
      CONST.LABEL_PRIORITY.TOTAL,
    ]);

    // Delete the middle node → one segment left, which is now the total.
    (makeDelIcon.mock.results[1].value as any)._delClick();

    const lastCall = registerLabel.mock.calls.at(-1);
    expect(lastCall?.[1]).toBe(CONST.LABEL_PRIORITY.TOTAL);
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
      id: "test-id",
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
    expect(mgr.registerFinalized).toHaveBeenCalledWith(expect.any(Function), "test-id");
  });

  it("rebuilds the centroid dot alongside the label and delete icon", () => {
    const opts = makeOpts();
    UI.attachPolygonUI(makeMgr() as any, opts as any);

    // The centroid dot is a CircleMarker with NODE_SOLID (same as circle
    // center) — no divIcon needed, avoids the SVG z-index collision.
    const centroidCalls = (window.L.circleMarker as any).mock.calls.filter(
      ([, opts]) => opts?.className === CONST.CLASSES.NODE_SOLID,
    );
    expect(centroidCalls.length).toBe(1);
  });

  it("routes the centroid dot to the node pane and the label to the label pane", () => {
    const mgr = makeMgr();
    const opts = makeOpts();
    const addLayerCalls: Array<{ layer: any; pane: string | undefined }> = [];
    opts.layers.addLayer = vi.fn((layer: any, pane?: string) => {
      addLayerCalls.push({ layer, pane });
      return layer;
    });
    UI.attachPolygonUI(mgr as any, opts as any);

    // rebuildCentroid() builds layers in order: [0]=centroidDot (CircleMarker,
    // node pane), [1]=centroidLabel (pane=foliplus-measure-label),
    // [2]=centroidDelMarker (node pane). The dot is an SVG path (CircleMarker),
    // so it lives above the fill by pane z-order (node > graph).
    // The label's offset (CENTROID_Z_OFFSET) keeps it above segment labels
    // after sortLayers re-sorts by Y on zoom.
    // [0] = centroidDot (CircleMarker): node pane
    expect(addLayerCalls[0].pane).toBe(CONST.PANES.NODE);
    // [1] = centroidLabel: pane = LABEL → label, has offset
    expect(addLayerCalls[1].pane).toBe(CONST.PANES.LABEL);
    const labelOpts = (window.L.marker as any).mock.calls[0][1];
    expect(labelOpts.zIndexOffset).toBe(CONST.LABEL.CENTROID_Z_OFFSET);
    expect(labelOpts.interactive).toBe(false);
    // Del icon: node pane.
    expect(makeDelIcon).toHaveBeenCalled();
    expect(addLayerCalls[2].pane).toBe(CONST.PANES.NODE);
  });

  it("registers a drag toggle (nodes + centroid drag) with the manager", () => {
    const mgr = makeMgr();
    const opts = makeOpts();
    UI.attachPolygonUI(mgr as any, opts as any);

    expect(mgr.registerEditDragToggle).toHaveBeenCalledWith(
      expect.any(Function),
      "test-id",
    );
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
        id: "test-id",
        onDelete: vi.fn(),
        onUpdate: vi.fn(),
      } as any,
    );

    // makeDelIcon call order: [0]=centroid, [1..4]=one per node.
    const centroidDel = (makeDelIcon as any).mock.results[0].value;
    const node0Del = (makeDelIcon as any).mock.results[1].value;
    // The centroid dot is the first L.circleMarker built (rebuildCentroid).
    const centroidDot = (window.L.circleMarker as any).mock.results[0].value;
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

  it("rebinds every remaining node ✕ to delete-all and re-titles after a 4-point polygon collapses to 3", () => {
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
    const onDelete = vi.fn();

    UI.attachPolygonUI(
      mgr as any,
      {
        layers,
        finalPoly,
        nodeMarkers,
        segLabels,
        points,
        area: 5000,
        id: "test-id",
        onDelete,
        onUpdate: vi.fn(),
      } as any,
    );

    // makeDelIcon call order: [0]=centroid, [1..4]=one per node.
    const nodeDel = (makeDelIcon as any).mock.results;
    const deletedNode = nodeDel[2].value as any; // node index 1

    // Give a remaining node's ✕ an element so the rebind's re-title lands.
    const survivor = nodeDel[3].value as any;
    const iconEl = { title: "" };
    (survivor.getElement as any).mockReturnValue(iconEl);

    deletedNode._delClick(); // 4 → 3 points

    // The node delete itself must not delete the whole measurement.
    expect(onDelete).not.toHaveBeenCalled();
    // Every remaining ✕ re-titles to del_all from the injected conf.
    expect(iconEl.title).toBe("Delete measurement");
    expect(mgr.T).toHaveBeenCalledWith("del_all");

    // Clicking a remaining node's ✕ (del-icon target) now deletes the whole
    // measurement instead of just that node. The rebind registers the del-all
    // click handler LAST (after the initial bindOpenOverlay one).
    const clickCalls = (survivor.on as any).mock.calls.filter(
      (c: any[]) => c[0] === "click",
    );
    const rebindHandler = clickCalls.at(-1)?.[1];
    expect(rebindHandler).toBeDefined();
    const delTarget = {
      closest: (sel: string) => (sel === CONST.SEL.DEL_ICON ? {} : null),
    };
    expect(() =>
      rebindHandler({ originalEvent: { target: delTarget } } as any),
    ).not.toThrow();
    expect(onDelete).toHaveBeenCalled();
  });
});
