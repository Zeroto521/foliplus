// Rows model golden tests — the model must describe exactly the rows the
// panel renders: same order, same keys, same painted attributes. This is the
// phase-1 safety net for the model-projection migration: the model is pure,
// the DOM is the current incremental path, and the two are compared row by row,
// attribute by attribute.
import { TileLayer, attachedPanel, initFixture } from "../fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE } from "#core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";
import { toggleFolderFold } from "#control/LayerControl/ui/listPanel/drag.js";
import { toggleFold } from "#control/LayerControl/ui/listPanel/index.js";
import { buildRowsModel } from "#control/LayerControl/ui/listPanel/rowModel.js";

/** One row as the migration cares about it: identity + painted attributes. */
interface Described {
  key: string;
  kind: string;
  role: string;
  folded: boolean;
  groupFolded: boolean;
  ariaExpanded: string | null;
  countText: string;
  countTitle: string;
  typeTitle: string;
  active: boolean;
  checked?: boolean;
  filtered?: boolean;
  name?: string;
  member?: boolean;
  isLast?: boolean;
  group?: boolean;
}

const rowKind = (el: HTMLElement): string => {
  if (el.classList.contains(CONST.CLASSES.TOGGLE_ALL)) return "role";
  if (el.classList.contains(CONST.CLASSES.FOLDER_ROW)) return "folder";
  return "layer";
};

const rowKey = (el: HTMLElement, kind: string): string => {
  if (kind === "role") return `role:${el.getAttribute(CONST.DATA.ROLE) ?? ""}`;
  if (kind === "folder") {
    return `folder:${el.getAttribute(CONST.DATA.ROLE) ?? ""}:${el.getAttribute(CONST.DATA.FOLDER_KEY) ?? ""}`;
  }
  return `layer:${el.getAttribute(CONST.DATA.LAYER_ID) ?? ""}`;
};

