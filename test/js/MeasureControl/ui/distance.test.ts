import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/MeasureControl/const.js";
import * as UI from "#foliplus/MeasureControl/ui/index.js";
import { installStubs, makeConf, makeMgr } from "./fixture.js";

const { attachDelClick, makeDelIcon, toggleDelIcon, realMakeDelIcon, dragHandlers } =
  vi.hoisted(() => ({
    attachDelClick: vi.fn((marker: any, cb: () => void) => {
      marker._delClick = cb;
    }),
    makeDelIcon: vi.fn((...args: any[]) => realMakeDelIcon.value(...args)),
    toggleDelIcon: vi.fn(),
    realMakeDelIcon: { value: null as any },
    dragHandlers: [] as Array<Record<string, (...args: any[]) => any>>,
  }));

vi.mock("#common/delicon.js", async importOriginal => {
  const actual = await importOriginal<typeof import("#common/delicon.js")>();
  realMakeDelIcon.value = actual.makeDelIcon;
  return {
    ...actual,
    makeDelIcon,
    attachDelClick,
    toggleDelIcon,
    hideDelIcons: vi.fn(),
  };
});

vi.mock("#foliplus/MeasureControl/edit.js", async importOriginal => {
  const actual =
    await importOriginal<typeof import("#foliplus/MeasureControl/edit.js")>();
  return {
    ...actual,
    bindNodeDrag: vi.fn((node: any, del: any, map: any, handlers: any) => {
      dragHandlers.push(handlers);
      return actual.bindNodeDrag(node, del, map, handlers);
    }),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  dragHandlers.length = 0;
  installStubs();
});

afterEach(() => {
  vi.restoreAllMocks();
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

    const lastDel = (makeDelIcon as any).mock.results[2].value as any;
    const iconEl = { title: "" };
    (lastDel.getElement as any).mockReturnValue(iconEl);

    const middleDel = (makeDelIcon as any).mock.results[1].value as any;
    (middleDel as any)._delClick();

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
    const toggle = (mgr.registerEditDragToggle as any).mock.calls[0][0];
    expect(() => toggle(true)).not.toThrow();
    expect(() => toggle(false)).not.toThrow();
  });

  it("keeps the overlay opener on the last endpoint's ✕ after collapsing to 2 points (regression)", () => {
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

    const middleDel = (makeDelIcon as any).mock.results[1].value as any;
    const lastDel = (makeDelIcon as any).mock.results[2].value as any;

    const postBindClickHandlers: Array<(e: any) => void> = [];
    (lastDel.on as any).mockImplementation((ev: string, fn: (e: any) => void) => {
      if (ev === "click") postBindClickHandlers.push(fn);
      return lastDel;
    });
    (lastDel.off as any).mockImplementation(() => lastDel);

    (middleDel as any)._delClick();

    expect(postBindClickHandlers.length).toBeGreaterThanOrEqual(1);

    for (const fn of postBindClickHandlers) {
      const nonXEvent = { originalEvent: { target: { closest: vi.fn(() => null) } } };
      expect(() => fn(nonXEvent)).not.toThrow();
    }
  });

  it("re-registers the correct number of labels after deleting an inner node (regression)", () => {
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

    expect(registerLabel).toHaveBeenCalledTimes(2);

    const middleDel = (makeDelIcon as any).mock.results[1].value;
    const beforeCalls = registerLabel.mock.calls.length;

    (middleDel as any)._delClick();

    expect(onDelete).not.toHaveBeenCalled();
    expect(onUpdate).toHaveBeenCalled();
    expect(registerLabel.mock.calls.length).toBeGreaterThan(beforeCalls);
  });

  it("gives the last segment label (the cumulative total) a higher priority than the others", () => {
    const registerLabel = vi.fn(() => () => {});
    const mkLabel = () => ({ on: vi.fn(), setLatLng: vi.fn(), setIcon: vi.fn() });
    const points = [0, 1, 2, 3].map(i => {
      return { lat: i, lng: i };
    });

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

    expect(registerLabel.mock.calls.map(c => c[1])).toEqual([
      CONST.LABEL_PRIORITY.SEGMENT,
      CONST.LABEL_PRIORITY.TOTAL,
    ]);

    (makeDelIcon.mock.results[1].value as any)._delClick();

    const lastCall = registerLabel.mock.calls.at(-1);
    expect(lastCall?.[1]).toBe(CONST.LABEL_PRIORITY.TOTAL);
  });
});

