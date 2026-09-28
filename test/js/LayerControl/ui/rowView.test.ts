import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GEOM_TYPE } from "#core/layer/index.js";
import type { LayerInfo } from "#core/layer/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { intentVisibleOf } from "#foliplus/LayerControl/ui/projection.js";
import {
  applyRowView,
  buildRowCell,
  rowView,
  snapshotAuthorVisible,
} from "#foliplus/LayerControl/ui/rowView.js";
import type { RowCell } from "#foliplus/LayerControl/ui/rowView.js";
import * as Icons from "#common/icon.js";
import { findItem, initFixture } from "./fixture.js";

const LABELS = { select: "Select", deselect: "Deselect" };

const cell = (over: Partial<RowCell> = {}): RowCell => ({
  id: "a",
  name: "A",
  checked: true,
  shown: true,
  countText: "",
  typeSvg: "<svg />",
  typeLabel: "polygon",
  ...over,
});

describe("rowView (pure projection)", () => {
  it.each([
    [true, true, true, "Deselect"],
    [true, false, true, "Deselect"],
    [false, true, false, "Select"],
    [false, false, false, "Select"],
  ])(
    "checked=%s shown=%s -> active=%s, tooltip=%s",
    (checked, shown, active, title) => {
      const view = rowView(cell({ checked, shown }), LABELS);
      expect(view.active).toBe(active);
      expect(view.checked).toBe(checked);
      expect(view.checkboxTitle).toBe(title);
    },
  );

  it("keeps the highlight whenever the box is checked, whatever the policy did", () => {
    // The highlight is the checkbox's own decoration. A layer the policy is
    // hiding (out of its stored zoom range) must not read as unchecked, or the
    // row would claim the user hid a layer they never touched. The policy's
    // decision still travels on the cell as `shown`; the out-of-range state
    // itself is signalled in the style panel.
    expect(rowView(cell({ checked: true, shown: false }), LABELS).active).toBe(true);
    expect(rowView(cell({ checked: false, shown: true }), LABELS).active).toBe(false);
  });

  it("titles the row as count + type, or the type alone", () => {
    expect(rowView(cell({ countText: "12" }), LABELS).title).toBe("12 polygon");
    expect(rowView(cell({ countText: "" }), LABELS).title).toBe("polygon");
  });

  it("passes the count, the icon, and the type label through unchanged", () => {
    const view = rowView(
      cell({ countText: "3", typeSvg: "<i/>", typeLabel: "line" }),
      LABELS,
    );
    expect(view.countText).toBe("3");
    expect(view.typeSvg).toBe("<i/>");
    expect(view.typeLabel).toBe("line");
  });
});

describe("intentVisibleOf (the intent seam)", () => {
  const intentUi = (
    overrides: Record<string, string[]> = {},
    hidden: string[] = [],
    author: Record<string, boolean> = {},
  ): LayerUI =>
    ({
      intentProvenance: overrides,
      hiddenLayerIds: new Set(hidden),
      authorVisible: new Map(Object.entries(author)),
    }) as unknown as LayerUI;

  const info = (id: string): LayerInfo => ({ id }) as LayerInfo;

  it.each([
    ["no override, no snapshot, defaults on", {}, [], {}, true],
    ["no override, author show=True", {}, [], { a: true }, true],
    ["no override, author show=False", {}, [], { a: false }, false],
    [
      "user re-checked a layer the author hid",
      { a: ["visible"] },
      [],
      { a: false },
      true,
    ],
    [
      "user unchecked a layer the author showed",
      { a: ["visible"] },
      ["a"],
      { a: true },
      false,
    ],
    [
      "other overrides do not count as a visible choice",
      { a: ["opacity"] },
      ["a"],
      { a: false },
      false,
    ],
  ])("%s -> %s", (_label, overrides, hidden, author, want) => {
    expect(intentVisibleOf(intentUi(overrides, hidden, author), "a")).toBe(want);
  });
});

