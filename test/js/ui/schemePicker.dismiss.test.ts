// test/js/ui/schemePicker.dismiss — dismissal belongs to the overlay registry,
// one layer at a time.
//
// The picker used to declare `dismiss: { kind: "local" }` while the listbox
// engine had no local implementation: the portalled popup registered no entry
// of its own, so an Escape fell through to the host panel (closing both) and a
// picker outside a host could not be dismissed at all. The fix injects the same
// per-map registry hook the dropdown already uses, so the single dispatcher
// closes exactly the top surface and the host panel survives.
//
// These tests drive the real registry (document capture listeners included), not
// a mock: a mocked register could pass while the dispatcher still closed the
// host panel.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ESC_PRIORITY,
  OVERLAY_IDS,
  ensureOverlayRegistry,
} from "#core/overlay/index.js";
import { type SchemePicker, createSchemePicker } from "#ui/index.js";

const colorScale = vi.fn((_name: string, n: number) => Array(n).fill("#999"));

/** A stand-in map: the registry only needs the unload hook it subscribes to. */
const fakeMap = (): object => ({ on: () => undefined });

const overlayOf = (registry: ReturnType<typeof ensureOverlayRegistry>) => ({
  register: registry.register.bind(registry),
  id: OVERLAY_IDS.LAYER_PICKER_DROPDOWN,
  rank: ESC_PRIORITY[OVERLAY_IDS.LAYER_PICKER_DROPDOWN],
});

const makeHostPanel = (map: object) => {
  const host = document.createElement("div");
  host.className = "foliplus-panel";
  document.body.append(host);
  const state = { open: true };
  const registry = ensureOverlayRegistry(map as never);
  const unregister = registry.register({
    id: OVERLAY_IDS.LAYER_STYLE,
    isOpen: () => state.open,
    close: () => {
      state.open = false;
    },
    panels: () => [host],
    dismissOn: "mousedown",
    pressPriority: ESC_PRIORITY[OVERLAY_IDS.LAYER_STYLE],
  });
  return { host, state, registry, unregister };
};

const makePicker = (
  overlay: ReturnType<typeof overlayOf>,
): {
  picker: SchemePicker;
  trigger: HTMLElement;
} => {
  const trigger = document.createElement("div");
  trigger.className = "foliplus-heatmap-scheme-bar";
  trigger.setAttribute("tabindex", "0");
  trigger.setAttribute("role", "combobox");
  const inner = document.createElement("div");
  inner.setAttribute("data-scheme-bar-inner", "");
  trigger.appendChild(inner);
  const hiddenSelect = document.createElement("select");
  // The trigger lives in its own container, the way a panel wraps it: the
  // listbox uses the trigger's parentElement as the popup's containment
  // wrapper, so appending the trigger straight to <body> would make the whole
  // page "inside" the surface and an outside press meaningless.
  const wrapper = document.createElement("div");
  wrapper.className = "foliplus-panel-row";
  wrapper.append(trigger, hiddenSelect);
  document.body.append(wrapper);
  const picker = createSchemePicker({
    trigger,
    hiddenSelect,
    schemes: ["Reds", "Blues", "Greens"],
    value: "Reds",
    numClasses: 6,
    portal: true,
    onChange: vi.fn(),
    colorScale,
    overlay,
  });
  return { picker, trigger };
};

const openPicker = (trigger: HTMLElement): void => {
  trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("scheme picker dismissal", () => {
  it("Escape closes only the picker, leaving the host panel open", () => {
    const host = makeHostPanel(fakeMap());
    const { picker, trigger } = makePicker(overlayOf(host.registry));
    openPicker(trigger);
    expect(picker.getDropdown()).not.toBeNull();

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );

    expect(picker.getDropdown()).toBeNull();
    expect(host.state.open).toBe(true);
    host.unregister();
    picker.destroy();
    host.registry.destroy();
  });

  it("an outside press closes only the picker, leaving the host panel open", () => {
    const host = makeHostPanel(fakeMap());
    const { picker, trigger } = makePicker(overlayOf(host.registry));
    openPicker(trigger);
    expect(picker.getDropdown()).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(picker.getDropdown()).toBeNull();
    expect(host.state.open).toBe(true);
    host.unregister();
    picker.destroy();
    host.registry.destroy();
  });
});
