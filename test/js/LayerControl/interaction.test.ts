import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureInteraction } from "#core/interaction.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import {
  handleMoreClick,
  handleMoreMenuClick,
  registerInteractions,
} from "#foliplus/LayerControl/interaction.js";
import * as Attr from "#foliplus/LayerControl/ui/attr.js";
import * as Focus from "#foliplus/LayerControl/ui/focus.js";
import * as Keyboard from "#foliplus/LayerControl/ui/keyboard.js";
import * as Menu from "#foliplus/LayerControl/ui/menu.js";
import * as Rename from "#foliplus/LayerControl/ui/rename.js";
import * as Style from "#foliplus/LayerControl/ui/style/index.js";
import { attachFaces } from "./ui/fixture.js";

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
  return attachFaces({
    uiContainer: container,
    m: { map },
    handleKeyDown: vi.fn(),
    handleOutsideMousedown: vi.fn(),
    openMoreMenu: vi.fn(),
    focusLayer: vi.fn(),
    closeMoreMenu: vi.fn(),
    renameLayer: vi.fn(),
    openStylePanel: vi.fn(),
    openAttrsPanel: vi.fn(),
    activeIdx: null,
    activeMenu: null,
  });
}

// ===========================================================================
describe("LayerControl registerInteractions", () => {
  let keyDownSpy: ReturnType<typeof vi.spyOn>;
  let outsideSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    keyDownSpy = vi.spyOn(Keyboard, "handleKeyDown");
    outsideSpy = vi.spyOn(Keyboard, "handleOutsideMousedown");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("returns a cleanup function", () => {
    const ui = makeUI();
    const cleanup = registerInteractions(ui.la, ui.panelStore, ui.focusStore);
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("registers all 7 keyboard shortcuts via InteractionManager", () => {
    const ui = makeUI();
    registerInteractions(ui.la, ui.panelStore, ui.focusStore);

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

  it("all keyboard shortcuts share the uiContainer as their container", () => {
    const ui = makeUI();
    registerInteractions(ui.la, ui.panelStore, ui.focusStore);

    const defs = getRegisterSpy().mock.calls[0][1] as any[];
    const keyDefs = defs.filter(d => d.container);
    expect(keyDefs).toHaveLength(7);
    for (const d of keyDefs) {
      expect(d.container).toBe(ui.panelStore.uiContainer);
    }
  });

  it("each keyboard shortcut handler forwards its event to ui.handleKeyDown", () => {
    const ui = makeUI();
    registerInteractions(ui.la, ui.panelStore, ui.focusStore);

    const defs = getRegisterSpy().mock.calls[0][1] as any[];
    const keyDefs = defs.filter(d => d.container);
    for (const d of keyDefs) {
      const event = { key: d.key } as unknown as KeyboardEvent;
      d.handler(event);
    }

    // Every handler is a pass-through to ui.handleKeyDown — one call per key.
    expect(keyDownSpy).toHaveBeenCalledTimes(keyDefs.length);
    // Spot-check that the event (and thus its key) is forwarded as-is.
    expect(keyDownSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ key: "ArrowUp" }),
    );
    expect(keyDownSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ key: "Escape" }),
    );
  });

  it("registers the outside-mousedown dismissal as an observed (non-swallowed) event", () => {
    const ui = makeUI();
    registerInteractions(ui.la, ui.panelStore, ui.focusStore);

    const defs = getRegisterSpy().mock.calls[0][1] as any[];
    const mouseDefs = defs.filter(d => d.event === "mousedown");
    expect(mouseDefs).toHaveLength(1);
    // The press must keep its native behavior (focus move, map drag), so the
    // manager must not match-and-cancel it — and it has no container binding:
    // "outside" is a class-level test on the event target, not a focus check.
    expect(mouseDefs[0].preventDefault).toBe(false);
    expect(mouseDefs[0].container).toBeUndefined();
    expect(mouseDefs[0].key).toBeUndefined();

    mouseDefs[0].handler({ type: "mousedown" });
    expect(outsideSpy).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
describe("LayerControl handleMoreClick", () => {
  let openMoreMenuSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    openMoreMenuSpy = vi.spyOn(Menu, "openMoreMenu");
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("calls openMoreMenu with the closest layer item", () => {
    const ui = makeUI();
    document.body.appendChild(ui.panelStore.uiContainer);

    const btn = ui.panelStore.uiContainer.querySelector(
      `.${CONST.CLASSES.MORE_BTN}`,
    ) as HTMLButtonElement;
    const item = btn.closest(`.${CONST.CLASSES.LAYER_ITEM}`) as HTMLElement;

    const stopPropagationSpy = vi.fn();
    const preventDefaultSpy = vi.fn();
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: btn });
    Object.defineProperty(event, "stopPropagation", { value: stopPropagationSpy });
    Object.defineProperty(event, "preventDefault", { value: preventDefaultSpy });
    handleMoreClick(ui.la, ui.panelStore, ui.focusStore, event);

    expect(openMoreMenuSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      item,
    );
    expect(stopPropagationSpy).toHaveBeenCalled();
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it("does nothing when the target is not a more button", () => {
    const ui = makeUI();
    document.body.appendChild(ui.panelStore.uiContainer);

    const item = ui.panelStore.uiContainer.querySelector(
      `.${CONST.CLASSES.LAYER_ITEM}`,
    ) as HTMLElement;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: item });
    handleMoreClick(ui.la, ui.panelStore, ui.focusStore, event);

    expect(openMoreMenuSpy).not.toHaveBeenCalled();
  });

  it("does nothing when the button is not inside a layer item", () => {
    const ui = makeUI();
    const btn = document.createElement("button");
    btn.className = CONST.CLASSES.MORE_BTN;
    document.body.appendChild(btn);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: btn });
    handleMoreClick(ui.la, ui.panelStore, ui.focusStore, event);

    expect(openMoreMenuSpy).not.toHaveBeenCalled();
  });
});