describe("buildRowCell + applyRowView (one writer per row)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const overlay = (ui: LayerUI): LayerInfo =>
    ui.m.layers.find(li => li.id === "overlay1")!;

  const box = (item: HTMLElement): HTMLInputElement =>
    item.querySelector<HTMLInputElement>('input[type="checkbox"]')!;

  it("keeps the box checked while a stored zoom range hides the layer", () => {
    const { ui, map } = initFixture({
      initialZoom: 5,
      seed: { layers: { overlay1: { overrides: ["zoomRange"], zoomRange: [10, 18] } } },
    });
    const layerInfo = overlay(ui);
    const cellInfo = buildRowCell(ui, layerInfo);

    // The policy removed the layer from the map, but the row still reads as
    // checked: the highlight is the checkbox's own decoration, so a layer the
    // policy hid cannot look like one the user hid. The policy fact survives on
    // the cell as `shown` for the color-basemap fallback; nothing paints it on
    // the row itself.
    expect(cellInfo.checked).toBe(true);
    expect(cellInfo.shown).toBe(false);
    expect(map.removeLayer).toHaveBeenCalledWith(layerInfo.layer);

    const item = findItem(ui, "overlay1");
    expect(box(item).checked).toBe(true);
    expect(item.classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);

    // The snapshot recorded the author's default, not the policy's decision.
    expect(ui.authorVisible.get("overlay1")).toBe(true);
  });

  it("focus overrides the range: the row is shown again", () => {
    const { ui } = initFixture({
      initialZoom: 5,
      seed: { layers: { overlay1: { overrides: ["zoomRange"], zoomRange: [10, 18] } } },
    });
    ui.focusingLayerId = "overlay1";
    const cellInfo = buildRowCell(ui, overlay(ui));
    expect(cellInfo.checked).toBe(true);
    expect(cellInfo.shown).toBe(true);
  });

  it("stays shown while the zoom is inside the stored range", () => {
    const { ui } = initFixture({
      initialZoom: 5,
      seed: { layers: { overlay1: { overrides: ["zoomRange"], zoomRange: [3, 7] } } },
    });
    const cellInfo = buildRowCell(ui, overlay(ui));
    expect(cellInfo.checked).toBe(true);
    expect(cellInfo.shown).toBe(true);
    const item = findItem(ui, "overlay1");
    expect(box(item).checked).toBe(true);
    expect(item.classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);
  });

  it("a user hide unchecks the row; the re-check puts it back", () => {
    const { ui } = initFixture({});
    const layerInfo = overlay(ui);
    const item = findItem(ui, "overlay1");

    ui.applyVisibility("overlay1", false);
    expect(ui.hiddenLayerIds.has("overlay1")).toBe(true);
    expect(buildRowCell(ui, layerInfo).checked).toBe(false);
    expect(box(item).checked).toBe(false);
    expect(item.classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);

    ui.applyVisibility("overlay1", true);
    expect(buildRowCell(ui, layerInfo).checked).toBe(true);
    expect(buildRowCell(ui, layerInfo).shown).toBe(true);
    expect(box(item).checked).toBe(true);
    expect(item.classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);
  });

  it("labels a base row with the base icon instead of probing the layer", () => {
    const { ui } = initFixture({});
    const base = ui.m.layers.find(li => li.id === "base1")!;
    const cellInfo = buildRowCell(ui, base);
    expect(cellInfo.typeSvg).toBe(Icons.GLOBE_ICON);
    expect(cellInfo.typeLabel).toContain("type_base");
  });

  it("uses the custom icon when the layer declares one", () => {
    const { ui } = initFixture({
      data: [{ id: "custom1", name: "Custom", group: "overlay" }],
    });
    const layerInfo = ui.m.layers.find(li => li.id === "custom1")!;
    layerInfo.iconSvg = '<svg id="custom" />';
    const cellInfo = buildRowCell(ui, layerInfo);
    expect(cellInfo.typeSvg).toBe('<svg id="custom" />');
    expect(layerInfo.type).toBe(GEOM_TYPE.CUSTOM);
  });

  it("shows the feature count in the count column and in the tooltip", () => {
    const { ui } = initFixture({});
    vi.spyOn(ui.mgmt, "getFeatureCount").mockReturnValue(12);
    const layerInfo = overlay(ui);
    const cellInfo = buildRowCell(ui, layerInfo);
    expect(cellInfo.countText).toBe("12");
    expect(rowView(cellInfo, LABELS).title).toBe(
      `${cellInfo.countText} ${cellInfo.typeLabel}`,
    );

    const item = document.createElement("div");
    item.innerHTML = `<span class="${CONST.CLASSES.COUNT_COL}"></span>`;
    applyRowView(ui, item, cellInfo);
    expect(item.querySelector<HTMLElement>(CONST.SEL.COUNT_COL)!.textContent).toBe(
      "12",
    );
  });

  it("leaves the type icon column alone when there is nothing to paint", () => {
    const { ui } = initFixture({});
    const layerInfo = overlay(ui);
    const cellInfo = buildRowCell(ui, layerInfo);
    const item = document.createElement("div");
    item.innerHTML = `<div class="${CONST.CLASSES.TYPE_ICON_COL}">old</div>`;
    applyRowView(ui, item, { ...cellInfo, typeSvg: "" });
    expect(
      item.querySelector<HTMLElement>(`.${CONST.CLASSES.TYPE_ICON_COL}`)!.innerHTML,
    ).toBe("old");
  });
});

