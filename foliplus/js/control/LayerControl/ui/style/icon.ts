// LayerControl UI — per-layer marker icon dimension.
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
// The authored icon is captured, not cloned. `setIcon` mutates
// `options.icon`, so reading it back after a write would feed the leaf its
// own last write; the author's icon is captured once per leaf on the first
// write (a WeakMap keyed by leaf, so a re-rendering GeoJSON recaptures
// honestly) and is what Reset restores from. A leaf with no explicit icon
// falls back to `L.Icon.Default.prototype` (Leaflet's shared default), so
// Reset always has a target.
//
// The glyph swap uses the DERIVE approach (lead-verified): the author's
// icon object is the prototype of a derived object whose `createIcon` is
// overridden to swap only the inner <i> symbol. The chassis (sprite
// background / className / iconSize / shadow) is inherited verbatim — the
// marker keeps the author's exact look minus the symbol.
import { CAP_TIER, DIM, walkLeaf } from "#core/layer/index.js";
import { dom } from "#common/dom.js";
import { formRow } from "#ui/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { INTENT, type IconIntent, getIntent } from "../intent.js";
import type { LayerUI } from "../surface.js";
import { GLYPHS, GLYPH_NAMES, resolveGlyph } from "./glyph.js";
import { registerDimension, resetIntentKeys, writeIntentKeys } from "./registry.js";
import { FACE, cancelStyleDimApply, scheduleStyleDimApply } from "./styleBag.js";

/** Grid columns for the glyph picker popup. */
const GLYPH_GRID_COLS = 8;
/** The leaf probe for the icon axis: a runtime `setIcon` (a marker). Same
 *  guard as the capability probe — a throwing getter answers nothing. */
const isIconLeaf = (leaf: unknown): leaf is L.Marker =>
  typeof (leaf as { setIcon?: unknown }).setIcon === "function";
/** The author's icon per leaf — captured on the layer's first write, and by
 *  reset time the only copy of it (`setIcon` replaces `options.icon` in
 *  place). Keyed by leaf so a tree that replaces its children (a
 *  re-rendering GeoJSON) recaptures honestly. */
const authorIcon = new WeakMap<object, unknown>();

/** Capture a leaf's author icon once. A leaf with no explicit icon falls
 *  back to `L.Icon.Default.prototype` so Reset always has a target. */
const captureAuthorIcon = (leaf: object): void => {
  if (authorIcon.has(leaf)) return;
  const own = (leaf as { options?: { icon?: unknown } }).options?.icon;
  authorIcon.set(leaf, own ?? defaultIconProto());
};

/** The Leaflet default-icon prototype a leaf with no explicit icon falls
 *  back to, or undefined in a Leaflet-free DOM. */
const defaultIconProto = (): unknown => {
  // jsdom always defines the Leaflet global, so the no-L arm is a
  // Leaflet-free-DOM guard, not a state this flow produces.
  /* v8 ignore next -- Leaflet-free DOM only */
  if (typeof L === "undefined") return undefined;
  return (
    (L as { Icon?: { Default?: { prototype?: unknown } } }).Icon?.Default?.prototype ??
    undefined
  );
};
/** The row gate: the layer must be in the registry, then its surface must
 *  declare the icon capability (a marker icon is not a `setStyle` face, so
 *  the capability slot is the one honest answer). */
const layerCanIcon = (ui: LayerUI, layerId: string): boolean => {
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (!layerInfo) return false;
  return ui.c.surfaceFor(layerInfo).capabilities.icon === CAP_TIER.NATIVE;
};
/** The inner shell: our SVG glyph inside the same <i> slot the author's
 *  FontAwesome/AwesomeMarkers icon used. `.awesome-marker i` carries
 *  margin-top:10px; display:inline-block; font-size:14px — the SVG inherits
 *  the container's color via fill=currentColor. The shell class lets tests
 *  and the stylesheet address the glyph's box without touching the author's
 *  chassis classes. */
const glyphInnerHtml = (svg: string): string =>
  `<i class="foliplus-marker-glyph">${svg}</i>`;
/** Derive a marker icon that swaps only the inner symbol. The author's icon
 *  object is the prototype; `createIcon` is overridden to build the same
 *  chassis div (via `_setIconStyles` with the author's markerColor) but with
 *  our glyph as the inner content. Every other inherited member —
 *  `createShadow`, `options`, `_setIconStyles` — is reused verbatim, so the
 *  sprite background, className, iconSize and popupAnchor stay pixel-identical.
 *
 *  (Chassis / glyph colour is task-82; not in scope this PR.)
 *
 *  Returns the derived icon object (already `Object.create(author)`), or the
 *  author's icon unchanged when the author is not a Leaflet icon (no
 *  `createIcon` to override) — honest degradation, not a fabricated divIcon.
 */
