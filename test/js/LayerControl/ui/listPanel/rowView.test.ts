import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LayerInfo, LayerRuntimeStore, ROLE } from "#core/layer/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import { LayerIntentStore } from "#foliplus/LayerControl/domain/index.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { clearIntent, getIntent, setIntent } from "#foliplus/LayerControl/ui/intent.js";
import {
  type RowCell,
  applyRowView,
  buildRowCell,
  rowView,
  syncNoBasemap,
  syncToggleAll,
} from "#foliplus/LayerControl/ui/listPanel/index.js";
import { intentVisibleOf, projectLayer } from "#foliplus/LayerControl/ui/projection.js";
import * as Icons from "#common/icon.js";
import { findItem, initFixture } from "../fixture.js";

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
  it("falls back through the title chain for filtered and unfiltered cells", () => {
    expect(rowView(cell({ filtered: true, filterTitle: "2 / 3" }), LABELS).title).toBe(
      "2 / 3",
    );
    expect(
      rowView(
        cell({ filtered: true, filterTitle: undefined, titleTypeLabel: "Point" }),
        LABELS,
      ).title,
    ).toBe("Point");
    expect(
      rowView(
        cell({ filtered: true, filterTitle: undefined, titleTypeLabel: undefined }),
        LABELS,
      ).title,
    ).toBe("polygon");
    expect(
      rowView(cell({ countText: "4", titleTypeLabel: undefined }), LABELS).title,
    ).toBe("4 · polygon");
    expect(
      rowView(cell({ countText: "4", titleTypeLabel: "Point" }), LABELS).title,
    ).toBe("4 · Point");
    expect(
      rowView(cell({ countText: "", titleTypeLabel: undefined }), LABELS).title,
    ).toBe("polygon");
  });

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
    expect(rowView(cell({ countText: "12" }), LABELS).title).toBe("12 · polygon");
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
  ): LayerUI => {
    const intentStore = new LayerIntentStore();
    for (const id of hidden) intentStore.setValue(id, "visible", false);
    for (const [id, keys] of Object.entries(overrides)) {
      intentStore.seedProvenance(id, keys as never);
    }
    const runtimeStore = new LayerRuntimeStore();
    for (const [id, visible] of Object.entries(author)) {
      runtimeStore.setAuthorVisible(id, visible);
    }
    return {
      intentStore,
      runtimeStore,
    } as unknown as LayerUI;
  };

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
    ui.c.layers.find(li => li.id === "overlay1")!;

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
    expect(ui.runtimeStore.getAuthorVisible("overlay1")).toBe(true);
  });

  it("focus overrides the range: the row is shown again", () => {
    const { ui } = initFixture({
      initialZoom: 5,
      seed: { layers: { overlay1: { overrides: ["zoomRange"], zoomRange: [10, 18] } } },
    });
    ui.focusController.focusingLayerId = "overlay1";
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
    expect(getIntent(ui, "overlay1", "visible")).toBe(false);
    expect(buildRowCell(ui, layerInfo).checked).toBe(false);
    expect(box(item).checked).toBe(false);
    expect(item.classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);

    ui.applyVisibility("overlay1", true);
    expect(buildRowCell(ui, layerInfo).checked).toBe(true);
    expect(buildRowCell(ui, layerInfo).shown).toBe(true);
    expect(box(item).checked).toBe(true);
    expect(item.classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);
  });

  it("a provenance marker with no value reads as the user's show choice", () => {
    // A restored record can carry the marker without the value; the row must
    // read it as the user's choice (checked), not fall back to the author's
    // default. Same fallback as `intentVisibleOf` — this pins the inlined
    // variant in `buildRowCell`.
    const { ui } = initFixture({});
    const layerInfo = overlay(ui);
    ui.runtimeStore.setAuthorVisible("overlay1", false);
    ui.intentStore.seedProvenance("overlay1", ["visible"]);
    clearIntent(ui, "overlay1", "visible");

    expect(buildRowCell(ui, layerInfo).checked).toBe(true);
  });

  it("labels a base row with the base icon instead of probing the layer", () => {
    const { ui } = initFixture({});
    const base = ui.c.layers.find(li => li.id === "base1")!;
    const cellInfo = buildRowCell(ui, base);
    expect(cellInfo.typeSvg).toBe(Icons.ICON_GLOBE);
    expect(cellInfo.typeLabel).toContain("type_tile_map");
    // The tooltip's short word is the renamed pair (地图 / Map); both keys
    // carry the _map suffix so the row never borrows the color row's words.
    expect(cellInfo.titleTypeLabel).toContain("type_tile_map_short");
  });

  it("uses the custom icon when the layer declares one", () => {
    const { ui } = initFixture({
      data: [{ id: "custom1", name: "Custom", role: "overlay" }],
    });
    const layerInfo = ui.c.layers.find(li => li.id === "custom1")!;
    layerInfo.iconSvg = '<svg id="custom" />';
    const cellInfo = buildRowCell(ui, layerInfo);
    expect(cellInfo.typeSvg).toBe('<svg id="custom" />');
    // The row is a projection, not a writer: the snapshot stays null until
    // getLayerType stamps it (single-writer 33.2).
    expect(layerInfo.type).toBeNull();
  });

  it("shows the feature count in the count column and in the tooltip", () => {
    const { ui } = initFixture({});
    vi.spyOn(ui.c, "getFeatureCount").mockReturnValue(12);
    const layerInfo = overlay(ui);
    const cellInfo = buildRowCell(ui, layerInfo);
    expect(cellInfo.countText).toBe("12");
    expect(rowView(cellInfo, LABELS).title).toBe(
      `${cellInfo.countText} · ${cellInfo.titleTypeLabel}`,
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
    expect(el.title).toBe("4 · polygon");
  });

  it("updates the other fields when the row is missing one decoration", () => {
    const el = document.createElement("div");
    el.innerHTML = `<span class="${CONST.CLASSES.COUNT_COL}"></span>`;
    applyRowView(ui, el, cell({ countText: "9", checked: false, shown: true }));
    expect(el.querySelector<HTMLElement>(CONST.SEL.COUNT_COL)!.textContent).toBe("9");
    expect(el.classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);
    expect(el.getAttribute(CONST.DATA.TITLE)).toBe("polygon");
  });

  it("always titles the label with the full layer name", () => {
    const el = item();
    el.innerHTML += `<span class="${CONST.CLASSES.LAYER_LABEL}">Facility Points</span>`;
    document.body.appendChild(el);
    const label = el.querySelector<HTMLElement>(`.${CONST.CLASSES.LAYER_LABEL}`)!;

    // A short, unclipped name still carries the full name: no measurement
    // gate and no empty attribute. The row keeps its own count · type
    // sentence and never repeats the name.
    applyRowView(ui, el, cell({ name: "Facility Points", countText: "4" }));
    expect(label.title).toBe("Facility Points");
    expect(label.title).not.toBe("");
    expect(el.title).toBe("4 · polygon");
    expect(el.title).not.toContain("Facility Points");

    // A long name is the same resident attribute. No scrollWidth/clientWidth
    // stub: the implementation no longer measures, so the title does not
    // depend on jsdom reporting (or not reporting) a clip.
    applyRowView(ui, el, cell({ name: "Facility Points - North District 2024" }));
    expect(label.title).toBe("Facility Points - North District 2024");
    expect(label.title).not.toBe("");
    expect(el.title).toBe("polygon");
  });

  it("leaves the count cell titleless when unfiltered so the row tooltip bubbles", () => {
    const el = item();
    applyRowView(ui, el, cell({ name: "Alpha", countText: "4" }));
    const count = el.querySelector<HTMLElement>(CONST.SEL.COUNT_COL)!;
    expect(count.hasAttribute("title")).toBe(false);
    expect(count.getAttribute("aria-label")).toBe("4 · polygon");
    expect(el.title).toBe("4 · polygon");

    // Filtered: the count cell carries its own filtered sentence.
    applyRowView(
      ui,
      el,
      cell({ name: "Alpha", filtered: true, filterTitle: "2 / 3 filtered · polygon" }),
    );
    expect(count.title).toBe("2 / 3 filtered · polygon");
    expect(el.title).toBe("2 / 3 filtered · polygon");
  });

  it("clears the label title for an empty name instead of writing an empty one", () => {
    // Symmetric with updateItemLabel: an empty name removes the attribute so
    // the row tooltip can still bubble on hover.
    const el = item();
    el.innerHTML += `<span class="${CONST.CLASSES.LAYER_LABEL}">Old</span>`;
    const label = el.querySelector<HTMLElement>(`.${CONST.CLASSES.LAYER_LABEL}`)!;
    label.title = "Old";

    applyRowView(ui, el, cell({ name: "" }));

    expect(label.hasAttribute("title")).toBe(false);
  });

  it("titles a detached row's label immediately (no deferred measurement)", () => {
    const el = item();
    el.innerHTML += `<span class="${CONST.CLASSES.LAYER_LABEL}">Facility Points</span>`;
    const label = el.querySelector<HTMLElement>(`.${CONST.CLASSES.LAYER_LABEL}`)!;
    applyRowView(ui, el, cell({ name: "Facility Points" }));
    expect(el.isConnected).toBe(false);
    expect(label.title).toBe("Facility Points");
  });

  it("buildRowCell handles a thin stub with an empty LayerIntentStore", () => {
    // The `?? false` fallbacks on the inline intent check: a thin stub may
    // carry an empty LayerIntentStore, so the check must degrade to the author
    // default rather than crashing.
    const layerRegistry = new Map([["x", { id: "x", layer: { options: {} } }]]);
    const bare = {
      c: { findLayer: () => null, layerRegistry, getFeatureCount: () => 0 },
      renamedNames: {},
      intentStore: new LayerIntentStore(),
      runtimeStore: new LayerRuntimeStore(),
      focusController: { focusingLayerId: null },
      listPanel: { checkedCount: {}, foldedRoles: new Set<string>() },
      T: (k: string) => k,
      config: { locale_code: "en" },
    } as unknown as LayerUI;

    const info = { id: "x", layer: { options: {} } } as LayerInfo;
    const result = buildRowCell(bare, info);
    expect(result.checked).toBe(true);
    expect(result.shown).toBe(true);
  });
});

