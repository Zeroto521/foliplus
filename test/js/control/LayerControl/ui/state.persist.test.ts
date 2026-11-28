// test/js/control/LayerControl/ui/style/state.persist — intent-store persistence and author folder derivation.
import {
  GridLayer,
  TEST_ENV,
  attachedPanel,
  initFixture,
  polygonLayerWithStyle,
} from "./fixture.js";
import { makeStore } from "./state.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#foliplus/core/event/index.js";
import { createLogger } from "#platform/log.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { effectiveRoleFolded } from "#control/LayerControl/fold/index.js";
import { LayerUI } from "#control/LayerControl/ui/index.js";
import {
  getIntent,
  seedIntentMap,
  setIntent,
} from "#control/LayerControl/ui/intent.js";
import {
  applyUserState,
  buildLayerStates,
  dropPersistedLayerState,
  loadPersistedState,
  markOverride,
  saveNamesState,
  saveState,
  setVisibleIntent,
  unmarkOverride,
} from "#control/LayerControl/ui/state.js";

// ─────────────────── intentStore + per-layer persistence ───────────────────

describe("ui/state intentStore and per-layer state persistence", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let map: any;

  beforeEach(() => {
    ({ manager, ui, map } = initFixture());
    window.localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("a user hide goes into intents.visible and persists visible:false", () => {
    // The record has to distinguish "user hid it" from "author declared
    // show=False" -- the same intents.visible value is either. markOverride is what
    // records that distinction: without it, reload would drop the id and the
    // layer would come back visible, undoing the user's last choice.
    const schedule = vi.fn();
    const bare = {
      intentStore: makeStore(),
      c: {
        persistence: { schedule },
        label: { configEntries: () => [] },
      },
    } as unknown as LayerUI;

    setVisibleIntent(bare, "overlay1", false);

    expect(bare.intentStore.isUserSet("overlay1", "visible")).toBe(true);
    const fields = schedule.mock.calls[0][0] as {
      layers: () => Record<string, { visible?: boolean; overrides: string[] }>;
    };
    expect(fields.layers()).toEqual({
      overlay1: { visible: false, overrides: ["visible"] },
    });
  });

  it("a user unhide persists visible:true rather than dropping the entry", () => {
    // The old test asserted the id was dropped from the hidden set. The new
    // model keeps the entry because it knows the user touched the layer --
    // dropping it would fall back to the author's show=False default, so the
    // unhide would only be visible for the current session.
    const schedule = vi.fn();
    const bare = {
      intentStore: makeStore(
        { overlay1: { visible: false } },
        { overlay1: ["visible"] },
      ),
      c: {
        persistence: { schedule },
        label: { configEntries: () => [] },
      },
    } as unknown as LayerUI;

    setVisibleIntent(bare, "overlay1", true);

    expect(getIntent(bare, "overlay1", "visible")).not.toBe(false);
    const fields = schedule.mock.calls[0][0] as {
      layers: () => Record<string, { visible?: boolean; overrides: string[] }>;
    };
    expect(fields.layers()).toEqual({
      overlay1: { visible: true, overrides: ["visible"] },
    });
  });

  it("persists a moved zoom range together with its provenance", () => {
    // The author's min_zoom / max_zoom is only the starting value, so moving the
    // handles has to mark provenance too -- without it the range would be read
    // back as a declaration and dropped, and the user's drag would not survive
    // a reload.
    const schedule = vi.fn();
    const bare = {
      intentStore: makeStore(
        { overlay1: { zoomRange: [4, 10] } },
        { overlay1: ["zoomRange"] },
      ),
      c: {
        persistence: { schedule },
        label: { configEntries: () => [] },
      },
    } as unknown as LayerUI;

    saveState(bare);

    const fields = schedule.mock.calls[0][0] as {
      layers: () => Record<string, { zoomRange?: number[]; overrides: string[] }>;
    };
    expect(fields.layers()).toEqual({
      overlay1: { zoomRange: [4, 10], overrides: ["zoomRange"] },
    });
  });

  it("drops the zoom range back to the author's default on reset", () => {
    // Reset is one rule: drop the provenance, and the value follows it. A
    // provenance with no live value must never be persisted -- the record cannot
    // say "the user reset this", so absence is what restores the declared value.
    const schedule = vi.fn();
    const bare = {
      intentStore: makeStore({}, { overlay1: ["zoomRange"] }),
      c: {
        persistence: { schedule },
        label: { configEntries: () => [] },
      },
    } as unknown as LayerUI;

    unmarkOverride(bare, "overlay1", "zoomRange");
    saveState(bare);

    expect(bare.intentStore.dumpProvenance().overlay1).toBeUndefined();
    const fields = schedule.mock.calls[0][0] as {
      layers: () => Record<string, unknown>;
    };
    expect(fields.layers()).toEqual({});
  });

  it("keeps the other dimensions when one is reset", () => {
    // Reset is per dimension, so unmarking zoomRange must not drop the layer's
    // other choices -- wiping the whole entry here would make one Reset button
    // forget the opacity the user set moments earlier.
    const bare = {
      intentStore: makeStore({}, { overlay1: ["visible", "zoomRange"] }),
    } as unknown as LayerUI;

    unmarkOverride(bare, "overlay1", "zoomRange");

    expect(bare.intentStore.dumpProvenance().overlay1).toEqual(["visible"]);
  });

  it("drops an entry whose only marker holds no live value", () => {
    // The mirror of the markOverride refusal, from the write side: a marker that
    // lost its value must not be written as an empty entry, which the next read
    // would discard anyway. Failing closed here keeps the invariant that every
    // persisted marker has a value.
    const schedule = vi.fn();
    const bare = {
      intentStore: makeStore({}, { overlay1: ["opacity"] }),
      c: {
        persistence: { schedule },
        label: { configEntries: () => [] },
      },
    } as unknown as LayerUI;

    saveState(bare);

    const fields = schedule.mock.calls[0][0] as {
      layers: () => Record<string, unknown>;
    };
    expect(fields.layers()).toEqual({});
  });

  it("refuses a marker for a dimension with no live value, loudly", () => {
    // buildLayerStates filters a marker whose value is missing, so recording it
    // here would mean the user's action vanishes on the next write with nothing
    // in the console. The gate therefore refuses it and says so instead of
    // accepting a marker that cannot survive a flush.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const schedule = vi.fn();
    const bare = {
      intentStore: makeStore(),
      c: {
        persistence: { schedule },
        label: { configEntries: () => [] },
      },
      log: createLogger("LayerControl"),
    } as unknown as LayerUI;

    markOverride(bare, "overlay1", "zoomRange");

    expect(bare.intentStore.dumpProvenance().overlay1).toBeUndefined();
    expect(schedule).not.toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toContain("no stored value for this dimension");
    warn.mockRestore();
  });

  it("treats an unknown override key as live (forward-compat default)", () => {
    // LayerOverride is closed today; the default branch of hasLiveValue /
    // LayerIntentStore.hasLive is the forward-compat path so a future dimension
    // without a typed guard is not silently dropped by markOverride — and
    // toPersisted writes only the marker (no LIVE rule yet), keeping the
    // disk contract intact.
    const bare = {
      intentStore: makeStore(),
      c: {
        persistence: { schedule: vi.fn() },
        label: { configEntries: () => [] },
      },
    } as unknown as LayerUI;

    markOverride(bare, "overlay1", "futureDim" as never);

    expect(bare.intentStore.dumpProvenance().overlay1).toEqual(["futureDim"]);
    const states = buildLayerStates(bare);
    expect(states.overlay1?.overrides).toEqual(["futureDim"]);
    expect(states.overlay1 && Object.keys(states.overlay1)).toEqual(["overrides"]);
  });

  it("skips label configs that are not objects", () => {
    // The label config rides `layers[id].label`; a corrupt entry
    // must not seed an intent, and an id with only a bad config drops out.
    const bare = {
      intentStore: makeStore(),
      listPanel: { foldedRoles: {}, checkedCount: {} },
      c: {
        persistence: {
          load: () =>
            ({
              order: null,
              foldedRoles: [],
              renamedNames: {},
              layers: {
                nullish: { overrides: [], label: null },
                valid: {
                  overrides: [],
                  label: { show: true, field: "name", format: "auto" },
                },
              },
            }) as never,
        },
      },
    } as unknown as LayerUI;
    loadPersistedState(bare);
    expect(getIntent(bare, "nullish", "label")).toBeUndefined();
    expect(getIntent(bare, "valid", "label")).toBeDefined();
  });

  it("ignores an override whose stored value has the wrong type", () => {
    // Defensive read: persistence normally pairs value + provenance, but a
    // direct record (or a future writer) can declare a marker with a bad value.
    const bare = {
      intentStore: makeStore(),
      listPanel: { foldedRoles: {}, checkedCount: {} },
      c: {
        persistence: {
          load: () =>
            ({
              order: null,
              foldedRoles: [],
              renamedNames: {},
              layers: {
                overlay1: { overrides: ["visible"], visible: "yes" },
              },
            }) as never,
        },
      },
    } as unknown as LayerUI;
    loadPersistedState(bare);
    expect(getIntent(bare, "overlay1", "visible")).toBeUndefined();
    expect(bare.intentStore.dumpProvenance().overlay1).toEqual(["visible"]);
  });

  it("saveNamesState keeps only intents that carry a name", () => {
    const schedule = vi.fn();
    const bare = {
      intentStore: makeStore({
        a: { opacity: 0.5 },
        b: { name: "Renamed" },
      }),
      c: { persistence: { schedule } },
    } as unknown as LayerUI;

    saveNamesState(bare);

    const fields = schedule.mock.calls[0][0] as {
      renamedNames: () => Record<string, string>;
    };
    expect(fields.renamedNames()).toEqual({ b: "Renamed" });
  });

  it("tolerates a shell with an empty LayerIntentStore", () => {
    // Sparse fixtures and a mid-teardown UI must not throw on the projection
    // walks — an empty store reads as no user choice, and an intent without a
    // name simply contributes nothing to the saved names.
    const schedule = vi.fn();
    const bare = {
      intentStore: makeStore(),
      c: {
        persistence: { schedule },
        label: { configEntries: () => [] },
        layerRegistry: new Map(),
        layers: [],
        replaySavedOrder: vi.fn(),
        map: { getContainer: () => document.createElement("div") },
      },
      focusController: { focusingLayerId: null },
      uiContainer: null,
      syncNoBasemap: vi.fn(),
    } as unknown as LayerUI;

    expect(buildLayerStates(bare)).toEqual({});
    expect(() => applyUserState(bare)).not.toThrow();
    expect(() => saveNamesState(bare)).not.toThrow();
    expect(schedule).toHaveBeenCalled();
  });

  it("refuses a border marker for a dimension that holds no stroke", () => {
    // The guard is per dimension, so the two border dimensions need the same
    // refusal as zoom range: marking a border with no value would be filtered
    // out of the next write and the user's action would vanish silently.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bare = {
      intentStore: makeStore(),
      c: { persistence: { schedule: vi.fn() } },
      log: createLogger("LayerControl"),
    } as unknown as LayerUI;

    markOverride(bare, "overlay1", "borderColor");
    markOverride(bare, "overlay1", "borderWeight");

    expect(bare.intentStore.dumpProvenance().overlay1).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(
      warn.mock.calls.every(([msg]) => String(msg).includes("no stored value")),
    ).toBe(true);
    warn.mockRestore();
  });

  it("restores a stored opacity and zoom range from the record", () => {
    // The record keeps the value and the provenance side by side, so a restore
    // must move them to the matching live maps. Reading the value without the
    // provenance would persist an author default as if the user had chosen it.
    window.localStorage.setItem(
      CONST.STORAGE.KEY,
      JSON.stringify({
        order: null,
        foldedRoles: { Overlay: true },
        renamedNames: {},
        layers: {
          overlay1: {
            opacity: 0.35,
            zoomRange: [3, 12],
            overrides: ["opacity", "zoomRange"],
          },
        },
      }),
    );

    loadPersistedState(ui);

    expect(ui.listPanel.foldedRoles).toEqual({ Overlay: true });
    expect(ui.intentStore.get("overlay1", "opacity")).toBe(0.35);
    expect(ui.intentStore.get("overlay1", "zoomRange")).toEqual([3, 12]);
    expect(ui.intentStore.dumpProvenance().overlay1).toEqual(["opacity", "zoomRange"]);
  });

  it("restores a stored border color and width from the record", () => {
    // The border maps are the row's own source of truth, so a restore has to
    // move the stored stroke into them: without it the drawer would reopen
    // showing the author's stroke while the map kept painting the user's last
    // choice.
    window.localStorage.setItem(
      CONST.STORAGE.KEY,
      JSON.stringify({
        order: null,
        foldedRoles: {},
        renamedNames: {},
        layers: {
          overlay1: {
            borderColor: "#0000ff",
            borderWeight: 4.5,
            overrides: ["borderColor", "borderWeight"],
          },
        },
      }),
    );

    loadPersistedState(ui);

    expect(ui.intentStore.get("overlay1", "borderColor")).toBe("#0000ff");
    expect(ui.intentStore.get("overlay1", "borderWeight")).toBe(4.5);
    expect(ui.intentStore.dumpProvenance().overlay1).toEqual([
      "borderColor",
      "borderWeight",
    ]);
  });

  it("disk shape is unchanged: PersistedLayerState keys stay the on-wire names", () => {
    // The live parallel maps collapsed into `ui.intentStore`, but the record
    // written to localStorage keeps its historical keys — `buildLayerStates`
    // is the only projection to disk. Pin the contract so a future field rename
    // cannot silently change what older sessions read back.
    const bare = {
      intentStore: makeStore(
        {
          overlay1: {
            visible: false,
            fillColor: "#123456",
            fillOpacity: 0.5,
            borderColor: "#0000ff",
            borderWeight: 4,
            opacity: 0.35,
            zoomRange: [3, 12] as [number, number],
            label: { show: true, field: "name", format: "auto" },
            name: "Renamed",
          },
        },
        {
          overlay1: [
            "visible",
            "fillColor",
            "fillOpacity",
            "borderColor",
            "borderWeight",
            "opacity",
            "zoomRange",
          ],
        },
      ),
      c: {
        label: {
          configEntries: () => [
            ["overlay1", { show: true, field: "name", format: "auto" }],
          ],
        },
      },
    } as unknown as LayerUI;

    const states = buildLayerStates(bare);
    const entry = states.overlay1;
    expect(entry).toBeDefined();
    expect(Object.keys(entry!).sort()).toEqual(
      [
        "label",
        "borderColor",
        "borderWeight",
        "fillColor",
        "fillOpacity",
        "opacity",
        "overrides",
        "visible",
        "zoomRange",
      ].sort(),
    );
    // `name` is NOT a layers[id] key — it rides the top-level `renamedNames`.
    expect("name" in entry!).toBe(false);
  });

  it("persists an opacity change together with its provenance", () => {
    const schedule = vi.fn();
    const bare = {
      intentStore: makeStore({ overlay1: { opacity: 0.6 } }, { overlay1: ["opacity"] }),
      c: {
        persistence: { schedule },
        label: { configEntries: () => [] },
      },
    } as unknown as LayerUI;

    saveState(bare);

    const fields = schedule.mock.calls[0][0] as {
      layers: () => Record<string, { opacity?: number; overrides: string[] }>;
    };
    expect(fields.layers()).toEqual({
      overlay1: { opacity: 0.6, overrides: ["opacity"] },
    });
  });

  it("persists border values by type presence, not truthiness", () => {
    // The gate (hasLiveValue) and the writer both speak typeof, so undefined
    // is the only absence: a weight of 0 survives while a marker whose value
    // went missing drops its whole entry. An empty string still reads as a
    // string here — no writer can produce one (hydration is truthy and the
    // color input only ever yields hex), and the read side discards it via
    // isHexColor, so a truthy carve-out in buildLayerStates would only make
    // this layer disagree with applyBorderToLayer's `!== undefined` reads.
    const schedule = vi.fn();
    const bare = {
      intentStore: makeStore(
        {
          kept: { borderColor: "#0000ff" },
          blank: { borderColor: "" },
          zero: { borderWeight: 0 },
        },
        {
          kept: ["borderColor"],
          blank: ["borderColor"],
          zero: ["borderWeight"],
          missing: ["borderColor", "borderWeight"],
        },
      ),
      c: {
        persistence: { schedule },
        label: { configEntries: () => [] },
      },
    } as unknown as LayerUI;

    saveState(bare);

    const fields = schedule.mock.calls[0][0] as {
      layers: () => Record<string, unknown>;
    };
    expect(fields.layers()).toEqual({
      kept: { borderColor: "#0000ff", overrides: ["borderColor"] },
      blank: { borderColor: "", overrides: ["borderColor"] },
      zero: { borderWeight: 0, overrides: ["borderWeight"] },
    });
  });

  it("applyUserState(id) ignores an id with no registry entry", () => {
    expect(() => ui.applyUserState("ghost")).not.toThrow();
  });

  it("applyUserState(id) projects a hidden flag onto a single late layer", () => {
    seedIntentMap(ui, "visible", { overlay1: false });

    ui.applyUserState("overlay1");

    expect(manager.intentVisible("overlay1")).toBe(false);
  });

  it("applyUserState(id) re-applies a stored zoom range on late registration", () => {
    // A stored range has to come back with its layer: without this pass a layer
    // that was out of range on the previous load would join the map at its
    // author default instead of staying inside the range the user chose.
    // With Option A, the zoomRange resolves through the visible op — the
    // layer's options are never written.
    manager.registerLayer({ id: "grid1", name: "Grid", layer: new GridLayer() });
    const li = manager.layerRegistry.get("grid1")!;
    ui.runtimeStore.setAuthorVisible("grid1", true); // author default: visible
    seedIntentMap(ui, "zoomRange", { grid1: [4, 9] });
    ui.intentStore.seedProvenance("grid1", ["zoomRange"]);

    ui.applyUserState("grid1");

    // The layer's options are untouched — zoomRange does not write them.
    const opts = (li.layer as { options: Record<string, unknown> }).options;
    expect("minZoom" in opts).toBe(false);
    expect("maxZoom" in opts).toBe(false);
  });

  it("applyUserState(id) leaves a native range alone when there is no layer", () => {
    // A canvas-only entry carries no Leaflet layer. A surface that reports the
    // range as native has nothing to dereference, so the pass has to bail
    // instead of writing into a layer that is not there.
    manager.registerLayer({ id: "ghostLayer", name: "Ghost" });
    const li = manager.layerRegistry.get("ghostLayer")!;
    manager.surfaceFor(li).capabilities.zoomRange = "native";
    seedIntentMap(ui, "zoomRange", { ghostLayer: [4, 9] });
    const mapWrites =
      map.addLayer.mock.calls.length + map.removeLayer.mock.calls.length;

    ui.applyUserState("ghostLayer");

    expect(li.layer).toBeNull();
    expect(map.addLayer.mock.calls.length + map.removeLayer.mock.calls.length).toBe(
      mapWrites,
    );
  });

  it("applyUserState renames the color basemap row without a registry entry", () => {
    // The color basemap has no LayerInfo in the registry — its rename goes
    // straight to the row label. Without the id guard at the top of the
    // sweep the color item would be skipped and the label would stay stale.
    seedIntentMap(ui, "name", { [CONST.SOLID_BASEMAP_ID]: "Renamed Color" });

    ui.applyUserState();

    const colorItem = attachedPanel(ui).querySelector(
      `[${CONST.DATA.LAYER_ID}="${CONST.SOLID_BASEMAP_ID}"]`,
    ) as HTMLElement | null;
    expect(colorItem).not.toBeNull();
    const label = colorItem!.querySelector("label") as HTMLElement | null;
    expect(label).not.toBeNull();
    expect(label!.textContent).toBe("Renamed Color");
  });

  it("applyUserState renames a layer that is in the registry", () => {
    // Covers the regular layer path in the sweep (lines 196-203): a layer ID
    // that IS in the registry gets its name projected through the layerInfo.
    seedIntentMap(ui, "name", { overlay1: "Renamed Overlay" });

    ui.applyUserState();

    const item = attachedPanel(ui).querySelector(
      `[${CONST.DATA.LAYER_ID}="overlay1"]`,
    ) as HTMLElement | null;
    expect(item).not.toBeNull();
    const label = item!.querySelector("label") as HTMLElement | null;
    expect(label).not.toBeNull();
    expect(label!.textContent).toBe("Renamed Overlay");
  });

  it("applyUserState(id) renames a layer through the id path", () => {
    // Covers line 165: applyNameProjection in the `if (id)` branch.
    // The item is null in this path, so only layerInfo.name is updated.
    seedIntentMap(ui, "name", { overlay1: "Renamed via id" });

    ui.applyUserState("overlay1");

    const li = manager.layerRegistry.get("overlay1");
    expect(li?.name).toBe("Renamed via id");
  });

  it("persists renamed names through the persistence scheduler", () => {
    // saveNamesState is the write half of the rename flow. Without a test
    // that reaches it, the function stays uncovered even though the read
    // path (applyUserState) is exercised.
    const schedule = vi.fn();
    const bare = {
      intentStore: makeStore({ overlay1: { name: "Renamed" } }),
      c: {
        persistence: { schedule },
        label: { configEntries: () => [] },
      },
    } as unknown as LayerUI;

    saveNamesState(bare);

    const fields = schedule.mock.calls[0][0] as {
      renamedNames: () => Record<string, string>;
    };
    expect(fields.renamedNames()).toEqual({ overlay1: "Renamed" });
  });

  // ─────────────────── intents.visible single-source regressions ───────────────────

  it("hide → restore → reload lands on the same visible state each pass", () => {
    // The value and the provenance write in one call; a reload must derive the
    // same intents.visible back from the stored record so the choice survives the
    // round trip in both directions.
    const first = new LayerUI(manager, TEST_ENV);
    vi.useFakeTimers();
    first.setVisibleIntent("overlay1", false);
    vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);
    vi.useRealTimers();

    // Reload pass 1: the hide comes back as intent, not as the author default.
    const u2 = new LayerUI(manager, TEST_ENV);
    u2.loadPersistedState();
    expect(u2.intentStore.dumpIntents()).toEqual({ overlay1: { visible: false } });
    expect(u2.intentVisible("overlay1")).toBe(false);
    expect(u2.intentStore.dumpProvenance().overlay1).toEqual(["visible"]);

    // Restore, then reload pass 2: the value flips to true, provenance stays.
    vi.useFakeTimers();
    u2.setVisibleIntent("overlay1", true);
    vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);
    vi.useRealTimers();

    const u3 = new LayerUI(manager, TEST_ENV);
    u3.loadPersistedState();
    expect(u3.intentStore.dumpIntents()).toEqual({ overlay1: { visible: true } });
    expect(u3.intentVisible("overlay1")).toBe(true);
    expect(u3.intentStore.dumpProvenance().overlay1).toEqual(["visible"]);
  });

  it("toggle back and forth never leaves the value and provenance out of step", () => {
    // A toggle is a value write + a provenance marker in the same call. Rapid
    // toggles must end with the *last* choice in both halves — the record must
    // not drift to an intermediate state or drop the marker.
    vi.useFakeTimers();
    ui.setVisibleIntent("overlay1", false);
    ui.setVisibleIntent("overlay1", true);
    ui.setVisibleIntent("overlay1", false);
    vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);
    vi.useRealTimers();

    expect(ui.intentStore.dumpIntents()).toEqual({ overlay1: { visible: false } });
    expect(ui.intentStore.dumpProvenance().overlay1).toEqual(["visible"]);

    const stored = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY)!).data;
    expect(stored.layers.overlay1).toEqual({
      visible: false,
      overrides: ["visible"],
    });

    // Un-hide once more: the last write wins in both halves.
    vi.useFakeTimers();
    ui.setVisibleIntent("overlay1", true);
    vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);
    vi.useRealTimers();

    expect(ui.intentStore.dumpIntents()).toEqual({ overlay1: { visible: true } });
    expect(ui.intentStore.dumpProvenance().overlay1).toEqual(["visible"]);
  });

  it("a layer deleted then re-registered starts from a clean intent", () => {
    // dropPersistedLayerState erases the value and the provenance together; a
    // later re-registration must not see a stale hidden flag.
    seedIntentMap(ui, "visible", { overlay1: false });
    ui.intentStore.replaceProvenance({ overlay1: ["visible"] });

    dropPersistedLayerState(ui, "overlay1");

    expect(ui.intentStore.dumpIntents()).toEqual({});
    expect(ui.intentStore.dumpProvenance()).toEqual({});

    // Re-registration replays the now-empty state: author default wins.
    ui.applyUserState("overlay1");
    expect(ui.intentVisible("overlay1")).toBe(true);
  });

  it("a value written directly (no provenance) still projects as user intent", () => {
    // A restored record or a test fixture can write the value without the
    // marker. The projection reads either half as "the user chose this" — a
    // bare intents.visible entry must never fall back to the author default.
    const u = new LayerUI(manager, TEST_ENV);
    seedIntentMap(u, "visible", {});
    setIntent(u, "overlay1", "visible", false);
    u.intentStore.seedProvenance("overlay1", []);

    expect(u.intentVisible("overlay1")).toBe(false);
  });
});