const cellText = (el: HTMLElement, selector: string): string =>
  // A filtered count cell is an SVG funnel plus the number; collapse the
  // markup's whitespace so the text still compares as the model's plain count.
  (el.querySelector<HTMLElement>(selector)?.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();

const cellTitle = (el: HTMLElement, selector: string): string =>
  el.querySelector<HTMLElement>(selector)?.getAttribute("title") ?? "";

/** Read the panel's current DOM as the same descriptor list the model yields. */
const describeRows = (ui: LayerUI): Described[] => {
  const container = attachedPanel(ui);
  const rows: Described[] = [];
  for (const child of Array.from(container.children)) {
    const el = child as HTMLElement;
    const kind = rowKind(el);
    const role =
      el.getAttribute(CONST.DATA.ROLE) ?? el.getAttribute("data-layer-type") ?? "";
    const countSel = `.${CONST.CLASSES.COUNT_COL}`;
    const typeSel = `.${CONST.CLASSES.TYPE_ICON_COL}`;
    const described: Described = {
      key: rowKey(el, kind),
      kind,
      role,
      folded: el.classList.contains(CONST.CLASSES.FOLDED),
      groupFolded: el.classList.contains(CONST.CLASSES.GROUP_FOLDED),
      // A role header carries aria-expanded on its fold button; a folder row
      // carries it on the row itself. Read whichever the row paints.
      ariaExpanded:
        kind === "role"
          ? (el
              .querySelector<HTMLElement>(`.${CONST.CLASSES.FOLD_BTN}`)
              ?.getAttribute("aria-expanded") ?? null)
          : el.getAttribute("aria-expanded"),
      countText: cellText(el, countSel),
      countTitle: cellTitle(el, countSel),
      // Group rows keep their type-cell title out of the golden comparison: the
      // current incremental path writes it once at render and never refreshes it
      // with the count cell, so the DOM carries a stale sentence. The drift is
      // pinned by its own test below; the model paints both cells from one row.
      typeTitle: kind === "layer" ? cellTitle(el, typeSel) : "",
      active: el.classList.contains(CONST.CLASSES.ACTIVE),
    };
    if (kind === "layer") {
      const input = el.querySelector<HTMLInputElement>('input[type="checkbox"]');
      const rail = el.querySelector<HTMLElement>(`.${CONST.CLASSES.RAIL_CELL}`);
      described.checked = input?.checked;
      described.filtered = el
        .querySelector<HTMLElement>(countSel)
        ?.classList.contains(CONST.CLASSES.COUNT_FILTERED);
      described.name =
        el.querySelector<HTMLElement>(`.${CONST.CLASSES.LAYER_LABEL}`)?.textContent ??
        "";
      described.member = Boolean(
        rail?.querySelector(
          `.${CONST.CLASSES.FOLD_TREE_MID}, .${CONST.CLASSES.FOLD_TREE_LAST}`,
        ),
      );
      described.isLast = Boolean(
        rail?.querySelector(`.${CONST.CLASSES.FOLD_TREE_LAST}`),
      );
      described.group = el.classList.contains(CONST.CLASSES.GROUP_ROW);
    }
    rows.push(described);
  }
  return rows;
};

/** The model row, read through the same descriptor shape. */
const describeModelRow = (
  ui: LayerUI,
  row: ReturnType<typeof buildRowsModel>["rows"][number],
): Described => {
  const described: Described = {
    key: row.key,
    kind: row.kind,
    role: row.role,
    folded: row.folded,
    groupFolded: row.groupFolded,
    ariaExpanded: row.ariaExpanded || null,
    countText: row.countText,
    countTitle: row.countTitle,
    typeTitle: row.kind === "layer" ? row.typeTitle : "",
    active: row.active,
  };
  if (row.kind === "layer") {
    described.checked = row.cell!.checked;
    described.filtered = row.cell!.filtered;
    described.name = row.cell!.name;
    described.member = row.member;
    described.isLast = row.isLastMember;
    described.group = row.group;
  }
  return described;
};

const describeModel = (ui: LayerUI): Described[] =>
  buildRowsModel(ui).rows.map(row => describeModelRow(ui, row));

const folderLayoutDoc = (keys: string[]) => ({
  version: 2,
  folders: keys.map(k => ({ key: k, name: k })),
  order: { overlay: keys },
  members: {},
});

describe("ui/listPanel row model is the panel's rows", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("mirrors a plain two-role panel row by row", () => {
    const { ui } = initFixture({
      data: [
        {
          id: "A",
          name: "Alpha",
          role: "overlay",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        {
          id: "B",
          name: "Beta",
          role: "overlay",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        { id: "B1", name: "Base", role: "base", layer: new TileLayer() },
      ],
    });
    const model = describeModel(ui);
    expect(model).toEqual(describeRows(ui));
    // The projection covers every rendered row, including the role headers and
    // the always-registered solid basemap.
    expect(model.map(r => r.key)).toContain(`layer:${CONST.SOLID_BASEMAP_ID}`);
    expect(model.filter(r => r.kind === "role").map(r => r.role)).toEqual(
      expect.arrayContaining([ROLE.OVERLAY, ROLE.BASE]),
    );
  });

  it("mirrors a folded role: the rows stay, the folded flags follow", () => {
    const { ui } = initFixture({
      data: [
        {
          id: "A",
          name: "Alpha",
          role: "overlay",
          layer: { options: {}, eachLayer: vi.fn() },
        },
      ],
    });
    toggleFold(ui, ROLE.OVERLAY);
    const model = describeModel(ui);
    expect(model).toEqual(describeRows(ui));
    expect(model.some(r => r.kind === "layer" && r.groupFolded)).toBe(true);
  });

  it("mirrors folder blocks, their members and the root rows between them", () => {
    const { ui } = initFixture({
      seedLayout: folderLayoutDoc(["a", "b"]),
      data: [
        {
          id: "a1",
          name: "A1",
          role: "overlay",
          folder: "a",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        {
          id: "b1",
          name: "B1",
          role: "overlay",
          folder: "b",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        {
          id: "R1",
          name: "Root",
          role: "overlay",
          layer: { options: {}, eachLayer: vi.fn() },
        },
      ],
    });
    const model = describeModel(ui);
    expect(model).toEqual(describeRows(ui));
    const keys = model.map(r => r.key);
    const folderAt = keys.indexOf("folder:overlay:a");
    expect(folderAt).toBeGreaterThan(-1);
    expect(keys[folderAt + 1]).toBe("layer:a1");
    expect(model.some(r => r.kind === "layer" && r.isLast)).toBe(true);
  });

  it("mirrors a filtered row: the funnel flag and the kept count", () => {
    const { ui } = initFixture({
      data: [
        {
          id: "F1",
          name: "Filtered",
          role: "overlay",
          layer: { options: {}, eachLayer: vi.fn() },
          filterProvider: () => ({
            filter: { op: "gt", value: 1 },
            kept: 3,
            total: 10,
          }),
        },
      ],
    });
    const model = describeModel(ui);
    expect(model).toEqual(describeRows(ui));
    const filtered = model.find(r => r.key === "layer:F1")!;
    expect(filtered.filtered).toBe(true);
    expect(filtered.countText).toBe("3");
  });

  it("mirrors a container row: the group flag, its child count and its title", () => {
    const groupLayer = {
      options: {},
      eachLayer: vi.fn(),
      addLayer: vi.fn(),
      getLayers: vi.fn(() => []),
      _layers: {},
    };
    const { ui } = initFixture({
      data: [{ id: "G1", name: "Group", role: "overlay", layer: groupLayer }],
    });
    const model = describeModel(ui);
    expect(model).toEqual(describeRows(ui));
    const group = model.find(r => r.key === "layer:G1")!;
    expect(group.group).toBe(true);
    expect(group.typeTitle).toContain("noun_group");
  });

  it("mirrors a folded folder: the header folds, its members hide by class", () => {
    const { ui } = initFixture({
      seedLayout: folderLayoutDoc(["a"]),
      data: [
        {
          id: "a1",
          name: "A1",
          role: "overlay",
          folder: "a",
          layer: { options: {}, eachLayer: vi.fn() },
        },
      ],
    });
    toggleFolderFold(ui, "overlay", "a");
    const model = describeModel(ui);
    expect(model).toEqual(describeRows(ui));
    const folder = model.find(r => r.key === "folder:overlay:a")!;
    expect(folder.folded).toBe(true);
    expect(folder.ariaExpanded).toBe("false");
    expect(model.find(r => r.key === "layer:a1")!.groupFolded).toBe(true);
  });

  it("mirrors an empty folder key: a header with a zero count", () => {
    const { ui } = initFixture({
      seedLayout: folderLayoutDoc(["empty"]),
      data: [
        {
          id: "A",
          name: "Alpha",
          role: "overlay",
          layer: { options: {}, eachLayer: vi.fn() },
        },
      ],
    });
    const model = describeModel(ui);
    expect(model).toEqual(describeRows(ui));
    expect(model.find(r => r.key === "folder:overlay:empty")!.countText).toBe("0");
  });

  it("mirrors a folded role that owns a folder: the folder header hides with it", () => {
    const { ui } = initFixture({
      seedLayout: folderLayoutDoc(["a"]),
      data: [
        {
          id: "a1",
          name: "A1",
          role: "overlay",
          folder: "a",
          layer: { options: {}, eachLayer: vi.fn() },
        },
      ],
    });
    toggleFold(ui, ROLE.OVERLAY);
    const model = describeModel(ui);
    expect(model).toEqual(describeRows(ui));
    expect(model.find(r => r.key === "folder:overlay:a")!.groupFolded).toBe(true);
  });

  it("models a coherent group row where the current path leaves a stale title", () => {
    // Pre-existing drift the projection removes: the count cell is refreshed on
    // every reconcile (writeRoleCount), but the type cell's "count · what it
    // is" sentence is written once at render. The color basemap registers one
    // pass later, so the base header shows the fresh count beside the stale
    // sentence. The model paints both cells from its one aggregate row, so the
    // commit phase makes them agree again.
    const { ui } = initFixture({
      data: [{ id: "B1", name: "Base", role: "base", layer: new TileLayer() }],
    });
    const baseRow = attachedPanel(ui).querySelector<HTMLElement>(
      `.${CONST.CLASSES.TOGGLE_ALL}[data-role="${ROLE.BASE}"]`,
    )!;
    const domCount = baseRow.querySelector<HTMLElement>(
      `.${CONST.CLASSES.COUNT_COL}`,
    )!.textContent;
    const domTypeTitle =
      baseRow
        .querySelector<HTMLElement>(`.${CONST.CLASSES.TYPE_ICON_COL}`)
        ?.getAttribute("title") ?? "";
    const modelRow = buildRowsModel(ui).rows.find(r => r.key === "role:base")!;
    expect(domCount).toBe(modelRow.countText);
    expect(domTypeTitle).toBe("1 · LayerControl.base_map_label");
    expect(modelRow.typeTitle).toBe("1/2 · LayerControl.base_map_label");
  });
});
