// LayerControl UI — per-layer marker icon dimension (DOM/panel layer).
//
// The icon dimension is a WHOLE-LAYER choice: the user picks one glyph from
// a grid, and every marker leaf in the layer gets that glyph. There is no
// field, no per-category mapping, no legend — one layer, one icon.
//
// The write is a direct Leaflet call rather than a `setStyle` face: a
// marker's icon is `options.icon`, not a style slice. `FACE.ICON` rides the
// same frame coalescer as `FACE.SIZE` (both are non-`setStyle` faces), so a
// burst of edits lands one walk.
//
// The Leaflet-facing half (capture / derive / apply / reset walks) lives in
// core/leaflet/markerIcon.ts; this file keeps only the intent slot, the FACE
// schedule and the panel/trigger/grid DOM.
import { CAP_TIER, DIM } from "#core/layer/index.js";
import { GLYPH_NAMES, glyphHtml, resolveGlyph } from "#core/leaflet/glyphSource.js";
import {
  applyIconToLeaves,
  authorGlyphName as authorGlyphNameOnLayer,
  resetIconLeaves,
} from "#core/leaflet/markerIcon.js";
import { dom } from "#common/dom.js";
import { formRow } from "#ui/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { ICON_KIND, INTENT, type IconIntent, getIntent } from "../intent.js";
import type { LayerUI } from "../surface.js";
import { registerDimension, resetIntentKeys, writeIntentKeys } from "./registry.js";
import { FACE, cancelStyleDimApply, scheduleStyleDimApply } from "./styleBag.js";

/** Grid columns for the glyph picker popup. */
const GLYPH_GRID_COLS = 8;
/** The row gate: the layer must be in the registry, then its surface must
 *  declare the icon capability (a marker icon is not a `setStyle` face, so
 *  the capability slot is the one honest answer). */
const layerCanIcon = (ui: LayerUI, layerId: string): boolean => {
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (!layerInfo) return false;
  return ui.c.surfaceFor(layerInfo).capabilities.icon === CAP_TIER.NATIVE;
};

/** Apply the layer's stored glyph to every marker leaf, capturing each
 *  leaf's author icon on first write. A missing intent is a no-op — a layer
 *  the user never touched keeps exactly what the author declared. */
const applyIconToLayer = (ui: LayerUI, layerId: string): void => {
  const intent = getIntent(ui, layerId, INTENT.ICON);
  if (intent?.kind !== ICON_KIND.GLYPH) return;
  const layer = ui.c.findLayer(layerId);
  if (!layer) return;
  applyIconToLeaves(layer, intent.value);
};
/** Write the layer's glyph and replay the walk. */
const commitGlyph = (ui: LayerUI, layerId: string, glyph: string): void => {
  writeIntentKeys(ui, layerId, [
    [INTENT.ICON, { kind: ICON_KIND.GLYPH, value: glyph }],
  ]);
  scheduleStyleDimApply(FACE.ICON, layerId, () => applyIconToLayer(ui, layerId), {
    owner: ui,
  });
};
/** Reset the layer's icons to what the author drew and drop the persisted
 *  entry. The authored icons come from the core capture table, never from a
 *  re-read — a re-read would restore the user's own choice, and a layer that
 *  never wrote has nothing to restore anyway. A walk queued by a trailing
 *  edit is cancelled before the leaves are touched. */
const resetLayerIcon = (ui: LayerUI, layerId: string): void => {
  if (!ui.c.layerRegistry.has(layerId)) return;
  resetIntentKeys(ui, layerId, [INTENT.ICON]);
  cancelStyleDimApply(FACE.ICON, layerId, ui);
  const layer = ui.c.findLayer(layerId);
  if (!layer) return;
  resetIconLeaves(layer);
};
/** The current glyph name for the row, or null when the layer still shows
 *  the author's icon (uncovered). */
