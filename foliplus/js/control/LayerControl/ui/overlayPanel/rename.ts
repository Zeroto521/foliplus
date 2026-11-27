// LayerControl UI — Inline layer rename.
import { notifyDeltas } from "../apply.js";
import { INTENT, setIntent } from "../intent.js";
import { displayName } from "../listPanel/rowView.js";
import { saveNamesState } from "../state.js";
import type { LayerUI } from "../surface.js";
import { closeOverlays, subscribeLayerTearDown } from "../teardown.js";
import { clearSurface, openSurface, registerSurfaceCloser } from "./openSurface.js";
import { HINT_DURATION } from "#core/overlay/index.js";
import {
  createInlineEditInput,
  removeInlineEditInput,
  updateItemLabel,
} from "#platform/dom.js";
import { FORM_CLASS } from "#ui/index.js";
import * as CONST from "#control/LayerControl/const.js";

/**
 * Turn the layer's label into an inline editable input so the user can
 * rename it. Enter/blur commits (non-empty), Escape cancels.
 *
 * The input replaces only the label's text node (the `<label>` element
 * stays in place), so layout / keyboard cursor focus is preserved. A
 * trailing space in the committed name would otherwise render as a zero-width
 * gap, so the value is trimmed on commit.
 */
const renameLayer = (ui: LayerUI, layerId: string): void => {
  if (!layerId || !ui.uiContainer) return;

  // Validate before tearing down: an unknown id or a row without a label would
  // otherwise clear whatever the user had open and then fail to open anything.
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (!layerInfo) return;

  const item = ui.uiContainer.querySelector(
    `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerId)}"]`,
  ) as HTMLElement | null;
  const label = item?.querySelector("label") as HTMLLabelElement | null;
  if (!item || !label) return;

  closeOverlays(ui);

  // displayName resolves rename → registry → the color layer's locale label,
  // so the input opens with the name the UI already shows.
  const currentName = displayName(ui, layerId);

  openSurface(ui, { kind: "rename", row: item, layerId });
  // Flag the row so CSS can stretch the input across the label+count area
  // (matching the SearchControl field's full extent) while editing.
  item?.classList.add(CONST.CLASSES.RENAMING);
  // An external delete retires the owned layer mid-rename: cancel silently
  // (the Escape branch) — there is no committed value to write into a row
  // that is about to disappear, and finishRename's registry guard would
  // skip the teardown anyway.
  // Anchor-teardown contract (cross-panel): close on BOTH LAYER_REMOVED and
  // LAYER_DELETED — see subscribeLayerTearDown in teardown.ts.
  ui.overlayPanel.renameRemovedUnsub = subscribeLayerTearDown(ui, layerId, () => {
    ui.overlayPanel.renameRemovedUnsub?.();
    ui.overlayPanel.renameRemovedUnsub = null;
    finishRename(ui, false);
  });
  createInlineEditInput({
    label,
    initialValue: currentName,
    className: `${CONST.CLASSES.RENAME_INPUT} ${FORM_CLASS.INPUT}`,
    ariaLabel: ui.T("rename_hint"),
    // Only commit on blur while this is still the active rename. Enter/Escape
    // call finishRename() which sets activeRenameId=null and removes the
    // focused input → that removal fires a blur that must not re-commit.
    isActive: () => ui.overlayPanel.activeRenameId === layerId,
    onCommit: trimmed => {
      const changed = trimmed !== currentName;
      if (changed) {
        // `ui.intentStore` name is the source of truth; the registry entry and
        // the row labels are projections that applyUserState() pushes out, so
        // a re-registration that rebuilds the registry from a third-party
        // layer's own metadata cannot resurrect the author's original name.
        setIntent(ui, layerId, INTENT.NAME, trimmed);
        saveNamesState(ui);
      }
      const moved = changed ? ui.applyUserState() : [];
      // Settle the visible rename first — the input comes down and the label
      // goes back up from the registry — and only then does the round go out.
      finishRename(ui, true);
      notifyDeltas(ui, moved);
    },
    onCancel: reason => {
      // Only an empty-name commit is a user mistake worth flagging;
      // Escape is an intentional abandon — stay silent.
      if (reason === "empty") {
        ui.c.map.foliplus!.hint.set(ui.config.name, "", ui.T("rename_empty"), {
          duration: HINT_DURATION.SHORT,
        });
      }
      // Escape defers the teardown: tearing the input down now would blur
      // it to `<body>`, and `document.activeElement` is what handleKeyDown's
      // container guard reads — a microtask already runs before the keydown
      // finishes bubbling, so the panel handler sees focus on `<body>` and
      // never reaches the Escape branch. A timeout fires after the whole
      // dispatch is unwound, so the cursor is cleared while the input still
      // holds focus. The isActive gate above keeps the deferred teardown's
      // blur from re-committing. Enter and blur have no document-level
      // handler to reach, so they tear down immediately.
      if (reason === "escape") {
        ui.timers.timeout("rename-deferred-teardown", () => finishRename(ui, true), 0);
      } else {
        finishRename(ui, true);
      }
    },
  });
};

/**
 * Tear down an in-flight rename input, restoring the label text.
 * @param {boolean} [restoreText=true] Re-set the label text from the
 *   registry. When false, the caller will write its own text immediately
 *   after (used internally to avoid a double write).
 */

const finishRename = (ui: LayerUI, restoreText = true): void => {
  // The row is the shared handle: a folder rename has no layer id, so keying
  // the teardown on the id alone left the folder input and its row flag
  // behind.
  const item = ui.overlayPanel.activeRenameRow;
  const layerId = ui.overlayPanel.activeRenameId;
  clearSurface(ui, "rename");
  ui.overlayPanel.renameRemovedUnsub?.();
  ui.overlayPanel.renameRemovedUnsub = null;
  if (!item) return;

  const label = item.querySelector("label") as HTMLLabelElement | null;
  item.classList.remove(CONST.CLASSES.RENAMING);
  removeInlineEditInput(label);
  // Only a layer row has a label to restore from the registry; a folder row's
  // label is rewritten by the rebuild its commit triggers.
  if (restoreText && layerId && ui.c.layerRegistry.get(layerId)) {
    updateItemLabel(item, displayName(ui, layerId));
  }
};

/**
 * Focus the map on a registered layer's bounding box.
 *
 * Best-effort approach:
 * 1. Compute bounds from the layer (fallback: walkLeaf for containers
 *    whose getBounds delegates to children).
 * 2. If the layer is not on the map, bring it on temporarily so the bounds
 *    and the visual highlight are consistent with the user's action.
 * 3. If the bounds area is below MIN_BOUNDS_AREA (single Marker, tiny
 *    polygon, etc.), `flyTo` the layer center instead of `fitBounds` —
 *    `fitBounds` on a degenerate box has no effect.
 * 4. Draw a dashed rectangle on the exact bounds so the user sees exactly
 *    what "this layer" covers.
 * 5. Highlight the focused layer row with the `foliplus-is-focusing`
 *    class so the list → map linkage is visible.
 * 6. Call `fitBounds` with `padding` and `maxZoom` capped to current +
 *    `FOCUS.MAX_ZOOM_STEP` to avoid satellite-zoom snaps on small features.
 * 7. Auto-cancel on any subsequent map `moveend`/`zoomend` so the rect
 *    doesn't linger while the user navigates elsewhere.
 */

// The state machine's close dispatch for this kind: a replacement commits the
// in-flight edit (finishRename's default restoreText=true), matching the old
// OVERLAY_CLEAR subscription.
registerSurfaceCloser("rename", ui => finishRename(ui));

export { renameLayer, finishRename };
