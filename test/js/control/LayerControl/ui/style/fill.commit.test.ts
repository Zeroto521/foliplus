// test/js/control/LayerControl/ui/style/fill.commit — commit, apply, flush and mouseout reapply.
import { findItem } from "../fixture.js";
import {
  RING,
  commitNow,
  initWithFillLayer,
  type makeFillableLayer,
} from "./fill.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { clearIntent, getIntent, setIntent } from "#control/LayerControl/ui/intent.js";
import {
  FILL_DIMENSION,
  applyFillToLayer,
  bindFillRow,
  commitFillColor,
  commitFillOpacity,
} from "#control/LayerControl/ui/style/fill.js";
import { closeStylePanel } from "#control/LayerControl/ui/style/index.js";
import {
  FACE,
  dropStyleDimApplies,
  flushStyleDimApply,
  hasStyleDimApply,
} from "#control/LayerControl/ui/style/styleBag.js";

describe("LayerUI style panel — fill color", () => {
  let manager: LayerController;

  let ui: LayerUI;

  let fillLayer: ReturnType<typeof makeFillableLayer>;

  beforeEach(() => {
    const fixture = initWithFillLayer();

    manager = fixture.manager;

    ui = fixture.ui;

    fillLayer = fixture.fillLayer;

    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();

    document.body.innerHTML = "";

    vi.clearAllMocks();

    vi.useRealTimers();
  });
  // ─────────────────── commit + persistence ───────────────────

  it("commitFillColor writes to the map, persists, and marks the override", () => {
    const setLayer = vi.spyOn(manager.persistence, "schedule");

    commitNow(ui, "overlay1", "color", "#ff0000");

    expect(getIntent(ui, "overlay1", "fillColor")).toBe("#ff0000");

    expect(ui.intentStore.isUserSet("overlay1", "fillColor")).toBe(true);

    expect(setLayer).toHaveBeenCalled();

    const fields = setLayer.mock.calls.at(-1)![0] as {
      layers: () => Record<string, { fillColor?: string; overrides?: string[] }>;
    };

    expect(fields.layers().overlay1.fillColor).toBe("#ff0000");

    expect(fields.layers().overlay1.overrides).toContain("fillColor");
  });

  it("commitFillColor normalizes #rgb to #rrggbb before persisting", () => {
    commitNow(ui, "overlay1", "color", "#f00");

    expect(getIntent(ui, "overlay1", "fillColor")).toBe("#ff0000");
  });

  it("commitFillColor no-ops when the value did not change", () => {
    setIntent(ui, "overlay1", "fillColor", "#ff0000");

    const setLayer = vi.spyOn(manager.persistence, "schedule");

    commitNow(ui, "overlay1", "color", "#ff0000");

    expect(setLayer).not.toHaveBeenCalled();
  });

  it("applyFillToLayer calls setStyle on every leaf with one it exposes", () => {
    setIntent(ui, "overlay1", "fillColor", "#123456");

    applyFillToLayer(ui, "overlay1");

    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",

      fill: true,
    });

    expect(fillLayer.leaves[1].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",

      fill: true,
    });
  });

  it("coalesces same-frame commits into one walk", () => {
    // A color-picker drag revisits every step; each applyFillToLayer pass is

    // a sweep over every leaf. The commit channel must collapse a burst into

    // one walk per animation frame.

    const frames: Array<() => void> = [];

    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);

      return frames.length;
    });

    vi.stubGlobal("cancelAnimationFrame", () => {});

    commitFillColor(ui, "overlay1", "#111111");

    commitFillColor(ui, "overlay1", "#222222");

    commitFillColor(ui, "overlay1", "#333333");

    // trailing rAF: no walk has run yet

    expect(fillLayer.leaves[0].setStyle).not.toHaveBeenCalled();

    // one frame delivers the latest intent in a single sweep

    for (const cb of frames.splice(0)) cb();

    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledTimes(1);

    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#333333",

      fill: true,
    });

    expect(fillLayer.leaves[1].setStyle).toHaveBeenCalledTimes(1);
  });

  it("flush delivers the terminal value when the drag ends", () => {
    // change / blur / panel close must flush the trailing frame: the last

    // commit is written to intent immediately but the walk is deferred, so

    // without a flush the map would keep the previous color.

    const frames: Array<() => void> = [];

    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);

      return frames.length;
    });

    vi.stubGlobal("cancelAnimationFrame", () => {});

    commitFillColor(ui, "overlay1", "#333333");

    flushStyleDimApply(FACE.FILL, "overlay1");

    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#333333",

      fill: true,
    });

    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledTimes(1);

    // a second flush is a no-op — the terminal value already landed

    flushStyleDimApply(FACE.FILL, "overlay1");

    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledTimes(1);
  });

  it("flush after the terminal commit matches a direct applyFillToLayer write", () => {
    // Value-identity pin: the deferred path must land the same setStyle

    // payload a synchronous applyFillToLayer would have written.

    const leaf = fillLayer.leaves[0];

    setIntent(ui, "overlay1", "fillColor", "#654321");

    setIntent(ui, "overlay1", "fillOpacity", 0.4);

    applyFillToLayer(ui, "overlay1");

    const syncCall = leaf.setStyle.mock.calls.at(-1);

    leaf.setStyle.mockClear();

    fillLayer.leaves[1].setStyle.mockClear();

    commitFillColor(ui, "overlay1", "#111111");

    commitFillColor(ui, "overlay1", "#654321");

    commitFillOpacity(ui, "overlay1", 40);

    flushStyleDimApply(FACE.FILL, "overlay1");

    expect(leaf.setStyle.mock.calls.at(-1)).toEqual(syncCall);

    expect(leaf.setStyle).toHaveBeenCalledWith({
      fillColor: "#654321",

      fillOpacity: 0.4,

      fill: true,
    });
  });

  it("opacity input change flushes the deferred walk without waiting for rAF", () => {
    // bindLiveNumber owns onchange (clamp + commit); the flush is chained

    // after it so the terminal opacity lands on the map immediately.

    const frames: Array<() => void> = [];

    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);

      return frames.length;
    });

    vi.stubGlobal("cancelAnimationFrame", () => {});

    setIntent(ui, "overlay1", "fillStyleMode", "solid");

    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    const row = item.querySelector(`.${CONST.CLASSES.STYLE_FILL_BLOCK}`) as HTMLElement;

    bindFillRow(ui, "overlay1", row);

    const opacity = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER}`,
    ) as HTMLInputElement;

    opacity.value = "40";

    opacity.dispatchEvent(new Event("change", { bubbles: true }));

    // An opacity-only commit pulls the author's color back in the same

    // payload, so nothing an earlier mode left can sit under the opacity.

    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#aabbcc",

      fillOpacity: 0.4,

      fill: true,
    });
  });

  it("color input change chains the previous handler and flushes", () => {
    // The color binder must never overwrite a future onchange: the new

    // handler runs the previous one first, then flushes the deferred walk.

    const frames: Array<() => void> = [];

    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);

      return frames.length;
    });

    vi.stubGlobal("cancelAnimationFrame", () => {});

    setIntent(ui, "overlay1", "fillStyleMode", "solid");

    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    const row = item.querySelector(`.${CONST.CLASSES.STYLE_FILL_BLOCK}`) as HTMLElement;

    const color = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`,
    ) as HTMLInputElement;

    const prior = vi.fn();

    color.onchange = prior;

    bindFillRow(ui, "overlay1", row);

    color.value = "#445544";

    color.dispatchEvent(new Event("input", { bubbles: true }));

    color.dispatchEvent(new Event("change", { bubbles: true }));

    expect(prior).toHaveBeenCalledTimes(1);

    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#445544",

      fill: true,
    });
  });

  it("color input blur flushes the deferred walk", () => {
    const frames: Array<() => void> = [];

    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);

      return frames.length;
    });

    vi.stubGlobal("cancelAnimationFrame", () => {});

    setIntent(ui, "overlay1", "fillStyleMode", "solid");

    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    const row = item.querySelector(`.${CONST.CLASSES.STYLE_FILL_BLOCK}`) as HTMLElement;

    bindFillRow(ui, "overlay1", row);

    const color = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`,
    ) as HTMLInputElement;

    color.value = "#222222";

    color.dispatchEvent(new Event("input", { bubbles: true }));

    expect(fillLayer.leaves[0].setStyle).not.toHaveBeenCalled();

    color.dispatchEvent(new Event("blur", { bubbles: true }));

    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#222222",

      fill: true,
    });
  });

  it("closing the style panel flushes a pending fill walk", () => {
    const frames: Array<() => void> = [];

    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);

      return frames.length;
    });

    vi.stubGlobal("cancelAnimationFrame", () => {});

    setIntent(ui, "overlay1", "fillStyleMode", "solid");

    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    const row = item.querySelector(`.${CONST.CLASSES.STYLE_FILL_BLOCK}`) as HTMLElement;

    bindFillRow(ui, "overlay1", row);

    const color = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`,
    ) as HTMLInputElement;

    color.value = "#333333";

    color.dispatchEvent(new Event("input", { bubbles: true }));

    closeStylePanel(ui, false);

    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#333333",

      fill: true,
    });
  });

  it("FILL_DIMENSION.value reports the stored choice over the authored one", () => {
    expect(FILL_DIMENSION.value!(ui, "overlay1")).toEqual({
      color: "#aabbcc",

      opacity: 0.5,

      mode: "original",
    });

    commitNow(ui, "overlay1", "color", "#445566");

    commitNow(ui, "overlay1", "opacity", 80);

    expect(FILL_DIMENSION.value!(ui, "overlay1")).toEqual({
      color: "#445566",

      opacity: 0.8,

      mode: "solid",
    });

    expect(FILL_DIMENSION.value!(ui, "ghost")).toBeUndefined();
  });

  it("FILL_DIMENSION.value reports the ramp mode when the map is painted by value", () => {
    // A ramp config without an explicit mode is the pre-fillMode record shape

    // and still paints the ramp, so the descriptor must say "value" rather than

    // the stored mode's solid fallback — or the panel would claim solid while

    // the map is painted by value.

    setIntent(ui, "overlay1", "fillValue", {
      field: "count",

      method: "equal",

      classes: 3,

      scheme: "Reds",
    });

    expect(FILL_DIMENSION.value!(ui, "overlay1")).toMatchObject({
      mode: "value",

      value: { field: "count", method: "equal", classes: 3, scheme: "Reds" },
    });

    // An explicit solid mode wins over a stored ramp config — the config is

    // kept for the next switch but the mode is solid.

    setIntent(ui, "overlay1", "fillStyleMode", "solid");

    expect(FILL_DIMENSION.value!(ui, "overlay1")).toMatchObject({ mode: "solid" });
  });

  it("unregister drops the fill scheduler entry — no Map residue for dead ids", () => {
    // The scheduler Map is keyed by layer id and would otherwise outlive

    // the layer: a churning map (Heatmap empty/reload, user delete) would

    // accumulate boxes. Unregister must cancel the pending frame and free

    // the entry.

    const frames: Array<() => void> = [];

    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);

      return frames.length;
    });

    vi.stubGlobal("cancelAnimationFrame", () => {});

    commitFillColor(ui, "overlay1", "#333333");

    expect(hasStyleDimApply(FACE.FILL, "overlay1")).toBe(true);

    manager.unregisterLayer("overlay1");

    expect(hasStyleDimApply(FACE.FILL, "overlay1")).toBe(false);

    // the cancelled frame must not paint into the dead layer

    for (const cb of frames.splice(0)) cb();

    expect(fillLayer.leaves[0].setStyle).not.toHaveBeenCalled();
  });

  it("dropStyleDimApplies is a no-op for an id with no entry", () => {
    expect(() => dropStyleDimApplies("ghost")).not.toThrow();

    expect(hasStyleDimApply(FACE.FILL, "ghost")).toBe(false);
  });

  it("forces fill on when the user sets a fill color, so a fill:false path becomes visible", () => {
    // Mirror of the border stroke fix: an author `fill: false` (or Leaflet

    // Path painting none) must not swallow the user's fillColor write.

    fillLayer.leaves[0].options.fill = false;

    fillLayer.leaves[1].options.fill = false;

    setIntent(ui, "overlay1", "fillColor", "#123456");

    applyFillToLayer(ui, "overlay1");

    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",

      fill: true,
    });

    expect(fillLayer.leaves[1].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",

      fill: true,
    });
  });

  it("forces fill on when the user sets a fill opacity", () => {
    setIntent(ui, "overlay1", "fillOpacity", 0.8);

    applyFillToLayer(ui, "overlay1");

    // The author's color rides the same payload: the opacity does not hide

    // a color the leaf never claimed.

    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#aabbcc",

      fillOpacity: 0.8,

      fill: true,
    });
  });

  it("applyFillToLayer is a silent no-op for a layer with no leaves", () => {
    // No honest write → do not persist a broken state. The gate

    // already prevents commit from reaching here for a non-vector layer,

    // but the walker itself must not throw on a group whose eachLayer

    // dispatches nothing.

    manager.registerLayer({
      id: "empty1",

      name: "Empty",

      layer: { options: {}, eachLayer: vi.fn() } as never,
    });

    setIntent(ui, "empty1", "fillColor", "#123456");

    expect(() => applyFillToLayer(ui, "empty1")).not.toThrow();
  });

  it("applyFillToLayer is a no-op when the layer is not in the registry", () => {
    setIntent(ui, "ghost", "fillColor", "#123456");

    expect(() => applyFillToLayer(ui, "ghost")).not.toThrow();
  });

  it("commitFillColor walks past a node with no setStyle or eachLayer", () => {
    // The leaf walk in applyFillToLayer falls through a leaf that exposes

    // neither a setter nor children — it must not throw, and the color

    // still commits.

    const fixture = initWithFillLayer();

    fixture.fillLayer.leaves[1] = { options: {} } as never;

    expect(() => commitFillColor(fixture.ui, "overlay1", "#ff0000")).not.toThrow();

    expect(getIntent(fixture.ui, "overlay1", "fillColor")).toBe("#ff0000");
  });

  it("mouseout on a leaf re-applies the user's fill after folium resets it", () => {
    // folium's highlight_on_hover restores the ORIGINAL style on mouseout;

    // the fill row's listener must reapply the user's color and opacity so

    // a hover cannot undo them.

    const fixture = initWithFillLayer();

    let handler: (() => void) | null = null;

    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0.5, fill: true },

      feature: { geometry: { type: "Polygon" } },

      getLatLngs: RING,

      setStyle: vi.fn(),

      on: vi.fn((_type: string, fn: () => void) => {
        handler = fn;
      }),
    };

    fixture.fillLayer.leaves[0] = leaf;

    setIntent(fixture.ui, "overlay1", "fillColor", "#123456");

    setIntent(fixture.ui, "overlay1", "fillOpacity", 0.4);

    applyFillToLayer(fixture.ui, "overlay1");

    expect(leaf.setStyle).toHaveBeenLastCalledWith({
      fillColor: "#123456",

      fillOpacity: 0.4,

      fill: true,
    });

    // folium's mouseout handler sets the original style back…

    leaf.setStyle({ fillColor: "#aabbcc", fillOpacity: 0.5, fill: true });

    // …and our listener restores the user's fill.

    handler!();

    expect(leaf.setStyle).toHaveBeenLastCalledWith({
      fillColor: "#123456",

      fillOpacity: 0.4,

      fill: true,
    });
  });

  it("mouseout on a leaf with no stored fill does not touch the style", () => {
    const fixture = initWithFillLayer();

    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0.5, fill: true },

      feature: { geometry: { type: "Polygon" } },

      getLatLngs: RING,

      setStyle: vi.fn(),

      on: vi.fn(),
    };

    fixture.fillLayer.leaves[0] = leaf;

    applyFillToLayer(fixture.ui, "overlay1"); // nothing stored — early return

    // applyFillToLayer never reached the walk, so no listener is attached:

    // folium's own hover handling stays untouched for an uncommitted layer.

    expect(leaf.on).not.toHaveBeenCalled();
  });

  it("mouseout reapplies only the stored fill color", () => {
    const fixture = initWithFillLayer();

    let handler: (() => void) | null = null;

    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0.5, fill: true },

      feature: { geometry: { type: "Polygon" } },

      getLatLngs: RING,

      setStyle: vi.fn(),

      on: vi.fn((_type: string, fn: () => void) => {
        handler = fn;
      }),
    };

    fixture.fillLayer.leaves[0] = leaf;

    setIntent(fixture.ui, "overlay1", "fillColor", "#123456");

    applyFillToLayer(fixture.ui, "overlay1");

    handler!();

    // fillOpacity is absent from the maps, so the reapply omits it — the

    // author's opacity stays in force.

    expect(leaf.setStyle).toHaveBeenLastCalledWith({
      fillColor: "#123456",

      fill: true,
    });
  });

  it("mouseout reapplies only the stored fill opacity", () => {
    const fixture = initWithFillLayer();

    let handler: (() => void) | null = null;

    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0.5, fill: true },

      feature: { geometry: { type: "Polygon" } },

      getLatLngs: RING,

      setStyle: vi.fn(),

      on: vi.fn((_type: string, fn: () => void) => {
        handler = fn;
      }),
    };

    fixture.fillLayer.leaves[0] = leaf;

    setIntent(fixture.ui, "overlay1", "fillOpacity", 0.4);

    applyFillToLayer(fixture.ui, "overlay1");

    handler!();

    expect(leaf.setStyle).toHaveBeenLastCalledWith({ fillOpacity: 0.4, fill: true });
  });

  it("mouseout after the fill was reset does not rewrite the style", () => {
    const fixture = initWithFillLayer();

    let handler: (() => void) | null = null;

    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0.5, fill: true },

      feature: { geometry: { type: "Polygon" } },

      getLatLngs: RING,

      setStyle: vi.fn(),

      on: vi.fn((_type: string, fn: () => void) => {
        handler = fn;
      }),
    };

    fixture.fillLayer.leaves[0] = leaf;

    setIntent(fixture.ui, "overlay1", "fillColor", "#123456");

    applyFillToLayer(fixture.ui, "overlay1");

    // Reset clears the maps; the listener from the earlier commit is still

    // attached (reset does not unbind it), so the reapply must no-op.

    clearIntent(fixture.ui, "overlay1", "fillColor");

    clearIntent(fixture.ui, "overlay1", "fillOpacity");

    leaf.setStyle.mockClear();

    handler!();

    expect(leaf.setStyle).not.toHaveBeenCalled();
  });

  it("attaches the reapply listener to leaves, not to the group", () => {
    // A folium GeoJson is a LayerGroup that ALSO exposes setStyle. The

    // listener must live on each leaf — mouseout fires there, never on the

    // group — so a group with both methods must still recurse.

    const leaves = [
      {
        options: { fillColor: "#aabbcc", fillOpacity: 0.5, fill: true },

        feature: { geometry: { type: "Polygon" } },

        getLatLngs: RING,

        setStyle: vi.fn(),

        on: vi.fn(),
      },

      {
        options: { fillColor: "#ddeeff", fillOpacity: 0.7, fill: true },

        feature: { geometry: { type: "Polygon" } },

        getLatLngs: RING,

        setStyle: vi.fn(),

        on: vi.fn(),
      },
    ];

    const group = {
      options: {},

      setStyle: vi.fn(),

      eachLayer: vi.fn((fn: (child: unknown) => void) =>
        leaves.forEach(child => fn(child)),
      ),

      getBounds: vi.fn(() => ({
        isValid: vi.fn(() => true),

        getSouthWest: vi.fn(() => ({ lat: 0, lng: 0 })),

        getNorthEast: vi.fn(() => ({ lat: 1, lng: 1 })),
      })),
    };

    manager.registerLayer({
      id: "group1",

      name: "Group",

      layer: group as never,
    });

    ui.runtimeStore.setFields("group1", [{ name: "count", numeric: true }]);

    setIntent(ui, "group1", "fillColor", "#123456");

    applyFillToLayer(ui, "group1");

    expect(leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",

      fill: true,
    });

    expect(leaves[1].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",

      fill: true,
    });

    expect(leaves[0].on).toHaveBeenCalledWith("mouseout", expect.any(Function));

    expect(leaves[1].on).toHaveBeenCalledWith("mouseout", expect.any(Function));

    expect(group.setStyle).not.toHaveBeenCalled();
  });

  it("the reapply listener calls setStyle with the leaf as `this`", () => {
    // Leaflet's Path.setStyle reads `this.options`; the detached reference

    // captured by the listener must stay bound to its layer or the reapply

    // throws "Cannot convert undefined or null to object".

    const fixture = initWithFillLayer();

    let handler: (() => void) | null = null;

    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0.5, fill: true },

      feature: { geometry: { type: "Polygon" } },

      getLatLngs: RING,

      setStyle: vi.fn(function (
        this: { options: Record<string, unknown> },

        s: Record<string, unknown>,
      ) {
        Object.assign(this.options, s);
      }),

      on: vi.fn((_type: string, fn: () => void) => {
        handler = fn;
      }),
    };

    fixture.fillLayer.leaves[0] = leaf;

    setIntent(fixture.ui, "overlay1", "fillColor", "#123456");

    applyFillToLayer(fixture.ui, "overlay1");

    handler!();

    expect(leaf.options.fillColor).toBe("#123456");
  });
});