describe("applyRowView (the single DOM write point)", () => {
  const ui: LayerUI = { T: vi.fn((k: string) => k) } as unknown as LayerUI;

  const item = (): HTMLElement => {
    const el = document.createElement("div");
    el.innerHTML = `
      <input type="checkbox" />
      <span class="${CONST.CLASSES.COUNT_COL}"></span>
      <div class="${CONST.CLASSES.TYPE_ICON_COL}"></div>
    `;
    return el;
  };

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("writes the box, the highlight, the count, the icon, and both tooltips", () => {
    const el = item();
    applyRowView(ui, el, cell({ name: "Alpha", countText: "4", typeSvg: "<b/>" }));

    const input = el.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(input.checked).toBe(true);
    expect(input.title).toBe("deselect_tooltip");
    expect(input.getAttribute("aria-label")).toBe("Alpha");
    expect(el.classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);
    expect(el.querySelector<HTMLElement>(CONST.SEL.COUNT_COL)!.textContent).toBe("4");
    expect(
      el.querySelector<HTMLElement>(`.${CONST.CLASSES.TYPE_ICON_COL}`)!.innerHTML,
    ).toBe("<b></b>");
    expect(el.getAttribute(CONST.DATA.TITLE)).toBe("polygon");
    expect(el.title).toBe("4 polygon");
  });

  it("updates the other fields when the row is missing one decoration", () => {
    const el = document.createElement("div");
    el.innerHTML = `<span class="${CONST.CLASSES.COUNT_COL}"></span>`;
    applyRowView(ui, el, cell({ countText: "9", checked: false, shown: true }));
    expect(el.querySelector<HTMLElement>(CONST.SEL.COUNT_COL)!.textContent).toBe("9");
    expect(el.classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);
    expect(el.getAttribute(CONST.DATA.TITLE)).toBe("polygon");
  });

  it("buildRowCell handles undefined intentProvenance and hiddenLayerIds", () => {
    // The `?.` and `?? false` fallbacks on the inline intent check: a thin
    // stub may not have populated these maps yet, so the check must degrade to
    // the author default rather than crashing.
    const layerRegistry = new Map([["x", { id: "x", layer: { options: {} } }]]);
    const bare = {
      m: { findLayer: () => null, layerRegistry },
      mgmt: { getFeatureCount: () => 0 },
      renamedNames: {},
      authorVisible: new Map(),
      hiddenLayerIds: undefined,
      intentProvenance: undefined,
      zoomRangeMap: {},
      opacityMap: {},
      fillColorMap: {},
      fillOpacityMap: {},
      focusingLayerId: null,
      appliedState: new Map(),
      T: (k: string) => k,
      conf: { locale_code: "en" },
    } as unknown as LayerUI;

    const info = { id: "x", layer: { options: {} } } as LayerInfo;
    const result = buildRowCell(bare, info);
    expect(result.checked).toBe(true);
    expect(result.shown).toBe(true);
  });
});