// ===========================================================================
describe("LayerControl handleMoreMenuClick", () => {
  let focusSpy: ReturnType<typeof vi.spyOn>;
  let closeMenuSpy: ReturnType<typeof vi.spyOn>;
  let renameSpy: ReturnType<typeof vi.spyOn>;
  let styleSpy: ReturnType<typeof vi.spyOn>;
  let attrsSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    focusSpy = vi.spyOn(Focus, "focusLayer");
    closeMenuSpy = vi.spyOn(Menu, "closeMoreMenu");
    renameSpy = vi.spyOn(Rename, "renameLayer");
    styleSpy = vi.spyOn(Style, "openStylePanel");
    attrsSpy = vi.spyOn(Attr, "openAttrsPanel");
  });

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

    ui.panelStore.activeMenu = {
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
    handleMoreMenuClick(ui.la, ui.panelStore, ui.focusStore, event);

    expect(focusSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "layer1",
    );
    expect(closeMenuSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      true,
    );
  });

  it("dispatches rename-layer action → renames inline and keeps focus in the row", () => {
    const { ui, li } = buildMenu();
    li.dataset.action = "rename-layer";

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: li });
    handleMoreMenuClick(ui.la, ui.panelStore, ui.focusStore, event);

    expect(renameSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "layer1",
    );
    // The inline rename input must keep focus: returning it to the row would
    // blur-commit the pre-edit value.
    expect(closeMenuSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      false,
    );
  });

  it("dispatches style-layer action → opens the style panel by layer id", () => {
    const { ui, li } = buildMenu();
    li.dataset.action = "style-layer";

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: li });
    handleMoreMenuClick(ui.la, ui.panelStore, ui.focusStore, event);

    expect(styleSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "layer1",
    );
    expect(closeMenuSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      true,
    );
  });

  it("dispatches attrs action → anchors the attributes panel to the menu's row", () => {
    const { ui, li } = buildMenu();
    li.dataset.action = "layer-attributes";

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: li });
    const attrsTarget = ui.panelStore.activeMenu.item;
    handleMoreMenuClick(ui.la, ui.panelStore, ui.focusStore, event);

    expect(attrsSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      attrsTarget,
    );
    expect(closeMenuSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      true,
    );
  });

  it("skips focusLayer when the menu item is disabled (hidden layer)", () => {
    const { ui, li } = buildMenu(true);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: li });
    handleMoreMenuClick(ui.la, ui.panelStore, ui.focusStore, event);

    expect(focusSpy).not.toHaveBeenCalled();
    expect(closeMenuSpy).not.toHaveBeenCalled();
  });

  it("does nothing when the target is not a menu li", () => {
    const { ui, li } = buildMenu();
    const ul = li.parentElement!;

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: ul });
    handleMoreMenuClick(ui.la, ui.panelStore, ui.focusStore, event);

    expect(focusSpy).not.toHaveBeenCalled();
    expect(closeMenuSpy).not.toHaveBeenCalled();
  });

  it("closes the menu when clicking outside it (panel / map)", () => {
    const { ui } = buildMenu();
    const outside = document.createElement("div");
    document.body.appendChild(outside);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: outside });
    handleMoreMenuClick(ui.la, ui.panelStore, ui.focusStore, event);

    expect(closeMenuSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      false,
    );
    outside.remove();
  });

  it("is a no-op for an outside click when no menu is open", () => {
    const ui = makeUI();
    const outside = document.createElement("div");
    document.body.appendChild(outside);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: outside });
    handleMoreMenuClick(ui.la, ui.panelStore, ui.focusStore, event);

    expect(closeMenuSpy).not.toHaveBeenCalled();
    outside.remove();
  });

  it("does not call focusLayer for an unknown action", () => {
    const ui = makeUI();
    const menu = document.createElement("ul");
    menu.className = "foliplus-layer-more-menu";
    const li = document.createElement("li");
    li.dataset.action = "unknown-action";
    menu.appendChild(li);
    ui.panelStore.activeMenu = {
      item: document.createElement("div"),
      menu,
      layerId: "layer1",
    };
    document.body.appendChild(menu);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: li });
    handleMoreMenuClick(ui.la, ui.panelStore, ui.focusStore, event);

    expect(focusSpy).not.toHaveBeenCalled();
    expect(closeMenuSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      true,
    );
  });

  it("does not call focusLayer for a li without data-action", () => {
    const ui = makeUI();
    const menu = document.createElement("ul");
    menu.className = "foliplus-layer-more-menu";
    const li = document.createElement("li");
    menu.appendChild(li);
    ui.panelStore.activeMenu = {
      item: document.createElement("div"),
      menu,
      layerId: "layer1",
    };
    document.body.appendChild(menu);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: li });
    handleMoreMenuClick(ui.la, ui.panelStore, ui.focusStore, event);

    expect(focusSpy).not.toHaveBeenCalled();
    expect(closeMenuSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      true,
    );
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
    handleMoreMenuClick(ui.la, ui.panelStore, ui.focusStore, event);

    expect(focusSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "",
    );
    expect(closeMenuSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      true,
    );
  });

  it("rename/style/attrs actions with no active menu fall back safely", () => {
    const ui = makeUI(); // activeMenu stays null
    const menu = document.createElement("ul");
    menu.className = "foliplus-layer-more-menu";
    const li = document.createElement("li");
    menu.appendChild(li);
    document.body.appendChild(menu);

    // rename/style fall back to an empty id; attrs anchors to the li itself.
    const cases = [
      ["rename-layer", renameSpy, ""],
      ["style-layer", styleSpy, ""],
      ["layer-attributes", attrsSpy, li],
    ] as const;
    for (const [action, spy, expected] of cases) {
      li.dataset.action = action;
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "target", { value: li });
      handleMoreMenuClick(ui.la, ui.panelStore, ui.focusStore, event);
      expect(spy).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expected,
      );
    }
  });
});
