// LayerControl interaction — keyboard navigation + overflow-menu click handlers.
import { ensureInteraction } from "#core/interaction.js";
import * as CONST from "./const.js";
import type { LayerAccess } from "./ui/access.js";
import { openAttrsPanel } from "./ui/attr.js";
import { focusLayer } from "./ui/focus.js";
import type { FocusStore } from "./ui/focusStore.js";
import { handleKeyDown, handleOutsideMousedown } from "./ui/keyboard.js";
import { activateDeleteItem, closeMoreMenu, openMoreMenu } from "./ui/menu.js";
import type { PanelStore } from "./ui/panelStore.js";
import { renameLayer } from "./ui/rename.js";
import { openStylePanel } from "./ui/style/index.js";

/** Keyboard shortcuts registered via InteractionManager. */
const registerInteractions = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
): (() => void) => {
  const container = ps.uiContainer!;
  const interaction = ensureInteraction(la.map);
  return interaction.register(CONFIG.name, [
    {
      key: "ArrowUp",
      container,
      handler: e => handleKeyDown(la, ps, fs, e as KeyboardEvent),
    },
    {
      key: "ArrowDown",
      container,
      handler: e => handleKeyDown(la, ps, fs, e as KeyboardEvent),
    },
    {
      key: "ArrowLeft",
      container,
      handler: e => handleKeyDown(la, ps, fs, e as KeyboardEvent),
    },
    {
      key: "ArrowRight",
      container,
      handler: e => handleKeyDown(la, ps, fs, e as KeyboardEvent),
    },
    {
      key: " ",
      container,
      handler: e => handleKeyDown(la, ps, fs, e as KeyboardEvent),
    },
    {
      key: "Enter",
      container,
      handler: e => handleKeyDown(la, ps, fs, e as KeyboardEvent),
    },
    {
      key: "Escape",
      container,
      handler: e => handleKeyDown(la, ps, fs, e as KeyboardEvent),
    },
    // Mousedown anywhere outside the panel drops the cursor — the pointer
    // counterpart of the Escape shortcut above. Observed, not swallowed
    // (preventDefault: false): a press outside must keep its native behavior
    // (focus move, map drag), so the manager must not match-and-cancel it.
    {
      event: "mousedown",
      preventDefault: false,
      handler: e => handleOutsideMousedown(la, ps, fs, e as MouseEvent),
    },
  ]);
};

/**
 * Click handler for the overflow ("more") button. Uses event delegation on
 * the container so it works for rows created after bindEvents.
 */
const handleMoreClick = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  event: Event,
): void => {
  const btn = (event.target as HTMLElement).closest(
    `.foliplus-layer-more-btn`,
  ) as HTMLButtonElement | null;
  if (!btn) return;
  event.stopPropagation();
  event.preventDefault();
  const item = btn.closest(CONST.SEL.LAYER_ITEM) as HTMLElement | null;
  if (!item) return;
  openMoreMenu(la, ps, fs, item);
};

/** Click handler for the overflow menu items (focus-layer action). */
const handleMoreMenuClick = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  event: Event,
): void => {
  const target = event.target as HTMLElement;
  // Any click that is not on the open menu closes it — panel, map, another
  // control. The ⋮ button's own click stops propagation, so re-opening the
  // menu from the same button still works (onClick re-creates it).
  if (!target.closest(".foliplus-layer-more-menu")) {
    if (ps.activeMenu) closeMoreMenu(la, ps, fs, false);
    return;
  }
  const li = target.closest(`.foliplus-layer-more-menu li`) as HTMLElement | null;
  if (!li) return;
  const action = li.dataset.action ?? "";
  // Skip disabled items (hidden layer). Keep menu open so user sees why.
  if (li.getAttribute("disabled")) return;
  if (action === CONST.ACTION.DELETE_LAYER) {
    // Armed in place: the first click arms, the second one deletes. While armed
    // the menu stays open so the confirming state is visible.
    if (activateDeleteItem(la, ps, fs, li)) closeMoreMenu(la, ps, fs, true);
    return;
  }
  if (action === CONST.ACTION.FOCUS_LAYER) {
    focusLayer(la, ps, fs, ps.activeMenu?.layerId ?? "");
  }
  if (action === CONST.ACTION.RENAME_LAYER) {
    renameLayer(la, ps, fs, ps.activeMenu?.layerId ?? "");
  }
  if (action === CONST.ACTION.STYLE_LAYER) {
    openStylePanel(la, ps, fs, ps.activeMenu?.layerId ?? "");
  }
  // Attributes anchors to the menu's own row — the menu is the source of
  // truth for which row owns it, and falling back to `li` would anchor the
  // panel to the menu's own <li> if the menu state were lost.
  if (action === CONST.ACTION.ATTRS_LAYER) {
    openAttrsPanel(la, ps, fs, ps.activeMenu?.item ?? li);
  }
  // rename-layer keeps focus on the inline input, so do not return focus to
  // the row (that blur would immediately commit the pre-edit value).
  // Any other menu item (focus-layer, style-layer, or an unknown action)
  // closes the menu and returns focus to the layer row.
  closeMoreMenu(la, ps, fs, action !== CONST.ACTION.RENAME_LAYER);
};

export { registerInteractions, handleMoreClick, handleMoreMenuClick };