// ── Notification-contract cases, moved from the former
// ── notifyContract.test.ts so they live with the script they drive. ──
it("a full replay announces after the direct style writes have landed", () => {
  // The full sweep projects visible / opacity / zoomRange and only reports
  // what moved; border and fill are direct `setStyle` writes that the shell
  // replays after it. Both land before the owning entry publishes, so a
  // subscriber reads the color the user stored rather than the author's that
  // the shell was about to overwrite. Driven through the control-attached
  // re-run, which is a real full replay from a real entry.
  const setStyle = vi.fn();
  const layer = polygonLayerWithStyle(
    { color: "#111111", fillColor: "#222222" },
    setStyle,
  );
  const { ui } = initFixture({
    data: [{ id: "overlay1", name: "Polygons", role: "overlay", layer }],
  });

  setIntent(ui, "overlay1", "borderColor", "#abcdef");
  // The hide is what gives the sweep a delta to report at all.
  setIntent(ui, "overlay1", "visible", false);
  ui.intentStore.seedProvenance("overlay1", ["borderColor", "visible"]);

  const borderAtDelivery: unknown[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    if (payload.id !== "overlay1") return;
    const writes = setStyle.mock.calls.map(call => call[0] as Record<string, unknown>);
    borderAtDelivery.push(writes.find(write => write.color !== undefined)?.color);
  });

  ui.events.publish(EVENTS.CONTROL_ATTACHED, { component: "HeatmapControl" });

  expect(borderAtDelivery).toEqual(["#abcdef"]);
});

