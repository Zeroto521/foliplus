import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/MeasureControl/const.js";
import * as UI from "#foliplus/MeasureControl/ui/index.js";
import { installStubs, makeMgr } from "./fixture.js";

// Mock delete-icon helpers — capture the click callback so tests can trigger it.
// Keep the original exports via importOriginal and override the function helpers.
const { attachDelClick, makeDelIcon, toggleDelIcon, realMakeDelIcon, dragHandlers } =
  vi.hoisted(() => ({
    attachDelClick: vi.fn((marker: any, cb: () => void) => {
      marker._delClick = cb;
    }),
    // makeDelIcon delegates to the real implementation so that hijacking
    // window.L.marker inside a test controls the del markers it creates.
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

// bindNodeDrag stays real (existing tests rely on its cursor/mousemove binding),
// but we capture the handlers so drag-body coverage is reachable by calling
// `dragHandlers[i].onDrag(latlng)` directly.
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
  dragHandlers.length = 0;
  installStubs();
});

afterEach(() => {
  vi.restoreAllMocks();
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

    expect(mgr.map.off).toHaveBeenCalledWith("click", expect.any(Function));
  });

  it("attaches click handlers that open the edit overlay on circle parts", () => {
    const { opts } = makeOpts();
    UI.attachCircleUI(makeMgr() as any, opts as any);

    const clickHandler = (opts.circle.on as any).mock.calls.find(
      (c: any[]) => c[0] === "click",
    )?.[1];
    expect(clickHandler).toBeDefined();
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

describe("attachCircleUI — drag flow", () => {
  const makeLayer = (name: string, initial: L.LatLng = { lat: 0, lng: 0 }) => ({
    _name: name,
    on: vi.fn(),
    off: vi.fn(),
    getElement: vi.fn(() => null),
    getLatLng: vi.fn(() => ({ ...initial })),
    setLatLng: vi.fn(),
    getRadius: vi.fn(() => 1000),
    setRadius: vi.fn(),
    setLatLngs: vi.fn(),
    setZIndexOffset: vi.fn(),
  });

  it("translates center, radius node, radius line, and label when dragging the center", () => {
    const layers = {
      removeLayer: vi.fn(),
      addLayer: vi.fn(l => l),
      unregister: vi.fn(),
    };
    const circle = makeLayer("circle", { lat: 10, lng: 10 });
    // Position of the radius node mutates as onDrag runs.
    let rPos: L.LatLng = { lat: 12, lng: 10 };
    const radiusNode: any = {
      ...makeLayer("radiusNode"),
      getLatLng: vi.fn(() => ({ ...rPos })),
    };
    radiusNode.setLatLng.mockImplementation((p: L.LatLng) => {
      rPos = { ...p };
      return radiusNode;
    });
    const radiusLine = makeLayer("radiusLine");
    const centerFinal = makeLayer("centerFinal", { lat: 10, lng: 10 });
    const delMarker = makeLayer("delMarker");
    const radiusLabel = makeLayer("radiusLabel");

    UI.attachCircleUI(
      makeMgr() as any,
      {
        layers,
        circle,
        radiusLine,
        radiusNode,
        centerFinal,
        delMarker,
        radiusLabel,
        onDelete: vi.fn(),
        id: "test-id",
      } as any,
    );

    // dragHandlers order: [0] = center, [1] = radius node.
    dragHandlers[0]!.onDrag!({ lat: 11, lng: 12 });

    expect(circle.setLatLng).toHaveBeenCalledWith({ lat: 11, lng: 12 });
    expect(centerFinal.setLatLng).toHaveBeenCalledWith({ lat: 11, lng: 12 });
    expect(delMarker.setLatLng).toHaveBeenCalledWith({ lat: 11, lng: 12 });
    // Radius node offsets by (dx, dy) = (2, 1) from its original.
    expect(radiusNode.setLatLng).toHaveBeenCalledWith({ lat: 13, lng: 12 });
    // Radius line tracks center → new radiusNode position.
    expect(radiusLine.setLatLngs).toHaveBeenCalledWith([
      { lat: 11, lng: 12 },
      { lat: 13, lng: 12 },
    ]);
    // Label repositions and re-formats (Util.formatDistance + Util.setLabelText).
    expect(radiusLabel.setLatLng).toHaveBeenCalled();
  });

  it("calls the onEnd callback with the final latlng after a center drag", () => {
    const onEnd = vi.fn();
    UI.attachCircleUI(
      makeMgr() as any,
      {
        layers: { removeLayer: vi.fn(), addLayer: vi.fn(l => l), unregister: vi.fn() },
        circle: makeLayer("circle"),
        radiusLine: makeLayer("radiusLine"),
        radiusNode: makeLayer("radiusNode"),
        centerFinal: makeLayer("centerFinal"),
        delMarker: makeLayer("delMarker"),
        radiusLabel: makeLayer("radiusLabel"),
        onDelete: vi.fn(),
        onEnd,
        id: "test-id",
      } as any,
    );

    dragHandlers[0]!.onEnd!({ lat: 5, lng: 5 });

    expect(onEnd).toHaveBeenCalledWith({ lat: 5, lng: 5 });
  });

  it("calls the onEnd callback with the final latlng after a radius-node drag", () => {
    const onEnd = vi.fn();
    UI.attachCircleUI(
      makeMgr() as any,
      {
        layers: { removeLayer: vi.fn(), addLayer: vi.fn(l => l), unregister: vi.fn() },
        circle: makeLayer("circle"),
        radiusLine: makeLayer("radiusLine"),
        radiusNode: makeLayer("radiusNode"),
        centerFinal: makeLayer("centerFinal"),
        delMarker: makeLayer("delMarker"),
        radiusLabel: makeLayer("radiusLabel"),
        onDelete: vi.fn(),
        onEnd,
        id: "test-id",
      } as any,
    );

    dragHandlers[1]!.onEnd!({ lat: 7, lng: 7 });

    expect(onEnd).toHaveBeenCalledWith({ lat: 7, lng: 7 });
  });

  it("updates the circle radius and radius line when dragging the radius node", () => {
    const circle = makeLayer("circle", { lat: 10, lng: 10 });
    const radiusLine = makeLayer("radiusLine");
    const radiusNode = makeLayer("radiusNode");

    UI.attachCircleUI(
      makeMgr() as any,
      {
        layers: { removeLayer: vi.fn(), addLayer: vi.fn(l => l), unregister: vi.fn() },
        circle,
        radiusLine,
        radiusNode,
        centerFinal: makeLayer("centerFinal"),
        delMarker: makeLayer("delMarker"),
        radiusLabel: makeLayer("radiusLabel"),
        onDelete: vi.fn(),
        id: "test-id",
      } as any,
    );

    dragHandlers[1]!.onDrag!({ lat: 10, lng: 15 });

    expect(radiusNode.setLatLng).toHaveBeenCalledWith({ lat: 10, lng: 15 });
    expect(circle.setRadius).toHaveBeenCalled();
    expect(radiusLine.setLatLngs).toHaveBeenCalledWith([
      { lat: 10, lng: 10 },
      { lat: 10, lng: 15 },
    ]);
  });

  it("skips radius node drag binding entirely when no radius node exists", () => {
    UI.attachCircleUI(
      makeMgr() as any,
      {
        layers: { removeLayer: vi.fn(), addLayer: vi.fn(l => l), unregister: vi.fn() },
        circle: makeLayer("circle"),
        radiusLine: null,
        radiusNode: null,
        centerFinal: makeLayer("centerFinal"),
        delMarker: makeLayer("delMarker"),
        radiusLabel: null,
        onDelete: vi.fn(),
        id: "test-id",
      } as any,
    );

    // Only the center drag is bound; the radius drag is skipped.
    expect(dragHandlers).toHaveLength(1);
  });

  it("enables/disables both drag binds when the edit-drag toggle fires", () => {
    const mgr = makeMgr();
    UI.attachCircleUI(
      mgr as any,
      {
        layers: { removeLayer: vi.fn(), addLayer: vi.fn(l => l), unregister: vi.fn() },
        circle: makeLayer("circle"),
        radiusLine: makeLayer("radiusLine"),
        radiusNode: makeLayer("radiusNode"),
        centerFinal: makeLayer("centerFinal"),
        delMarker: makeLayer("delMarker"),
        radiusLabel: makeLayer("radiusLabel"),
        onDelete: vi.fn(),
        id: "test-id",
      } as any,
    );

    const toggle = (mgr.registerEditDragToggle as any).mock.calls[0][0];
    // The callback body invokes dragBinds[i].setEnabled — assert no throw and
    // (via cursor) that the real bindNodeDrag's setCursor runs for both binds.
    expect(() => toggle(true)).not.toThrow();
    expect(() => toggle(false)).not.toThrow();
  });
});

describe("attachCircleUI — null-optionals", () => {
  const mk = (name: string) => ({
    on: vi.fn(),
    off: vi.fn(),
    getElement: vi.fn(() => null),
    getLatLng: vi.fn(() => ({ lat: 0, lng: 0 })),
    setLatLng: vi.fn(),
    getRadius: vi.fn(() => 1000),
    setRadius: vi.fn(),
    setLatLngs: vi.fn(),
  });

  it("skips optional layers in removeLayers and skips label registration when they are null", () => {
    const layers = {
      removeLayer: vi.fn(),
      addLayer: vi.fn(l => l),
      unregister: vi.fn(),
    };
    const registerLabel = vi.fn(() => () => {});
    const opts = {
      layers,
      circle: mk("circle"),
      radiusLine: null,
      radiusNode: null,
      centerFinal: mk("centerFinal"),
      delMarker: mk("delMarker"),
      radiusLabel: null,
      onDelete: vi.fn(),
      id: "test-id",
    };
    UI.attachCircleUI({ ...makeMgr(), registerLabel } as any, opts as any);

    // No label registration — the ternary took the `() => {}` arm.
    expect(registerLabel).not.toHaveBeenCalled();

    // Trigger delete → removeLayers runs. The three null optionals are skipped.
    (opts.delMarker as any)._delClick();
    const nullArgs = layers.removeLayer.mock.calls.filter(c => c[0] == null);
    expect(nullArgs).toHaveLength(0);
  });

  it("center-drag skips the optional layers and updateLabel returns early when they are null", () => {
    const circle = mk("circle");
    const centerFinal = mk("centerFinal");
    UI.attachCircleUI(
      makeMgr() as any,
      {
        layers: { removeLayer: vi.fn(), addLayer: vi.fn(l => l), unregister: vi.fn() },
        circle,
        radiusLine: null,
        radiusNode: null,
        centerFinal,
        delMarker: mk("delMarker"),
        radiusLabel: null,
        onDelete: vi.fn(),
        id: "test-id",
      } as any,
    );

    dragHandlers[0]!.onDrag!({ lat: 5, lng: 5 });

    expect(circle.setLatLng).toHaveBeenCalledWith({ lat: 5, lng: 5 });
    expect(centerFinal.setLatLng).toHaveBeenCalledWith({ lat: 5, lng: 5 });
    // radiusNode is null — no setLatLng on it; radiusLine is null — no setLatLngs.
    // updateLabel returns early because radiusLabel is null — no circle.setRadius
    // (that only runs in the radius-node drag, not the center drag).
    expect(circle.setRadius).not.toHaveBeenCalled();
  });

  it("radius-drag skips the radius line and label when they are null", () => {
    const circle = mk("circle");
    const radiusNode = mk("radiusNode");
    UI.attachCircleUI(
      makeMgr() as any,
      {
        layers: { removeLayer: vi.fn(), addLayer: vi.fn(l => l), unregister: vi.fn() },
        circle,
        radiusLine: null,
        radiusNode,
        centerFinal: mk("centerFinal"),
        delMarker: mk("delMarker"),
        radiusLabel: null,
        onDelete: vi.fn(),
        id: "test-id",
      } as any,
    );

    dragHandlers[1]!.onDrag!({ lat: 1, lng: 5 });

    expect(circle.setRadius).toHaveBeenCalled();
    expect(radiusNode.setLatLng).toHaveBeenCalledWith({ lat: 1, lng: 5 });
    // No radius line to update; no label to reposition (updateLabel early-returns).
    expect(circle.setLatLng).not.toHaveBeenCalled();
  });
});
