// LayerControl interaction — keyboard navigation + overflow-menu click handlers.
import { ensureInteraction } from "#core/interaction/index.js";
import * as CONST from "./const.js";
import { runMenuAction } from "./ui/overlayPanel/menu.js";
import type { LayerUI } from "./ui/surface.js";

/** Keyboard shortcuts registered via InteractionManager. */
const registerInteractions = (ui: LayerUI): (() => void) => {
  // A torn-down panel has no scope to bind the shortcuts to. The manager reads
  // a missing container as "no scope" and would register them at the document
  // level — the panel's arrows, space, Enter and Escape escaping into the map,
  // which keeps them alive after the control is gone. No panel, no shortcuts.
  const container = ui.uiContainer;
  if (!container) return () => undefined;
  const interaction = ensureInteraction(ui.c.map);
  return interaction.register(CONFIG.name, [
    { key: "ArrowUp", container, handler: e => ui.handleKeyDown(e as KeyboardEvent) },
    { key: "ArrowDown", container, handler: e => ui.handleKeyDown(e as KeyboardEvent) },
    { key: "ArrowLeft", container, handler: e => ui.handleKeyDown(e as KeyboardEvent) },
    {
      key: "ArrowRight",
      container,
      handler: e => ui.handleKeyDown(e as KeyboardEvent),
    },
    { key: " ", container, handler: e => ui.handleKeyDown(e as KeyboardEvent) },
    { key: "Enter", container, handler: e => ui.handleKeyDown(e as KeyboardEvent) },
    { key: "Escape", container, handler: e => ui.handleKeyDown(e as KeyboardEvent) },
    // Mousedown anywhere outside the panel drops the cursor — the pointer
    // counterpart of the Escape shortcut above. Observed, not swallowed
    // (preventDefault: false): a press outside must keep its native behavior
    // (focus move, map drag), so the manager must not match-and-cancel it.
    {
      event: "mousedown",
      preventDefault: false,
      handler: e => ui.handleOutsideMousedown(e as MouseEvent),
    },
  ]);
};

/**
 * Click handler for the overflow ("more") button. Uses event delegation on
 * the container so it works for rows created after bindLayerEvents.
 */
const handleMoreClick = (ui: LayerUI, event: Event): void => {
  const btn = (event.target as HTMLElement).closest(
    `.foliplus-layer-more-btn`,
  ) as HTMLButtonElement | null;
  if (!btn) return;
  event.stopPropagation();
  event.preventDefault();
  const item = btn.closest(CONST.SEL.LAYER_ITEM) as HTMLElement | null;
  if (!item) return;
  ui.openMoreMenu(item);
};

/** Click handler for the overflow menu items. The action itself is dispatched
 *  by the menu's shared runner, so a click and a keyboard activation of the
 *  same entry cannot diverge. */
const handleMoreMenuClick = (ui: LayerUI, event: Event): void => {
  const target = event.target as HTMLElement;
  // Any click that is not on the open menu closes it — panel, map, another
  // control. The ⋮ button's own click stops propagation, so re-opening the
  // menu from the same button still works (onClick re-creates it).
  if (!target.closest(".foliplus-layer-more-menu")) {
    if (ui.overlayPanel.activeMenu) ui.closeMoreMenu(false);
    return;
  }
  const menuItem = target.closest(`.foliplus-layer-more-menu li`) as HTMLElement | null;
  if (!menuItem) return;
  // A disabled entry keeps the menu open so the user sees why (its tooltip
  // carries the reason); the shared runner applies that rule for both inputs.
  runMenuAction(ui, menuItem);
};

export { registerInteractions, handleMoreClick, handleMoreMenuClick };