describe("intentVisibleOf: what counts as the user's choice", () => {
  it("a bare intents.visible entry is already a choice — the row reads unchecked", () => {
    // `setVisibleIntent` always marks, but a restored record or a direct write
    // can leave an entry without its provenance marker. Either half is the
    // user's choice; only the author's default is the fallback.
    const { ui } = initFixture({});
    const layerInfo = ui.c.layers.find(li => li.id === "overlay1")!;
    ui.intentStore.seedProvenance("overlay1", []);
    setIntent(ui, "overlay1", "visible", false);
    expect(intentVisibleOf(ui, layerInfo.id)).toBe(false);
  });

  it("neither half present falls back to the author's declared default", () => {
    const { ui } = initFixture({});
    const layerInfo = ui.c.layers.find(li => li.id === "overlay1")!;
    ui.intentStore.seedProvenance("overlay1", []);
    clearIntent(ui, "overlay1", "visible");
    ui.runtimeStore.setAuthorVisible("overlay1", false);
    expect(intentVisibleOf(ui, layerInfo.id)).toBe(false);
  });
});

describe("the four readers agree on a half-broken record", () => {
  it("a VISIBLE marker without a value reads as show everywhere", () => {
    // `loadPersistedState` restores `overrides` markers wholesale but writes a
    // dimension's value only when it passes the LIVE type check, so "marker,
    // no value" is real state. The canonical readers read it as the user's
    // show choice (`?? true`); the sync counters used to inline a copy that
    // dropped the fallback and counted the row as hidden while its checkbox
    // read checked. All four must agree.
    const { ui } = initFixture({});
    const li = ui.c.layers.find(l => l.id === "overlay1")!;
    const base = ui.c.layers.find(l => l.id === "base1")!;
    ui.runtimeStore.setAuthorVisible("overlay1", false);
    ui.runtimeStore.setAuthorVisible("base1", false);
    ui.intentStore.seedProvenance("overlay1", ["visible"]);
    ui.intentStore.seedProvenance("base1", ["visible"]);
    clearIntent(ui, "overlay1", "visible");
    clearIntent(ui, "base1", "visible");

    expect(intentVisibleOf(ui, "overlay1")).toBe(true);
    expect(projectLayer(ui, li).intent.visible).toBe(true);
    expect(buildRowCell(ui, li).checked).toBe(true);
    expect(intentVisibleOf(ui, "base1")).toBe(true);
    expect(projectLayer(ui, base).intent.visible).toBe(true);
    expect(buildRowCell(ui, base).checked).toBe(true);

    // The sync counters agree: the overlay row counts as on, the base row
    // keeps the no-basemap hatch off.
    syncToggleAll(ui, ROLE.OVERLAY);
    expect(ui.listPanel.checkedCount[ROLE.OVERLAY]).toEqual({ total: 1, on: 1 });
    syncNoBasemap(ui);
    expect(ui.c.map.getContainer().classList.contains(CONST.CLASSES.NO_BASE_MAP)).toBe(
      false,
    );
  });
});

