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
import { ICON_KIND, INTENT, type IconIntent, getIntent } from "../intent.js";
import type { LayerUI } from "../surface.js";
import {
  capabilityGate,
  registerDimension,
  resetIntentKeys,
  writeIntentKeys,
} from "./registry.js";
import { FACE, cancelStyleDimApply, scheduleStyleDimApply } from "./styleBag.js";
import { ListCursor, claimKeys } from "#core/interaction/index.js";
import { DIM } from "#core/layer/index.js";
import {
  type AuthorGlyph,
  PICKER_GLYPHS,
  applyIconColorToLeaves,
  applyIconToLeaves,
  authorGlyphName as authorGlyphNameOnLayer,
  authorGlyphPrefix as authorGlyphPrefixOnLayer,
  glyphAvailable,
  glyphHtml,
  resetIconLeaves,
  resolveGlyph,
} from "#core/leaflet/index.js";
import { ensureOverlayRegistry } from "#core/overlay/index.js";
import { dom } from "#platform/dom.js";
import { POPUP_OVERLAY_RANK, formRow, nextOptionId } from "#ui/index.js";
import * as CONST from "#control/LayerControl/const.js";

/** Grid columns for the glyph picker popup. */
const GLYPH_GRID_COLS = 8;
/** The row gate: the layer must be in the registry, then its surface must
 *  declare the icon capability (a marker icon is not a `setStyle` face, so
 *  the capability slot is the one honest answer). */
const layerCanIcon = capabilityGate("icon", "native");

/** Apply the layer's stored glyph to every marker leaf, capturing each
 *  leaf's author icon on first write. A missing intent is a no-op — a layer
 *  the user never touched keeps exactly what the author declared. */
const applyIconToLayer = (ui: LayerUI, layerId: string): void => {
  const intent = getIntent(ui, layerId, INTENT.ICON);
  if (intent?.kind !== ICON_KIND.GLYPH) return;
  const layer = ui.c.findLayer(layerId);
  if (!layer) return;
  // Merge the current marker color + opacity into the SAME derived-icon
  // construction (the color is a separate dimension, but setIcon
  // replaces the whole icon, so a glyph edit must carry the current
  // color and a color edit must carry the current glyph).
  const color = getIntent(ui, layerId, INTENT.ICON_COLOR);
  const opacity = getIntent(ui, layerId, INTENT.ICON_COLOR_OPACITY);
  applyIconToLeaves(
    layer,
    intent.value,
    typeof color === "string" ? color : undefined,
    typeof opacity === "number" ? opacity : undefined,
  );
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
  // Orthogonal: a user-set marker color survives a glyph reset. Re-derive
  // the color on the freshly restored author icons so the color and the
  // glyph never split across two writes.
  const color = getIntent(ui, layerId, INTENT.ICON_COLOR);
  const opacity = getIntent(ui, layerId, INTENT.ICON_COLOR_OPACITY);
  if (typeof color === "string") {
    applyIconColorToLeaves(
      layer,
      color,
      currentGlyph(ui, layerId),
      typeof opacity === "number" ? opacity : undefined,
    );
  }
};
/** The current glyph name for the row, or null when the layer still shows
 *  the author's icon (uncovered). */
const currentGlyph = (ui: LayerUI, layerId: string): string | null => {
  const intent = getIntent(ui, layerId, INTENT.ICON);
  return intent?.kind === ICON_KIND.GLYPH ? intent.value : null;
};
/** The author's own glyph name when the layer's marker icon declares one
 *  (awesome-markers/Leaflet put the name in
 *  `leaf.options.icon.options.icon`). Used for the row preview only — the
 *  write semantics are unchanged: an uncovered layer keeps the author icon.
 *  Walks leaves and returns the first declared name with its syntax verdict
 *  (a valid name wins, else the first invalid declaration so a typo is never
 *  silently dropped), or null when no leaf declares a string icon name. */
