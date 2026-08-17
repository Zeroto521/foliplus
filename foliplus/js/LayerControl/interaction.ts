// LayerControl interaction — keyboard navigation.
import { ensureInteraction } from "#core/interaction.js";
import type { LayerUI } from "./ui.js";

export const registerInteractions = (ui: LayerUI): (() => void) => {
  const container = ui.uiContainer;
  return ensureInteraction(ui.m.map).register(CONF.name, [
    {
      key: "ArrowUp",
      container,
      handler: () =>
        ui.handleKeyDown({ key: "ArrowUp", preventDefault: () => {} } as KeyboardEvent),
    },
    {
      key: "ArrowDown",
      container,
      handler: () =>
        ui.handleKeyDown({
          key: "ArrowDown",
          preventDefault: () => {},
        } as KeyboardEvent),
    },
    {
      key: "ArrowLeft",
      container,
      handler: () =>
        ui.handleKeyDown({
          key: "ArrowLeft",
          preventDefault: () => {},
        } as KeyboardEvent),
    },
    {
      key: "ArrowRight",
      container,
      handler: () =>
        ui.handleKeyDown({
          key: "ArrowRight",
          preventDefault: () => {},
        } as KeyboardEvent),
    },
    {
      key: " ",
      container,
      handler: () =>
        ui.handleKeyDown({ key: " ", preventDefault: () => {} } as KeyboardEvent),
    },
    {
      key: "Enter",
      container,
      handler: () =>
        ui.handleKeyDown({ key: "Enter", preventDefault: () => {} } as KeyboardEvent),
    },
    {
      key: "Escape",
      container,
      handler: () =>
        ui.handleKeyDown({ key: "Escape", preventDefault: () => {} } as KeyboardEvent),
    },
  ]);
};