describe("attachDistanceUI — drag flow", () => {
  const mkNode = (pt: L.LatLng) => ({
    on: vi.fn(),
    off: vi.fn(),
    getLatLng: vi.fn(() => pt),
    setLatLng: vi.fn(),
  });

  const mkLabel = () => ({
    on: vi.fn(),
    setLatLng: vi.fn(),
    setIcon: vi.fn(),
  });

  it("translates the whole distance when dragging the first node", () => {
    const points = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
    ];
    const nodeMarkers = points.map(mkNode);
    const finalPoly = { on: vi.fn(), setLatLngs: vi.fn() };
    const layers = {
      removeLayer: vi.fn(),
      addLayer: vi.fn((l: any) => l),
      unregister: vi.fn(),
    };

    UI.attachDistanceUI(
      makeMgr() as any,
      {
        layers,
        finalPoly,
        nodeMarkers,
        segLabels: [mkLabel(), mkLabel()],
        points,
        id: "test-id",
        onDelete: vi.fn(),
        onUpdate: vi.fn(),
      } as any,
    );

    // dragHandlers[0] is the first node's drag (translate whole).
    dragHandlers[0]!.onDrag!({ lat: 5, lng: 5 });

    expect(points).toEqual([
      { lat: 5, lng: 5 },
      { lat: 6, lng: 6 },
      { lat: 7, lng: 7 },
    ]);
    expect(finalPoly.setLatLngs).toHaveBeenCalledWith(points);
    expect(nodeMarkers[0].setLatLng).toHaveBeenCalledWith({ lat: 5, lng: 5 });
    expect(nodeMarkers[1].setLatLng).toHaveBeenCalledWith({ lat: 6, lng: 6 });
    expect(nodeMarkers[2].setLatLng).toHaveBeenCalledWith({ lat: 7, lng: 7 });
  });

  it("updates only the dragged point when dragging a non-first node", () => {
    const points = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
    ];
    const finalPoly = { on: vi.fn(), setLatLngs: vi.fn() };

    UI.attachDistanceUI(
      makeMgr() as any,
      {
        layers: { removeLayer: vi.fn(), addLayer: vi.fn(l => l), unregister: vi.fn() },
        finalPoly,
        nodeMarkers: points.map(mkNode),
        segLabels: [mkLabel(), mkLabel()],
        points,
        id: "test-id",
        onDelete: vi.fn(),
        onUpdate: vi.fn(),
      } as any,
    );

    // dragHandlers[1] is the middle node's drag (single-point update).
    dragHandlers[1]!.onDrag!({ lat: 3, lng: 3 });

    expect(points).toEqual([
      { lat: 0, lng: 0 },
      { lat: 3, lng: 3 },
      { lat: 2, lng: 2 },
    ]);
    expect(finalPoly.setLatLngs).toHaveBeenCalledWith(points);
  });

  it("fires onUpdate from onEnd after dragging the first node", () => {
    const points = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 1 },
    ];
    const onUpdate = vi.fn();

    UI.attachDistanceUI(
      makeMgr() as any,
      {
        layers: { removeLayer: vi.fn(), addLayer: vi.fn(l => l), unregister: vi.fn() },
        finalPoly: { on: vi.fn(), setLatLngs: vi.fn() },
        nodeMarkers: points.map(mkNode),
        segLabels: [mkLabel()],
        points,
        id: "test-id",
        onDelete: vi.fn(),
        onUpdate,
      } as any,
    );

    dragHandlers[0]!.onEnd!({ lat: 5, lng: 5 });

    expect(onUpdate).toHaveBeenCalledWith(points);
  });

  it("fires onUpdate from onEnd after dragging a non-first node", () => {
    const points = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
    ];
    const onUpdate = vi.fn();

    UI.attachDistanceUI(
      makeMgr() as any,
      {
        layers: { removeLayer: vi.fn(), addLayer: vi.fn(l => l), unregister: vi.fn() },
        finalPoly: { on: vi.fn(), setLatLngs: vi.fn() },
        nodeMarkers: points.map(mkNode),
        segLabels: [mkLabel(), mkLabel()],
        points,
        id: "test-id",
        onDelete: vi.fn(),
        onUpdate,
      } as any,
    );

    dragHandlers[1]!.onEnd!({ lat: 9, lng: 9 });

    expect(onUpdate).toHaveBeenCalledWith(points);
  });
});

describe("attachDistanceUI — whole-distance delete flow", () => {
  it("runs the dispose body and removes the whole measurement on del-all ✕ click", () => {
    const points = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 1 },
    ];
    const mgr = makeMgr();
    const finalPoly = { on: vi.fn(), setLatLngs: vi.fn() };
    const nodeMarkers = points.map(
      pt =>
        ({
          on: vi.fn(),
          off: vi.fn(),
          getLatLng: vi.fn(() => pt),
          setLatLng: vi.fn(),
        }) as any,
    );
    const segLabels = [
      {
        on: vi.fn(),
        setLatLng: vi.fn(),
        setIcon: vi.fn(),
      } as any,
    ];
    const registerLabel = vi.fn(() => vi.fn(() => {}));
    const layers = {
      removeLayer: vi.fn(),
      addLayer: vi.fn(l => l),
      unregister: vi.fn(),
    };

    UI.attachDistanceUI(
      { ...mgr, registerLabel } as any,
      {
        layers,
        finalPoly,
        nodeMarkers,
        segLabels,
        points,
        id: "test-id",
        onDelete: vi.fn(),
        onUpdate: vi.fn(),
      } as any,
    );

    // With 2 points, both endpoints are del-all. Clicking either triggers
    // deleteMeasurement, which runs dispose() → dragBinds[i].cleanup() +
    // unregisterSegLabels() + unregisterDragToggle().
    const firstEndpointDel = (makeDelIcon as any).mock.results[0].value as any;
    (firstEndpointDel as any)._delClick();

    expect(registerLabel).toHaveBeenCalled();
    // dispose's removeLayers fans out to finalPoly + nodes + segLabels + delMarkers.
    // The last call is the fan-out (resortLayers' per-layer calls came first).
    const removedArgs = (layers.removeLayer.mock.calls.at(-1) ?? []) as any[];
    expect(removedArgs).toContain(finalPoly);
    expect(removedArgs).toContain(nodeMarkers[0]);
    expect(removedArgs).toContain(segLabels[0]);
    expect(layers.unregister).toHaveBeenCalled();
  });
});
