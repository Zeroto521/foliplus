// HeatmapControl interaction — scheme bar/dropdown keyboard events.
import { ensureInteraction } from "#core/interaction.js";

const registerSchemeBarEvents = (map: L.Map, ctrl: any): (() => void) => {
  const schemes = CONF.schemes ?? [];

  const setScheme = (name: string) => {
    ctrl.m.currentScheme = name;
    if (ctrl.schemeSelectHidden) ctrl.schemeSelectHidden.value = name;

    ctrl.updateScheme();
  };
  return ensureInteraction(map).register(CONF.name, [
    {
      key: "ArrowUp",
      element: ctrl.schemeBar,
      handler: () => {
        const idx = schemes.indexOf(ctrl.m.currentScheme);
        if (idx > 0) {
          setScheme(schemes[idx - 1]);
        }
      },
    },
    {
      key: "ArrowDown",
      element: ctrl.schemeBar,
      handler: () => {
        const idx = schemes.indexOf(ctrl.m.currentScheme);
        if (idx < schemes.length - 1) {
          setScheme(schemes[idx + 1]);
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
  ]);
};

const registerDropdownEvents = (
  map: L.Map,
  ctrl: any,
  items: HTMLElement[],
): (() => void) => {
  return ensureInteraction(map).register(`${CONF.name}-dropdown`, [
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
        if (active?.classList.contains("foliplus-heatmap-scheme-dropdown-item")) {
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

export { registerSchemeBarEvents, registerDropdownEvents };
