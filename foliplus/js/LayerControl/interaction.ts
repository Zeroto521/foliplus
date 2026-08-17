// LayerControl interaction — keyboard navigation.
import { ensureInteraction } from "#core/interaction.js";
import type { LayerUI } from "./ui.js";

export const registerInteractions = (ui: LayerUI): (() => void) => {
  const container = ui.uiContainer;
  return ensureInteraction(ui.m.map).register(CONF.name, [
    { key: "ArrowUp", container, handler: (e) => ui.handleKeyDown(e as KeyboardEvent) },
    { key: "ArrowDown", container, handler: (e) => ui.handleKeyDown(e as KeyboardEvent) },
    { key: "ArrowLeft", container, handler: (e) => ui.handleKeyDown(e as KeyboardEvent) },
    { key: "ArrowRight", container, handler: (e) => ui.handleKeyDown(e as KeyboardEvent) },
    { key: " ", container, handler: (e) => ui.handleKeyDown(e as KeyboardEvent) },
    { key: "Enter", container, handler: (e) => ui.handleKeyDown(e as KeyboardEvent) },
    { key: "Escape", container, handler: (e) => ui.handleKeyDown(e as KeyboardEvent) },
  ]);
};