const currentGlyph = (ui: LayerUI, layerId: string): string | null => {
  const intent = getIntent(ui, layerId, INTENT.ICON);
  return intent?.kind === ICON_KIND.GLYPH ? intent.value : null;
};
/** The author's own glyph name when the layer's marker icon declares one
 *  we can render (awesome-markers/Leaflet put the name in
 *  `leaf.options.icon.options.icon`). Used for the row preview only — the
 *  write semantics are unchanged: an uncovered layer keeps the author icon.
 *  Walks leaves and returns the first recognized name, or null. */
const authorGlyphName = (ui: LayerUI, layerId: string): string | null => {
  const layer = ui.c.findLayer(layerId);
  if (!layer) return null;
  return authorGlyphNameOnLayer(layer);
};
/** Build the icon row: a trigger showing the current glyph (or the author's
 *  original, labelled 「原始」) plus a grid picker popup. The popup is a
 *  simple absolute-positioned grid anchored to the trigger; Esc / outside
 *  click / a glyph click close it. The grid is a 2D keyboard-accessible
 *  matrix (arrows + Enter), independent of the listbox engine's vertical
 *  list. */
const buildIconRow = (ui: LayerUI, layerId: string): HTMLElement | null => {
  if (!layerCanIcon(ui, layerId)) return null;
  const trigger = dom.el("button", {
    class: `${CONST.CLASSES.STYLE_ICON_TRIGGER} foliplus-form-select`,
    type: "button",
    "aria-haspopup": "grid",
    "aria-label": ui.T("style_icon"),
  }) as HTMLButtonElement;

  const glyphBox = dom.el("span", {
    class: CONST.CLASSES.STYLE_ICON_TRIGGER_GLYPH,
  }) as HTMLSpanElement;
  const nameBox = dom.el("span", {
    class: CONST.CLASSES.STYLE_ICON_TRIGGER_NAME,
  }) as HTMLSpanElement;
  trigger.append(glyphBox, nameBox);

  const renderTrigger = () => {
    // Covered: the user's glyph. Uncovered: the author's recognized glyph
    // (preview only — the write is still the author icon), else the
    // author-original label.
    const value = currentGlyph(ui, layerId) ?? authorGlyphName(ui, layerId);
    const glyph = value ? resolveGlyph(value) : null;
    if (value && glyph) {
      glyphBox.innerHTML = glyphHtml(glyph);
      nameBox.textContent = glyph;
      trigger.title = value;
    } else {
      glyphBox.innerHTML = "";
      nameBox.textContent = ui.T("style_icon_original");
      trigger.title = ui.T("style_icon_original");
    }
  };
  renderTrigger();

  const row = formRow(ui.T("style_icon"), trigger, CONST.CLASSES.STYLE_ICON_ROW);
  bindGlyphGrid(ui, layerId, trigger, row, renderTrigger);
  return row;
};
/** Open the glyph grid popup under the trigger and wire its interactions.
 *  The grid is built lazily on first open and re-rendered on every open so
 *  the current selection stays highlighted. */
const bindGlyphGrid = (
  ui: LayerUI,
  layerId: string,
  trigger: HTMLButtonElement,
  row: HTMLElement,
  renderTrigger: () => void,
): void => {
  let grid: HTMLElement | null = null;
  const close = () => {
    grid?.remove();
    grid = null;
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-activedescendant");
  };

  const open = () => {
    if (grid) return;
    grid = buildGlyphGrid(ui, layerId, trigger, close, renderTrigger);
    trigger.setAttribute("aria-expanded", "true");
    row.appendChild(grid);
    // Outside press closes.
    const onDoc = (ev: Event) => {
      if (grid && !grid.contains(ev.target as Node)) close();
    };
    document.addEventListener("pointerdown", onDoc, { once: true });
    grid.dataset.closeOnDoc = "1";
    grid.addEventListener("remove", () =>
      document.removeEventListener("pointerdown", onDoc),
    );
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        close();
        trigger.focus();
      }
    };
    document.addEventListener("keydown", onKey, { once: true });
    grid.dataset.closeOnKey = "1";
    grid.addEventListener("remove", () =>
      document.removeEventListener("keydown", onKey),
    );
  };

  trigger.onclick = () => {
    if (grid) close();
    else open();
  };
};
/** Build the glyph grid popup DOM: a 2D matrix of cells, current highlighted,
 *  hover tooltip = name, click applies + closes, arrows + Enter navigate. */
