// HeatmapControl interaction — scheme bar/dropdown keyboard events.
import { ensureInteraction } from "#core/interaction.js";

export const registerSchemeBarEvents = (map: L.Map, ctrl: any): (() => void) => {
  return ensureInteraction(map).register(CONF.name, [
    {
      key: "ArrowLeft",
      element: ctrl.schemeBar,
      handler: () => {
        const idx = ctrl.availableSchemes.indexOf(ctrl.scheme);
        if (idx > 0) {
          ctrl.scheme = ctrl.availableSchemes[idx - 1];
          ctrl.updateScheme();
        }
      },
    },
    {
      key: "ArrowRight",
      element: ctrl.schemeBar,
      handler: () => {
        const idx = ctrl.availableSchemes.indexOf(ctrl.scheme);
        if (idx < ctrl.availableSchemes.length - 1) {
          ctrl.scheme = ctrl.availableSchemes[idx + 1];
          ctrl.updateScheme();
        }
      },
    },
    {
      key: "Enter",
      element: ctrl.schemeBar,
      handler: () => {
        ctrl.toggleDropdown?.();
      },
    },
    {
      key: " ",
      element: ctrl.schemeBar,
      handler: () => {
        ctrl.toggleDropdown?.();
      },
    },
    {
      key: "ArrowUp",
      element: ctrl.schemeBar,
      handler: () => {
        ctrl.toggleDropdown?.();
      },
    },
    {
      key: "ArrowDown",
      element: ctrl.schemeBar,
      handler: () => {
        ctrl.toggleDropdown?.();
      },
    },
  ]);
};

export const registerDropdownEvents = (
  map: L.Map,
  ctrl: any,
  items: HTMLElement[],
): (() => void) => {
  return ensureInteraction(map).register(CONF.name + "-dropdown", [
    {
      key: "ArrowDown",
      element: ctrl.schemeDropdown,
      handler: () => {
        const activeIdx = items.indexOf(document.activeElement as HTMLElement);
        items[(activeIdx + 1) % items.length].focus();
      },
    },
    {
      key: "ArrowUp",
      element: ctrl.schemeDropdown,
      handler: () => {
        const activeIdx = items.indexOf(document.activeElement as HTMLElement);
        items[(activeIdx - 1 + items.length) % items.length].focus();
      },
    },
    {
      key: "Enter",
      element: ctrl.schemeDropdown,
      handler: () => {
        const active = document.activeElement;
        if (active?.classList.contains("foliplus-scheme-dropdown-item")) {
          const idx = items.indexOf(active as HTMLElement);
          ctrl.selectScheme?.(idx);
        }
      },
    },
    {
      key: "Escape",
      element: ctrl.schemeDropdown,
      handler: () => {
        ctrl.schemeDropdown?.remove();
        ctrl.schemeDropdown = null;
        ctrl.schemeBar?.classList.remove("foliplus-scheme-bar-open");
        ctrl.schemeBar?.focus();
      },
    },
  ]);
};
