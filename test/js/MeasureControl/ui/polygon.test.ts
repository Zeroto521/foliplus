import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/MeasureControl/const.js";
import * as UI from "#foliplus/MeasureControl/ui/index.js";
import { installStubs, makeMgr } from "./fixture.js";

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

    const centroidCalls = (window.L.circleMarker as any).mock.calls.filter(
      ([, opts]: any[]) => opts?.className === CONST.CLASSES.NODE_SOLID,
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

    expect(addLayerCalls[0].pane).toBe(CONST.PANES.NODE);
    expect(addLayerCalls[1].pane).toBe(CONST.PANES.LABEL);
    const labelOpts = (window.L.marker as any).mock.calls[0][1];
    expect(labelOpts.zIndexOffset).toBe(CONST.LABEL.CENTROID_Z_OFFSET);
    expect(labelOpts.interactive).toBe(false);
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

    const centroidDel = (makeDelIcon as any).mock.results[0].value;
    const node0Del = (makeDelIcon as any).mock.results[1].value;
    const centroidDot = (window.L.circleMarker as any).mock.results[0].value;
    const centroidEl = { style: {} };
    centroidDot.getElement = vi.fn(() => centroidEl);

    const toggle = (mgr.registerEditDragToggle as any).mock.calls[0][0];
    toggle(true);
    expect(centroidEl.style.cursor).toBe("move");

    const offBefore = mgr.map.off.mock.calls.length;
    node0Del._delClick();
    expect(mgr.map.off).toHaveBeenCalledTimes(offBefore + 2);

    toggle(false);
    expect(centroidEl.style.cursor).toBe("");
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

    const nodeDel = (makeDelIcon as any).mock.results;
    const deletedNode = nodeDel[2].value as any;

    const survivor = nodeDel[3].value as any;
    const iconEl = { title: "" };
    (survivor.getElement as any).mockReturnValue(iconEl);

    deletedNode._delClick();

    expect(onDelete).not.toHaveBeenCalled();
    expect(iconEl.title).toBe("Delete measurement");
    expect(mgr.T).toHaveBeenCalledWith("del_all");

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

describe("attachPolygonUI — overlay open/close", () => {
  it("shows delete icons on nodes and centroid when the overlay opens", () => {
    const points = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 1 },
      { lat: 2, lng: 0 },
      { lat: 3, lng: 1 },
    ];
    const mkNode = (pt: L.LatLng) => ({
      on: vi.fn(),
      off: vi.fn(),
      getLatLng: vi.fn(() => pt),
      getElement: vi.fn(() => null),
      setLatLng: vi.fn(),
    });
    const finalPoly = { on: vi.fn(), setLatLngs: vi.fn() };

    UI.attachPolygonUI(
      makeMgr() as any,
      {
        layers: { removeLayer: vi.fn(), addLayer: vi.fn(l => l), unregister: vi.fn() },
        finalPoly,
        nodeMarkers: points.map(mkNode),
        segLabels: [0, 1, 2].map(() => ({ on: vi.fn() })),
        points,
        area: 5000,
        id: "test-id",
        onDelete: vi.fn(),
        onUpdate: vi.fn(),
      } as any,
    );

    // Trigger open by clicking the final polygon.
    const openClick = (finalPoly.on as any).mock.calls.find(
      (c: any[]) => c[0] === "click",
    )?.[1];
    openClick({ originalEvent: { target: null } } as any);

    // 4 nodes + 1 centroid = 5 toggleDelIcon(m, true) calls.
    expect(toggleDelIcon).toHaveBeenCalledTimes(5);
    for (const call of toggleDelIcon.mock.calls) {
      expect(call[1]).toBe(true);
    }
  });

  it("hides delete icons on nodes and centroid when the overlay closes", () => {
    const mgr = makeMgr();
    const points = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 1 },
      { lat: 2, lng: 0 },
      { lat: 3, lng: 1 },
    ];
    const mkNode = (pt: L.LatLng) => ({
      on: vi.fn(),
      off: vi.fn(),
      getLatLng: vi.fn(() => pt),
      getElement: vi.fn(() => null),
      setLatLng: vi.fn(),
    });
    const finalPoly = { on: vi.fn(), setLatLngs: vi.fn() };
    const layers = {
      removeLayer: vi.fn(),
      addLayer: vi.fn(l => l),
      unregister: vi.fn(),
    };
    const nodeMarkers = points.map(mkNode);

    UI.attachPolygonUI(
      mgr as any,
      {
        layers,
        finalPoly,
        nodeMarkers,
        segLabels: [0, 1, 2].map(() => ({ on: vi.fn() })),
        points,
        area: 5000,
        id: "test-id",
        onDelete: vi.fn(),
        onUpdate: vi.fn(),
      } as any,
    );

    // Open first.
    const openClick = (finalPoly.on as any).mock.calls.find(
      (c: any[]) => c[0] === "click",
    )?.[1];
    openClick({ originalEvent: { target: null } } as any);
    // Now close via the map-click (empty space).
    const mapClick = mgr.map.on.mock.calls.find((c: any[]) => c[0] === "click")?.[1];
    mapClick({ originalEvent: { target: null } } as any);

    // Each toggleDelIcon(m, false) call — 5 total (4 nodes + centroid).
    const falseCalls = toggleDelIcon.mock.calls.filter(([, v]: any[]) => v === false);
    expect(falseCalls.length).toBe(5);
  });

  it("rebind handler opens the overlay on non-del-icon clicks", () => {
    const mgr = makeMgr();
    const points = [0, 1, 2, 3].map(lat => ({ lat, lng: 0 }));
    const mkNode = (pt: L.LatLng) => ({
      on: vi.fn(),
      off: vi.fn(),
      getLatLng: vi.fn(() => pt),
      getElement: vi.fn(() => null),
      setLatLng: vi.fn(),
    });
    const nodeMarkers = points.map(mkNode);

    UI.attachPolygonUI(
      mgr as any,
      {
        layers: { removeLayer: vi.fn(), addLayer: vi.fn(l => l), unregister: vi.fn() },
        finalPoly: { on: vi.fn(), setLatLngs: vi.fn() },
        nodeMarkers,
        segLabels: [0, 1, 2].map(() => ({ on: vi.fn() })),
        points,
        area: 5000,
        id: "test-id",
        onDelete: vi.fn(),
        onUpdate: vi.fn(),
      } as any,
    );

    // Delete a node to trigger the 4→3 rebind.
    const deletedNode = (makeDelIcon as any).mock.results[2].value as any;
    const survivor = (makeDelIcon as any).mock.results[3].value as any;

    deletedNode._delClick();

    // The rebind handler is the LAST click handler bound to the survivor.
    const rebindHandler = (survivor.on as any).mock.calls
      .filter((c: any[]) => c[0] === "click")
      .at(-1)?.[1];
    expect(rebindHandler).toBeDefined();

    // With a non-del target, openOverlay must run (else branch).
    const nonDelTarget = {
      closest: (sel: string) => (sel === CONST.SEL.DEL_ICON ? null : null),
    };
    // isEditMode must be true for openOverlay to actually open.
    expect(mgr.isEditMode).toBe(true);
    // Count toggleDelIcon calls before/after firing — openOverlay triggers onOpen
    // which shows the del icons.
    const beforeCalls = toggleDelIcon.mock.calls.length;
    rebindHandler({ originalEvent: { target: nonDelTarget } } as any);
    // onOpen calls toggleDelIcon(m, true) for 2 remaining nodes + centroid = 3.
    expect(toggleDelIcon.mock.calls.length).toBeGreaterThan(beforeCalls);
  });
});