// ── Static guard: the row visual is painted from one writer ─────
//
// LayerControl's layer row has five visual slots: the checkbox state, the
// ACTIVE highlight class, the feature-count column, the type-icon column,
// and the row tooltip. `applyRowView` (ui/rowView.ts) is the single writer
// for all five — every site that paints a row's decoration calls it with a
// RowCell and lets it write the DOM, rather than writing fields by hand.
//
// This scan is what keeps that invariant enforced. Without it, the claim
// "all row visual writes converge on one writer" is a code review convention,
// not a machine-checkable rule.
//
// WHAT THIS COVERS — six patterns, one per write operation:
//
//   1. checkbox.checked   — `(input|checkbox).checked =`
//      Slot 1. Variable-name-anchored: the writer and the two known consumers
//      use `input` and `checkbox`. A rename to `cb` or `el` would slip past.
//
//   2. ACTIVE class       — `item.classList.add|remove|toggle(...ACTIVE)`
//      Slot 2. Receiver-anchored on `item`, the row element. Scoped to
//      LayerControl because `CONST.CLASSES.ACTIVE` is shared with
//      MeasureControl (tool buttons) and HeatmapControl (scheme items) —
//      those are different components' own UI, not layer rows.
//
//   3. count column       — `CONST.SEL.COUNT_COL`
//      Slot 3. The selector constant is exclusive to rowView.ts. Any
//      reference outside the writer is a bypass.
//
//   4. type icon          — `querySelector(...TYPE_ICON_COL)`
//      Slot 4. The selection that precedes the innerHTML write. Anchored on
//      `querySelector` rather than the constant because list.ts also names
//      `TYPE_ICON_COL` in a `class:` property (DOM construction, not a state
//      write). The raw CSS string `.foliplus-type-icon-col` would slip past.
//
//   5. row data-title     — `setAttribute(...DATA.TITLE)`
//      Slot 5a. The data attribute that persists the type label. Anchored on
//      `setAttribute` because list.ts also names `DATA.TITLE` in an object
//      literal (`[CONST.DATA.TITLE]: colorType`) — construction, not a write.
//
//   6. row HTML title     — `item.title =`
//      Slot 5b. Receiver-anchored on `item`. Scoped to LayerControl because
//      HeatmapControl also writes `item.title` on its own UI items.
//
// STILL NOT CAUGHT, and worth knowing:
//
//   - A variable other than `input` / `checkbox` for a row checkbox:
//     `const cb = item.querySelector(...); cb.checked = false`.
//   - A variable other than `item` for the row element:
//     `const el = ...; el.classList.remove(CONST.CLASSES.ACTIVE)`.
//   - The raw CSS class string instead of the constant:
//     `item.querySelector(".foliplus-type-icon-col")`.
//   - A selector held in a variable:
//     `const sel = CONST.SEL.COUNT_COL; item.querySelector(sel)`.
//   - The checkbox tooltip alone (slot 5b's sibling):
//     `input.title = "…"` without a simultaneous `input.checked =` write.
//     The style panel (zoomRange.ts) writes `input.title` on its own inputs,
//     so the pattern cannot be anchored on `input.title` without a false
//     positive. A bypass that updates the tooltip without the checkbox state
//     would not be caught.
//
// Comments are stripped before matching, so the prose above and in the
// sources may name the fields freely. String literals are deliberately NOT
// stripped: patterns 3, 4, and 5a read from them.
//
// Widening the scan: add a pattern to PATTERNS, or loosen an anchor. The
// whitelist (OUT_OF_CHARTER) is the only way to permit an exception — every
// entry names the file, the slot, the count, and the reason.
//
// ── Patterns ───────────────────────────────────────────────────

