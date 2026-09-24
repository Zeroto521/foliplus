import { HINT_DURATION } from "#core/hint.js";
import { ensureLayerAPI } from "#core/layer/index.js";
import { BaseControl } from "#foliplus/BaseControl.js";
import { dom } from "#common/dom.js";
import { createScopedTranslator, createTranslator } from "#common/locale.js";
import { createPanelControl } from "#common/panel.js";
import { restoreDefaults } from "./logic.js";

// ── SVG icon ── a sliders glyph, "style controls". Stroke comes from
// common/button.css' shared button rule, so no inline presentation attributes.
const STYLEKIT = `
  <svg viewBox="0 0 24 24">
    <line x1="4" y1="7" x2="20" y2="7"/>
    <line x1="4" y1="17" x2="20" y2="17"/>
    <circle cx="9" cy="7" r="2.4"/>
    <circle cx="15" cy="17" r="2.4"/>
  </svg>`;

const _ = createTranslator(CONF);
const T = createScopedTranslator(CONF);
ensureLayerAPI(map);

class StyleKitControl extends BaseControl {
  declare container: HTMLElement;
  declare panel: HTMLElement;
  declare restoreBtn: HTMLButtonElement;

  buildDOM() {
    const { container, ctrl, panelContent, destroy } = createPanelControl({
      cssClass: "foliplus-stylekit-ctrl",
      toggleTitle: T("title"),
      toggleSvg: STYLEKIT,
      panelTitle: T("title"),
      closeTitle: _("foliplus.close_label"),
    });
    // See HeatmapControl.buildDOM: keeps the factory's document-level listeners
    // from outliving a control that is removed but not garbage-collected.
    this.effect(() => destroy);

    this.restoreBtn = dom.el(
      "button",
      {
        class: "foliplus-panel-btn stylekit-action",
        title: T("restore_defaults"),
        "aria-label": T("restore_defaults"),
        onclick: () => {
          const restored = restoreDefaults(map.foliplus!.LayerAPI.layers);
          if (restored > 0) {
            map.foliplus!.showHint(CONF.name, T("restored"), HINT_DURATION.SHORT);
          }
        },
      },
      T("restore_defaults"),
    ) as HTMLButtonElement;
    panelContent.append(this.restoreBtn);

    this.container = container;
    this.panel = ctrl;
    return container;
  }
}

new StyleKitControl({ position: CONF.position }).addTo(map);