describe("attachPolygonUI — drag flow", () => {
  const mkNode = (pt: L.LatLng) => ({
    on: vi.fn(),
    off: vi.fn(),
    getLatLng: vi.fn(() => pt),
    getElement: vi.fn(() => null),
    setLatLng: vi.fn(),
  });

  it("updates only the dragged point when dragging a polygon node", () => {
    const points = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 1 },
      { lat: 2, lng: 0 },
      { lat: 3, lng: 1 },
    ];
    const finalPoly = { on: vi.fn(), setLatLngs: vi.fn() };

    UI.attachPolygonUI(
      makeMgr() as any,
      {
        layers: { removeLayer: vi.fn(), addLayer: vi.fn(l => l), unregister: vi.fn() },
        finalPoly,
        nodeMarkers: points.map(mkNode),
        segLabels: [0, 1, 2, 3].map(() => ({ on: vi.fn() })),
        points,
        area: 5000,
        id: "test-id",
        onDelete: vi.fn(),
        onUpdate: vi.fn(),
      } as any,
    );

    // dragHandlers order: [0..n-1] = one per node, [n] = centroid.
    dragHandlers[1]!.onDrag!({ lat: 9, lng: 9 });

    expect(points).toEqual([
      { lat: 0, lng: 0 },
      { lat: 9, lng: 9 },
      { lat: 2, lng: 0 },
      { lat: 3, lng: 1 },
    ]);
    expect(finalPoly.setLatLngs).toHaveBeenCalledWith(points);
  });

  it("calls onUpdate from the node drag onEnd", () => {
    const points = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 1 },
      { lat: 2, lng: 0 },
      { lat: 3, lng: 1 },
    ];
    const onUpdate = vi.fn();

    UI.attachPolygonUI(
      makeMgr() as any,
      {
        layers: { removeLayer: vi.fn(), addLayer: vi.fn(l => l), unregister: vi.fn() },
        finalPoly: { on: vi.fn(), setLatLngs: vi.fn() },
        nodeMarkers: points.map(mkNode),
        segLabels: [0, 1, 2, 3].map(() => ({ on: vi.fn() })),
        points,
        area: 5000,
        id: "test-id",
        onDelete: vi.fn(),
        onUpdate,
      } as any,
    );

    dragHandlers[0]!.onEnd!({ lat: 5, lng: 5 });

    expect(onUpdate).toHaveBeenCalled();
  });

  it("translates the whole polygon when dragging the centroid", () => {
    const points = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 1 },
      { lat: 2, lng: 0 },
    ];
    const nodeMarkers: any[] = points.map(pt => ({
      ...mkNode(pt),
      setLatLng: vi.fn(),
    }));
    UI.attachPolygonUI(
      makeMgr() as any,
      {
        layers: { removeLayer: vi.fn(), addLayer: vi.fn(l => l), unregister: vi.fn() },
        finalPoly: { on: vi.fn(), setLatLngs: vi.fn() },
        nodeMarkers,
        segLabels: [0, 1, 2].map(() => ({ on: vi.fn() })),
        points,
        area: 5000,
        id: "test-id",
        onDelete: vi.fn(),
        onUpdate: vi.fn(),
      } as any,
    );

    // The centroid dot is the first L.circleMarker built (rebuildCentroid).
    // Patch its position AFTER attach so onDrag reads a mutable latlng.
    const centroidDot: any = (window.L.circleMarker as any).mock.results[0].value;
    const centroidPos: L.LatLng = { lat: 1, lng: 0.5 };
    centroidDot.getLatLng = vi.fn(() => ({ ...centroidPos }));
    const centroidDrag = dragHandlers.at(-1)!;

    centroidDrag.onDrag!({ lat: 3, lng: 3 });

    // Every point translates by (dx, dy) = (3 - 0.5, 3 - 1) = (2.5, 2).
    expect(points).toEqual([
      { lat: 2, lng: 2.5 },
      { lat: 3, lng: 3.5 },
      { lat: 4, lng: 2.5 },
    ]);
    nodeMarkers.forEach((m, i) => {
      expect(m.setLatLng).toHaveBeenCalledWith(points[i]);
    });
  });

  it("calls onUpdate from the centroid drag onEnd", () => {
    const points = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 1 },
      { lat: 2, lng: 0 },
    ];
    const onUpdate = vi.fn();

    UI.attachPolygonUI(
      makeMgr() as any,
      {
        layers: { removeLayer: vi.fn(), addLayer: vi.fn(l => l), unregister: vi.fn() },
        finalPoly: { on: vi.fn(), setLatLngs: vi.fn() },
        nodeMarkers: points.map(mkNode),
        segLabels: [0, 1, 2].map(() => ({ on: vi.fn() })),
        points,
        area: 5000,
        id: "test-id",
        onDelete: vi.fn(),
        onUpdate,
      } as any,
    );

    const centroidDrag = dragHandlers.at(-1)!;
    centroidDrag.onEnd!({ lat: 5, lng: 5 });

    expect(onUpdate).toHaveBeenCalled();
  });
});
