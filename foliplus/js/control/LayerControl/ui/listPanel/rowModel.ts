// LayerControl UI — ListPanel row model: the panel's rows as data, not DOM.
//
// One build reads the registry, the intent/projection, the folder layout and
// the fold state and returns the panel's rows in document order. Rows are the
// projection input: `commitRows` diffs a build against the last committed one
// and touches only the rows that really changed. Nothing in this file writes
// the DOM, the map, the registry or storage — it is readable in a pure test.
import type { LayerUI } from "../surface.js";
import { displayBlocks, rolesWithHeader } from "./list.js";
import {
  type RowCell,
  buildRowCell,
  countLabelTitle,
  countTooltip,
  roleCountText,
  rowView,
} from "./rowView.js";
import { type RoleAggregates, roleAggregates } from "./visibility.js";
import { ROLE } from "#core/layer/index.js";
import { effectiveFolderFolded } from "#control/LayerControl/declaredFolder.js";
import { effectiveRoleFolded } from "#control/LayerControl/declaredRole.js";

/** Stable row identity across rebuilds: a layer row keys on the layer id, a
 *  group row on its role and (for folders) its folder key. `child:` is reserved
 *  for the container-expand child rows (#1284); nothing emits it yet — the
 *  child rows join this same model once #1284 is in main, not as a second row
 *  pipeline. */
type RowKey = string;

type RowKind = "role" | "folder" | "layer";

/** One row of the panel. Rows are in document order; hierarchy is carried by
 *  `role`, `member` and the folded flags — a folded row stays in the model
 *  (exactly as it stays mounted today) and is hidden by its class. */
interface RowModel {
  /** role:<role> | folder:<role>:<key> | layer:<id> */
  key: RowKey;
  kind: RowKind;
  role: string;
  /** Layer rows (and later child rows) only. */
  id?: string;
  /** Folder rows only. */
  folderKey?: string;
  /** The row's paint input; null for group rows (they paint counts, not cells). */
  cell: RowCell | null;
  /** Group rows: the aggregate count and its two title sentences. */
  countText: string;
  countTitle: string;
  typeTitle: string;
  /** The fold projection the chevron reads ("" on a layer row). */
  ariaExpanded: string;
  /** The row's own fold state (role header / folder row). */
  folded: boolean;
  /** Hidden because an ancestor is folded: the GROUP_FOLDED class. */
  groupFolded: boolean;
  /** Whether the row paints ACTIVE (a visible member exists). */
  active: boolean;
  /** Layer rows: folder member, and last member (the └ connector). */
  member: boolean;
  isLastMember: boolean;
  /** Layer rows: container/group row (GROUP_ROW class + group titles). */
  group: boolean;
  /** Cheap change signature: equal signature means the row needs no paint. */
  sig: string;
}

interface RowsModel {
  rows: RowModel[];
  /** One aggregate pass per role, shared by the role header and its folder rows. */
  roleAggregates: Map<string, RoleAggregates>;
}

/** The row sequence one role contributes: its header (when it owns one) and
 *  the block order the stacking code uses. */
const roleLabel = (role: string): string =>
  role === ROLE.BASE ? "base_map_label" : "data_layer_label";

const layerSignature = (row: RowModel, cell: RowCell): string =>
  [
    "L",
    row.role,
    cell.checked ? "1" : "0",
    cell.filtered ? "1" : "0",
    // The count cell's tooltip is its own paint input: a filtered row can keep
    // the same flag and count while the sentence changes (locale switch, a
    // different filtered sentence), and a signature without it would skip the
    // repaint. Symmetric with groupSignature's countTitle.
    row.countTitle,
    cell.countText,
    cell.name,
    cell.typeLabel,
    cell.group ? "1" : "0",
    cell.checked ? "a" : "-",
    cell.typeSvg,
    row.member ? "m" : "-",
    row.isLastMember ? "1" : "0",
    row.groupFolded ? "1" : "0",
  ].join("|");

/** The count cell's tooltip, as `applyRowView` writes it: the filtered sentence
 *  only, and no title at all on an unfiltered row (an empty title would swallow
 *  the row's own tooltip). Read through `rowView` — the same function the paint
 *  path uses — so the model cannot invent a second title formula. */
const layerCountTitle = (ui: LayerUI, cell: RowCell): string =>
  cell.filtered
    ? rowView(cell, {
        select: ui.T("select_tooltip"),
        deselect: ui.T("deselect_tooltip"),
      }).title
    : "";

/** The type cell's title: a group row names itself (count · what it is); a leaf
 *  row leaves the cell titleless and lets the row title bubble. */
const layerTypeTitle = (ui: LayerUI, cell: RowCell): string =>
  cell.group ? countLabelTitle(cell.countText, ui.T("noun_group")) : "";

