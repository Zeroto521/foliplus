import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureInteraction } from "#core/interaction.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import {
  handleMoreClick,
  handleMoreMenuClick,
  registerInteractions,
} from "#foliplus/LayerControl/interaction.js";

// ---- Mock the real InteractionManager. The real one creates doc-level
// listeners + a MutationObserver that don't auto-teardown cleanly in jsdom.
// The factory is hoisted by vi.mock(), so it creates its own spy internally.
// Each call to ensureInteraction() returns a fresh object, but that IS the
// object registerInteractions() uses, so we can grab the register spy from
// ensureInteraction's mock results after each call.
vi.mock("#core/interaction.js", () => ({
  ensureInteraction: vi.fn(() => ({
    register: vi.fn(() => () => {}),
  })),
}));

function getRegisterSpy(): any {
  return (ensureInteraction as any).mock.results[0]?.value?.register;
}

function makeUI(): any {
  const container = document.createElement("div");

  container.innerHTML = `
    <div class="foliplus-layer-item" tabindex="0" data-layer-id="layer1">
      <input type="checkbox" checked />
      <button class="${CONST.CLASSES.MORE_BTN}">⋯</button>
    </div>
    <div class="foliplus-layer-item" tabindex="0" data-layer-id="layer2">
      <input type="checkbox" checked />
      <button class="${CONST.CLASSES.MORE_BTN}">⋯</button>
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
    openMoreMenu: vi.fn(),
    focusLayer: vi.fn(),
    closeMoreMenu: vi.fn(),
    activeIdx: null,
    activeMenu: null,
  };
}

// ===========================================================================
describe("LayerControl registerInteractions", () => {
  afterEach(() => {
    document.body.innerHTML = "";

    vi.clearAllMocks();
  });

  it("returns a cleanup function", () => {
    const ui = makeUI();
    const cleanup = registerInteractions(ui);

    expect(typeof cleanup).toBe("function");

    cleanup();
  });

  it("registers all 7 keyboard shortcuts via InteractionManager", () => {
    const ui = makeUI();

    registerInteractions(ui);

    const reg = getRegisterSpy();

    expect(reg).toHaveBeenCalledTimes(1);

    expect(reg).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        expect.objectContaining({ key: "ArrowUp" }),
        expect.objectContaining({ key: "ArrowDown" }),
        expect.objectContaining({ key: "ArrowLeft" }),
        expect.objectContaining({ key: "ArrowRight" }),
        expect.objectContaining({ key: " " }),
        expect.objectContaining({ key: "Enter" }),
        expect.objectContaining({ key: "Escape" }),
      ]),
    );
  });

  it("all shortcuts share the uiContainer as their container", () => {
    const ui = makeUI();

    registerInteractions(ui);

    const defs = getRegisterSpy().mock.calls[0][1];
    for (const d of defs) {
      expect(d.container).toBe(ui.uiContainer);
    }
  });

  it("each shortcut handler forwards its event to ui.handleKeyDown", () => {
    const ui = makeUI();

    registerInteractions(ui);

    const defs = getRegisterSpy().mock.calls[0][1];
    for (const d of defs) {
      const event = { key: d.key } as unknown as KeyboardEvent;

      d.handler(event);
    }

    // Every handler is a pass-through to ui.handleKeyDown — one call per key.
    expect(ui.handleKeyDown).toHaveBeenCalledTimes(defs.length);

    // Spot-check that the event (and thus its key) is forwarded as-is.
    expect(ui.handleKeyDown).toHaveBeenCalledWith(
      expect.objectContaining({ key: "ArrowUp" }),
    );

    expect(ui.handleKeyDown).toHaveBeenCalledWith(
      expect.objectContaining({ key: "Escape" }),
    );
  });
});

// ===========================================================================
describe("LayerControl handleMoreClick", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("calls openMoreMenu with the closest layer item", () => {
    const ui = makeUI();

    document.body.appendChild(ui.uiContainer);

    const btn = ui.uiContainer.querySelector(
      `.${CONST.CLASSES.MORE_BTN}`,
    ) as HTMLButtonElement;
    const item = btn.closest(`.${CONST.CLASSES.LAYER_ITEM}`) as HTMLElement;

    const stopPropagationSpy = vi.fn();
    const preventDefaultSpy = vi.fn();
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });

    Object.defineProperty(event, "target", { value: btn });

    Object.defineProperty(event, "stopPropagation", { value: stopPropagationSpy });

    Object.defineProperty(event, "preventDefault", { value: preventDefaultSpy });

    handleMoreClick(ui, event);

    expect(ui.openMoreMenu).toHaveBeenCalledWith(item);

    expect(stopPropagationSpy).toHaveBeenCalled();

    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it("does nothing when the target is not a more button", () => {
    const ui = makeUI();

    document.body.appendChild(ui.uiContainer);

    const item = ui.uiContainer.querySelector(
      `.${CONST.CLASSES.LAYER_ITEM}`,
    ) as HTMLElement;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });

    Object.defineProperty(event, "target", { value: item });

    handleMoreClick(ui, event);

    expect(ui.openMoreMenu).not.toHaveBeenCalled();
  });

  it("does nothing when the button is not inside a layer item", () => {
    const ui = makeUI();
    const btn = document.createElement("button");

    btn.className = CONST.CLASSES.MORE_BTN;

    document.body.appendChild(btn);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });

    Object.defineProperty(event, "target", { value: btn });

    handleMoreClick(ui, event);

    expect(ui.openMoreMenu).not.toHaveBeenCalled();
  });
});

// ===========================================================================
describe("LayerControl handleMoreMenuClick", () => {
  function buildMenu(disabled: boolean = false): {
    ui: any;
    li: HTMLElement;
  } {
    const ui = makeUI();
    const menu = document.createElement("ul");

    menu.className = "foliplus-layer-more-menu";
    const li = document.createElement("li");

    li.dataset.action = "focus-layer";
    if (disabled) li.setAttribute("disabled", "disabled");

    menu.appendChild(li);

    ui.activeMenu = {
      item: document.createElement("div"),
      menu,
      layerId: "layer1",
    };

    document.body.appendChild(menu);
    return { ui, li };
  }

  it("dispatches focus-layer action → calls focusLayer + closeMoreMenu", () => {
    const { ui, li } = buildMenu();

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });

    Object.defineProperty(event, "target", { value: li });

    handleMoreMenuClick(ui, event);

    expect(ui.focusLayer).toHaveBeenCalledWith("layer1");

    expect(ui.closeMoreMenu).toHaveBeenCalledWith(true);
  });

  it("skips focusLayer when the menu item is disabled (hidden layer)", () => {
    const { ui, li } = buildMenu(true);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });

    Object.defineProperty(event, "target", { value: li });

    handleMoreMenuClick(ui, event);

    expect(ui.focusLayer).not.toHaveBeenCalled();

    expect(ui.closeMoreMenu).not.toHaveBeenCalled();
  });

  it("does nothing when the target is not a menu li", () => {
    const { ui, li } = buildMenu();
    const ul = li.parentElement!;

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });

    Object.defineProperty(event, "target", { value: ul });

    handleMoreMenuClick(ui, event);

    expect(ui.focusLayer).not.toHaveBeenCalled();

    expect(ui.closeMoreMenu).not.toHaveBeenCalled();
  });

  it("does not call focusLayer for an unknown action", () => {
    const ui = makeUI();
    const menu = document.createElement("ul");

    menu.className = "foliplus-layer-more-menu";
    const li = document.createElement("li");

    li.dataset.action = "unknown-action";

    menu.appendChild(li);

    ui.activeMenu = {
      item: document.createElement("div"),
      menu,
      layerId: "layer1",
    };

    document.body.appendChild(menu);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });

    Object.defineProperty(event, "target", { value: li });

    handleMoreMenuClick(ui, event);

    expect(ui.focusLayer).not.toHaveBeenCalled();

    expect(ui.closeMoreMenu).toHaveBeenCalledWith(true);
  });

  it("does not call focusLayer for a li without data-action", () => {
    const ui = makeUI();
    const menu = document.createElement("ul");

    menu.className = "foliplus-layer-more-menu";
    const li = document.createElement("li");

    menu.appendChild(li);

    ui.activeMenu = {
      item: document.createElement("div"),
      menu,
      layerId: "layer1",
    };

    document.body.appendChild(menu);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });

    Object.defineProperty(event, "target", { value: li });

    handleMoreMenuClick(ui, event);

    expect(ui.focusLayer).not.toHaveBeenCalled();

    expect(ui.closeMoreMenu).toHaveBeenCalledWith(true);
  });

  it("focus-layer action with no active menu falls back to an empty layer id", () => {
    const ui = makeUI(); // activeMenu stays null
    const menu = document.createElement("ul");

    menu.className = "foliplus-layer-more-menu";
    const li = document.createElement("li");

    li.dataset.action = "focus-layer";

    menu.appendChild(li);

    document.body.appendChild(menu);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });

    Object.defineProperty(event, "target", { value: li });

    handleMoreMenuClick(ui, event);

    expect(ui.focusLayer).toHaveBeenCalledWith("");

    expect(ui.closeMoreMenu).toHaveBeenCalledWith(true);
  });
});
