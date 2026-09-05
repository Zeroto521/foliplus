// LayerControl interaction — keyboard navigation + overflow-menu click handlers.
import { ensureInteraction } from "#core/interaction.js";
import * as CONST from "./const.js";
import type { LayerUI } from "./ui.js";

/** Keyboard shortcuts registered via InteractionManager. */
const registerInteractions = (ui: LayerUI): (() => void) => {
  const container = ui.uiContainer;
  return ensureInteraction(ui.m.map).register(CONF.name, [
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
  ]);
};

/**
 * Click handler for the overflow ("more") button. Uses event delegation on
 * the container so it works for rows created after bindEvents.
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

/** Click handler for the overflow menu items (focus-layer action). */
const handleMoreMenuClick = (ui: LayerUI, event: Event): void => {
  const li = (event.target as HTMLElement).closest(
    `.foliplus-layer-more-menu li`,
  ) as HTMLElement | null;
  if (!li) return;
  const action = li.dataset.action ?? "";
  // Skip disabled items (hidden layer). Keep menu open so user sees why.
  if (li.getAttribute("disabled")) return;
  if (action === "focus-layer") ui.focusLayer(ui.activeMenu?.layerId ?? "");
  if (action === "rename-layer") ui.renameLayer(ui.activeMenu?.layerId ?? "");
  if (action === CONST.ACTION.ATTRS_LAYER)
    ui.openAttrsPanel(ui.activeMenu?.item ?? li);
  // rename-layer keeps focus on the inline input, so do not return focus to
  // the row (that blur would immediately commit the pre-edit value).
  ui.closeMoreMenu(action !== "rename-layer");
};

export { registerInteractions, handleMoreClick, handleMoreMenuClick };