const groupSignature = (row: RowModel): string =>
  [
    row.kind === "role" ? "R" : "F",
    row.role,
    row.folderKey ?? "",
    row.countText,
    row.countTitle,
    row.typeTitle,
    row.ariaExpanded,
    row.folded ? "1" : "0",
    row.groupFolded ? "1" : "0",
    row.active ? "1" : "0",
  ].join("|");

/** Build the panel's rows. Pure: a function of the UI's already-established
 *  state, so the same state always yields the same rows. */
const buildRowsModel = (ui: LayerUI): RowsModel => {
  const rows: RowModel[] = [];
  const aggregatesByRole = new Map<string, RoleAggregates>();
  const headerSeen = new Set<string>();

  const emitRole = (role: string): void => {
    if (headerSeen.has(role) || !rolesWithHeader(ui, role)) return;
    headerSeen.add(role);
    const aggregates = roleAggregates(ui, role);
    aggregatesByRole.set(role, aggregates);
    const roleFolded = effectiveRoleFolded(
      ui.listPanel.foldedRoles,
      ui.listPanel.authorDefaultFoldedRoles,
      role,
    );
    const countText = roleCountText(aggregates.total, aggregates.on);
    const countTitle = countTooltip(
      ui,
      "layers_count_tooltip",
      aggregates.on,
      aggregates.total,
    );
    const typeTitle = countLabelTitle(countText, ui.T(roleLabel(role)));
    const header: RowModel = {
      key: `role:${role}`,
      kind: "role",
      role,
      cell: null,
      countText,
      countTitle,
      typeTitle,
      ariaExpanded: roleFolded ? "false" : "true",
      folded: roleFolded,
      groupFolded: false,
      active: aggregates.on > 0,
      member: false,
      isLastMember: false,
      group: false,
      sig: "",
    };
    header.sig = groupSignature(header);
    rows.push(header);

    for (const block of displayBlocks(ui, role)) {
      if (block.kind === "folder") {
        const folderFolded = effectiveFolderFolded(
          ui.listPanel.authorFoldedFolders,
          ui.listPanel.foldedFolders,
          role,
          block.key,
        );
        const vis = aggregates.folders.get(block.key) ?? { total: 0, on: 0 };
        const folderCount = roleCountText(vis.total, vis.on);
        const folder: RowModel = {
          key: `folder:${role}:${block.key}`,
          kind: "folder",
          role,
          folderKey: block.key,
          cell: null,
          countText: folderCount,
          countTitle: countTooltip(ui, "layers_count_tooltip", vis.on, vis.total),
          typeTitle: countLabelTitle(folderCount, ui.T("noun_folder")),
          ariaExpanded: folderFolded ? "false" : "true",
          folded: folderFolded,
          groupFolded: roleFolded,
          active: vis.on > 0,
          member: false,
          isLastMember: false,
          group: false,
          sig: "",
        };
        folder.sig = groupSignature(folder);
        rows.push(folder);
        const members = block.block.members;
        members.forEach((info, idx) => {
          const cell = buildRowCell(ui, info);
          const row: RowModel = {
            key: `layer:${info.id}`,
            kind: "layer",
            role,
            id: info.id,
            cell,
            countText: cell.countText,
            countTitle: layerCountTitle(ui, cell),
            typeTitle: layerTypeTitle(ui, cell),
            ariaExpanded: "",
            folded: false,
            groupFolded: roleFolded || folderFolded,
            active: cell.checked,
            member: true,
            isLastMember: idx === members.length - 1,
            group: Boolean(cell.group),
            sig: "",
          };
          row.sig = layerSignature(row, cell);
          rows.push(row);
        });
      } else {
        const info = block.layer;
        const cell = buildRowCell(ui, info);
        const row: RowModel = {
          key: `layer:${info.id}`,
          kind: "layer",
          role,
          id: info.id,
          cell,
          countText: cell.countText,
          countTitle: layerCountTitle(ui, cell),
          typeTitle: layerTypeTitle(ui, cell),
          ariaExpanded: "",
          folded: false,
          groupFolded: roleFolded,
          active: cell.checked,
          member: false,
          isLastMember: false,
          group: Boolean(cell.group),
          sig: "",
        };
        row.sig = layerSignature(row, cell);
        rows.push(row);
      }
    }
  };

  const seenRoleOrder: string[] = [];
  for (const layerInfo of ui.c.layers) {
    if (!seenRoleOrder.includes(layerInfo.role)) {
      seenRoleOrder.push(layerInfo.role);
      emitRole(layerInfo.role);
    }
  }
  for (const role of [ROLE.OVERLAY, ROLE.BASE]) {
    if (!headerSeen.has(role)) emitRole(role);
  }

  return { rows, roleAggregates: aggregatesByRole };
};

export { buildRowsModel };
