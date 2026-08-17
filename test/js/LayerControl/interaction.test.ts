import { describe, expect, it, vi } from "vitest";
import { registerInteractions } from "#foliplus/LayerControl/interaction.js";

function makeUI(): any {
  const container = document.createElement("div");
  container.innerHTML = `
    <div class="foliplus-layer-item" tabindex="0" data-layer-id="layer1">
      <input type="checkbox" />
    </div>
    <div class="foliplus-layer-item" tabindex="0" data-layer-id="layer2">
      <input type="checkbox" />
    </div>
  `;
  const map: any = {
    foliplus: {},
    getContainer: vi.fn(() => document.createElement("div")),
    on: vi.fn(),
  };
  return {
    uiContainer: container,
    m: { map },
    handleKeyDown: vi.fn(),
    activeIdx: null,
  };
}

describe("LayerControl interaction", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("registerInteractions returns cleanup function", () => {
    const ui = makeUI();
    const cleanup = registerInteractions(ui);
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("ArrowDown dispatches to handleKeyDown when container has focus", () => {
    const ui = makeUI();
    const cleanup = registerInteractions(ui);
    document.body.appendChild(ui.uiContainer);
    const item = ui.uiContainer.querySelector(".foliplus-layer-item") as HTMLElement;
    item.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(ui.handleKeyDown).toHaveBeenCalled();
    cleanup();
  });

  it("Escape dispatches to handleKeyDown", () => {
    const ui = makeUI();
    const cleanup = registerInteractions(ui);
    document.body.appendChild(ui.uiContainer);
    const item = ui.uiContainer.querySelector(".foliplus-layer-item") as HTMLElement;
    item.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(ui.handleKeyDown).toHaveBeenCalled();
    cleanup();
  });
});