type GuardPattern = {
  /** Which visual slot this pattern guards. */
  slot: string;
  /** The regex to match. */
  re: RegExp;
  /** If set, only scan files whose path contains this substring. */
  scope?: string;
};

const PATTERNS: GuardPattern[] = [
  {
    slot: "checkbox.checked",
    re: /\b(?:input|checkbox)\.checked\s*=/g,
  },
  {
    slot: "ACTIVE class",
    re: /\bitem\.classList\.(?:add|remove|toggle)\s*\([^)]*ACTIVE/g,
    scope: "LayerControl/",
  },
  {
    slot: "count column",
    re: /\bCONST\.SEL\.COUNT_COL\b/g,
  },
  {
    slot: "type icon",
    re: /\bquerySelector[^)]*TYPE_ICON_COL/g,
  },
  {
    slot: "row data-title",
    re: /\bsetAttribute\([^)]*DATA\.TITLE/g,
  },
  {
    slot: "row title",
    re: /\bitem\.title\s*=/g,
    scope: "LayerControl/",
  },
];

// ── Whitelist ──────────────────────────────────────────────────

// Counted exceptions to the charter, named by file, slot, count, and reason.
// A new reach in a whitelisted file beyond the recorded count still fails.
//
// The first entry is the momentary flip in focus/index.ts — a toggle that
// dispatches `change`, which triggers applyUserState → applyRowView and
// redraws the row from the corrected intent. It is a transient input flip,
// not a terminal visual write, so the guard permits it.
//
const OUT_OF_CHARTER: ReadonlyArray<{
  file: string;
  slot: string;
  n: number;
  reason: string;
}> = [
  {
    file: "LayerControl/ui/focus/index.ts",
    slot: "checkbox.checked",
    n: 1,
    reason: `momentary flip: checkbox.checked = !checkbox.checked → dispatchEvent('change') → applyUserState → applyRowView redraws the row from corrected intent`,
  },
];