const authorGlyphName = (ui: LayerUI, layerId: string): AuthorGlyph | null => {
  const layer = ui.c.findLayer(layerId);
  if (!layer) return null;
  return authorGlyphNameOnLayer(layer);
};
/** The author's FontAwesome family prefix for the layer (see authorGlyphPrefixOnLayer).
 *  Returns null when the layer declares no prefix — callers then fall back to
 *  the panel's fa-solid family. */
const authorGlyphPrefix = (ui: LayerUI, layerId: string): string | null => {
  const layer = ui.c.findLayer(layerId);
  if (!layer) return null;
  return authorGlyphPrefixOnLayer(layer);
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
    class: `${CONST.CLASSES.STYLE_ICON_TRIGGER} foliplus-input-skin foliplus-form-select`,
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
    // Covered: the user's glyph. Uncovered: the author's declared glyph
    // (preview only — the write is still the author icon), else the
    // author-original label.
    const userGlyph = currentGlyph(ui, layerId);
    const author = userGlyph ? null : authorGlyphName(ui, layerId);
    const authorPrefix = userGlyph ? null : authorGlyphPrefix(ui, layerId);
    const value = userGlyph ?? author?.name ?? null;
    const glyph = value ? resolveGlyph(value) : null;
    // The user's picked/persisted glyph renders in the panel's fa-solid family;
    // an author-declared glyph renders under the author's own prefix
    // (awesome-markers paints `prefix + " " + icon`) — probe the SAME stack so
    // a name the map actually draws is never reported unavailable.
    const available = glyph ? glyphAvailable(glyph, authorPrefix ?? "fa-solid") : false;
    // An author-declared name that fails glyph syntax is NEVER renderable, no
    // matter what the stylesheet paints — it gets its own unavailable state
    // rather than silently reading as the author-original label.
    const authorInvalid = !userGlyph && author !== null && !author.valid;
    if (value && glyph && available && !authorInvalid) {
      // The name is syntactically valid AND the loaded stylesheet paints it:
      // the happy path — show the glyph and its name.
      glyphBox.innerHTML = glyphHtml(glyph);
      nameBox.textContent = glyph;
      trigger.title = value;
      trigger.classList.remove(CONST.CLASSES.STYLE_ICON_TRIGGER_UNAVAILABLE);
    } else if (value) {
      // A name we cannot render. Two distinct reasons, two messages: an
      // author-invalid name (syntax failed — a typo, never paintable) vs a
      // syntactically valid name the loaded stylesheet does not paint.
      // Never silently show "Original" or a blank tofu — surface the actual
      // name in an explicit unavailable state (dashed-outline circle preview)
      // with a title/aria-label explaining the fallback.
      glyphBox.innerHTML = `<span class="${CONST.CLASSES.STYLE_ICON_UNAVAILABLE_GLYPH}" aria-hidden="true"></span>`;
      nameBox.textContent = value;
      const hint = (
        authorInvalid ? ui.T("style_icon_invalid") : ui.T("style_icon_unavailable")
      ).replace("{name}", value);
      trigger.title = hint;
      trigger.setAttribute("aria-label", hint);
      trigger.classList.add(CONST.CLASSES.STYLE_ICON_TRIGGER_UNAVAILABLE);
    } else {
      // No user glyph and no author-declared name: the true author-original
      // label. (An author-invalid declaration never reaches here — author.name
      // is non-null, so value is non-null and the unavailable branch above owns it.)
      glyphBox.innerHTML = "";
      nameBox.textContent = ui.T("style_icon_original");
      trigger.title = ui.T("style_icon_original");
      trigger.classList.remove(CONST.CLASSES.STYLE_ICON_TRIGGER_UNAVAILABLE);
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
  let unbind: (() => void) | null = null;
  let releaseClaim: (() => void) | null = null;
  const close = () => {
    // Pair the dismissal teardown with the close path (never a synthetic
    // `remove` event): unbind is captured once per open.
    unbind?.();
    unbind = null;
    // The grid owns the keyboard while it is open: release on close so the
    // layer list regains its arrows / Enter / Space.
    releaseClaim?.();
    releaseClaim = null;
    grid?.remove();
    grid = null;
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-activedescendant");
  };

  const open = () => {
    /* v8 ignore next -- defensive: trigger handler closes before re-opening */
    if (grid) return;
    const built = buildGlyphGrid(ui, layerId, trigger, close, renderTrigger);
    grid = built.grid;
    // While the grid is open it owns the arrow / Home / End / Enter / Space
    // keys: a press on a focused cell must move the grid cursor, not toggle a
    // layer row behind the popup. The claim makes the central dispatcher and
    // every other handler stand aside; released in close().
    releaseClaim = claimKeys(grid);
    trigger.setAttribute("aria-expanded", "true");
    row.appendChild(grid);
    // Put focus INTO the grid now that it is in the document — the real
    // ownership is DOM focus, the claim is only the dispatcher guard.
    built.focusInitial();
    // The overlay registry is the single Escape/outside-press dispatcher:
    // register the grid as a floating surface ranked above the style panel,
    // so one Escape closes the grid and the next closes the panel (one layer
    // at a time). The close path runs the same teardown the registry calls.
    unbind = ensureOverlayRegistry(ui.c.map).register({
      id: "layer.style.icon-grid",
      isOpen: () => grid !== null,
      panels: () => (grid ? [grid] : []),
      close: ({ restoreFocus }) => {
        close();
        if (restoreFocus) trigger.focus();
      },
      dismissOn: "mousedown",
      pressPriority: POPUP_OVERLAY_RANK,
      escapeRank: POPUP_OVERLAY_RANK,
    });
    grid.dataset.closeOnDoc = "1";
    grid.dataset.closeOnKey = "1";
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
): { grid: HTMLElement; focusInitial: () => void } => {
  const current = currentGlyph(ui, layerId);
  const grid = dom.el("div", {
    class: CONST.CLASSES.STYLE_ICON_GRID,
    role: "grid",
    "aria-label": ui.T("style_icon"),
  }) as HTMLElement;
  const cells: HTMLButtonElement[] = [];

  for (const glyph of PICKER_GLYPHS) {
    const cell = dom.el(
      "button",
      {
        class: CONST.CLASSES.STYLE_ICON_CELL,
        type: "button",
        role: "gridcell",
        title: glyph,
        "data-glyph": glyph,
        id: nextOptionId("icon-cell"),
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
      // The grid is gone: hand focus back to the trigger, the element that
      // opened it (a keyboard commit must not leave focus on a removed cell).
      trigger.focus();
    };
    cells.push(cell);
    grid.appendChild(cell);
  }

  // Keyboard: 2D walk via the shared ListCursor (arrows move row/column,
  // Home/End first/last, Enter/Space activate the focused cell — a <button>
  // fires its own click natively, which commits + closes). Esc is handled by
  // the dismissal primitive above. The grid keeps its own ARIA roles: the
  // cursor paints focus, not a listbox selection.
  const cursor = new ListCursor({
    root: grid,
    itemSelector: `.${CONST.CLASSES.STYLE_ICON_CELL}`,
    activeClass: "foliplus-icon-grid-cursor",
    mode: "roving",
    cols: GLYPH_GRID_COLS,
    roles: { list: "grid", item: "gridcell" },
    // Cells carry their own role/id from the shared id source below; the
    // cursor only paints focus + aria-activedescendant.
    paintOptionContract: false,
    // Enter/Space on a focused cell commits + closes (the cell's click).
    onActivate: (_, el) => (el as HTMLButtonElement).click(),
  });
  cursor.bindKeys(grid);
  // The popup must hold DOM focus on open: without it the key press goes to
  // the element that had focus (a row checkbox, a slider thumb) and toggles
  // the layer behind the popup — the claim alone cannot redirect a browser's
  // key, it only stands the dispatcher aside. Focus the current cell (or the
  // first) once the grid is appended; the cell is a real button so the
  // roving tabindex contract puts tabindex=0 on it.
  const focusInitial = (): void => {
    const initial = current
      ? cells.findIndex(cell => cell.getAttribute("data-glyph") === current)
      : -1;
    cursor.set(initial >= 0 ? initial : 0);
  };
  return { grid, focusInitial };
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
  currentGlyph,
  layerCanIcon,
  resetLayerIcon,
};
