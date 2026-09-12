// LayerControl UI 鈥?Inline layer rename.
import { HINT_DURATION } from "#core/hint.js";
import { forEachLeaf } from "#core/layer/index.js";
import {
  createInlineEditInput,
  removeInlineEditInput,
  updateItemLabel,
} from "#common/dom.js";
import * as CONST from "../const.js";
import type { LayerUI } from "../ui.js";
import { T } from "./shared.js";

/**
 * Turn the layer's label into an inline editable input so the user can
 * rename it. Enter/blur commits (non-empty), Escape cancels.
 *
 * The input replaces only the label's text node (the `<label>` element
 * stays in place), so layout / keyboard cursor focus is preserved. A
 * trailing space in the committed name would otherwise render as a zero-width
 * gap, so the value is trimmed on commit.
 */
export function renameLayer(ui: LayerUI, layerId: string): void {
  if (!layerId || !ui.uiContainer) return;
  ui.finishRename();

  const layerInfo = ui.m.layerRegistry.get(layerId);
  const isColorLayer = layerId === CONST.COLOR.MAP_ID;
  if (!layerInfo && !isColorLayer) return;

  const item = ui.uiContainer.querySelector(
    `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerId)}"]`,
  ) as HTMLElement | null;
  const label = item?.querySelector("label") as HTMLLabelElement | null;
  if (!label) return;

  // displayName resolves rename 鈫?registry 鈫?the color layer's locale label,
  // so the input opens with the name the UI already shows.
  const currentName = ui.displayName(layerId);

  ui.activeRenameId = layerId;
  // Flag the row so CSS can stretch the input across the label+count area
  // (matching the SearchControl field's full extent) while editing.
  item?.classList.add(CONST.CLASSES.RENAMING);
  createInlineEditInput({
    label,
    initialValue: currentName,
    className: `${CONST.CLASSES.RENAME_INPUT} foliplus-input`,
    ariaLabel: T("rename_hint"),
    // Only commit on blur while this is still the active rename. Enter/Escape
    // call finishRename() which sets activeRenameId=null and removes the
    // focused input 鈫?that removal fires a blur that must not re-commit.
    isActive: () => ui.activeRenameId === layerId,
    onCommit: trimmed => {
      const changed = trimmed !== currentName;
      if (changed) {
        // renamedNames is the source of truth; the registry entry and the
        // row labels are projections that applyUserState() pushes out, so
        // a re-registration that rebuilds the registry from a third-party
        // layer's own metadata cannot resurrect the author's original name.
        ui.renamedNames[layerId] = trimmed;
        ui.saveNamesState();
        ui.applyUserState();
      }
      ui.finishRename(true);
    },
    onCancel: reason => {
      // Only an empty-name commit is a user mistake worth flagging;
      // Escape is an intentional abandon 鈥?stay silent.
      if (reason === "empty") {
        map.foliplus!.showHint(CONF.name, T("rename_empty"), HINT_DURATION.SHORT);
      }
      // Escape defers the teardown: tearing the input down now would blur
      // it to `<body>`, and `document.activeElement` is what handleKeyDown's
      // container guard reads 鈥?a microtask already runs before the keydown
      // finishes bubbling, so the panel handler sees focus on `<body>` and
      // never reaches the Escape branch. A timeout fires after the whole
      // dispatch is unwound, so the cursor is cleared while the input still
      // holds focus. The isActive gate above keeps the deferred teardown's
      // blur from re-committing. Enter and blur have no document-level
      // handler to reach, so they tear down immediately.
      if (reason === "escape") {
        setTimeout(() => ui.finishRename(true), 0);
      } else {
        ui.finishRename(true);
      }
    },
  });
}

/**
 * Tear down an in-flight rename input, restoring the label text.
 * @param {boolean} [restoreText=true] Re-set the label text from the
 *   registry. When false, the caller will write its own text immediately
 *   after (used internally to avoid a double write).
 */

/**
 * Tear down an in-flight rename input, restoring the label text.
 * @param {boolean} [restoreText=true] Re-set the label text from the
 *   registry. When false, the caller will write its own text immediately
 *   after (used internally to avoid a double write).
 */
export function finishRename(ui: LayerUI, restoreText = true): void {
  if (!ui.activeRenameId) return;
  const layerId = ui.activeRenameId;
  ui.activeRenameId = null;
  if (!ui.uiContainer) return;

  const layerInfo = ui.m.layerRegistry.get(layerId);
  const isColorLayer = layerId === CONST.COLOR.MAP_ID;
  if (!layerInfo && !isColorLayer) return;

  const item = ui.uiContainer.querySelector(
    `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerId)}"]`,
  ) as HTMLElement | null;
  const label = item?.querySelector("label") as HTMLLabelElement | null;
  item?.classList.remove(CONST.CLASSES.RENAMING);
  removeInlineEditInput(label);
  if (restoreText) updateItemLabel(item, ui.displayName(layerId));
}

/**
 * Focus the map on a registered layer's bounding box.
 *
 * Best-effort approach:
 * 1. Compute bounds from the layer (fallback: forEachLeaf for containers
 *    whose getBounds delegates to children).
 * 2. If the layer is not on the map, bring it on temporarily so the bounds
 *    and the visual highlight are consistent with the user's action.
 * 3. If the bounds area is below MIN_BOUNDS_AREA (single Marker, tiny
 *    polygon, etc.), `flyTo` the layer center instead of `fitBounds` 鈥? *    `fitBounds` on a degenerate box has no effect.
 * 4. Draw a dashed rectangle on the exact bounds so the user sees exactly
 *    what "this layer" covers.
 * 5. Highlight the focused layer row with the `foliplus-layer-focusing`
 *    class so the list 鈫?map linkage is visible.
 * 6. Call `fitBounds` with `padding` and `maxZoom` capped to current +
 *    `FOCUS.MAX_ZOOM_STEP` to avoid satellite-zoom snaps on small features.
 * 7. Auto-cancel on any subsequent map `moveend`/`zoomend` so the rect
 *    doesn't linger while the user navigates elsewhere.
 */