describe("authorFoldedFolders derivation from CONF.folders", () => {
  it("derives the author default folded set on loadPersistedState", () => {
    window.CONFIG.folders = {
      overlay: [
        { name: "业务数据", folded: true },
        { name: "边界", folded: false },
      ],
      base: [{ name: "底图", folded: true }],
    };
    const { ui } = initFixture({
      data: [
        {
          id: "overlay1",
          name: "Polygons",
          role: "overlay",
          layer: polygonLayerWithStyle(
            { color: "#111111", fillColor: "#222222" },
            vi.fn(),
          ),
        },
      ],
    });
    ui.loadPersistedState();
    expect(ui.listPanel.authorFoldedFolders).toEqual(
      new Set(["overlay::业务数据", "base::底图"]),
    );
  });

  it("derives an empty set when CONF.folders is absent", () => {
    delete window.CONFIG.folders;
    const { ui } = initFixture({
      data: [
        {
          id: "overlay1",
          name: "Polygons",
          role: "overlay",
          layer: polygonLayerWithStyle(
            { color: "#111111", fillColor: "#222222" },
            vi.fn(),
          ),
        },
      ],
    });
    ui.loadPersistedState();
    expect(ui.listPanel.authorFoldedFolders).toEqual(new Set());
  });

  it("keeps author defaults separate from the user foldedRoles", () => {
    window.CONFIG.folders = {
      overlay: [{ name: "业务数据", folded: true }],
      base: [],
    };
    window.localStorage.setItem(
      CONST.STORAGE.KEY,
      JSON.stringify({ foldedRoles: { overlay: true } }),
    );
    const { ui } = initFixture({
      data: [
        {
          id: "overlay1",
          name: "Polygons",
          role: "overlay",
          layer: polygonLayerWithStyle(
            { color: "#111111", fillColor: "#222222" },
            vi.fn(),
          ),
        },
      ],
    });
    ui.loadPersistedState();
    // foldedRoles (user) is separate from authorFoldedFolders (author default):
    // they are two layers, never one set.
    expect(ui.listPanel.foldedRoles).toEqual({ overlay: true });
    expect(ui.listPanel.authorFoldedFolders).toEqual(new Set(["overlay::业务数据"]));
  });

  it("keeps a user-expanded author-folded role expanded across a reload", () => {
    // The KEY acceptance case: the author declares overlay folded; the user
    // expands it; a reload must keep it expanded (not snap back to the author
    // default). The false entry in the Record is what carries the opinion.
    window.CONFIG.roles = {
      overlay: { folded: true },
      base: { folded: false },
    };
    window.localStorage.setItem(
      CONST.STORAGE.KEY,
      JSON.stringify({ foldedRoles: { overlay: false } }),
    );
    const { ui } = initFixture({
      data: [
        {
          id: "overlay1",
          name: "Polygons",
          role: "overlay",
          layer: polygonLayerWithStyle(
            { color: "#111111", fillColor: "#222222" },
            vi.fn(),
          ),
        },
      ],
    });
    ui.loadPersistedState();
    // User opinion false (expand) recorded; author default says folded.
    expect(ui.listPanel.foldedRoles).toEqual({ overlay: false });
    expect(ui.listPanel.authorDefaultFoldedRoles).toEqual({
      overlay: true,
      base: false,
    });
    // Effective resolution: user expand wins over author fold → expanded.
    expect(
      effectiveRoleFolded(
        ui.listPanel.foldedRoles,
        ui.listPanel.authorDefaultFoldedRoles,
        "overlay",
      ),
    ).toBe(false);
  });
});