const buildMarkerIcon = (opts: {
  /** The author's captured icon object (or the Leaflet default prototype). */
  author: unknown;
  /** The glyph name to render. */
  glyph: string;
}): unknown => {
  const author = opts.author as
    { createIcon?: () => HTMLElement; options?: { markerColor?: string } } | undefined;
  if (!author || typeof author.createIcon !== "function") return opts.author;
  const svg = GLYPHS[resolveGlyph(opts.glyph)];
  const inner = glyphInnerHtml(svg);
  const derived = Object.create(author) as {
    createIcon: () => HTMLElement | undefined;
    createShadow?: () => HTMLElement | undefined;
  };
  derived.createIcon = function (this: unknown) {
    // Reuse the author's own chassis build and swap only the inner
    // content — className, backgroundImage/backgroundPosition, iconSize
    // and popupAnchor stay pixel-identical by construction, which is
    // exactly the DOM-level contract the lead pinned (m01511).
    const div = author.createIcon?.() as HTMLElement | undefined;
    if (div) div.innerHTML = inner;
    return div;
  };
  return derived;
};
/** Apply the layer's stored glyph to every marker leaf, capturing each
 *  leaf's author icon on first write. A missing intent is a no-op — a layer
 *  the user never touched keeps exactly what the author declared. */
const applyIconToLayer = (ui: LayerUI, layerId: string): void => {
  const intent = getIntent(ui, layerId, INTENT.ICON);
  if (intent?.kind !== "glyph") return;
  const layer = ui.c.findLayer(layerId);
  if (!layer) return;
  walkLeaf(layer, leaf => {
    if (!isIconLeaf(leaf)) return;
    captureAuthorIcon(leaf);
    const author = authorIcon.get(leaf);
    if (author === undefined) return;
    const derived = buildMarkerIcon({ author, glyph: intent.value });
    leaf.setIcon(derived as Parameters<L.Marker["setIcon"]>[0]);
  });
};
/** Write the layer's glyph and replay the walk. */
const commitGlyph = (ui: LayerUI, layerId: string, glyph: string): void => {
  writeIntentKeys(ui, layerId, [[INTENT.ICON, { kind: "glyph", value: glyph }]]);
  scheduleStyleDimApply(FACE.ICON, layerId, () => applyIconToLayer(ui, layerId), {
    owner: ui,
  });
};
/** Reset the layer's icons to what the author drew and drop the persisted
 *  entry. The authored icons come from the WeakMap, never from a re-read — a
 *  re-read would restore the user's own choice, and a layer that never wrote
 *  has nothing to restore anyway. A walk queued by a trailing edit is
 *  cancelled before the leaves are touched. */
const resetLayerIcon = (ui: LayerUI, layerId: string): void => {
  if (!ui.c.layerRegistry.has(layerId)) return;
  resetIntentKeys(ui, layerId, [INTENT.ICON]);
  cancelStyleDimApply(FACE.ICON, layerId, ui);
  const layer = ui.c.findLayer(layerId);
  if (!layer) return;
  walkLeaf(layer, leaf => {
    if (!isIconLeaf(leaf)) return;
    const captured = authorIcon.get(leaf);
    if (captured !== undefined) {
      // Leaflet's Icon.Default creates an <img> and _createImg REUSES the
      // existing element when the marker already has one. An <img> that
      // carries our glyph would be returned unchanged, so _initIcon sees
      // `icon === this._icon` and never swaps — the glyph would survive
      // Reset. Detach the glyph-laden element first so createIcon(null)
      // builds a fresh author <img> instead of reusing it.
      const marker = leaf as L.Marker & {
        _icon?: HTMLElement | null;
        _shadow?: HTMLElement | null;
        _removeIcon?: () => void;
        _removeShadow?: () => void;
      };
      marker._removeIcon?.();
      marker._removeShadow?.();
      leaf.setIcon(captured as Parameters<L.Marker["setIcon"]>[0]);
    }
    authorIcon.delete(leaf);
  });
};
/** The current glyph name for the row, or null when the layer still shows
 *  the author's icon (uncovered). */
const currentGlyph = (ui: LayerUI, layerId: string): string | null => {
  const intent = getIntent(ui, layerId, INTENT.ICON);
  return intent?.kind === "glyph" ? intent.value : null;
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
    class: CONST.CLASSES.STYLE_ICON_TRIGGER,
    type: "button",
    "aria-haspopup": "grid",
    "aria-label": ui.T("style_icon"),
  }) as HTMLButtonElement;

  const renderTrigger = () => {
    const value = currentGlyph(ui, layerId);
    trigger.textContent = "";
    if (value) {
      trigger.innerHTML = glyphInnerHtml(GLYPHS[resolveGlyph(value)]);
      trigger.title = value;
    } else {
      trigger.textContent = ui.T("style_icon_original");
      trigger.title = ui.T("style_icon_original");
    }
  };
  renderTrigger();

  const row = formRow(ui.T("style_icon"), trigger, CONST.CLASSES.STYLE_ICON_ROW);
  bindGlyphGrid(ui, layerId, trigger, row);
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
    grid = buildGlyphGrid(ui, layerId, trigger, close);
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
      { html: glyphInnerHtml(GLYPHS[glyph]) },
    ) as HTMLButtonElement;
    if (glyph === current) {
      cell.classList.add(CONST.CLASSES.STYLE_ICON_CELL_SELECTED);
    }
    cell.onclick = () => {
      commitGlyph(ui, layerId, glyph);
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
  buildMarkerIcon,
  commitGlyph,
  layerCanIcon,
  resetLayerIcon,
};