describe("snapshotAuthorVisible", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reads the author's default from the map at boot, once per id", () => {
    const { ui, map } = initFixture({});
    const layerInfo = ui.m.layers.find(li => li.id === "overlay1")!;
    expect(ui.authorVisible.get("overlay1")).toBe(true);

    (map.hasLayer as ReturnType<typeof vi.fn>).mockReturnValue(false);
    snapshotAuthorVisible(ui, layerInfo);
    expect(ui.authorVisible.get("overlay1")).toBe(true);
  });

  it("leaves the snapshot unknown while the layer's object is not linked yet", () => {
    // Folium emits a layer's JS global *after* the control's IIFE, so at
    // attach a registry entry has no resolvable layer yet and there is no
    // honest map state to read. Latching the registry flag here would record
    // `true` for an author `show=False` layer and — the snapshot being
    // idempotent — keep the later correct reading out for good. That is the
    // exact path the show=False zoom-sweep gate covers.
    const { ui } = initFixture({});
    vi.spyOn(ui.m, "findLayer").mockReturnValue(null);
    snapshotAuthorVisible(ui, { id: "ghost", visible: true } as LayerInfo);
    snapshotAuthorVisible(ui, { id: "ghost-hidden", visible: false } as LayerInfo);
    expect(ui.authorVisible.has("ghost")).toBe(false);
    expect(ui.authorVisible.has("ghost-hidden")).toBe(false);
  });

  it("records the intent value for a canvas-only layer with no map to observe", () => {
    // A canvas layer never has a Leaflet layer to observe at any point, so
    // the snapshot reads the intent (`intentVisibleOf`) as its ground truth
    // — a leaflet layer reads the map, a canvas reads the intent record.
    // With no persisted dimension the intent falls back to the author
    // default of `true`, so both snapshots latch `true`; a test that
    // wants to distinguish must seed a hidden intent first.
    const { ui } = initFixture({});
    vi.spyOn(ui.m, "findLayer").mockReturnValue(null);
    snapshotAuthorVisible(ui, {
      id: "heat",
      canvas: document.createElement("canvas"),
    } as unknown as LayerInfo);
    snapshotAuthorVisible(ui, {
      id: "heat-hidden",
      canvas: document.createElement("canvas"),
    } as unknown as LayerInfo);
    expect(ui.authorVisible.get("heat")).toBe(true);
    expect(ui.authorVisible.get("heat-hidden")).toBe(true);

    // A persisted hidden choice for a canvas layer still latches false —
    // the intent record is the observation, not the layer's on-map state.
    snapshotAuthorVisible(ui, {
      id: "heat-mixed",
      canvas: document.createElement("canvas"),
    } as unknown as LayerInfo);
    ui.hiddenLayerIds.add("heat-mixed");
    ui.intentProvenance["heat-mixed"] = ["visible"];
    snapshotAuthorVisible(ui, {
      id: "heat-mixed",
      canvas: document.createElement("canvas"),
    } as unknown as LayerInfo);
    // The snapshot is idempotent — the first read wins.
    expect(ui.authorVisible.get("heat-mixed")).toBe(true);
  });

  it("lets a later pass latch the truth once the layer is linked", () => {
    // The unknown state is not a dead end: initTypesAndVisibility runs after
    // folium links its layers and must be able to record the real boot
    // membership. A `show=False` layer reads as `false` there.
    const { ui } = initFixture({});
    const find = vi.spyOn(ui.m, "findLayer").mockReturnValue(null);
    snapshotAuthorVisible(ui, { id: "late" } as LayerInfo);
    expect(ui.authorVisible.has("late")).toBe(false);

    const layer = { options: {} } as L.Layer;
    find.mockReturnValue(layer);
    (ui.m.map.hasLayer as ReturnType<typeof vi.fn>).mockReturnValue(false);
    snapshotAuthorVisible(ui, { id: "late" } as LayerInfo);
    expect(ui.authorVisible.get("late")).toBe(false);
  });
});

describe("intentVisibleOf: what counts as the user's choice", () => {
  it("a bare hiddenLayerIds entry is already a choice — the row reads unchecked", () => {
    // `syncHiddenId` always marks, but a restored record or a direct write
    // can leave an entry without its provenance marker. Either half is the
    // user's choice; only the author's default is the fallback.
    const { ui } = initFixture({});
    const layerInfo = ui.m.layers.find(li => li.id === "overlay1")!;
    ui.intentProvenance.overlay1 = undefined as never;
    delete ui.intentProvenance.overlay1;
    ui.hiddenLayerIds.add("overlay1");
    expect(intentVisibleOf(ui, layerInfo.id)).toBe(false);
  });

  it("neither half present falls back to the author's declared default", () => {
    const { ui } = initFixture({});
    const layerInfo = ui.m.layers.find(li => li.id === "overlay1")!;
    delete ui.intentProvenance.overlay1;
    ui.hiddenLayerIds.delete("overlay1");
    ui.authorVisible.set("overlay1", false);
    expect(intentVisibleOf(ui, layerInfo.id)).toBe(false);
  });
});