// ── Path resolution and scanning ───────────────────────────────

const WRITER = "LayerControl/ui/listPanel/rowView.ts";

const REPO_ROOT = process.cwd();
const JS_ROOT = resolve(REPO_ROOT, "foliplus/js");

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
};

const rel = (p: string) => p.slice(REPO_ROOT.length + 1).replace(/\\/g, "/");

const COMMENT_RE = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
const codeOnly = (src: string): string => src.replace(COMMENT_RE, " ");
const code = (p: string) => codeOnly(readFileSync(p, "utf-8"));

const sources = walk(JS_ROOT);

/** Count matches of `re` in the code of `filePath`. */
const matchCount = (filePath: string, re: RegExp): number => {
  const src = code(filePath);
  re.lastIndex = 0;
  return (src.match(re) || []).length;
};

/** Whether a file path falls within a pattern's scope. */
const inScope = (relPath: string, scope: string | undefined): boolean => {
  if (!scope) return true;
  return relPath.includes(scope);
};

// Build the allowance map: file → slot → count.
const allowances = new Map<string, Map<string, number>>();
for (const { file, slot, n } of OUT_OF_CHARTER) {
  const key = `foliplus/js/${file}`;
  if (!allowances.has(key)) allowances.set(key, new Map());
  allowances.get(key)!.set(slot, n);
}