const buildGlyphGrid = (
  ui: LayerUI,
  layerId: string,
  trigger: HTMLButtonElement,
  close: () => void,
  renderTrigger: () => void,
): HTMLElement => {
  const current = currentGlyph(ui, layerId);
  const grid = dom.el("div", {
    class: CONST.CLASSES.STYLE_ICON_GRID,
    role: "grid",
    "aria-label": ui.T("style_icon"),
  }) as HTMLElement;
  const cells: HTMLButtonElement[] = [];

  for (const glyph of GLYPH_NAMES) {
    const cell = dom.el(
      "button",
      {
        class: CONST.CLASSES.STYLE_ICON_CELL,
        type: "button",
        role: "gridcell",
        title: glyph,
        "data-glyph": glyph,
        ...(glyph === current ? { "aria-current": "true" } : {}),
      },
      { html: glyphHtml(glyph) },
    ) as HTMLButtonElement;
    if (glyph === current) {
      cell.classList.add(CONST.CLASSES.STYLE_ICON_CELL_SELECTED);
    }
    cell.onclick = () => {
      commitGlyph(ui, layerId, glyph);
      renderTrigger();
      close();
    };
    cells.push(cell);
    grid.appendChild(cell);
  }

  // Keyboard: arrows move 2D, Enter/Space activates, Esc closes (handled above).
  const focusIndex = (index: number) => {
    if (index >= 0 && index < cells.length) cells[index]?.focus();
  };
  const currentIndex = () => cells.findIndex(c => c === document.activeElement);
  grid.addEventListener("keydown", ev => {
    const idx = currentIndex();
    if (idx < 0) return;
    const cols = GLYPH_GRID_COLS;
    let next = idx;
    if (ev.key === "ArrowRight") next = Math.min(cells.length - 1, idx + 1);
    else if (ev.key === "ArrowLeft") next = Math.max(0, idx - 1);
    else if (ev.key === "ArrowDown") next = Math.min(cells.length - 1, idx + cols);
    else if (ev.key === "ArrowUp") next = Math.max(0, idx - cols);
    else if (ev.key === "Home") next = 0;
    else if (ev.key === "End") next = cells.length - 1;
    else if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      cells[idx]?.click();
      return;
    } else return;
    ev.preventDefault();
    focusIndex(next);
  });
  return grid;
};
/** Register icon as a per-layer dimension. The descriptor owns the
 *  intent+persist slot; `commitGlyph` / `resetLayerIcon` stay as thin
 *  delegates so the direct callers keep one entry point. */
const ICON_DIMENSION = registerDimension<IconIntent>({
  key: DIM.ICON,
  gate: layerCanIcon,
  value: (ui, layerId) => getIntent(ui, layerId, INTENT.ICON),
  row: (ui, layerId) => buildIconRow(ui, layerId) as HTMLElement,
  write: (ui, layerId, patch) => {
    writeIntentKeys(ui, layerId, [[INTENT.ICON, patch]]);
    scheduleStyleDimApply(FACE.ICON, layerId, () => applyIconToLayer(ui, layerId), {
      owner: ui,
    });
  },
  reset: (ui, layerId) => resetLayerIcon(ui, layerId),
  valueSource: (ui, layerId) => {
    if (!layerCanIcon(ui, layerId)) return "none";
    return ui.intentStore.isUserSet(layerId, INTENT.ICON) ? "user" : "author";
  },
  contentChange: {
    kind: "frame",
    face: FACE.ICON,
    when: (ui, layerId) => getIntent(ui, layerId, INTENT.ICON) !== undefined,
    run: (ui, layerId) => applyIconToLayer(ui, layerId),
  },
});
export {
  ICON_DIMENSION,
  applyIconToLayer,
  buildIconRow,
  commitGlyph,
  layerCanIcon,
  resetLayerIcon,
};