// ── Tests ──────────────────────────────────────────────────────

describe("applyRowView is the only module writing row visual slots", () => {
  it("scans a non-trivial production tree", () => {
    expect(sources.length).toBeGreaterThanOrEqual(80);
  });

  it("confines every row visual write to the writer or to a counted exception", () => {
    // The exception list holds exactly one entry (focus/index.ts). That is the
    // state the guard asserts on, so a
    // new allowance shows up as an edit to the array and to this assertion
    // together, not as a quietly widened scan.
    expect(OUT_OF_CHARTER).toHaveLength(1);

    const problems: string[] = [];
    for (const file of sources) {
      const name = rel(file);
      if (name === `foliplus/js/${WRITER}`) continue;

      const fileAllowances = allowances.get(name);
      for (const pattern of PATTERNS) {
        if (!inScope(name, pattern.scope)) continue;
        const found = matchCount(file, pattern.re);
        const allowed = fileAllowances?.get(pattern.slot) ?? 0;
        if (found > allowed) {
          problems.push(
            `${name}: "${pattern.slot}" ${found}${allowed ? ` > ${allowed}` : " (no allowance)"}`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("every counted exception is still exactly as large as recorded", () => {
    // An allowance that outlives its reach would quietly cover the next one.
    for (const { file, slot, n } of OUT_OF_CHARTER) {
      const pattern = PATTERNS.find(p => p.slot === slot);
      expect(pattern, `no pattern for slot "${slot}"`).toBeDefined();
      const path = resolve(JS_ROOT, file);
      expect(matchCount(path, pattern!.re), file).toBe(n);
    }
  });

  it("the writer really holds all of them, so the scan cannot pass vacuously", () => {
    // A pattern that matches nothing in rowView.ts would mean the scan
    // passes vacuously — it guards a slot the writer does not own.
    const writerPath = resolve(JS_ROOT, WRITER);
    for (const pattern of PATTERNS) {
      if (!inScope(`foliplus/js/${WRITER}`, pattern.scope)) continue;
      expect(matchCount(writerPath, pattern.re), pattern.slot).toBeGreaterThanOrEqual(
        1,
      );
    }
  });
});

// ── Pattern unit tests ─────────────────────────────────────────
//
// Each test exercises the anchors that make the pattern work, and the false
// friends the anchors keep out. These are the same shapes that appear in
// the production tree, not synthetic ones.

describe("pattern anchors", () => {
  const matched = (src: string, re: RegExp): string[] => {
    re.lastIndex = 0;
    return src.match(re) ?? [];
  };

  it("slot 1: catches checked writes on input and checkbox variables", () => {
    const re = PATTERNS[0].re;
    expect(matched("input.checked = view.checked", re)).toHaveLength(1);
    expect(matched("checkbox.checked = !checkbox.checked", re)).toHaveLength(1);
    expect(matched("if (input) input.checked = false", re)).toHaveLength(1);
  });

  it("slot 1: does not match other checkbox variables", () => {
    // labelControl.ts uses showInput and collideInput for its own checkboxes.
    // visibility.ts uses allCb for the select-all checkbox. None are row
    // checkboxes, and the variable-name anchor keeps them out.
    const re = PATTERNS[0].re;
    expect(matched("showInput.checked = !!v.labelShow", re)).toEqual([]);
    expect(matched("collideInput.checked = v.labelCollide !== false", re)).toEqual([]);
    expect(matched("allCb.checked = allChecked", re)).toEqual([]);
    // The residual gap: a rename to `cb` or `el` would slip past.
    expect(matched("cb.checked = false", re)).toEqual([]);
  });

  it("slot 2: catches classList writes to ACTIVE on item variables", () => {
    const re = PATTERNS[1].re;
    expect(
      matched("item.classList.toggle(CONST.CLASSES.ACTIVE, view.active)", re),
    ).toHaveLength(1);
    expect(matched("item.classList.remove(CONST.CLASSES.ACTIVE)", re)).toHaveLength(1);
    expect(matched("item.classList.add(CONST.CLASSES.ACTIVE)", re)).toHaveLength(1);
  });

  it("slot 2: does not match non-row ACTIVE writes", () => {
    const re = PATTERNS[1].re;
    // MeasureControl writes ACTIVE on tool buttons, not row items.
    expect(
      matched(
        "btn.classList.toggle(CONST.CLASSES.ACTIVE, btn.dataset.mode === mode)",
        re,
      ),
    ).toEqual([]);
    // The map container is not a row item.
    expect(
      matched("ui.c.map.getContainer().classList.add(CONST.CLASSES.ACTIVE)", re),
    ).toEqual([]);
    // The color item is not a layer row.
    expect(matched("?.classList.add(CONST.CLASSES.ACTIVE)", re)).toEqual([]);
    // Residual gap: a rename of `item` to `el` would slip past.
    expect(matched("el.classList.remove(CONST.CLASSES.ACTIVE)", re)).toEqual([]);
  });

  it("slot 3: catches the count column selector", () => {
    const re = PATTERNS[2].re;
    expect(matched("item.querySelector(CONST.SEL.COUNT_COL)", re)).toHaveLength(1);
    // The class constant (used in list.ts for DOM construction) is not the
    // selector — the guard anchors on SEL, which is the selector namespace.
    expect(matched("class: CONST.CLASSES.COUNT_COL", re)).toEqual([]);
  });

  it("slot 4: catches the type icon selection", () => {
    const re = PATTERNS[3].re;
    expect(
      matched("item.querySelector(`.${CONST.CLASSES.TYPE_ICON_COL}`)", re),
    ).toHaveLength(1);
    // list.ts names TYPE_ICON_COL in a class property, not a querySelector.
    expect(matched("class: CONST.CLASSES.TYPE_ICON_COL", re)).toEqual([]);
    // Residual gap: the raw CSS string would slip past.
    expect(matched('item.querySelector(".foliplus-type-icon-col")', re)).toEqual([]);
  });

  it("slot 5a: catches the data-title attribute write", () => {
    const re = PATTERNS[4].re;
    expect(
      matched("item.setAttribute(CONST.DATA.TITLE, view.typeLabel)", re),
    ).toHaveLength(1);
    // list.ts names DATA.TITLE in an object literal (construction, not a write).
    expect(matched("[CONST.DATA.TITLE]: colorType", re)).toEqual([]);
  });

  it("slot 5b: catches the row HTML title write", () => {
    const re = PATTERNS[5].re;
    expect(matched("item.title = view.title", re)).toHaveLength(1);
    // HeatmapControl writes item.title on its own UI items (different scope).
    expect(matched("item.title = name", re)).toHaveLength(1);
  });

  it("slot 5b: the checkbox tooltip is not guarded — documented gap", () => {
    // The writer writes both input.title (checkbox tooltip) and item.title
    // (row tooltip). The checkbox tooltip pattern (input.title =) is shared
    // with zoomRange.ts (style panel inputs), so it cannot be anchored on
    // `input.title` without a false positive. A bypass that updates only the
    // checkbox tooltip — without also writing input.checked — would not be
    // caught. The checked write (slot 1) is written alongside the tooltip in
    // the writer, so a simultaneous bypass of both is caught by slot 1.
    const re = PATTERNS[5].re;
    expect(matched("input.title = view.checkboxTitle", re)).toEqual([]);
    expect(matched("input.title = `x ${value}`", re)).toEqual([]);
  });
});
